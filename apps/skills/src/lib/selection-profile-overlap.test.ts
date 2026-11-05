/**
 * Overlapping writers of one cached selection profile (E-00534). A sync reads
 * the cached profile, downloads and verifies bundles, then activates. Another
 * writer can replace the profile in between; the stale sync must then refuse
 * and write nothing, so the other writer's profile survives. Each case runs the
 * real syncSelectionProfile path, in one process and in two child processes.
 */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packSkillBundle } from "./skill-bundle.js";
import { syncSelectionProfile } from "./selection-resolver.js";
import { handleProfileSync } from "../cli/commands/profile-sync.js";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const AUTHORITY = "https://skills.example.com/api/v1";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function bundle(root: string, slug: string) {
  const source = join(root, `source-${slug}`); mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), `---\nname: ${slug}\ndescription: Fixture ${slug}\nkind: instruction\n---\nFixture ${slug} body.\n`);
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: slug, version: "1.0.0", skills: { kind: "instruction" } }));
  return packSkillBundle(source);
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-profile-overlap-")); roots.push(root);
  const cacheDir = join(root, "cache");
  const bundles = { alpha: bundle(root, "alpha"), beta: bundle(root, "beta") };
  const profile = (revision: string, slugs: Array<keyof typeof bundles>): ResolvedSkillProfile => ({
    authority: AUTHORITY, workspaceId: "org-test", profileId: "fleet", profileRevision: revision,
    selections: slugs.map(slug => ({ authority: AUTHORITY, workspaceId: "org-test", profileRevision: revision, slug, version: "1.0.0", bundleDigest: `sha256:${bundles[slug].sha256}` })),
  });
  const profileFile = join(cacheDir, "profiles", `${createHash("sha256").update(JSON.stringify("fleet")).digest("hex")}.json`);
  const downloads: string[] = [];
  const client = (resolved: ResolvedSkillProfile, beforeBundle?: () => Promise<void>): ProfileClient => ({
    authority: AUTHORITY,
    async resolveProfile() { return structuredClone(resolved); },
    async recordStation() { throw new Error("these cases never report a station"); },
    async getBundle(slug) {
      downloads.push(slug);
      await beforeBundle?.();
      return new Response(bundles[slug as keyof typeof bundles].bytes, { status: 200 });
    },
  });
  const revision = () => JSON.parse(readFileSync(profileFile, "utf8")).profile.profileRevision as string;
  return { root, cacheDir, bundles, profile, profileFile, client, downloads, revision };
}

test("a sync that read profile A refuses after a competing sync commits B, and B survives", async () => {
  const f = fixture();
  await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-A", ["alpha"])) });
  const bytesA = readFileSync(f.profileFile);
  let entered!: () => void, release!: () => void;
  const downloading = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  // C reads A, then waits inside its bundle download while B commits.
  const stale = syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-C", ["alpha", "beta"]), async () => { entered(); await barrier; }) });
  const outcome = stale.then(() => null, (error: { code?: string }) => error.code ?? "UNNAMED");
  await downloading;
  expect(readFileSync(f.profileFile)).toEqual(bytesA);
  await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-B", ["alpha"])) });
  const bytesB = readFileSync(f.profileFile);
  expect(f.revision()).toBe("revision-B");
  release();
  expect(await outcome).toBe("SELECTION_PROFILE_CHANGED");
  expect(readFileSync(f.profileFile)).toEqual(bytesB);
  expect(readdirSync(join(f.cacheDir, "profiles")).sort()).toEqual([f.profileFile.split("/").pop()!]);
});

const childWriter = String.raw`
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [resolverPath, root, mode, profileJson, bundlesJson, profileFile] = process.argv.slice(1);
const { syncSelectionProfile } = await import(resolverPath);
const profile = JSON.parse(profileJson), bundles = JSON.parse(bundlesJson);
const waitFor = async (path) => { const end = Date.now() + 12000; while (!existsSync(path)) { if (Date.now() > end) throw new Error("SYNTHETIC_BARRIER_TIMEOUT"); await Bun.sleep(5); } };
if (mode === "competing-B") await waitFor(join(root, "C-ready"));
const client = { authority: profile.authority,
  async resolveProfile() { return profile; },
  async recordStation() { throw new Error("no station report"); },
  async getBundle(slug) {
    if (mode === "stale-C") {
      copyFileSync(profileFile, join(root, "C-preserved-A.json"));
      writeFileSync(join(root, "C-ready"), "ready");
      await waitFor(join(root, "B-committed"));
    }
    return new Response(Buffer.from(bundles[slug], "base64"), { status: 200 });
  } };
let code = null;
try { await syncSelectionProfile("fleet", { cacheDir: join(root, "cache"), client }); } catch (error) { code = error?.code ?? "UNNAMED"; }
if (mode === "competing-B") writeFileSync(join(root, "B-committed"), "committed");
console.log(JSON.stringify({ mode, code }));
`;

test("distinct child writers: C preserves A, B commits B, and the stale C is refused while B survives", async () => {
  const f = fixture();
  await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-A", ["alpha"])) });
  const bytesA = readFileSync(f.profileFile);
  const bundles = JSON.stringify({ alpha: Buffer.from(f.bundles.alpha.bytes).toString("base64"), beta: Buffer.from(f.bundles.beta.bytes).toString("base64") });
  const resolverPath = join(import.meta.dir, "selection-resolver.ts");
  const spawnWriter = (mode: string, profile: ResolvedSkillProfile) => Bun.spawn(
    [process.execPath, "--no-install", "-e", childWriter, resolverPath, f.root, mode, JSON.stringify(profile), bundles, f.profileFile],
    { cwd: f.root, stdout: "pipe", stderr: "pipe" });
  const children = [spawnWriter("stale-C", f.profile("revision-C", ["alpha", "beta"])), spawnWriter("competing-B", f.profile("revision-B", ["alpha"]))];
  const results = await Promise.all(children.map(async child => {
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, status };
  }));
  for (const result of results) expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
  const [stale, competing] = results.map(result => JSON.parse(result.stdout.trim()));
  expect(competing).toEqual({ mode: "competing-B", code: null });
  expect(sha256(readFileSync(join(f.root, "C-preserved-A.json")))).toBe(sha256(bytesA));
  expect(f.revision()).toBe("revision-B");
  expect(stale).toEqual({ mode: "stale-C", code: "SELECTION_PROFILE_CHANGED" });
  expect(readdirSync(join(f.cacheDir, "profiles")).sort()).toEqual([f.profileFile.split("/").pop()!]);
});

test("an operator-preserved snapshot binds sync: a profile replaced since then is refused before any download", async () => {
  const f = fixture();
  await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-A", ["alpha"])) });
  const preservedA = sha256(readFileSync(f.profileFile));
  await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-B", ["alpha"])) });
  const bytesB = readFileSync(f.profileFile);
  f.downloads.length = 0;
  await expect(syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-C", ["alpha", "beta"])), expectedProfileSha256: preservedA }))
    .rejects.toMatchObject({ code: "SELECTION_PROFILE_CHANGED" });
  await expect(syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-C", ["alpha"])), expectedProfileSha256: null }))
    .rejects.toMatchObject({ code: "SELECTION_PROFILE_CHANGED" });
  await expect(syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-C", ["alpha"])), expectedProfileSha256: "not-a-digest" }))
    .rejects.toMatchObject({ code: "INVALID_PROFILE_PRECONDITION" });
  expect(f.downloads).toEqual([]);
  expect(readFileSync(f.profileFile)).toEqual(bytesB);
  const applied = await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-C", ["alpha", "beta"])), expectedProfileSha256: sha256(bytesB) });
  expect(applied.receipt?.profile.profileRevision).toBe("revision-C");
  expect(f.revision()).toBe("revision-C");
});

test("skills sync --expect-profile-sha256 reaches activation, with 'absent' meaning no cached profile", async () => {
  const f = fixture();
  const exitCode = process.exitCode;
  const output: string[] = [];
  const log = console.log;
  console.log = (...values: unknown[]) => { output.push(values.join(" ")); };
  try {
    const command = { selectionProfile: "fleet", stationReport: false, json: true, expectProfileSha256: "absent" };
    await handleProfileSync(command, { cacheDir: f.cacheDir, client: f.client(f.profile("revision-A", ["alpha"])) });
    expect(f.revision()).toBe("revision-A");
    const bytesA = readFileSync(f.profileFile);
    await handleProfileSync(command, { cacheDir: f.cacheDir, client: f.client(f.profile("revision-B", ["alpha"])) });
    expect(process.exitCode).toBe(1);
    expect(output.map(line => JSON.parse(line).error?.code)).toContain("SELECTION_PROFILE_CHANGED");
    expect(readFileSync(f.profileFile)).toEqual(bytesA);
    process.exitCode = exitCode;
    await handleProfileSync({ ...command, expectProfileSha256: sha256(bytesA) }, { cacheDir: f.cacheDir, client: f.client(f.profile("revision-B", ["alpha"])) });
    expect(f.revision()).toBe("revision-B");
  } finally { console.log = log; process.exitCode = exitCode; }
});

test("a single writer behaves as before: same result, same bytes, no lock or temporary file left", async () => {
  const f = fixture();
  const first = await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-A", ["alpha"])), expectedProfileSha256: null, now: () => Date.parse("2026-11-05T00:00:00.000Z") });
  expect(Object.keys(first).sort()).toEqual(["changed", "downloaded", "profile", "receipt", "stationReported"]);
  expect(first).toMatchObject({ changed: true, downloaded: 1, stationReported: false });
  expect(readFileSync(f.profileFile, "utf8")).toBe(`${JSON.stringify({ schemaVersion: 1, verifiedAt: "2026-11-05T00:00:00.000Z", profile: f.profile("revision-A", ["alpha"]) })}\n`);
  const again = await syncSelectionProfile("fleet", { cacheDir: f.cacheDir, client: f.client(f.profile("revision-A", ["alpha"])) });
  expect(again).toMatchObject({ changed: false, downloaded: 0, stationReported: false });
  expect(readdirSync(join(f.cacheDir, "profiles")).sort()).toEqual([f.profileFile.split("/").pop()!]);
});
