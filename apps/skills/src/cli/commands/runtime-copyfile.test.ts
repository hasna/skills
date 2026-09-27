import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, delimiter, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { preflightTarball, readBodyCapped, rollbackCopyfileRuntime, updateCopyfileRuntime } from "./runtime-copyfile.js";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

const BIN = {
  skills: "bin/index.js",
  "skills-mcp": "bin/mcp.js",
  "skills-serve": "bin/server.js",
  "skills-server": "bin/server.js",
  "skills-worker": "bin/worker.js",
  "skills-maintenance": "bin/maintenance.js",
  "skills-migrate": "bin/migrate.js",
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureHome() {
  const home = join(tmpdir(), `skills-copyfile-${crypto.randomUUID()}`);
  roots.push(home);
  const runtime = join(home, ".hasna", "skills", "runtime");
  const oldPackage = join(runtime, "0.10.6-copyfile", "node_modules", "@hasna", "skills");
  const localBin = join(home, ".local", "bin"), bunBin = join(home, ".bun", "bin");
  for (const dir of [runtime, oldPackage, localBin, bunBin, join(home, ".claude"), join(home, ".codex"), join(home, ".hasna", "skills")]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(runtime, 0o700);
  for (const [name, path] of Object.entries(BIN)) {
    const target = join(oldPackage, path);
    mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(target, `#!/usr/bin/env bun\nconsole.log("0.10.6 ${name}");\n`, { mode: 0o755 });
    for (const dir of [localBin, bunBin]) symlinkSync(relative(dir, target), join(dir, name));
  }
  writeFileSync(join(oldPackage, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "0.10.6", bin: BIN }), { mode: 0o600 });
  const configs = [
    [join(home, ".claude", "settings.json"), "{\"fixture\":\"claude\"}\n"],
    [join(home, ".codex", "config.toml"), "fixture = true\n"],
    [join(home, ".codex", "hooks.json"), "{\"fixture\":\"hooks\"}\n"],
    [join(home, ".hasna", "skills", "agent-policy.json"), "{\"fixture\":\"policy\"}\n"],
  ] as const;
  for (const [path, text] of configs) writeFileSync(path, text, { mode: 0o600 });
  const externalBin = join(tmpdir(), `skills-external-bin-${crypto.randomUUID()}`);
  roots.push(externalBin);
  mkdirSync(externalBin, { mode: 0o700 });
  for (const [name, path] of Object.entries(BIN)) symlinkSync(relative(externalBin, join(oldPackage, path)), join(externalBin, name));
  return { home, runtime, oldPackage, localBin, bunBin, externalBin, configs };
}

async function serverWithArtifact() {
  const artifact = await new Bun.Archive({
    "package/package.json": JSON.stringify({ name: "@hasna/skills", version: "0.10.8", bin: BIN, dependencies: {} }),
    "package/README.md": "Synthetic package fixture.\n",
    ...Object.fromEntries(Object.entries(BIN).map(([name, file]) => [`package/${file}`, `#!/usr/bin/env bun\nconsole.log("0.10.8 ${name}");\n`])),
  }, { compress: "gzip" }).bytes();
  const integrity = `sha512-${createHash("sha512").update(artifact).digest("base64")}`;
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/0.10.8")) return Response.json({
        _id: "@hasna/skills@0.10.8", name: "@hasna/skills", version: "0.10.8",
        dist: { integrity, tarball: `${server.url.origin}/skills-0.10.8.tgz` },
      });
      if (url.pathname === "/skills-0.10.8.tgz") return new Response(artifact);
      return new Response("not found", { status: 404 });
    },
  });
  return { server, artifact, integrity };
}

describe("exact-version copyfile runtime update", () => {
  test("verifies the exact artifact, switches physical runtime launchers, preserves config and rolls back", async () => {
    const f = fixtureHome();
    const { server, integrity } = await serverWithArtifact();
    try {
      const pathValue = `${f.externalBin}${delimiter}${f.localBin}${delimiter}${f.bunBin}`;
      const result = await updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue, registryOrigin: server.url.origin });
      expect(result).toMatchObject({ updated: true, version: "0.10.8", currentVersion: "0.10.6", launcherCount: 21, configCount: 4, tarballIntegrity: integrity });
      const targetRoot = join(f.runtime, "0.10.8-copyfile");
      const targetPackage = join(targetRoot, "node_modules", "@hasna", "skills");
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(targetPackage, BIN.skills));
      expect(realpathSync(join(f.bunBin, "skills"))).toBe(join(targetPackage, BIN.skills));
      expect(JSON.parse(readFileSync(join(targetPackage, "package.json"), "utf8")).version).toBe("0.10.8");
      expect(lstatSync(targetRoot).mode & 0o077).toBe(0);
      const receipt = JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8"));
      expect(receipt).toMatchObject({ state: "switched", targetVersion: "0.10.8", tarballIntegrity: integrity, tarballBytes: expect.any(Number) });
      expect(receipt.launchers).toHaveLength(21);
      expect(receipt.launchers.every((item: { backupPath: string }) => existsSync(item.backupPath))).toBe(true);
      expect(receipt.launchers.every((item: { path: string; backupPath: string; oldLinkTarget: string }) => readlinkSync(item.backupPath) === item.oldLinkTarget && item.oldLinkTarget === relative(join(item.path, ".."), f.oldPackage + "/" + BIN[basename(item.path) as keyof typeof BIN]))).toBe(true);
      const receiptHistory = join(targetRoot, "receipt-history");
      expect(readdirSync(receiptHistory).length).toBeGreaterThan(1);
      expect(readdirSync(receiptHistory).every(name => (lstatSync(join(receiptHistory, name)).mode & 0o222) === 0)).toBe(true);
      expect(readdirSync(f.runtime).filter(name => name.startsWith(".copyfile-update-lock-released-")).length).toBe(1);
      expect(readFileSync(join(targetRoot, "install-lock.json"), "utf8")).toContain('"lockfileVersion"');
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name), stat = lstatSync(path);
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) walk(path);
          else if (stat.isFile()) expect(stat.mode & 0o022).toBe(0);
        }
      };
      walk(join(targetRoot, "node_modules"));
      for (const [path, content] of f.configs) {
        expect(readFileSync(path, "utf8")).toBe(content);
        const relativePath = path.slice(f.home.length + 1);
        expect(readFileSync(join(targetRoot, "preimage", "configs", relativePath), "utf8")).toBe(content);
      }
      const partiallyRolled = receipt.launchers[0];
      const afterPath = `${partiallyRolled.path}.skills-after-${result.receiptId}`;
      symlinkSync(partiallyRolled.newTarget, afterPath);
      const partialTemp = `${partiallyRolled.path}.partial-rollback`;
      symlinkSync(partiallyRolled.oldLinkTarget, partialTemp);
      renameSync(partialTemp, partiallyRolled.path);
      const priorReceiptBytes = readFileSync(join(targetRoot, "rollout-receipt.json"));
      const historySnapshot = join(receiptHistory, `synthetic-interruption-${crypto.randomUUID()}.json`);
      writeFileSync(historySnapshot, priorReceiptBytes, { mode: 0o400, flag: "wx" });
      expect(readFileSync(historySnapshot).equals(priorReceiptBytes)).toBe(true);
      receipt.state = "rollback-required";
      writeFileSync(join(targetRoot, "rollout-receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
      const rolled = rollbackCopyfileRuntime(String(result.receiptId), { homeDir: f.home });
      expect(rolled).toMatchObject({ rolledBack: true, restoredVersion: "0.10.6", launcherCount: 21 });
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(realpathSync(join(f.bunBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(readlinkSync(join(f.localBin, "skills"))).toBe(receipt.launchers.find((item: { path: string }) => item.path === join(f.localBin, "skills")).oldLinkTarget);
      expect(realpathSync(join(f.externalBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(JSON.parse(readFileSync(join(targetRoot, "rollout-receipt.json"), "utf8")).state).toBe("rolled-back");
      const rollbackHistory = readdirSync(receiptHistory)
        .filter(name => name.endsWith(".json"))
        .map(name => ({ name, receipt: JSON.parse(readFileSync(join(receiptHistory, name), "utf8")) }))
        .filter(item => item.receipt.state === "rollback-required");
      // The fixture starts from an interrupted partial rollback; every subsequent
      // per-launcher completion must preserve the exact prior journal state.
      expect(new Set(rollbackHistory.map(item => item.receipt.rollbackCompletedLaunchers.length))).toEqual(
        new Set(Array.from({ length: 21 }, (_, index) => index)),
      );
      expect(rollbackHistory.every(item => (lstatSync(join(receiptHistory, item.name)).mode & 0o222) === 0)).toBe(true);
      expect(readdirSync(f.runtime).filter(name => name.startsWith(".copyfile-update-lock-released-")).length).toBe(2);
    } finally { server.stop(true); }
  });

  test("refuses non-exact versions and registry integrity mismatch before switching launchers", async () => {
    const f = fixtureHome();
    await expect(updateCopyfileRuntime("latest", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}` })).rejects.toThrow("EXACT_VERSION_REQUIRED");
    const fixture = await serverWithArtifact();
    const brokenFetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/skills-0.10.8.tgz") {
        const changed = new Uint8Array(await response.arrayBuffer());
        changed[changed.length - 1] ^= 0xff;
        return new Response(changed, { status: 200, headers: { "content-type": "application/octet-stream" } });
      }
      return response;
    }) as typeof fetch;
    try {
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}`, registryOrigin: fixture.server.url.origin, fetcher: brokenFetcher })).rejects.toThrow("TARBALL_INTEGRITY_MISMATCH");
      expect(realpathSync(join(f.localBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      expect(realpathSync(join(f.bunBin, "skills"))).toBe(join(f.oldPackage, BIN.skills));
      const alias = join(f.home, "aliased-bin");
      symlinkSync(f.localBin, alias);
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${alias}${delimiter}${f.bunBin}` })).rejects.toThrow("PATH_ANCESTOR_SYMLINK_UNSUPPORTED");
      const skillLauncher = join(f.localBin, "skills");
      const originalText = readlinkSync(skillLauncher);
      renameSync(skillLauncher, `${skillLauncher}.direct`);
      symlinkSync(originalText, join(f.localBin, ".skills-target-chain"));
      symlinkSync(".skills-target-chain", skillLauncher);
      await expect(updateCopyfileRuntime("0.10.8", { homeDir: f.home, pathValue: `${f.localBin}${delimiter}${f.bunBin}` })).rejects.toThrow("LAUNCHER_SYMLINK_CHAIN_UNSUPPORTED");
      expect(existsSync(`${skillLauncher}.skills-prev-test`)).toBe(false);
    } finally { fixture.server.stop(true); }
  });

  test("streams registry responses under a hard byte cap", async () => {
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.enqueue(new Uint8Array([4, 5, 6])); controller.close(); },
    }));
    await expect(readBodyCapped(response, 4, "BODY_TOO_LARGE")).rejects.toThrow("BODY_TOO_LARGE");
  });

  test("bounds expanded tar bytes and refuses link or extended tar entry types before extraction", async () => {
    const archive = await new Bun.Archive({ "package/a": "small", "package/b": "small" }, { compress: "gzip" }).bytes();
    await expect(preflightTarball(archive, { maxEntries: 1 })).rejects.toThrow("TARBALL_ENTRY_COUNT_INVALID");
    await expect(preflightTarball(archive, { maxExpandedBytes: 512 })).rejects.toThrow("TARBALL_EXPANDED_SIZE_INVALID");

    const tar = new Uint8Array(1536);
    const header = tar.subarray(0, 512);
    header.set(new TextEncoder().encode("package/link"), 0);
    header.set(new TextEncoder().encode("0000644\0"), 100);
    header.set(new TextEncoder().encode("0000000\0"), 108);
    header.set(new TextEncoder().encode("0000000\0"), 116);
    header.set(new TextEncoder().encode("00000000000\0"), 124);
    header.set(new TextEncoder().encode("00000000000\0"), 136);
    header.fill(32, 148, 156);
    header[156] = "2".charCodeAt(0);
    header.set(new TextEncoder().encode("ustar\0"), 257);
    header.set(new TextEncoder().encode("00"), 263);
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0");
    header.set(new TextEncoder().encode(`${checksum}\0 `), 148);
    await expect(preflightTarball(gzipSync(tar))).rejects.toThrow("TARBALL_ENTRY_TYPE_UNSUPPORTED");
  });
});
