import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectSelectionLockPath, readProjectSelectionSnapshot, readSkillSessionSnapshotIfExists, writeSelectionJson } from "./selection-cache.js";

// SH-00041: a session's working folder may reach its project through a symlink
// (macOS /tmp is a symlink to /private/tmp, and a workspace may be opened
// through an alias). The project lock is read and written at the resolved base,
// while a symlink at `.skills`, at the lock file itself or in the data-dir cache
// root keeps the hard UNSAFE_CACHE_PATH refusal.
const receipt = {
  schemaVersion: 1 as const,
  verifiedAt: "2026-11-02T00:00:00.000Z",
  profile: { profileId: "fleet", workspaceId: "org_dev", profileRevision: "rev-1", authority: "https://api.hasna.com/skills/v1", selections: [] },
};
const codeOf = (run: () => unknown): string | null => {
  try { run(); return null; }
  catch (error) { return (error as { code?: string }).code ?? "NO_CODE"; }
};
const root = () => mkdtempSync(join(tmpdir(), "skills-project-symlink-"));

test("a symlinked cwd alias reads the project lock at its resolved base", () => {
  const base = root(), real = join(base, "real"), alias = join(base, "alias");
  mkdirSync(real, { recursive: true });
  symlinkSync(real, alias);
  // No lock file: the alias is a supported working-folder alias, not a refusal.
  expect(readProjectSelectionSnapshot(alias)).toBeNull();
  expect(projectSelectionLockPath(alias)).toBe(join(real, ".skills", "selection.lock.json"));
  // The same lock is then read through the alias with its canonical path.
  mkdirSync(join(real, ".skills"));
  writeFileSync(join(real, ".skills", "selection.lock.json"), `${JSON.stringify(receipt)}\n`);
  const snapshot = readProjectSelectionSnapshot(alias);
  expect(snapshot?.receipt.profile.profileId).toBe("fleet");
  expect(snapshot?.lock.path).toBe(join(real, ".skills", "selection.lock.json"));
});

test("a project lock written through a symlinked cwd alias lands at the resolved base", () => {
  const base = root(), real = join(base, "real"), alias = join(base, "alias");
  mkdirSync(real, { recursive: true });
  symlinkSync(real, alias);
  writeSelectionJson(projectSelectionLockPath(alias), receipt);
  expect(existsSync(join(real, ".skills", "selection.lock.json"))).toBe(true);
  expect(readProjectSelectionSnapshot(alias)?.lock.path).toBe(join(real, ".skills", "selection.lock.json"));
});

test("a symlinked .skills directory is still refused", () => {
  const base = root(), project = join(base, "project"), target = join(base, "target");
  mkdirSync(project, { recursive: true }); mkdirSync(target);
  symlinkSync(target, join(project, ".skills"));
  expect(codeOf(() => readProjectSelectionSnapshot(project))).toBe("UNSAFE_CACHE_PATH");
});

test("a symlinked lock file is still refused", () => {
  const base = root(), project = join(base, "project"), target = join(base, "target.json");
  mkdirSync(join(project, ".skills"), { recursive: true });
  writeFileSync(target, `${JSON.stringify(receipt)}\n`);
  symlinkSync(target, join(project, ".skills", "selection.lock.json"));
  expect(codeOf(() => readProjectSelectionSnapshot(project))).toBe("UNSAFE_CACHE_PATH");
});

test("a .skills entry that is not a directory is still refused", () => {
  const base = root(), project = join(base, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, ".skills"), "not a directory");
  expect(codeOf(() => readProjectSelectionSnapshot(project))).toBe("UNSAFE_CACHE_PATH");
});

test("a symlinked data-dir cache root is still refused", () => {
  const base = root(), realCache = join(base, "cache"), aliasCache = join(base, "cache-alias");
  mkdirSync(join(realCache, "sessions"), { recursive: true });
  symlinkSync(realCache, aliasCache);
  expect(codeOf(() => readSkillSessionSnapshotIfExists("session-abc", { cacheDir: aliasCache }))).toBe("UNSAFE_CACHE_PATH");
  // Control: the same read through the real cache root is an ordinary miss.
  expect(readSkillSessionSnapshotIfExists("session-abc", { cacheDir: realCache })).toBeNull();
});
