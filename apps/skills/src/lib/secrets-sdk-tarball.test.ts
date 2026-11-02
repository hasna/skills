import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

// Synthetic archives only.
const SCRIPT = resolve(import.meta.dir, "../../scripts/verify-no-secrets-sdk-in-tarball.ts");
const { secretsSdkMarkersIn, tarBytes } = await import(SCRIPT) as {
  secretsSdkMarkersIn: (bytes: Uint8Array) => string[]; tarBytes: (gzipped: Uint8Array) => Uint8Array;
};
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = realpathSync(mkdtempSync(join(tmpdir(), "secrets-sdk-tarball-"))); roots.push(root); return root; }

/** A gzipped ustar archive of `files` (relative path -> content), built by the system tar as `npm pack` lays it out. */
function archive(files: Record<string, string>) {
  const root = directory(), source = join(root, "src");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(source, path, ".."), { recursive: true });
    writeFileSync(join(source, path), content);
  }
  const out = join(root, "package.tgz");
  const result = Bun.spawnSync(["/usr/bin/tar", "--format", "ustar", "-czf", out, "-C", source, "package"], { stdout: "ignore", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  return out;
}
function verify(path: string) {
  const result = Bun.spawnSync([process.execPath, "--no-install", SCRIPT, path], { stdout: "pipe", stderr: "pipe" });
  return { status: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

test("a clean archive passes", () => {
  const clean = archive({ "package/package.json": "{}", "package/dist/index.js": "export const x = sdk.createSecretsClientFromEnv(env);\nclass SecretsClientError {}\n".repeat(50) });
  expect(verify(clean)).toMatchObject({ status: 0, stderr: "" });
});

test("a marker in a file's content is found and named, never echoed", () => {
  const body = "const before = 1;\nfunction createSecretsClientFromEnv(env) { return env; }\n// synthetic-tail-7c1\n";
  const hit = archive({ "package/package.json": "{}", "package/dist/sdk.js": body });
  const result = verify(hit);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("marker found: function createSecretsClientFromEnv(");
  expect(result.stderr).not.toContain("synthetic-tail-7c1");
  expect(result.stderr).not.toContain("return env");
});

test("a marker in a member name (a tar header) is found", () => {
  const hit = archive({ "package/package.json": "{}", "package/vendor/class SecretsClient/readme.txt": "nothing to see\n" });
  expect(verify(hit)).toMatchObject({ status: 1 });
  expect(verify(hit).stderr).toContain("marker found: class SecretsClient");
});

test("both markers are reported, and a non-archive is refused rather than passed", () => {
  expect(secretsSdkMarkersIn(new TextEncoder().encode("class SecretsClient {}\nfunction createSecretsClientFromEnv() {}"))).toEqual(["function createSecretsClientFromEnv(", "class SecretsClient"]);
  const root = directory();
  writeFileSync(join(root, "plain.tgz"), "not gzip");
  expect(verify(join(root, "plain.tgz")).status).toBe(2);
  expect(() => tarBytes(Bun.gzipSync(new TextEncoder().encode("class SecretsClient")))).toThrow();
  expect(verify(join(root, "missing.tgz")).status).toBe(2);
});
