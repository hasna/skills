/**
 * Timeout nesting on the managed hook's first turn, after SessionStart's sync
 * has used part of the 12-second window. Runs the real `hook user-prompt`
 * command and the generated Hermes supervisor against a stand-in sync and
 * context child, so each layer's timer is measured as installed. Adapted from
 * the independent correctness review of hasna/skills#152.
 */
import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";
import { hermesHookDefinitions } from "../lib/agent-hermes.js";
import { MANAGED_HOOK_DEADLINE_MS, SESSION_RENEWAL_TIMEOUT_MS, SESSION_START_CONTEXT_RESERVE_MS } from "../lib/session-reconciliation.js";

const scratch = mkdtempSync(join(tmpdir(), "skills-hook-nesting-"));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js"), executable = join(scratch, "skills");
// The stand-in context child records the renewal budget it was given, then
// either runs a renewal to exactly that budget (the default one when it was
// given none) or hangs.
beforeAll(async () => {
  writeFileSync(entry, `import { writeFileSync } from "node:fs";
import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
if (process.argv[2] === "sync") {
  await sleep(process.env.SKILLS_TEST_SYNC_SLEEP === "hang" ? 30_000 : Number(process.env.SKILLS_TEST_SYNC_SLEEP ?? "0"));
  process.stdout.write("{}");
} else if (process.argv[2] === "context") {
  const at = process.argv.indexOf("--renewal-budget-ms"), budget = at < 0 ? "none" : process.argv[at + 1]!;
  writeFileSync(process.env.SKILLS_TEST_BUDGET_FILE!, budget);
  if (process.env.SKILLS_TEST_CHILD_MODE === "hang") await sleep(30_000);
  // Without a budget from the hook, a renewal runs to the default 9 s budget.
  else await sleep(budget === "none" ? 9_250 : Number(budget));
  process.stdout.write(JSON.stringify({ error: { code: "SESSION_RENEWAL_TIMEOUT", message: "stand-in renewal ran to its budget" } }));
  process.exitCode = 1;
} else {
  const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
}
`);
  await buildCliFixture(entry, binary);
  writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${binary}' "$@"\n`); chmodSync(executable, 0o700);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function station() {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills"), budgetFile = join(home, "budget.txt");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const env = { PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home,
    HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch, SKILLS_TEST_BUDGET_FILE: budgetFile };
  async function run(command: string[], extra: Record<string, string>, input: unknown) {
    const started = performance.now();
    const child = Bun.spawn(command, { cwd: home, env: { ...env, ...extra }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [stdout, , status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, status, ms: Math.round(performance.now() - started), budget: existsSync(budgetFile) ? readFileSync(budgetFile, "utf8") : "not spawned" };
    } finally { clearTimeout(timer); }
  }
  const installed = await run([process.execPath, "--no-env-file", binary, "hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", executable, "--apply", "--json"], {}, {});
  expect(installed.status).toBe(0);
  const supervisor = join(data, "agent-hooks", "hermes.js");
  const definitions = hermesHookDefinitions({ path: supervisor, runtime: process.execPath });
  writeFileSync(join(home, ".hermes", "shell-hooks-allowlist.json"), JSON.stringify({ approvals: Object.entries(definitions).map(([event, entry]) => ({ event, command: entry.command })) }), { mode: 0o600 });
  return {
    hermesFirstTurn: (extra: Record<string, string>) => run([process.execPath, supervisor, "--event", "pre_llm_call"], extra,
      { hook_event_name: "pre_llm_call", cwd: home, session_id: "s1", extra: { user_message: "test request", is_first_turn: true } }),
    claude: (event: "SessionStart" | "UserPromptSubmit", extra: Record<string, string>) => run([process.execPath, "--no-env-file", binary, "hook", "user-prompt", "--agent", "claude", "--selection-profile", "engineering", "--event", event], extra,
      { hook_event_name: event, session_id: "s1", cwd: home, ...(event === "UserPromptSubmit" ? { prompt: "continue the current task" } : { source: "startup" }) }),
  };
}
const SUPERVISOR_REFUSAL = "Stop and repair skills sync/hook installation";
const afterSync = { SKILLS_TEST_SYNC_SLEEP: "3000" };

test("a full prompt window keeps the whole renewal budget", async () => {
  const s = await station(), result = await s.claude("UserPromptSubmit", {});
  expect(Number(result.budget)).toBe(SESSION_RENEWAL_TIMEOUT_MS);
  expect(result.stdout).toContain("SESSION_RENEWAL_TIMEOUT");
}, 60_000);

test("after a 3-second SessionStart sync, a renewal at its budget is reported by the renewal, not by the hook's kill", async () => {
  const s = await station(), result = await s.claude("SessionStart", afterSync);
  const budget = Number(result.budget);
  expect(budget).toBeGreaterThan(0);
  expect(budget).toBeLessThan(SESSION_RENEWAL_TIMEOUT_MS);
  expect(result.stdout).toContain("SESSION_RENEWAL_TIMEOUT");
  expect(result.stdout).not.toContain("SKILLS_HOOK_TIMEOUT");
  expect(result.status).toBe(0);
}, 60_000);

test("a Hermes first turn after a 3-second sync reports the renewal timeout, not the supervisor's refusal", async () => {
  const s = await station(), result = await s.hermesFirstTurn(afterSync);
  expect(result.stdout).toContain("SESSION_RENEWAL_TIMEOUT");
  expect(result.stdout).not.toContain(SUPERVISOR_REFUSAL);
  expect(result.status).toBe(0);
}, 60_000);

test("a hung context child on a Hermes first turn is reported by the hook before the supervisor kills it", async () => {
  const s = await station(), result = await s.hermesFirstTurn({ ...afterSync, SKILLS_TEST_CHILD_MODE: "hang" });
  expect(result.stdout).toContain("SKILLS_HOOK_TIMEOUT");
  expect(result.stdout).not.toContain(SUPERVISOR_REFUSAL);
  expect(result.status).toBe(0);
}, 60_000);

// A long sync can no longer use the context child's share of the window: it
// is stopped at its own budget, reported in one line, and the context child
// still runs with the rest. Nothing is left for the Hermes supervisor to kill.
const SYNC_NOTICE = "Skills profile refresh did not finish at session start [SKILLS_HOOK_TIMEOUT] (stage=sync)";
test("a long SessionStart sync is stopped at its own budget and the context child keeps the rest of the window", async () => {
  const s = await station(), longSync = { SKILLS_TEST_SYNC_SLEEP: "8500" };
  for (const result of [await s.claude("SessionStart", longSync), await s.hermesFirstTurn(longSync)]) {
    const budget = Number(result.budget);
    expect(budget).toBeGreaterThan(SESSION_START_CONTEXT_RESERVE_MS - 3_000);
    expect(budget).toBeLessThan(SESSION_RENEWAL_TIMEOUT_MS);
    expect(result.stdout).toContain(SYNC_NOTICE);
    expect(result.stdout).toContain("SESSION_RENEWAL_TIMEOUT");
    expect(result.stdout).not.toContain(SUPERVISOR_REFUSAL);
    expect(result.status).toBe(0);
    expect(result.ms).toBeLessThan(MANAGED_HOOK_DEADLINE_MS + 1_500);
  }
}, 90_000);

test("a sync that never finishes is stopped by the hook, which reports it and still runs the context child before any outer kill", async () => {
  const s = await station(), hungSync = { SKILLS_TEST_SYNC_SLEEP: "hang" };
  for (const result of [await s.claude("SessionStart", hungSync), await s.hermesFirstTurn(hungSync)]) {
    expect(Number(result.budget)).toBeGreaterThan(0);
    expect(result.stdout).toContain(SYNC_NOTICE);
    expect(result.stdout).toContain("SESSION_RENEWAL_TIMEOUT");
    expect(result.stdout).not.toContain(SUPERVISOR_REFUSAL);
    expect(result.status).toBe(0);
    expect(result.ms).toBeLessThan(MANAGED_HOOK_DEADLINE_MS + 1_500);
  }
}, 90_000);
