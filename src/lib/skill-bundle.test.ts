import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectSkillBundleEntries, packSkillBundle, sha256Hex, unpackSkillBundle } from "./skill-bundle.js";

/**
 * Each test gets its own temp directory.
 *
 * Not a shared one cleaned between tests: a shared directory turns a cleanup that misses
 * a file into a different test's input, which relocates pollution rather than removing it
 * and makes failures depend on execution order.
 */
function withSkillDir(files: Record<string, string | Uint8Array>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "skills-bundle-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const absolute = join(dir, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content as never);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MINIMAL = {
  "SKILL.md": "---\nname: demo\ndescription: A demo skill\n---\n\n# Demo\n",
  "skill.json": '{"standard":"hasna.skill.v1","name":"demo"}\n',
  "src/index.ts": "console.log('hi');\n",
};

describe("packSkillBundle", () => {
  test("packs the files present and reports them", () => {
    withSkillDir(MINIMAL, (dir) => {
      const packed = packSkillBundle(dir);
      expect(packed.paths).toEqual(["SKILL.md", "skill.json", "src/index.ts"]);
      expect(packed.fileCount).toBe(3);
      expect(packed.bytes.byteLength).toBeGreaterThan(0);
      expect(packed.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(packed.sha256).toBe(sha256Hex(packed.bytes));
      expect(packed.unpackedByteSize).toBe(
        Object.values(MINIMAL).reduce((sum, value) => sum + new TextEncoder().encode(value as string).byteLength, 0),
      );
    });
  });

  test("is byte-identical across repeated packs of the same sources", () => {
    withSkillDir(MINIMAL, (dir) => {
      const first = packSkillBundle(dir);
      const second = packSkillBundle(dir);
      expect(second.sha256).toBe(first.sha256);
      expect(Array.from(second.bytes)).toEqual(Array.from(first.bytes));
    });
  });

  test("is byte-identical across two directories holding the same content", () => {
    // The stronger claim: the digest addresses content, not a particular directory's
    // inode timestamps. Two machines packing the same skill must agree.
    let firstDigest = "";
    withSkillDir(MINIMAL, (dir) => { firstDigest = packSkillBundle(dir).sha256; });
    withSkillDir(MINIMAL, (dir) => { expect(packSkillBundle(dir).sha256).toBe(firstDigest); });
  });

  test("the digest ignores file modification times", () => {
    // The two determinism tests above are NOT sufficient and were verified not to be:
    // both packs happen inside the same second, so an implementation writing the real
    // mtime into the tar header passes them both. Backdating the sources by a year is
    // what makes a leaked timestamp change the bytes.
    let recent = "";
    withSkillDir(MINIMAL, (dir) => { recent = packSkillBundle(dir).sha256; });
    withSkillDir(MINIMAL, (dir) => {
      const ancient = new Date("1999-04-05T06:07:08Z");
      for (const path of Object.keys(MINIMAL)) utimesSync(join(dir, path), ancient, ancient);
      expect(packSkillBundle(dir).sha256).toBe(recent);
    });
  });

  test("the gzip container header carries no machine-specific bytes", () => {
    // The tar being canonical is only half of it: zlib stamps the gzip member header with
    // an MTIME (bytes 4-7) and the BUILD PLATFORM's OS byte (byte 9 - 0x03 on Linux,
    // 0x00 on Windows, 0x13 on macOS). Two machines packing identical sources would
    // otherwise publish the same skill under two different digests, which is precisely
    // what a content address must not do. Verified not to be covered by the tar-header
    // test above.
    withSkillDir(MINIMAL, (dir) => {
      const bytes = packSkillBundle(dir).bytes;
      expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]); // gzip magic; anti-vacuity
      expect([bytes[4], bytes[5], bytes[6], bytes[7]]).toEqual([0, 0, 0, 0]); // MTIME
      expect(bytes[9]).toBe(0xff); // OS: "unknown", rather than whichever built this zlib
    });
  });

  test("the compression level is pinned, not inherited from the runtime default", () => {
    // Recompressed here with an EXPLICIT level rather than by calling the implementation
    // again, so this fails if the default ever moves rather than moving with it.
    withSkillDir(MINIMAL, (dir) => {
      const packed = packSkillBundle(dir);
      const canonical = new Uint8Array(Bun.gzipSync(Bun.gunzipSync(packed.bytes), { level: 6 }));
      canonical[4] = 0; canonical[5] = 0; canonical[6] = 0; canonical[7] = 0; canonical[9] = 0xff;
      expect(sha256Hex(packed.bytes)).toBe(sha256Hex(canonical));
    });
  });

  test("every header pins mtime, uid, and gid to zero", () => {
    // Asserted on the bytes rather than inferred from two digests matching, so the
    // property holds for reasons a reader can check rather than by coincidence of timing.
    withSkillDir(MINIMAL, (dir) => {
      const tar = Bun.gunzipSync(packSkillBundle(dir).bytes);
      const decoder = new TextDecoder();
      let offset = 0;
      let headers = 0;
      while (offset + 512 <= tar.byteLength) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        expect(decoder.decode(header.subarray(136, 147))).toBe("00000000000"); // mtime
        expect(decoder.decode(header.subarray(108, 115))).toBe("0000000"); // uid
        expect(decoder.decode(header.subarray(116, 123))).toBe("0000000"); // gid
        expect(decoder.decode(header.subarray(265, 297)).replace(/\0+$/, "")).toBe(""); // uname
        expect(decoder.decode(header.subarray(297, 329)).replace(/\0+$/, "")).toBe(""); // gname
        headers += 1;
        const size = Number.parseInt(decoder.decode(header.subarray(124, 135)), 8);
        offset += 512 + Math.ceil(size / 512) * 512;
      }
      // Anti-vacuity: the loop above asserts nothing if it never finds a header.
      expect(headers).toBe(3);
    });
  });

  test("a one-byte content change changes the digest", () => {
    let unchanged = "";
    withSkillDir(MINIMAL, (dir) => { unchanged = packSkillBundle(dir).sha256; });
    withSkillDir({ ...MINIMAL, "src/index.ts": "console.log('hI');\n" }, (dir) => {
      expect(packSkillBundle(dir).sha256).not.toBe(unchanged);
    });
  });

  test("refuses to pack a directory with no packable files", () => {
    withSkillDir({ "node_modules/left-pad/index.js": "x" }, (dir) => {
      expect(() => packSkillBundle(dir)).toThrow(/Nothing to pack/);
    });
  });

  test("enforces the unpacked size limit before compressing", () => {
    withSkillDir({ ...MINIMAL, "big.txt": "x".repeat(5000) }, (dir) => {
      expect(() => packSkillBundle(dir, { maxUnpackedBytes: 1000 })).toThrow(/over the 1000 byte limit/);
      // 0 disables, and is not confused with "no limit supplied".
      expect(packSkillBundle(dir, { maxUnpackedBytes: 0 }).fileCount).toBe(4);
    });
  });

  test("refuses a path too long for a ustar header rather than truncating it", () => {
    withSkillDir({ ...MINIMAL, [`src/${"d".repeat(120)}.ts`]: "x" }, (dir) => {
      expect(() => packSkillBundle(dir)).toThrow(/longer than the 100 bytes/);
    });
  });
});

describe("bundle exclusions", () => {
  test("drops VCS, dependency, and OS junk at any depth", () => {
    withSkillDir({
      ...MINIMAL,
      ".git/config": "[core]\n",
      "node_modules/left-pad/index.js": "module.exports = 1;\n",
      "references/node_modules/nested/index.js": "nested\n",
      "._SKILL.md": "apple double\n",
      ".DS_Store": "junk\n",
      "references/guide.md": "keep me\n",
    }, (dir) => {
      expect(packSkillBundle(dir).paths).toEqual(["SKILL.md", "references/guide.md", "skill.json", "src/index.ts"]);
    });
  });

  test("drops build output at the root but keeps a nested one", () => {
    withSkillDir({
      ...MINIMAL,
      "dist/index.js": "built\n",
      "build/out.js": "built\n",
      "references/build/example.md": "a real reference\n",
    }, (dir) => {
      const paths = packSkillBundle(dir).paths;
      expect(paths).toContain("references/build/example.md");
      expect(paths).not.toContain("dist/index.js");
      expect(paths).not.toContain("build/out.js");
    });
  });

  test("never packs a credential file, whatever it is called or where it sits", () => {
    // Every name here was demonstrated by adversarial review to reach the tarball under
    // the first version of this filter, which matched `.env`/`.env.*` and six exact
    // filenames, case-sensitively.
    const leaks: Record<string, string> = {
      ".envrc": "export AWS_SECRET_ACCESS_KEY=direnv-leak\n",
      ".ENV": "UPPER=uppercase-leak\n",
      ".Env.local": "MIXED=mixedcase-leak\n",
      "env.local": "NODOT=nodot-leak\n",
      ".pgpass": "host:5432:db:user:pgpass-leak\n",
      "server.pem": "pem-leak-placeholder-not-a-real-key\n",
      "tls.key": "tlskey-leak\n",
      "id_ecdsa": "ecdsa-leak\n",
      "sub/.envrc": "export TOKEN=nested-direnv-leak\n",
      ".aws/credentials": "aws_secret_access_key = awsdir-leak\n",
      ".ssh/id_rsa": "ssh-dir-leak\n",
      "references/service.pem": "nested-pem-leak\n",
    };
    withSkillDir({ ...MINIMAL, ...leaks }, (dir) => {
      const packed = packSkillBundle(dir);
      for (const name of Object.keys(leaks)) expect(packed.paths).not.toContain(name);
      const text = new TextDecoder().decode(concatEntries(unpackSkillBundle(packed.bytes)));
      for (const value of Object.values(leaks)) {
        const secret = value.trim().split(/[=:\s]/).filter(Boolean).pop()!;
        expect(text).not.toContain(secret);
      }
      // Anti-vacuity: the real content is still there, so the assertions above are not
      // passing because the bundle is empty.
      expect(packed.paths).toEqual(["SKILL.md", "skill.json", "src/index.ts"]);
      expect(text).toContain("A demo skill");
    });
  });

  test("keeps env-prefixed source and an env/ directory, dropping only real dotenv files", () => {
    // A dotenv file's suffix names an environment (local, production, ...), never a file
    // type. Source that merely shares the `env.` prefix - `env.ts`, `env.mjs`, `env.json`,
    // `env.config.js` - and a directory literally named `env/` are content and must survive
    // the pack, while the actual dotless dotenv files (`env.local`, `env.production`) must
    // still be dropped so the security guarantee this filter exists for is not weakened.
    withSkillDir({
      ...MINIMAL,
      "src/env.ts": "export const env = process.env;\n",
      "src/env.js": "module.exports = process.env;\n",
      "src/env.mjs": "export default process.env;\n",
      "src/env.config.js": "module.exports = {};\n",
      "config/env.json": '{"schema":true}\n',
      "env/schema.ts": "export type Env = Record<string, string>;\n",
      "lib/environment.ts": "export const environment = 1;\n",
      "env.local": "SECRET=dotless-env-local-leak\n",
      "env.production": "SECRET=dotless-env-prod-leak\n",
    }, (dir) => {
      const packed = packSkillBundle(dir);
      for (const kept of [
        "src/env.ts", "src/env.js", "src/env.mjs", "src/env.config.js",
        "config/env.json", "env/schema.ts", "lib/environment.ts",
      ]) {
        expect(packed.paths).toContain(kept);
      }
      for (const dropped of ["env.local", "env.production"]) {
        expect(packed.paths).not.toContain(dropped);
      }
      // Belt and braces: assert on the bytes, not only the path list. The dropped secrets
      // are absent, and the kept source is really present rather than reported-but-omitted.
      const text = new TextDecoder().decode(concatEntries(unpackSkillBundle(packed.bytes)));
      expect(text).not.toContain("dotless-env-local-leak");
      expect(text).not.toContain("dotless-env-prod-leak");
      expect(text).toContain("export type Env");
    });
  });

  test("keeps env templates, which carry names rather than values", () => {
    withSkillDir({ ...MINIMAL, ".env.example": "OPENAI_API_KEY=\n", ".env.sample": "X=\n" }, (dir) => {
      const paths = packSkillBundle(dir).paths;
      expect(paths).toContain(".env.example");
      expect(paths).toContain(".env.sample");
    });
  });

  test("never packs a .env, at any depth, but keeps .env.example", () => {
    // The one exclusion that is a security property rather than tidiness: `skills push`
    // uploads to a server other people can read.
    withSkillDir({
      ...MINIMAL,
      ".env": "OPENAI_API_KEY=would-have-been-uploaded\n",
      ".env.local": "TOKEN=also-would-have\n",
      ".env.production": "TOKEN=and-this\n",
      "references/.env": "NESTED_SECRET=nested\n",
      ".env.example": "OPENAI_API_KEY=\n",
    }, (dir) => {
      const packed = packSkillBundle(dir);
      expect(packed.paths).toContain(".env.example");
      for (const forbidden of [".env", ".env.local", ".env.production", "references/.env"]) {
        expect(packed.paths).not.toContain(forbidden);
      }
      // Belt and braces: assert on the bytes, not only on the reported path list. A
      // filter that reported the right paths while still writing the file would pass a
      // path-only assertion.
      const text = new TextDecoder().decode(concatEntries(unpackSkillBundle(packed.bytes)));
      expect(text).not.toContain("would-have-been-uploaded");
      expect(text).not.toContain("NESTED_SECRET");
    });
  });

  test("skips symlinks instead of following or recording them", () => {
    withSkillDir(MINIMAL, (dir) => {
      const outside = mkdtempSync(join(tmpdir(), "skills-bundle-outside-"));
      try {
        writeFileSync(join(outside, "secret.txt"), "outside the skill\n");
        symlinkSync(outside, join(dir, "escape"));
        symlinkSync(join(outside, "secret.txt"), join(dir, "escape.txt"));
        const packed = packSkillBundle(dir);
        expect(packed.paths).toEqual(["SKILL.md", "skill.json", "src/index.ts"]);
        const text = new TextDecoder().decode(concatEntries(unpackSkillBundle(packed.bytes)));
        expect(text).not.toContain("outside the skill");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});

describe("round trip", () => {
  test("unpack returns exactly what was packed, including binary content", () => {
    // 0x00 through 0xff: the case a text-only pipeline mangles silently.
    const binary = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) binary[i] = i;
    withSkillDir({ ...MINIMAL, "assets/all-bytes.bin": binary }, (dir) => {
      const packed = packSkillBundle(dir);
      const entries = unpackSkillBundle(packed.bytes);
      expect(entries.map((entry) => entry.path)).toEqual(packed.paths);

      const restored = entries.find((entry) => entry.path === "assets/all-bytes.bin");
      expect(restored).toBeTruthy();
      expect(Array.from(restored!.bytes)).toEqual(Array.from(binary));

      const skillMd = entries.find((entry) => entry.path === "SKILL.md");
      expect(new TextDecoder().decode(skillMd!.bytes)).toBe(MINIMAL["SKILL.md"]);
    });
  });

  test("survives a file whose size is an exact multiple of the 512-byte block", () => {
    // The padding arithmetic's boundary case: a wrong `remainder === 0` branch writes an
    // extra block and every later entry is read at the wrong offset.
    const exact = "z".repeat(1024);
    withSkillDir({ ...MINIMAL, "exact.txt": exact, "after.txt": "still readable\n" }, (dir) => {
      const entries = unpackSkillBundle(packSkillBundle(dir).bytes);
      expect(new TextDecoder().decode(entries.find((entry) => entry.path === "exact.txt")!.bytes)).toBe(exact);
      expect(new TextDecoder().decode(entries.find((entry) => entry.path === "after.txt")!.bytes)).toBe("still readable\n");
    });
  });

  test("preserves the executable bit as a normalised mode", () => {
    withSkillDir(MINIMAL, (dir) => {
      const entries = collectSkillBundleEntries(dir);
      for (const entry of entries) expect([0o644, 0o755]).toContain(entry.mode);
    });
  });

  test("a truncated archive is rejected rather than silently short", () => {
    withSkillDir({ ...MINIMAL, "big.txt": "y".repeat(4096) }, (dir) => {
      const packed = packSkillBundle(dir);
      const tar = Bun.gunzipSync(packed.bytes);
      // Lopped after a whole entry: the case that used to return three of four files and
      // report success, because the read loop's exit condition doubled as its success
      // condition.
      expect(() => unpackSkillBundle(Bun.gzipSync(tar.slice(0, tar.byteLength - 2048)))).toThrow(/truncated/);
      // Lopped mid-body: caught by the size/offset check instead.
      expect(() => unpackSkillBundle(Bun.gzipSync(tar.slice(0, 1024)))).toThrow(/corrupt bundle/);
    });
  });

  test("an entry that is not a regular file is refused on read", () => {
    // A symlink entry in a downloaded bundle points wherever its author chose; a GNU
    // LongLink header hides the real path in the body, past the path check.
    for (const [typeflag, label] of [["2", "symlink"], ["1", "hardlink"], ["5", "directory"], ["L", "GNU LongLink"]] as const) {
      expect(() => unpackSkillBundle(handmadeTar("innocent.txt", "payload", typeflag)), label)
        .toThrow(/only regular files are allowed/);
    }
    // Control: '0' and NUL are both spellings of "regular file" and must still work.
    expect(unpackSkillBundle(handmadeTar("innocent.txt", "payload", "0"))[0]!.path).toBe("innocent.txt");
    expect(unpackSkillBundle(handmadeTar("innocent.txt", "payload", "\0"))[0]!.path).toBe("innocent.txt");
  });

  test("an entry whose path escapes the extraction root is refused on read", () => {
    // There is no extractor yet. That is the point: `skills pull` will read this
    // function's output, and a bundle from a server is untrusted input.
    for (const evil of ["../../etc/passwd", "/etc/passwd", "a/../../b", "..\\..\\windows"]) {
      expect(() => unpackSkillBundle(handmadeTar(evil, "owned"))).toThrow(/unsafe bundle entry|not allowed/);
    }
    // The control: the same handmade archive with a safe path must unpack, or the four
    // assertions above would pass for a reason that has nothing to do with the path.
    expect(unpackSkillBundle(handmadeTar("src/index.ts", "owned"))[0]!.path).toBe("src/index.ts");
  });
});

/**
 * A one-entry gzipped ustar archive built by hand.
 *
 * packSkillBundle() cannot produce a traversal path - it refuses one at write time - so
 * asserting the read-side guard requires an archive this repo's writer would never emit,
 * which is exactly the archive a hostile server would send.
 */
function handmadeTar(path: string, content: string, typeflag = "0"): Uint8Array {
  const body = new TextEncoder().encode(content);
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();
  const put = (offset: number, value: string) => header.set(encoder.encode(value), offset);
  put(0, path);
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, `${body.byteLength.toString(8).padStart(11, "0")}\0`);
  put(136, `${(0).toString(8).padStart(11, "0")}\0`);
  put(148, "        ");
  put(156, typeflag);
  put(257, "ustar\0");
  put(263, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  put(148, `${checksum.toString(8).padStart(6, "0")}\0 `);

  const padded = Math.ceil(body.byteLength / 512) * 512;
  const tar = new Uint8Array(512 + padded + 1024);
  tar.set(header, 0);
  tar.set(body, 512);
  return Bun.gzipSync(tar);
}

function concatEntries(entries: Array<{ bytes: Uint8Array }>): Uint8Array {
  const total = entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const entry of entries) {
    out.set(entry.bytes, offset);
    offset += entry.bytes.byteLength;
  }
  return out;
}
