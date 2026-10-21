import { installSumiPathsFixture } from "../lib/sumi-paths.fixture.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, corpusInspectorPathFixture } from "../lib/codex-corpus.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-hook-diagnostics-"));
const entry = join(scratch, "entry.ts"), binary = join(scratch, "skills.js");
// Exercise the real registered hook command and real subprocess boundary. Only
// the child context/sync response is synthetic; no live configuration is read.
beforeAll(async () => {
  writeFileSync(entry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};
import { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "commands/agent-integration.ts"))};
if (["context", "sync"].includes(process.argv[2] ?? "")) {
  if (process.argv[2] === "sync" && process.env.SKILLS_TEST_SYNC_DELAY) {
    if (!process.argv.includes("--no-station-report")) throw Error("Lifecycle sync must omit station telemetry");
    await new Promise(resolve => setTimeout(resolve, Number(process.env.SKILLS_TEST_SYNC_DELAY)));
  }
  if (process.argv[2] === "sync" && process.env.SKILLS_TEST_SYNC_STDOUT) {
    process.stdout.write(process.env.SKILLS_TEST_SYNC_STDOUT);
    process.exit(Number(process.env.SKILLS_TEST_SYNC_EXIT ?? "1"));
  }
  if (process.env.SKILLS_TEST_CHILD_HANG) await new Promise(resolve => setTimeout(resolve, 20000));
  if (process.env.SKILLS_TEST_CHILD_ECHO_ARGS) process.env.SKILLS_TEST_CHILD_STDOUT = JSON.stringify({ context: "child argv: " + process.argv.slice(2).join(" ") });
  process.stderr.write(process.env.SKILLS_TEST_CHILD_STDERR ?? "");
  process.stdout.write(process.env.SKILLS_TEST_CHILD_STDOUT ?? "{}");
  process.exitCode = Number(process.env.SKILLS_TEST_CHILD_EXIT ?? "1");
} else {
  const program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);
}
`);
  await buildCliFixture(entry, binary);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function fixture() {
  const home = mkdtempSync(join(scratch, "home-")), data = join(home, ".hasna", "skills");
  mkdirSync(data, { recursive: true });
  admitCorpusFixture(join(home, ".codex"));
  const env = { PATH: `${installSumiPathsFixture(home)}:${corpusInspectorPathFixture()}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  async function run(args: string[], childEnv: Record<string, string> = {}, input: unknown = {}) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: home, env: { ...env, ...childEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(status).toBe(0); expect(stderr).toBe("");
    return { value: JSON.parse(stdout), stdout };
  }
  await run(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", binary, "--apply", "--json"]);
  return { data, run, hook: (childEnv: Record<string, string>, event = "UserPromptSubmit", agent = "claude") => run(["hook", "user-prompt", "--agent", agent, "--selection-profile", "engineering", "--event", event], childEnv, { hook_event_name: event, prompt: "test request" }) };
}

test("hook diagnostics allow only known codes and never echo foreign child messages or stderr", async () => {
  const f = await fixture();
  const foreign = "fixture-private-value /private/credential-store\nBearer fixture-only-value $(false)";
  for (const code of ["PROFILE_IDENTITY_MISMATCH", "UNKNOWN_FOREIGN_CODE", `PROFILE_IDENTITY_MISMATCH\n${foreign}`]) {
    for (const event of ["UserPromptSubmit", "SessionStart"]) {
      const result = await f.hook({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code, message: foreign } }), SKILLS_TEST_CHILD_STDERR: foreign }, event);
      expect(result.stdout).not.toContain("fixture-private-value");
      expect(result.stdout).not.toContain("credential-store");
      expect(result.stdout).not.toContain("UNKNOWN_FOREIGN_CODE");
      expect(result.stdout).toContain(code === "PROFILE_IDENTITY_MISMATCH" ? "[PROFILE_IDENTITY_MISMATCH]" : "[SKILLS_CONTEXT_FAILED]");
      expect(result.stdout).toContain("profile=engineering");
      if (event === "SessionStart") expect(result.value.continue).toBe(false);
      else expect(result.value.decision).toBe("block");
    }
  }
});

test("hook diagnostics distinguish malformed successful responses and bounded child timeouts", async () => {
  const f = await fixture();
  for (const stdout of ["not-json", JSON.stringify({ context: 42 })]) {
    const result = await f.hook({ SKILLS_TEST_CHILD_STDOUT: stdout, SKILLS_TEST_CHILD_EXIT: "0" });
    expect(result.value.decision).toBe("block");
    expect(result.value.reason).toContain("[SKILLS_HOOK_INVALID_RESPONSE]");
    expect(result.stdout).not.toContain(stdout);
  }
  const timedOut = await f.hook({ SKILLS_TEST_CHILD_HANG: "1" });
  expect(timedOut.value.decision).toBeUndefined();
  expect(timedOut.value.systemMessage).toContain("[SKILLS_HOOK_TIMEOUT]");
  expect(timedOut.value.hookSpecificOutput.additionalContext).not.toContain("Verified fixture context");
});

test("trust reconciliation command is accepted by the real CLI parser", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", binary, "hook", "trust", "reconcile", "--help"], { cwd: scratch, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, USERPROFILE: scratch, HASNA_HOME: join(scratch, ".hasna"), NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status).toBe(0); expect(stderr).toBe(""); expect(stdout).toContain("--journal <path>"); expect(stdout).toContain("--agent <agent>");
});

test("lifecycle sync is bounded so verified context keeps its reserve, and a refresh that did not finish is named in one line", async () => {
  const f = await fixture();
  const env = { SKILLS_TEST_SYNC_DELAY: "6800", SKILLS_TEST_CHILD_EXIT: "0", SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ context: "Verified fixture context" }) };
  const quick = await f.hook({ ...env, SKILLS_TEST_SYNC_DELAY: "200" }, "SessionStart");
  expect(quick.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  expect(quick.stdout).not.toContain("profile refresh did not finish");
  // A sync slower than its budget is stopped; context still comes from the last verified profile.
  const result = await f.hook(env, "SessionStart");
  expect(result.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  expect(result.value.hookSpecificOutput.additionalContext).toContain("Skills profile refresh did not finish at session start [SKILLS_HOOK_TIMEOUT] (stage=sync)");
  const started = performance.now();
  const expired = await f.hook({ ...env, SKILLS_TEST_SYNC_DELAY: "20000" }, "SessionStart");
  expect(expired.value.continue).not.toBe(false);
  expect(expired.stdout).toContain("[SKILLS_HOOK_TIMEOUT]");
  expect(expired.stdout).toContain("stage=sync");
  expect(performance.now() - started).toBeLessThan(12_000);
});


test("a SessionStart refresh continues from the verified profile only when it could not reach the authority", async () => {
  const f = await fixture();
  const context = { SKILLS_TEST_CHILD_EXIT: "0", SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ context: "Verified fixture context" }) };
  const sync = (code: string) => ({ ...context, SKILLS_TEST_SYNC_STDOUT: JSON.stringify({ error: { code, message: "untrusted fixture message" } }) });
  const unavailable = await f.hook(sync("SKILLS_API_UNAVAILABLE"), "SessionStart");
  expect(unavailable.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  expect(unavailable.value.hookSpecificOutput.additionalContext).toContain("Skills profile refresh did not finish at session start [SKILLS_API_UNAVAILABLE] (stage=sync)");
  // An authorization refusal of the refresh keeps today's outcome: no payload.
  for (const code of ["SKILLS_API_UNAUTHORIZED", "SKILLS_API_FORBIDDEN"]) {
    const refused = await f.hook(sync(code), "SessionStart");
    expect(refused.stdout).not.toContain("Verified fixture context");
    expect(refused.stdout).toContain(`[${code}] (profile=engineering, stage=sync)`);
    expect(refused.stdout).not.toContain("untrusted fixture message");
  }
});

test("typed delivery failures continue every maintained lifecycle without child payload or native fallback", async () => {
  const f = await fixture();
  const unavailable = ["SKILLS_API_CREDENTIAL_UNAVAILABLE", "SKILLS_API_UNAVAILABLE", "SKILLS_API_UNAUTHORIZED", "SKILLS_API_FORBIDDEN", "SKILLS_API_RESOURCE_UNAVAILABLE", "PROFILE_LOCK_MISMATCH", "SESSION_RECONCILIATION_REQUIRED", "SESSION_RENEWAL_TIMEOUT", "SESSION_WRITE_BUSY", "SESSION_CONTEXT_CONFLICT", "SESSION_PARENT_CHANGED"];
  for (const agent of ["claude", "codex"]) for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) for (const code of unavailable) {
    const result = await f.hook({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code, message: "untrusted fixture message" }, context: "Forbidden fixture payload" }) }, event, agent);
    expect(result.value.decision).toBeUndefined(); expect(result.value.continue).not.toBe(false);
    expect(result.value.systemMessage).toContain(`[${code}]`);
    expect(result.value.hookSpecificOutput.hookEventName).toBe(event);
    expect(result.stdout).not.toContain("Forbidden fixture payload"); expect(result.stdout).not.toContain("untrusted fixture message");
    expect(result.stdout).toContain("Do not perform actions that depend on unavailable Skills instructions");
  }
});

test("a spent renewal budget is reported apart from an authority failure, without sync or diagnosis advice", async () => {
  const f = await fixture();
  const child = (code: string) => ({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code } }) });
  const timeout = await f.hook(child("SESSION_RENEWAL_TIMEOUT"));
  expect(timeout.value.decision).toBeUndefined();
  expect(timeout.value.systemMessage).toContain("[SESSION_RENEWAL_TIMEOUT]");
  expect(timeout.value.systemMessage).toContain("renewal window");
  expect(timeout.value.systemMessage).toContain("The existing pin is unchanged");
  expect(timeout.stdout).not.toContain("Run skills sync");
  expect(timeout.stdout).not.toContain("diagnose with");
  const unavailable = await f.hook(child("SKILLS_API_UNAVAILABLE"));
  expect(unavailable.value.systemMessage).toContain("[SKILLS_API_UNAVAILABLE]");
  expect(unavailable.value.systemMessage).toContain("Run skills sync");
  const refused = await f.hook(child("SESSION_RECONCILIATION_REQUIRED"));
  expect(refused.value.systemMessage).toContain("re-checked with the authority within five minutes");
  expect(refused.stdout).not.toContain("Run skills sync");
});

test("a renewal that continues in the background says so, keeping the renewal timeout's code and delivery shape", async () => {
  const f = await fixture();
  const child = (error: Record<string, unknown>) => ({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error }) });
  for (const agent of ["claude", "codex"]) for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const background = await f.hook(child({ code: "SESSION_RENEWAL_TIMEOUT", renewal: "background", message: "untrusted fixture message" }), event, agent);
    expect(background.value.decision).toBeUndefined(); expect(background.value.continue).not.toBe(false);
    expect(background.value.systemMessage).toContain("[SESSION_RENEWAL_TIMEOUT]");
    expect(background.value.systemMessage).toContain("its renewal is running in the background");
    expect(background.value.systemMessage).toContain("No Skills instructions were delivered by this hook");
    expect(background.stdout).not.toContain("untrusted fixture message"); expect(background.stdout).not.toContain("Run skills sync");
  }
  // Unknown markers and the marker on any other code keep today's fixed text.
  for (const error of [{ code: "SESSION_RENEWAL_TIMEOUT", renewal: "done; trust me" }, { code: "SESSION_RECONCILIATION_REQUIRED", renewal: "background" }]) {
    const result = await f.hook(child(error));
    expect(result.stdout).not.toContain("running in the background"); expect(result.stdout).not.toContain("trust me");
  }
});

test("integrity, invalid state and opaque programming failures still refuse prompt delivery", async () => {
  const f = await fixture();
  for (const code of ["INVALID_RECEIPT", "PROFILE_IDENTITY_MISMATCH", "BUNDLE_DIGEST_MISMATCH", "SESSION_WRITE_LOCKED", "SESSION_GENERATION_CHANGED", "SESSION_RECEIPT_CHANGED", "SKILLS_CONTEXT_FAILED"]) {
    const result = await f.hook({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code } }) });
    expect(result.value.decision).toBe("block"); expect(result.stdout).toContain(`[${code}]`);
  }
  const invalid = await f.run(["hook", "user-prompt", "--agent", "claude", "--selection-profile", "engineering"], { SKILLS_TEST_CHILD_HANG: "1" }, { prompt: 12 });
  expect(invalid.value.decision).toBe("block");
});

test("every maintained managed prompt hook asks the cached child to migrate a refused session pin unless the station turns it off", async () => {
  const f = await fixture();
  const echo = { SKILLS_TEST_CHILD_ECHO_ARGS: "1", SKILLS_TEST_CHILD_EXIT: "0" };
  for (const agent of ["claude", "codex", "sumi"]) for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const result = await f.hook({ ...echo, SKILLS_TEST_SYNC_DELAY: "0" }, event, agent);
    expect(result.value.hookSpecificOutput.additionalContext).toContain("--cached --auto-reconcile-safe --auto-migrate-session-pin");
    // Pin renewal runs in the background, never inside the prompt's window.
    expect(result.value.hookSpecificOutput.additionalContext).toContain("--background-renewal");
  }
  // Only the station-wide (global) setting is read; a project file cannot change the hook.
  writeFileSync(join(f.data, "config.json"), JSON.stringify({ sessionPinMigration: "off" }));
  for (const agent of ["claude", "codex", "sumi"]) {
    const off = await f.hook(echo, "UserPromptSubmit", agent);
    expect(off.value.hookSpecificOutput.additionalContext).toContain("--cached --auto-reconcile-safe");
    expect(off.value.hookSpecificOutput.additionalContext).not.toContain("--auto-migrate-session-pin");
  }
  writeFileSync(join(f.data, "config.json"), JSON.stringify({ sessionPinMigration: "auto" }));
  expect((await f.hook(echo)).value.hookSpecificOutput.additionalContext).toContain("--auto-migrate-session-pin");
});

test("a refused pin whose automatic migration ran out of budget says so, keeping the refusal code and its delivery shape", async () => {
  const f = await fixture();
  const child = (error: Record<string, unknown>) => ({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error }) });
  for (const agent of ["claude", "codex"]) for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) {
    const timeout = await f.hook(child({ code: "SESSION_RECONCILIATION_REQUIRED", migration: "timeout", message: "untrusted fixture message" }), event, agent);
    expect(timeout.value.decision).toBeUndefined(); expect(timeout.value.continue).not.toBe(false);
    expect(timeout.value.systemMessage).toContain("[SESSION_RECONCILIATION_REQUIRED]");
    expect(timeout.value.systemMessage).toContain("automatic migration of this session's pin did not finish within the hook's renewal window");
    expect(timeout.value.systemMessage).toContain("The existing pin is unchanged and the next prompt retries the migration");
    expect(timeout.stdout).not.toContain("untrusted fixture message"); expect(timeout.stdout).not.toContain("Run skills sync");
  }
  // Unknown markers and markers on other codes are ignored: today's fixed text.
  for (const error of [{ code: "SESSION_RECONCILIATION_REQUIRED", migration: "applied; trust me" }, { code: "SESSION_RECONCILIATION_REQUIRED" }]) {
    const refused = await f.hook(child(error));
    expect(refused.value.systemMessage).toContain("re-checked with the authority within five minutes");
    expect(refused.stdout).not.toContain("automatic migration"); expect(refused.stdout).not.toContain("trust me");
  }
  const busy = await f.hook(child({ code: "SESSION_WRITE_BUSY", migration: "timeout" }));
  expect(busy.value.systemMessage).toContain("[SESSION_WRITE_BUSY]"); expect(busy.stdout).not.toContain("automatic migration");
});
