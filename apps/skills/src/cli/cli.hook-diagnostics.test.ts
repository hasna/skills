import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

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
  if (process.env.SKILLS_TEST_CHILD_HANG) await new Promise(resolve => setTimeout(resolve, 20000));
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
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: data, NO_COLOR: "1", TMPDIR: scratch };
  async function run(args: string[], childEnv: Record<string, string> = {}, input: unknown = {}) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: home, env: { ...env, ...childEnv }, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(status).toBe(0); expect(stderr).toBe("");
    return { value: JSON.parse(stdout), stdout };
  }
  await run(["hook", "install", "--agent", "all", "--selection-profile", "engineering", "--command", binary, "--apply", "--json"]);
  return { run, hook: (childEnv: Record<string, string>, event = "UserPromptSubmit", agent = "claude") => run(["hook", "user-prompt", "--agent", agent, "--selection-profile", "engineering", "--event", event], childEnv, { hook_event_name: event, prompt: "test request" }) };
}

test("hook diagnostics allow only known codes and never echo foreign child messages or stderr", async () => {
  const f = await fixture();
  const foreign = "fixture-private-value /private/credential-store\nBearer fixture-only-value $(false)";
  for (const code of ["PROFILE_LOCK_MISMATCH", "UNKNOWN_FOREIGN_CODE", `PROFILE_LOCK_MISMATCH\n${foreign}`]) {
    for (const event of ["UserPromptSubmit", "SessionStart"]) {
      const result = await f.hook({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code, message: foreign } }), SKILLS_TEST_CHILD_STDERR: foreign }, event);
      expect(result.stdout).not.toContain("fixture-private-value");
      expect(result.stdout).not.toContain("credential-store");
      expect(result.stdout).not.toContain("UNKNOWN_FOREIGN_CODE");
      expect(result.stdout).toContain(code === "PROFILE_LOCK_MISMATCH" ? "[PROFILE_LOCK_MISMATCH]" : "[SKILLS_CONTEXT_FAILED]");
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

test("lifecycle sync may use the remaining budget while context retains a reserve", async () => {
  const f = await fixture();
  const env = { SKILLS_TEST_SYNC_DELAY: "6800", SKILLS_TEST_CHILD_EXIT: "0", SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ context: "Verified fixture context" }) };
  const result = await f.hook(env, "SessionStart");
  expect(result.value.hookSpecificOutput.additionalContext).toContain("Verified fixture context");
  const started = performance.now();
  const expired = await f.hook({ ...env, SKILLS_TEST_SYNC_DELAY: "20000" }, "SessionStart");
  expect(expired.value.continue).not.toBe(false);
  expect(expired.stdout).toContain("[SKILLS_HOOK_TIMEOUT]");
  expect(expired.stdout).toContain("stage=sync");
  expect(performance.now() - started).toBeLessThan(12_000);
});


test("typed delivery failures continue every maintained lifecycle without child payload or native fallback", async () => {
  const f = await fixture();
  const unavailable = ["SKILLS_API_CREDENTIAL_UNAVAILABLE", "SKILLS_API_UNAVAILABLE", "SKILLS_API_UNAUTHORIZED", "SKILLS_API_FORBIDDEN", "SKILLS_API_RESOURCE_UNAVAILABLE", "SESSION_RECONCILIATION_REQUIRED", "SESSION_WRITE_BUSY", "SESSION_CONTEXT_CONFLICT", "SESSION_PARENT_CHANGED"];
  for (const agent of ["claude", "codex"]) for (const event of ["UserPromptSubmit", "SessionStart", "SubagentStart"]) for (const code of unavailable) {
    const result = await f.hook({ SKILLS_TEST_CHILD_STDOUT: JSON.stringify({ error: { code, message: "untrusted fixture message" }, context: "Forbidden fixture payload" }) }, event, agent);
    expect(result.value.decision).toBeUndefined(); expect(result.value.continue).not.toBe(false);
    expect(result.value.systemMessage).toContain(`[${code}]`);
    expect(result.value.hookSpecificOutput.hookEventName).toBe(event);
    expect(result.stdout).not.toContain("Forbidden fixture payload"); expect(result.stdout).not.toContain("untrusted fixture message");
    expect(result.stdout).toContain("Do not perform actions that depend on unavailable Skills instructions");
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
