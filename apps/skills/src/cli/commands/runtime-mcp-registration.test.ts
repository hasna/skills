import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../../test-preload.js";
import { bootstrapModes, firstRunModes, registrationModes, registrationFailureLine, readRegistrationFailure, readRegistrationReceipt } from "./runtime-mcp-registration-diagnostics.fixture.js";

useDefaultTestTimeout();

for (const mode of registrationModes) {
  test(`agent MCP registration preserves selection and stdio: ${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-mcp-registration-"));
    const diagnosticId = randomUUID();
    for (const name of ["home", "tmp"]) mkdirSync(join(root, name), { mode: 0o700 });
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", resolve(import.meta.dir, "runtime-mcp-registration.fixture.ts"), mode], {
      cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PATH: "/nonexistent-fixture-bin", NO_COLOR: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", REGISTRATION_FIXTURE_ROOT: root, REGISTRATION_DIAGNOSTIC_ID: diagnosticId },
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 20_000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      const diagnostic = JSON.stringify({ exit: Number.isInteger(code) ? code : null,
        location: stderr.match(/runtime-mcp-registration\.fixture\.ts:[0-9]{1,7}:[0-9]{1,7}(?![0-9])/)?.[0] ?? "unavailable",
        registration: readRegistrationFailure(stderr, mode, diagnosticId) ?? "unavailable" });
      expect(timedOut, diagnostic).toBe(false); expect(stderr.length, diagnostic).toBe(0); expect(code, diagnostic).toBe(0);
      const receipt = readRegistrationReceipt(stdout, mode);
      expect(receipt !== undefined, diagnostic).toBe(true);
      expect(receipt).toMatchObject({ mode, unrelatedEntriesPreserved: true, credentialsUnchanged: true, credentialsNotDisclosed: true, networkCalls: 0 });
      const firstRunRefused = firstRunModes.includes(mode) && !["claude-first-run", "claude-first-run-no-userid"].includes(mode);
      const bootstrapRefused = bootstrapModes.includes(mode) && !["claude-native-bootstrap", "claude-native-bootstrap-existing"].includes(mode);
      expect(receipt!.adapters).toBe(["bad-url", "aliases"].includes(mode) ? 0 : bootstrapRefused || firstRunRefused ? 6 : ["invalid-toml", "claude-drift", "claude-locked", "claude-late-lock", "claude-policy-refused", "claude-blocked", "claude-unknown-refusal", "claude-spawn-refused"].includes(mode) ? 6 : 7);
    } finally {
      clearTimeout(timer);
      // Only this test's freshly created child and synthetic files are owned here.
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      rmSync(root, { recursive: true, force: true });
    }
  });
}

const diagnosticAgents = ["claude", "codex", "gemini", "pi", "opencode", "cursor", "windsurf"];
const diagnosticResults = () => diagnosticAgents.map(agent => ({ agent, success: true, error: "", command: "private fixture command" }));
const diagnosticInput = () => ({ mode: "claude-native-bootstrap", id: randomUUID(),
  logs: JSON.stringify({ results: diagnosticResults() }), exitMatches: false });

test("registration failure diagnostics expose exact known adapter refusals without private result fields", () => {
  const categories = [
    ["ACCESS_METADATA_UNAVAILABLE", "configuration access metadata could not be verified or preserved"],
    ["UNSAFE_PATH", "refused an unsafe or unowned configuration path"],
    ["OWNERSHIP_UNAVAILABLE", "configuration ownership cannot be verified on this platform"],
    ["LOCKED", "configuration is locked; no foreign lock was removed"],
    ["INVALID_CONFIG", "existing configuration is invalid"],
    ["BACKUP_FAILED", "could not preserve and verify the original configuration"],
    ["WRITE_FAILED", "could not prepare the replacement configuration"],
    ["CONFIG_CHANGED", "configuration or its path changed during registration"],
    ["VERIFY_FAILED", "could not verify the committed configuration; retain the backup for recovery"],
    ["UPDATE_REFUSED", "configuration update was refused"],
  ];
  for (const agent of diagnosticAgents) for (const [category, message] of categories) {
    const results = diagnosticResults(), result = results.find(entry => entry.agent === agent)!;
    result.success = false;
    result.error = agent === "claude" ? "Could not safely update the Claude user MCP configuration; native admission or config checks refused the update"
      : `Could not safely update the ${agent === "codex" ? "Codex" : agent === "opencode" ? "OpenCode" : "agent"} MCP configuration: ${message}`;
    const input = { ...diagnosticInput(), logs: JSON.stringify({ results }) };
    const line = registrationFailureLine(input)!;
    const record = readRegistrationFailure(line + "\nprivate assertion output", input.mode, input.id)!;
    expect(record.agents.map(entry => entry.agent)).toEqual(diagnosticAgents);
    expect(record.agents.find(entry => entry.agent === agent)).toEqual({ agent, success: false,
      refusal: agent === "claude" ? "CLAUDE_REFUSED" : category, argsChecked: false, argsPresent: false, argsMatch: false });
    expect(line.includes(result.command)).toBe(false); expect(line.includes(result.error)).toBe(false);
    expect(JSON.stringify(record).includes("private assertion output")).toBe(false);
  }
});

test("registration diagnostics identify missing stdio args even when an expected Claude refusal masks the extra failure", () => {
  const results = diagnosticResults();
  results[0]!.success = false; results[0]!.error = "private Claude refusal with a config path";
  results[1]!.success = false; results[1]!.error = "Could not safely update the Codex MCP configuration: configuration is locked; no foreign lock was removed";
  const input = { ...diagnosticInput(), mode: "claude-native-bootstrap-existing-remove", exitMatches: true,
    logs: JSON.stringify({ results }), args: { agent: "codex", value: undefined } };
  const record = readRegistrationFailure(registrationFailureLine(input)!, input.mode, input.id)!;
  expect(record.exitMatches).toBe(true);
  expect(record.agents[0]!.refusal).toBe("UNKNOWN");
  expect(record.agents[1]).toEqual({ agent: "codex", success: false, refusal: "LOCKED", argsChecked: true, argsPresent: false, argsMatch: false });
  const wrongArgs = readRegistrationFailure(registrationFailureLine({ ...input, args: { agent: "codex", value: ["private argument"] } })!, input.mode, input.id)!;
  expect(wrongArgs.agents[1]!.argsPresent).toBe(true); expect(wrongArgs.agents[1]!.argsMatch).toBe(false);
  expect(JSON.stringify(wrongArgs).includes("private argument")).toBe(false);
});

test("registration diagnostics produce no success noise and do not forward unknown result content", () => {
  const input = diagnosticInput();
  expect(registrationFailureLine({ ...input, exitMatches: true })).toBeUndefined();
  expect(registrationFailureLine({ ...input, exitMatches: true, args: { agent: "codex", value: ["--stdio"] } })).toBeUndefined();
  for (const logs of ["private malformed output", "null", JSON.stringify({ results: [{ agent: "unknown", success: false }] })]) {
    const record = readRegistrationFailure(registrationFailureLine({ ...input, logs })!, input.mode, input.id)!;
    expect(record).toEqual({ mode: input.mode, exitMatches: false, resultsAvailable: false, agents: [] });
  }
  const results = diagnosticResults(); results[1]!.success = false;
  results[1]!.error = "Could not safely update the Codex MCP configuration: configuration is locked; no foreign lock was removed extra private content";
  const record = readRegistrationFailure(registrationFailureLine({ ...input, logs: JSON.stringify({ results }) })!, input.mode, input.id)!;
  expect(record.agents[1]!.refusal).toBe("UNKNOWN");
  expect(JSON.stringify(record).includes("private")).toBe(false);
});

test("registration diagnostic reader refuses malformed records, unknown fields and capability-bearing values", () => {
  const input = diagnosticInput(), line = registrationFailureLine(input)!;
  const start = line.indexOf("{"), prefix = line.slice(0, start);
  const capability = new URL("http://127.0.0.1:9/callback"); capability.searchParams.set("code", randomUUID());
  const changes: Array<(data: any) => void> = [
    data => { data.extra = capability.href; }, data => { data.mode = capability.href; },
    data => { data.agents[0].path = capability.href; }, data => { data.agents[0].agent = capability.href; },
    data => { data.agents[0].refusal = capability.href; }, data => { data.agents[0].success = capability.href; },
    data => { data.exitMatches = "false"; }, data => { data.resultsAvailable = 1; },
    data => { data.agents[0].argsChecked = "false"; }, data => { data.agents[0].argsPresent = null; },
    data => { data.agents[0].argsMatch = []; }, data => { data.agents[0].refusal = "LOCKED"; },
    data => { data.agents[0].argsMatch = true; }, data => { data.agents[1].agent = "claude"; },
    data => { data.agents.push(data.agents[0]); }, data => { data.agents = {}; },
    data => { data.agents[0] = null; }, data => { data.exitMatches = true; },
  ];
  for (const change of changes) {
    const data = JSON.parse(line.slice(start)); change(data);
    expect(readRegistrationFailure(prefix + JSON.stringify(data), input.mode, input.id)).toBeUndefined();
  }
  for (const raw of ["{", "null", "[]", JSON.stringify({ private: capability.href }), line.slice(start).replace('"exitMatches":false', '"exitMatches":true,"exitMatches":false')]) {
    expect(readRegistrationFailure(prefix + raw, input.mode, input.id)).toBeUndefined();
  }
});

test("registration diagnostic reader refuses spoofed, duplicated, oversized or mismatched frames", () => {
  const input = diagnosticInput(), line = registrationFailureLine(input)!;
  for (const stderr of ["prefix " + line, line + "\n" + line, line.replace(input.id, randomUUID()),
    "\n" + line, line + "x".repeat(4096), line + "\n" + "x".repeat(64 * 1024)]) {
    expect(readRegistrationFailure(stderr, input.mode, input.id)).toBeUndefined();
  }
  expect(readRegistrationFailure(line, "claude-native-bootstrap-existing-remove", input.id)).toBeUndefined();
  expect(readRegistrationFailure(line, "unknown", input.id)).toBeUndefined();
  expect(readRegistrationFailure(line, input.mode, "invalid")).toBeUndefined();
  expect(registrationFailureLine({ ...input, mode: "unknown" })).toBeUndefined();
  expect(registrationFailureLine({ ...input, id: "invalid" })).toBeUndefined();
  expect(registrationFailureLine({ ...input, id: input.id + "\n" })).toBeUndefined();
});

test("registration success receipts are bounded and validated before entering assertion output", () => {
  const mode = "claude-native-bootstrap";
  const receipt = { mode, adapters: 7, refused: false, consumerSelectionVerified: true, stdioSelected: true,
    unrelatedEntriesPreserved: true, credentialsUnchanged: true, credentialsNotDisclosed: true, networkCalls: 0, mockedAuthRequests: 0 };
  expect(readRegistrationReceipt(JSON.stringify(receipt) + "\n", mode)).toEqual(receipt);
  for (const value of [null, { ...receipt, extra: "private content" }, { ...receipt, mode: "private content" },
    { ...receipt, credentialsUnchanged: "private content" }, { ...receipt, adapters: 8 }, { ...receipt, adapters: 1.5 },
    { ...receipt, networkCalls: "private content" }, { ...receipt, mockedAuthRequests: 2 }]) {
    expect(readRegistrationReceipt(JSON.stringify(value), mode)).toBeUndefined();
  }
  expect(readRegistrationReceipt("private malformed output", mode)).toBeUndefined();
  expect(readRegistrationReceipt(JSON.stringify(receipt) + " ".repeat(4096), mode)).toBeUndefined();
});

const guardedModes = ["atomic", "new", "race", "new-race", "cas-stat-race", "locked", "symlink", "parent-symlink", "home-ancestor-symlink", "hardlink",
  "invalid", "invalid-container", "backup-readback", "temp-write", "final-readback", "group-preserved", "group-refused",
  "acl-deny-directory", "acl-allow-directory", "acl-deny-file", "acl-allow-file", "acl-backup-inherit-allow", "acl-temp-inherit-allow", "acl-unknown", "acl-read-error",
  "linux-acl-absent", "linux-acl-file", "linux-acl-directory", "linux-acl-default", "linux-acl-ancestor-default", "linux-acl-create-parent-default", "linux-acl-error", "linux-acl-unsupported"];
for (const agent of ["codex", "gemini", "pi", "opencode", "cursor", "windsurf"]) for (const mode of guardedModes) {
  test.skipIf(mode.startsWith("linux-acl-") && process.platform !== "linux")(`direct MCP config writes preserve originals and refuse unsafe changes: ${agent}/${mode}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "skills-mcp-guarded-"));
    for (const name of ["home", "tmp"]) mkdirSync(join(root, name), { mode: 0o700 });
    let home = join(root, "home");
    if (mode === "home-ancestor-symlink") {
      mkdirSync(join(home, "nested"), { mode: 0o700 });
      const alias = join(root, "home-alias"); symlinkSync(home, alias); home = join(alias, "nested");
    }
    const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install",
      resolve(import.meta.dir, "runtime-mcp-guarded-writes.fixture.ts"), agent, mode], {
      cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { HOME: home, TMPDIR: join(root, "tmp"), PATH: "/nonexistent-fixture-bin",
        HASNA_HOME: join(home, ".hasna"), HASNA_CONFIG_HOME: join(home, "config"), HASNA_PROFILE: "guarded-fixture",
        HASNA_SKILLS_API_URL: "http://127.0.0.1:9", SKILLS_API_URL: "http://127.0.0.1:9",
        HASNA_STATION: "guarded-config-fixture", NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        GUARDED_CONFIG_FIXTURE_ROOT: root },
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 20_000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      const diagnostic = JSON.stringify({ exit: Number.isInteger(code) ? code : null,
        location: stderr.match(/runtime-mcp-guarded-writes\.fixture\.ts:[0-9]{1,7}:[0-9]{1,7}(?![0-9])/)?.[0] ?? "unavailable" });
      expect(timedOut, diagnostic).toBe(false); expect(stderr.length, diagnostic).toBe(0); expect(code, diagnostic).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ agent, mode, cases: 1, networkCalls: 0, syntheticOnly: true });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
      // Only this fresh sandbox's synthetic HOME, config, backups and output.
      rmSync(root, { recursive: true, force: true });
    }
  });
}
