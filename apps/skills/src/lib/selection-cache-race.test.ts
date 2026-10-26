import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packSkillBundle } from "./skill-bundle.js";
import { readCachedSelection, readSelectionJson, selectionBundlePath } from "./selection-cache.js";

// Fresh child processes keep the filesystem interposition out of other tests.
// Fixtures stay under the runner's temporary root for inspection.
const modulePath = join(import.meta.dir, "selection-cache.ts");
const boundaryWorker = String.raw`
import { mock } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
const actual = { ...fs };
const [modulePath, root, kind] = process.argv.slice(1);
const parent = join(root, "parent"), leaf = join(parent, "receipt.json");
const target = join(root, "target"); actual.mkdirSync(target);
let intercepted = false;
mock.module("node:fs", () => ({ ...actual, mkdirSync(path, options) {
  if (String(path) === parent && !intercepted) {
    intercepted = true;
    if (kind === "directory") actual.mkdirSync(path, { mode: 0o700 });
    else if (kind === "file") actual.writeFileSync(path, "competitor");
    else if (kind === "symlink") actual.symlinkSync(target, path, "dir");
    else throw Object.assign(new Error("synthetic refusal"), { code: kind === "disappeared" ? "EEXIST" : "EACCES" });
  }
  return actual.mkdirSync(path, options);
} }));
const { writeSelectionJson } = await import(modulePath);
let code = null;
try { writeSelectionJson(leaf, { synthetic: true }); } catch (error) { code = error.code; }
console.log(JSON.stringify({ intercepted, code, leaf: actual.existsSync(leaf), targetLeaf: actual.existsSync(join(target, "receipt.json")), value: code === null ? JSON.parse(actual.readFileSync(leaf, "utf8")) : null }));
`;

for (const kind of ["directory", "file", "symlink", "disappeared", "wrong-error"]) {
  test(`parent creation race: ${kind}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-cache-boundary-"));
    const child = Bun.spawn([process.execPath, "--no-install", "-e", boundaryWorker, modulePath, root, kind], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    const result = JSON.parse(stdout);
    expect(result.intercepted).toBe(true);
    expect(result.code).toBe(kind === "directory" ? null : kind === "disappeared" ? "ENOENT" : kind === "wrong-error" ? "EACCES" : "UNSAFE_CACHE_PATH");
    expect(result.leaf).toBe(kind === "directory");
    expect(result.targetLeaf).toBe(false);
    if (kind === "directory") expect(result.value).toEqual({ synthetic: true });
  });
}

const concurrentWorker = String.raw`
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [modulePath, root, id, operation] = process.argv.slice(1);
globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN"); };
const { writeSelectionJson, createExclusiveSelectionJson, cacheSelectionBundle } = await import(modulePath);
writeFileSync(join(root, "ready", id), "ready");
const deadline = Date.now() + 10000;
while (!existsSync(join(root, "go"))) { if (Date.now() > deadline) throw new Error("barrier timeout"); await Bun.sleep(1); }
const path = join(root, "cache", "nested", operation === "shared-exclusive" ? "winner.json" : id + ".json");
let created = true;
if (operation === "bundle") {
  const selection = JSON.parse(readFileSync(join(root, "selection.json"), "utf8"));
  await cacheSelectionBundle(selection, new Response(readFileSync(join(root, "bundle.tar.gz"))), { cacheDir: join(root, "cache") });
} else if (operation.includes("exclusive")) created = createExclusiveSelectionJson(path, { id });
else writeSelectionJson(path, { id });
console.log(JSON.stringify({ id, created }));
`;

for (const operation of ["json", "exclusive", "shared-exclusive", "bundle", "warm-json"]) {
  test(`sixteen real concurrent cache writers: ${operation}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-cache-concurrent-"));
    mkdirSync(join(root, "ready"));
    const source = join(root, "source"); mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "---\nname: fixture\ndescription: Fixture\nkind: instruction\n---\nSynthetic body.\n");
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", skills: { kind: "instruction" } }));
    const bundle = packSkillBundle(source);
    const selection = { authority: "http://127.0.0.1:1/v1", workspaceId: "synthetic", profileRevision: "r1", slug: "fixture", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
    writeFileSync(join(root, "bundle.tar.gz"), bundle.bytes);
    writeFileSync(join(root, "selection.json"), JSON.stringify(selection));
    if (operation === "warm-json") mkdirSync(join(root, "cache", "nested"), { recursive: true, mode: 0o700 });
    const children = Array.from({ length: 16 }, (_, id) => {
      const child = Bun.spawn([process.execPath, "--no-install", "-e", concurrentWorker, modulePath, root, String(id), operation], { stdout: "pipe", stderr: "pipe" });
      return { child, result: Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]) };
    });
    const deadline = Date.now() + 10000;
    while (!children.every((_, id) => existsSync(join(root, "ready", String(id))))) {
      if (Date.now() > deadline) throw new Error("writers did not reach barrier");
      await Bun.sleep(1);
    }
    writeFileSync(join(root, "go"), "go");
    const results = await Promise.all(children.map(async ({ result }) => {
      const [stdout, stderr, status] = await result;
      expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
      return JSON.parse(stdout) as { id: string; created: boolean };
    }));
    const options = { cacheDir: join(root, "cache") };
    if (operation === "bundle") {
      expect((await readCachedSelection(selection, options))?.some(entry => entry.path === "SKILL.md")).toBe(true);
      expect(statSync(selectionBundlePath(selection, options)).mode & 0o777).toBe(0o400);
      expect(readFileSync(selectionBundlePath(selection, options))).toEqual(Buffer.from(bundle.bytes));
    } else if (operation === "shared-exclusive") {
      const winners = results.filter(result => result.created);
      expect(winners).toHaveLength(1);
      expect(readSelectionJson<{ id: string }>(join(root, "cache", "nested", "winner.json"))).toEqual({ id: winners[0]!.id });
    } else {
      for (const result of results) {
        expect(result.created).toBe(true);
        const path = join(root, "cache", "nested", `${result.id}.json`);
        expect(readSelectionJson<{ id: string }>(path)).toEqual({ id: result.id });
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
    }
    expect(statSync(join(root, "cache")).mode & 0o777).toBe(0o700);
  }, 30000);
}
