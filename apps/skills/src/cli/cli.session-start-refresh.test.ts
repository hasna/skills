/**
 * The managed hook refreshes this station's cached selection profile only at
 * SessionStart, through the ordinary sync child, so a published version reaches
 * the next session on every station without a manual sync. A station may skip
 * the refresh while its cached profile is younger than
 * SKILLS_SESSION_START_SYNC_MAX_AGE_MINUTES, and concurrent session starts on
 * one station share one refresh.
 *
 * The real registered hook command and subprocess boundary run; only the sync
 * and context children are synthetic. The sync child records each start and,
 * when asked, activates a verified profile as `skills sync` does.
 */
import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { activateSelectionProfile, createExclusiveSelectionJson, profileRefreshLockPath, readSelectionProfile } from "../lib/selection-cache.js";
import { SESSION_START_REFRESH_LOCK_STALE_MS } from "../lib/session-start-refresh.js";
import { MANAGED_HOOK_DEADLINE_MS } from "../lib/session-reconciliation.js";
import type { ResolvedSkillProfile } from "../types/skill-selection.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-session-start-refresh-"));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
const PROFILE = (revision: string): ResolvedSkillProfile => ({ authority: "https://skills.example.com/api/v1", workspaceId: "org-test", profileId: "engineering", profileRevision: revision, selections: [] });
const CONTEXT = "Verified fixture context";
const NOTICE = "Skills profile refresh did not finish at session start [SKILLS_HOOK_TIMEOUT] (stage=sync)";
const MINUTE = 60_000;

beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { appendFileSync } from "node:fs";
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
import { activateSelectionProfile } from ${JSON.stringify(resolve(import.meta.dir, "../lib/selection-cache.ts"))};
if (process.argv[2] === "sync") {
  appendFileSync(process.env.SKILLS_TEST_SYNC_LOG, process.argv.slice(2).join(" ") + "\\n");
  await new Promise(resolve => setTimeout(resolve, Number(process.env.SKILLS_TEST_SYNC_DELAY ?? "0")));
  if (process.env.SKILLS_TEST_SYNC_ACTIVATE) activateSelectionProfile(JSON.parse(process.env.SKILLS_TEST_SYNC_ACTIVATE), { cacheDir: process.env.SKILLS_TEST_CACHE_DIR });
  process.stdout.write(process.env.SKILLS_TEST_SYNC_STDOUT ?? "{}");
  process.exitCode = Number(process.env.SKILLS_TEST_SYNC_EXIT ?? "0");
} else if (process.argv[2] === "context") {
  process.stdout.write(JSON.stringify({ context: ${JSON.stringify(CONTEXT)} }));
} else {
  const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
}
`);
  await buildCliFixture(entry, binary);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function fixture() {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills"), cacheDir = join(data, "selection-cache");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const log = join(home, "sync.log");
  writeFileSync(log, "");
  const env = { PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch, SKILLS_TEST_SYNC_LOG: log, SKILLS_TEST_CACHE_DIR: cacheDir };
  async function run(args: string[], childEnv: Record<string, string> = {}, input: unknown = {}) {
    const started = performance.now();
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: home, env: { ...env, ...childEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(status).toBe(0); expect(stderr).toBe("");
    return { value: JSON.parse(stdout), stdout, ms: performance.now() - started };
  }
  await run(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", binary, "--apply", "--json"]);
  return {
    cacheDir,
    syncs: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
    cacheVerifiedAgo: (ms: number, revision = "cached") => activateSelectionProfile(PROFILE(revision), { cacheDir, now: () => Date.now() - ms }),
    hook: (childEnv: Record<string, string> = {}, event = "SessionStart", agent = "claude") =>
      run(["hook", "user-prompt", "--agent", agent, "--selection-profile", "engineering", "--event", event], childEnv, { hook_event_name: event, session_id: `session-${Math.random().toString(16).slice(2)}`, prompt: "test request" }),
  };
}
const context = (result: { value: any }) => result.value.hookSpecificOutput?.additionalContext ?? "";

test("by default every SessionStart refreshes through the ordinary sync child, however recent the cached profile", async () => {
  const f = await fixture();
  f.cacheVerifiedAgo(MINUTE);
  const started = await f.hook();
  expect(context(started)).toContain(CONTEXT);
  expect(started.stdout).not.toContain("profile refresh did not finish");
  expect(f.syncs()).toEqual(["sync --selection-profile engineering --no-station-report --json"]);
});

test("a station that sets a refresh age skips the refresh while its cached profile is younger and refreshes once it is older or missing", async () => {
  const f = await fixture(), hourly = { SKILLS_SESSION_START_SYNC_MAX_AGE_MINUTES: "60" };
  f.cacheVerifiedAgo(5 * MINUTE);
  const fresh = await f.hook(hourly);
  expect(context(fresh)).toContain(CONTEXT);
  expect(fresh.stdout).not.toContain("profile refresh did not finish");
  expect(f.syncs()).toEqual([]);
  f.cacheVerifiedAgo(61 * MINUTE);
  const stale = await f.hook(hourly);
  expect(context(stale)).toContain(CONTEXT);
  expect(f.syncs()).toHaveLength(1);
  // An invalid setting keeps the every-start default.
  f.cacheVerifiedAgo(MINUTE);
  await f.hook({ SKILLS_SESSION_START_SYNC_MAX_AGE_MINUTES: "1441" });
  expect(f.syncs()).toHaveLength(2);
  const missing = await fixture();
  await missing.hook(hourly);
  expect(missing.syncs()).toHaveLength(1);
});

test("prompt and subagent events never refresh, whatever the cached profile's age; a Codex SessionStart does", async () => {
  const f = await fixture();
  f.cacheVerifiedAgo(23 * 60 * MINUTE);
  for (const event of ["UserPromptSubmit", "SubagentStart"]) {
    const result = await f.hook({}, event);
    expect(context(result)).toContain(CONTEXT);
  }
  await f.hook({}, "SessionStart", "codex");
  expect(f.syncs()).toHaveLength(1);
  for (const agent of ["claude", "codex"]) await f.hook({}, "UserPromptSubmit", agent);
  expect(f.syncs()).toHaveLength(1);
});

test("a refresh that does not finish in its budget falls back to the verified profile with one notice and frees the next session start", async () => {
  const f = await fixture();
  f.cacheVerifiedAgo(2 * 60 * MINUTE);
  const slow = await f.hook({ SKILLS_TEST_SYNC_DELAY: "20000" });
  expect(context(slow)).toContain(CONTEXT);
  expect(context(slow)).toContain(NOTICE);
  expect(slow.ms).toBeLessThan(MANAGED_HOOK_DEADLINE_MS);
  expect(existsSync(profileRefreshLockPath("engineering", { cacheDir: f.cacheDir }))).toBe(false);
  const failed = await f.hook({ SKILLS_TEST_SYNC_EXIT: "1", SKILLS_TEST_SYNC_STDOUT: JSON.stringify({ error: { code: "SKILLS_API_UNAVAILABLE", message: "untrusted fixture message" } }) });
  expect(context(failed)).toContain(CONTEXT);
  expect(context(failed)).toContain("Skills profile refresh did not finish at session start [SKILLS_API_UNAVAILABLE] (stage=sync)");
  expect(failed.stdout).not.toContain("untrusted fixture message");
  const next = await f.hook();
  expect(next.stdout).not.toContain("profile refresh did not finish");
  expect(f.syncs()).toHaveLength(3);
});

test("concurrent session starts on one station run one refresh, and every one uses the profile it activated", async () => {
  const f = await fixture();
  f.cacheVerifiedAgo(2 * 60 * MINUTE, "old");
  const env = { SKILLS_TEST_SYNC_DELAY: "3000", SKILLS_TEST_SYNC_ACTIVATE: JSON.stringify(PROFILE("new")) };
  const results = await Promise.all([f.hook(env), f.hook(env), f.hook(env)]);
  for (const result of results) {
    expect(context(result)).toContain(CONTEXT);
    expect(result.stdout).not.toContain("profile refresh did not finish");
  }
  expect(f.syncs()).toHaveLength(1);
  const cached = readSelectionProfile("engineering", { cacheDir: f.cacheDir });
  expect(cached?.profile.profileRevision).toBe("new");
  expect(existsSync(profileRefreshLockPath("engineering", { cacheDir: f.cacheDir }))).toBe(false);
});

test("a session start that finds another live refresh waits only within its budget, then uses the verified profile with the notice", async () => {
  const f = await fixture();
  f.cacheVerifiedAgo(2 * 60 * MINUTE);
  const marker = profileRefreshLockPath("engineering", { cacheDir: f.cacheDir });
  expect(createExclusiveSelectionJson(marker, { pid: 1, host: "other", startedAt: new Date().toISOString() })).toBe(true);
  const waited = await f.hook();
  expect(context(waited)).toContain(CONTEXT);
  expect(context(waited)).toContain(NOTICE);
  expect(waited.ms).toBeLessThan(MANAGED_HOOK_DEADLINE_MS);
  expect(f.syncs()).toEqual([]);
  // The live holder's marker is never removed by the waiter.
  expect(existsSync(marker)).toBe(true);
});

test("a refresh marker left by a hook that no longer runs is taken over and released", async () => {
  const f = await fixture();
  f.cacheVerifiedAgo(2 * 60 * MINUTE);
  const marker = profileRefreshLockPath("engineering", { cacheDir: f.cacheDir });
  expect(createExclusiveSelectionJson(marker, { pid: 1, host: "other", startedAt: new Date().toISOString() })).toBe(true);
  const old = (Date.now() - SESSION_START_REFRESH_LOCK_STALE_MS - 30_000) / 1000;
  utimesSync(marker, old, old);
  const started = await f.hook();
  expect(context(started)).toContain(CONTEXT);
  expect(started.stdout).not.toContain("profile refresh did not finish");
  expect(f.syncs()).toHaveLength(1);
  expect(existsSync(marker)).toBe(false);
});
