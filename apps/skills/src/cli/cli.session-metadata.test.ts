import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { selectionKey, sessionReceiptPath, writeSelectionJson } from "../lib/selection-cache.js";
import { inspectSkillSession, reconcileSkillSession } from "../sdk/index.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";

const scratch = mkdtempSync(join(tmpdir(), "skills-session-metadata-"));
const binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("compiled CLI and public SDK expose the same read-only session metadata and reviewed delta", async () => {
  let resolves = 0, otherRequests = 0;
  const token = randomUUID();
  let target!: ResolvedSkillProfile;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("refused", { status: 401 });
    if (new URL(request.url).pathname === "/api/v1/profiles/shared/resolve") {
      resolves++;
      return Response.json(target);
    }
    otherRequests++;
    return new Response("unexpected operation", { status: 404 });
  } });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    const home = join(scratch, "home"), data = join(home, ".hasna", "skills"), cacheDir = join(data, "selection-cache");
    mkdirSync(home, { recursive: true });
    const old: ResolvedSkillProfile = { authority: `${origin}/api/v1`, workspaceId: "fixture", profileId: "legacy", profileRevision: "old",
      selections: ["retained", "removed", "changed", "unloaded"].map(slug => ({ authority: `${origin}/api/v1`, workspaceId: "fixture",
        profileRevision: "old", slug, version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}`, triggers: { keywords: ["SYNTHETIC_PRIVATE_POLICY"] } })) };
    const metadata = (index: number) => ({ slug: old.selections[index]!.slug, version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` });
    const sessionId = "metadata-fixture", path = sessionReceiptPath(sessionId, { cacheDir });
    writeSelectionJson(path, { schemaVersion: 1, verifiedAt: "2026-01-01T00:00:00Z", profile: old, sessionId,
      loaded: old.selections.slice(0, 3).map(selectionKey) });
    const before = readFileSync(path), receiptSha256 = createHash("sha256").update(before).digest("hex");
    target = { ...old, profileId: "shared", profileRevision: "new", selections: old.selections.filter(selection => selection.slug !== "removed")
      .map(selection => ({ ...selection, profileRevision: "new", ...(selection.slug === "changed" ? { bundleDigest: `sha256:${"b".repeat(64)}` } : {}) })) };
    const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"),
      HASNA_SKILLS_DIR: data, NO_COLOR: "1", TERM: "dumb", TMPDIR: scratch, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
    async function cli(args: string[], authenticated = false) {
      const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: scratch, env: {
        ...env, ...(authenticated ? { HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY_OVERRIDE: token } : {}),
      }, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      return stdout;
    }
    const shown = JSON.parse(await cli(["sessions", "show", sessionId, "--json"]));
    expect(shown).toEqual(inspectSkillSession(sessionId, { cacheDir }));
    expect(shown.selections).toEqual(old.selections.map((_, index) => ({ ...metadata(index), loaded: index < 3 })));
    const plain = await cli(["sessions", "show", sessionId]);
    expect(plain).toContain(`Loaded: changed@1.0.0 sha256:${"a".repeat(64)}`);
    expect(plain).toContain(`Unloaded: unloaded@1.0.0 sha256:${"a".repeat(64)}`);
    expect(resolves).toBe(0); // show needs neither a credential nor an authority read
    const args = ["sessions", "reconcile", sessionId, "--from-profile", "legacy", "--from-revision", "old", "--receipt-sha256", receiptSha256,
      "--selection-profile", "shared", "--profile-revision", "new"];
    const preview = JSON.parse(await cli([...args, "--json"], true));
    const sdk = await reconcileSkillSession({ sessionId, fromProfile: "legacy", fromRevision: "old", receiptSha256, selectionProfile: "shared", profileRevision: "new" }, {
      cacheDir, client: { authority: old.authority, resolveProfile: async () => target,
        getBundle: async () => { throw new Error("Metadata preview must not fetch payloads"); }, recordStation: async () => { throw new Error("Preview must not mutate station state"); } },
    });
    expect(preview.applied).toBe(false);
    expect(preview.plan.selectionDelta).toEqual(sdk.plan.selectionDelta);
    expect(preview.plan.selectionDelta[1]).toEqual({ selection: metadata(1), loaded: true, outcome: "retired", reason: "selection-removed" });
    expect(preview.plan.selectionDelta[2]).toEqual({ selection: metadata(2), loaded: true, outcome: "retired", reason: "bundle-changed",
      replacement: { ...metadata(2), bundleDigest: `sha256:${"b".repeat(64)}` } });
    const plainPreview = await cli(args, true);
    expect(plainPreview).toContain("retired (selection-removed): removed@1.0.0");
    expect(plainPreview).toContain(`retired (bundle-changed): changed@1.0.0 sha256:${"a".repeat(64)} -> changed@1.0.0 sha256:${"b".repeat(64)}`);
    expect(plainPreview).toContain("unloaded (same-bundle): unloaded@1.0.0");
    expect(JSON.stringify({ shown, preview, plain, plainPreview })).not.toContain("SYNTHETIC_PRIVATE_POLICY");
    expect(resolves).toBe(2);
    expect(otherRequests).toBe(0);
    expect(readFileSync(path)).toEqual(before);
    expect(existsSync(join(cacheDir, "session-reconciliations"))).toBe(false);
  } finally { server.stop(true); }
});
