import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSkillContext } from "./skill-context.js";
import { readSkillSession, sessionReceiptPath, writeSelectionJson } from "./selection-cache.js";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";
import { parseSkillContextInput } from "../cli/commands/context.js";
import { packSkillBundle } from "./skill-bundle.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const cacheDir = mkdtempSync(join(tmpdir(), "skills-native-custody-")); roots.push(cacheDir);
  const profile: ResolvedSkillProfile = { authority: "https://skills.example.com/api/v1", workspaceId: "workspace-fixture", profileId: "engineering", profileRevision: "revision-one", selections: [] };
  const client: ProfileClient = { authority: profile.authority, resolveProfile: async () => profile, getBundle: async () => { throw new Error("Empty fixture does not fetch bundles"); }, recordStation: async () => { throw new Error("No station writes"); } };
  return { cacheDir, profile, client };
}

test("native session input preserves explicit root custody and refuses malformed or mixed identities", async () => {
  expect(parseSkillContextInput(JSON.stringify({ session_id: "root", parent_session_id: null })).parentSessionId).toBeNull();
  expect(() => parseSkillContextInput(JSON.stringify({ parent_session_id: 1 }))).toThrow("string or null");
  const f = fixture();
  for (const input of [{ sessionId: "root", parentSessionId: "root" }, { sessionId: "root", parentSessionId: null, agentId: "legacy-child" }]) {
    await expect(buildSkillContext({ profileId: "engineering", ...input }, f)).rejects.toMatchObject({ code: "INVALID_SESSION" });
  }
});

test("real child and nested session IDs inherit exact parent pins and retain those pins on resume", async () => {
  const f = fixture();
  await buildSkillContext({ profileId: "engineering", sessionId: "root", parentSessionId: null }, f);
  const current = { ...f, client: { ...f.client, resolveProfile: async () => ({ ...f.profile, profileRevision: "revision-two" }) } };
  const child = await buildSkillContext({ profileId: "engineering", sessionId: "child", parentSessionId: "root" }, current);
  const nested = await buildSkillContext({ profileId: "engineering", sessionId: "nested", parentSessionId: "child" }, current);
  expect(child.receipt.profileRevision).toBe("revision-one"); expect(nested.receipt.profileRevision).toBe("revision-one");
  expect(readSkillSession("child", f)?.parent?.sessionId).toBe("root");
  expect(readSkillSession("nested", f)?.parent?.sessionId).toBe("child");
  expect(readSkillSession("root:child", f)).toBeNull();
  expect((await buildSkillContext({ profileId: "engineering", sessionId: "nested", parentSessionId: "child", restore: true }, current)).receipt.profileRevision).toBe("revision-one");
});

test("native child custody refuses missing parents, reused IDs and cross-root reparenting", async () => {
  const f = fixture();
  await expect(buildSkillContext({ profileId: "engineering", sessionId: "child", parentSessionId: "missing" }, f)).rejects.toMatchObject({ code: "SESSION_PARENT_NOT_FOUND" });
  await buildSkillContext({ profileId: "engineering", sessionId: "root", parentSessionId: null }, f);
  await buildSkillContext({ profileId: "engineering", sessionId: "other-root", parentSessionId: null }, f);
  await buildSkillContext({ profileId: "engineering", sessionId: "child", parentSessionId: "root" }, f);
  for (const [sessionId, parentSessionId] of [["child", "other-root"], ["child", null], ["root", "other-root"]] as const) {
    await expect(buildSkillContext({ profileId: "engineering", sessionId, parentSessionId }, f)).rejects.toMatchObject({ code: "SESSION_PARENT_MISMATCH" });
  }
});

test("native child writer retains the exact parent receipt precondition", async () => {
  const f = fixture();
  await buildSkillContext({ profileId: "engineering", sessionId: "root", parentSessionId: null }, f);
  const client = { ...f.client, resolveProfile: async () => {
    const parent = readSkillSession("root", f)!;
    writeSelectionJson(sessionReceiptPath("root", f), { ...parent, verifiedAt: "2026-10-04T01:00:00Z" });
    return f.profile;
  } };
  await expect(buildSkillContext({ profileId: "engineering", sessionId: "child", parentSessionId: "root" }, { ...f, client })).rejects.toMatchObject({ code: "SESSION_PARENT_CHANGED" });
  expect(readSkillSession("child", f)).toBeNull();
});

test("legacy composite child identity stays unchanged", async () => {
  const f = fixture();
  await buildSkillContext({ profileId: "engineering", sessionId: "root" }, f);
  await buildSkillContext({ profileId: "engineering", sessionId: "root", agentId: "legacy-child" }, f);
  expect(readSkillSession("root:legacy-child", f)?.parent?.sessionId).toBe("root");
});

test("nested native children inherit loaded payload pins and an unavailable exact bundle never falls back", async () => {
  const f = fixture(), source = mkdtempSync(join(tmpdir(), "skills-native-bundle-")); roots.push(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: native-fixture\ndescription: Native inheritance fixture\nkind: instruction\n---\nExact inherited instructions.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "native-fixture", version: "1.0.0", skills: { kind: "instruction" } }));
  const bundle = packSkillBundle(source);
  const profile = { ...f.profile, selections: [{ authority: f.profile.authority, workspaceId: f.profile.workspaceId, profileRevision: f.profile.profileRevision, slug: "native-fixture", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}`, triggers: { keywords: [] } }] };
  const client = { ...f.client, resolveProfile: async () => profile, getBundle: async () => new Response(bundle.bytes, { headers: { "X-Skill-Bundle-Sha256": bundle.sha256, "X-Skill-Version": "1.0.0" } }) };
  const options = { ...f, client };
  await buildSkillContext({ profileId: "engineering", sessionId: "root", parentSessionId: null, prompt: "$native-fixture" }, options);
  const child = await buildSkillContext({ profileId: "engineering", sessionId: "child", parentSessionId: "root" }, options);
  const nested = await buildSkillContext({ profileId: "engineering", sessionId: "nested", parentSessionId: "child" }, options);
  expect(child.context).toContain("Exact inherited instructions."); expect(child.selections[0]?.reason).toBe("subagent-inherit");
  expect(nested.context).toContain("Exact inherited instructions."); expect(nested.selections[0]?.reason).toBe("subagent-inherit");
  await expect(buildSkillContext({ profileId: "engineering", sessionId: "refused-child", parentSessionId: "root" }, { ...options, client: { ...client, getBundle: async () => null } })).rejects.toMatchObject({ code: "BUNDLE_UNAVAILABLE" });
  expect(readSkillSession("refused-child", f)).toBeNull();
});
