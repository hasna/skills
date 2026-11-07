import { expect, test } from "bun:test";
import { Command } from "commander";
import { hostname } from "node:os";
import pkg from "../../package.json" with { type: "json" };
import { registerAgentIntegration } from "../cli/commands/agent-integration.js";
import {
  MIGRATION_ACTOR_SCHEMA, MIGRATION_COMMANDS, MIGRATION_SDK_CALLERS, buildMigrationActor, currentProcessProbe, observeInvocation,
  type MigrationProcessProbe,
} from "./migration-actor.js";

// Unit tests for the actor block that the three migration writers add to their
// records. The receipt-level tests (migration-receipt-actor.test.ts, the reconcile
// test and cli.migration-actor.test.ts) prove each writer carries it.

const probe = (overrides: Partial<MigrationProcessProbe> = {}): MigrationProcessProbe => ({
  now: () => new Date("2026-11-07T12:00:00.000Z"), pid: 4242, ppid: 4141, uid: 1234, uptimeSeconds: 12.5, hostname: () => "station-fixture",
  execPath: "/opt/fixture/bun", argv: ["/opt/fixture/bun", "/opt/fixture/skills.js"], env: {}, cliVersion: "9.8.7", ...overrides,
});
const run = (...args: string[]) => ["/opt/fixture/bun", "/opt/fixture/skills.js", ...args];
const SECRET = "sentinel secret=4f2a9c71e0", PRIVATE_PATH = "/Users/sentinel/private/review-inputs.json";

test("the block names its schema and its two halves", () => {
  const actor = buildMigrationActor(undefined, probe());
  expect(actor.schema).toBe(MIGRATION_ACTOR_SCHEMA);
  expect(MIGRATION_ACTOR_SCHEMA).toBe("hasna.skills-migration-actor.v1");
  expect(Object.keys(actor).sort()).toEqual(["observed", "schema", "supplied"]);
});

const OBSERVED: Array<[string, unknown]> = [
  ["writtenAt", "2026-11-07T12:00:00.000Z"], ["cliVersion", "9.8.7"], ["pid", 4242], ["ppid", 4141], ["uid", 1234],
  ["processStartedAt", "2026-11-07T11:59:47.500Z"], ["hostname", "station-fixture"], ["execPath", "/opt/fixture/bun"],
];
for (const [field, expected] of OBSERVED) test(`observed.${field} is what the process measured`, () => {
  const observed = buildMigrationActor(undefined, probe()).observed as unknown as Record<string, unknown>;
  expect(observed[field]).toEqual(expected);
});

test("observed holds exactly the measured fields and nothing a caller or the environment can add", () => {
  const environment = { SKILLS_AGENT_ID: "agent-sentinel", HASNA_AGENT_ID: "agent-other", AGENT_ID: "agent-third", CLAUDE_CODE_SESSION_ID: "session-sentinel", HOSTNAME: "forged-host", USER: "forged-user" };
  const hostile = JSON.parse(JSON.stringify({ app: "hooks", command: "install", version: "1.2.3", writtenAt: "1999-01-01T00:00:00.000Z", cliVersion: "0.0.1", pid: 1, ppid: 1, uid: 0, hostname: "forged-host", execPath: "/forged", invocation: { command: "forged" }, observed: { pid: 1 }, authenticated: true }));
  const actor = buildMigrationActor(hostile, probe({ env: environment }));
  expect(Object.keys(actor.observed).sort()).toEqual(["cliVersion", "execPath", "hostname", "pid", "ppid", "processStartedAt", "uid", "writtenAt"]);
  expect(actor.observed).toEqual(buildMigrationActor(undefined, probe()).observed);
  const observedText = JSON.stringify(actor.observed);
  for (const forged of ["agent-sentinel", "session-sentinel", "forged", "hooks", "1999"]) expect(observedText).not.toContain(forged);
  expect(actor.supplied.authenticated).toBe(false);
});

test("a value the process cannot measure is left out, not guessed", () => {
  const unavailable = buildMigrationActor(undefined, probe({ uid: undefined, hostname: () => { throw new Error("no hostname"); } }));
  expect("uid" in unavailable.observed).toBe(false);
  expect("hostname" in unavailable.observed).toBe(false);
  expect(unavailable.observed.pid).toBe(4242);
});

test("observed strings are bounded", () => {
  const long = buildMigrationActor(undefined, probe({ hostname: () => "h".repeat(400), execPath: "/" + "e".repeat(2000) }));
  expect(long.observed.hostname!.length).toBe(255);
  expect(long.observed.execPath.length).toBe(1024);
});

test("the live probe reads this process", () => {
  const live = currentProcessProbe();
  expect([live.pid, live.ppid, live.uid, live.execPath, live.cliVersion, live.hostname()]).toEqual([process.pid, process.ppid, process.getuid!(), process.execPath, pkg.version, hostname()]);
  const before = Date.now(), actor = buildMigrationActor(), after = Date.now();
  expect(actor.observed.cliVersion).toBe(pkg.version);
  expect(Date.parse(actor.observed.writtenAt)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(actor.observed.writtenAt)).toBeLessThanOrEqual(after);
  expect(Math.abs(Date.parse(actor.observed.processStartedAt) - (Date.now() - process.uptime() * 1000))).toBeLessThan(2000);
  expect(Date.parse(actor.observed.processStartedAt)).toBeLessThan(Date.parse(actor.observed.writtenAt));
});

// ---- caller-supplied labels -------------------------------------------------
test("supplied.agent is the first set of the three agent variables and names its source", () => {
  expect(buildMigrationActor(undefined, probe({ env: { SKILLS_AGENT_ID: "agent-a", HASNA_AGENT_ID: "agent-b", AGENT_ID: "agent-c" } })).supplied.agent).toEqual({ id: "agent-a", source: "SKILLS_AGENT_ID" });
  expect(buildMigrationActor(undefined, probe({ env: { HASNA_AGENT_ID: "agent-b", AGENT_ID: "agent-c" } })).supplied.agent).toEqual({ id: "agent-b", source: "HASNA_AGENT_ID" });
  expect(buildMigrationActor(undefined, probe({ env: { AGENT_ID: "agent-fixture-0a1b2c3d4e5f" } })).supplied.agent).toEqual({ id: "agent-fixture-0a1b2c3d4e5f", source: "AGENT_ID" });
  expect(buildMigrationActor(undefined, probe({ env: { AGENT_ID: "oid_Ab12cd" } })).supplied.agent).toEqual({ id: "oid_Ab12cd", source: "AGENT_ID" });
  expect(buildMigrationActor(undefined, probe()).supplied.agent).toBeUndefined();
});

test("supplied.parentSession is the documented Claude Code session variable", () => {
  const session = "0f1e2d3c-4b5a-4968-8776-655443322110";
  expect(buildMigrationActor(undefined, probe({ env: { CLAUDE_CODE_SESSION_ID: session } })).supplied.parentSession).toEqual({ id: session, source: "CLAUDE_CODE_SESSION_ID" });
  expect(buildMigrationActor(undefined, probe({ env: { CODEX_THREAD_ID: session, SESSION_ID: session } })).supplied.parentSession).toBeUndefined();
});

test("an environment label that is not a short identifier is dropped by name only", () => {
  for (const value of ["", "has space", "line\nbreak", "key=value", "a;b", "x".repeat(129), "-leading-dash", "/a/path", `${SECRET} extra`]) {
    const actor = buildMigrationActor(undefined, probe({ env: { SKILLS_AGENT_ID: value, HASNA_AGENT_ID: "agent-valid", CLAUDE_CODE_SESSION_ID: value } }));
    expect(actor.supplied.agent).toBeUndefined();
    expect(actor.supplied.parentSession).toBeUndefined();
    expect(actor.supplied.rejected).toEqual(["agent", "parentSession"]);
    for (const part of value.split(/\s+/).filter(candidate => candidate.length >= 8)) expect(JSON.stringify(actor)).not.toContain(part);
  }
});

test("supplied is always marked unauthenticated, even with nothing supplied", () => {
  expect(buildMigrationActor(undefined, probe()).supplied).toEqual({ authenticated: false });
});

const SDK_OK = { app: "hooks", command: "install", version: "0.4.2" };
test("an SDK caller on the allowlist is recorded under supplied.sdk", () => {
  expect(buildMigrationActor(SDK_OK, probe()).supplied).toEqual({ authenticated: false, sdk: SDK_OK });
  expect(buildMigrationActor({ app: "mementos", command: "session setup-hook" }, probe()).supplied.sdk).toEqual({ app: "mementos", command: "session setup-hook" });
  expect(buildMigrationActor({ app: "hooks", version: "1.2.3-rc.1" }, probe()).supplied.sdk).toEqual({ app: "hooks", version: "1.2.3-rc.1" });
  expect(Object.keys(MIGRATION_SDK_CALLERS).sort()).toEqual(["hooks", "mementos"]);
});

test("an SDK app, command or version outside its allowlist is dropped by name and never recorded", () => {
  const unknownApp = buildMigrationActor({ app: SECRET, command: "install", version: "1.2.3" }, probe());
  expect(unknownApp.supplied).toEqual({ authenticated: false, rejected: ["sdk.app", "sdk.command", "sdk.version"] });
  const unknownCommand = buildMigrationActor({ app: "hooks", command: `install ${SECRET}`, version: "1.2.3" }, probe());
  expect(unknownCommand.supplied).toEqual({ authenticated: false, sdk: { app: "hooks", version: "1.2.3" }, rejected: ["sdk.command"] });
  expect(buildMigrationActor({ app: "mementos", command: "install" }, probe()).supplied.sdk).toEqual({ app: "mementos" });
  for (const version of ["latest", "1.2", "1.2.3; rm", "v1.2.3", `1.2.3-${SECRET}x`, "1.2.3-" + "a".repeat(40)]) {
    const actor = buildMigrationActor({ app: "hooks", version }, probe());
    expect(actor.supplied).toEqual({ authenticated: false, sdk: { app: "hooks" }, rejected: ["sdk.version"] });
  }
  expect(JSON.stringify([unknownApp, unknownCommand])).not.toContain("sentinel");
});

test("a malformed SDK actor never throws and is reported by name", () => {
  for (const value of ["hooks", 7, null, ["hooks"]]) expect(buildMigrationActor(value as never, probe()).supplied).toEqual({ authenticated: false, rejected: ["sdk"] });
  expect(buildMigrationActor({ app: 7, command: {}, version: [] } as never, probe()).supplied.rejected).toEqual(["sdk.app", "sdk.command", "sdk.version"]);
  const throwing = { get app(): string { throw new Error("getter"); } };
  expect(buildMigrationActor(throwing as never, probe()).supplied).toEqual({ authenticated: false, rejected: ["sdk.app"] });
});

// ---- the observed invocation ------------------------------------------------
test("a listed command records its listed flag names and only enumerated values", () => {
  const invocation = observeInvocation(run("hook", "install", "--agent", "claude", "--command", PRIVATE_PATH, "--selection-profile", SECRET, "--discovery-inputs", PRIVATE_PATH, "--codex-skill-denials", PRIVATE_PATH, "--allow-root-aliases", "--apply", "--json"));
  expect(invocation).toEqual({ command: "hook install", flags: ["--agent", "--allow-root-aliases", "--apply", "--codex-skill-denials", "--command", "--discovery-inputs", "--json", "--selection-profile"], flagValues: { "--agent": "claude" } });
  const text = JSON.stringify(buildMigrationActor(undefined, probe({ argv: run("hook", "install", "--command", PRIVATE_PATH, "--selection-profile", SECRET, "--discovery-inputs", PRIVATE_PATH, "--apply") })));
  for (const leaked of [SECRET, "sentinel", PRIVATE_PATH, "sentinel", "review-inputs"]) expect(text).not.toContain(leaked);
});

test("every listed command is recognised from argv, in both flag spellings", () => {
  for (const command of Object.keys(MIGRATION_COMMANDS)) expect(observeInvocation(run(...command.split(" "), "--apply"))).toEqual({ command, flags: ["--apply"] });
  expect(observeInvocation(run("hook", "install", "--agent=codex", "--apply"))).toEqual({ command: "hook install", flags: ["--agent", "--apply"], flagValues: { "--agent": "codex" } });
  expect(observeInvocation(run("hook", "rebind-settings", "--agent", "sumi", "--codex-witness-version=8", "--claude-witness-version", "5"))?.flagValues)
    .toEqual({ "--agent": "sumi", "--claude-witness-version": "5", "--codex-witness-version": "8" });
  expect(observeInvocation(run("hook", "trust-native", "--platform", "darwin-arm64", "--digest", "a".repeat(64)))?.flagValues).toEqual({ "--platform": "darwin-arm64" });
  expect(observeInvocation(run("migrate", "native", "--agent", "codex", "--include-unmanaged", "--target-manifest", PRIVATE_PATH))).toEqual({ command: "migrate native", flags: ["--agent", "--include-unmanaged", "--target-manifest"], flagValues: { "--agent": "codex" } });
});

test("an enumerated flag with a value outside its list records the flag name and no value", () => {
  for (const value of [SECRET, "claude,codex", "CLAUDE", "", "claude "]) {
    const invocation = observeInvocation(run("hook", "install", "--agent", value, "--apply"));
    expect(invocation).toEqual({ command: "hook install", flags: ["--agent", "--apply"] });
    expect(JSON.stringify(invocation)).not.toContain(SECRET);
  }
  expect(observeInvocation(run("hook", "install", `--agent=${SECRET}`))).toEqual({ command: "hook install", flags: ["--agent"] });
  expect(observeInvocation(run("hook", "install", "--agent"))).toEqual({ command: "hook install", flags: ["--agent"] });
  expect(observeInvocation(run("hook", "rebind-settings", "--codex-witness-version", "9"))).toEqual({ command: "hook rebind-settings", flags: ["--codex-witness-version"] });
});

test("a flag that is not listed for the command is not recorded, whatever its value", () => {
  expect(observeInvocation(run("hook", "install", "--token", SECRET, "--made-up=sentinel-value-9", "--apply"))).toEqual({ command: "hook install", flags: ["--apply"] });
  expect(observeInvocation(run("hook", "install", "--target-manifest", PRIVATE_PATH, "--codex-command", "codex", "--apply"))).toEqual({ command: "hook install", flags: ["--apply"] });
  expect(observeInvocation(run("migrate", "native", "--codex-command", "codex", "--command", PRIVATE_PATH, "--selection-profile", SECRET, "--apply"))).toEqual({ command: "migrate native", flags: ["--apply"] });
  expect(observeInvocation(run("hook", "codex-reconcile", "-x", "-j", "--apply", "--api-key", SECRET))).toEqual({ command: "hook codex-reconcile", flags: ["--apply"] });
  const text = JSON.stringify(buildMigrationActor(undefined, probe({ argv: run("hook", "install", "--token", SECRET, "--made-up=sentinel-value-9", "--apply") })));
  for (const leaked of ["--token", "made-up", SECRET, "sentinel-value-9"]) expect(text).not.toContain(leaked);
});

test("names that collide with object prototype members are not flags", () => {
  const invocation = observeInvocation(run("hook", "install", "--__proto__", "x", "--constructor", "--hasOwnProperty=1", "--toString", "--apply"));
  expect(invocation).toEqual({ command: "hook install", flags: ["--apply"] });
  expect(observeInvocation(run("constructor", "--apply"))).toBeUndefined();
  expect(observeInvocation(run("__proto__", "toString", "--apply"))).toBeUndefined();
});

test("a command that is not listed leaves no invocation and no trace of its arguments", () => {
  const unlisted = [
    ["hook", "user-prompt", "--agent", "claude"], ["hook", "disable-claude-context", "--apply"], ["hook", "trust", "--agent", "codex", "--apply"], ["hook", "drift"], ["hook"],
    ["sync", "--apply"], ["login", "--token", SECRET], ["migrate"], ["migrate", "other", "--apply"], ["self-update", "--apply"], ["load", SECRET], [],
  ];
  for (const args of unlisted) {
    expect(observeInvocation(run(...args))).toBeUndefined();
    const actor = buildMigrationActor(undefined, probe({ argv: run(...args) }));
    expect("invocation" in actor.observed).toBe(false);
    expect(JSON.stringify(actor)).not.toContain(SECRET);
  }
  expect(observeInvocation(["/opt/fixture/bun"])).toBeUndefined();
  expect(observeInvocation([])).toBeUndefined();
});

test("a stray positional after a listed command is not recorded", () => {
  expect(observeInvocation(run("hook", "install", SECRET, "--apply", PRIVATE_PATH))).toEqual({ command: "hook install", flags: ["--apply"] });
  expect(observeInvocation(run("hook", "install", SECRET))).toEqual({ command: "hook install", flags: [] });
  expect(JSON.stringify(observeInvocation(run("hook", "install", SECRET, PRIVATE_PATH)))).not.toContain("sentinel");
});

test("a flag that takes a value consumes the next token even when it looks like a flag", () => {
  expect(observeInvocation(run("hook", "install", "--command", "--apply"))).toEqual({ command: "hook install", flags: ["--command"] });
  expect(observeInvocation(run("hook", "install", "--agent", "--apply"))).toEqual({ command: "hook install", flags: ["--agent"] });
  expect(observeInvocation(run("hook", "install", "--command=--apply"))).toEqual({ command: "hook install", flags: ["--command"] });
  expect(observeInvocation(run("hook", "install", "--apply", "claude"))).toEqual({ command: "hook install", flags: ["--apply"] });
});

test("flags are listed once, sorted, and stop at the end-of-options marker", () => {
  expect(observeInvocation(run("hook", "trust-native", "--json", "--digest", "a", "--digest", "b", "--apply", "--platform", "linux-x64", "--", "--expected-policy-sha256", "c")))
    .toEqual({ command: "hook trust-native", flags: ["--apply", "--digest", "--json", "--platform"], flagValues: { "--platform": "linux-x64" } });
});

// ---- the allowlist stays true to the real CLI -------------------------------
function walk(command: Command, prefix: string[] = []): Array<{ path: string; command: Command }> {
  return command.commands.flatMap(child => [{ path: [...prefix, child.name()].join(" "), command: child }, ...walk(child, [...prefix, child.name()])]);
}
// Commands with --apply that do not write one of the three migration records.
const NOT_A_MIGRATION_RECORD = ["hook disable-claude-context", "hook trust"];

test("every CLI command that applies is either a recorded migration command or explicitly not one", () => {
  const program = new Command(); registerAgentIntegration(program);
  const applying = walk(program).filter(entry => entry.command.options.some(option => option.long === "--apply")).map(entry => entry.path).sort();
  expect(applying.filter(path => !NOT_A_MIGRATION_RECORD.includes(path))).toEqual(Object.keys(MIGRATION_COMMANDS).sort());
  expect(NOT_A_MIGRATION_RECORD.every(path => applying.includes(path))).toBe(true);
});

test("the allowlist classifies every option of each listed command exactly as the CLI declares it", () => {
  const program = new Command(); registerAgentIntegration(program);
  const declared = new Map(walk(program).map(entry => [entry.path, entry.command]));
  for (const [path, rules] of Object.entries(MIGRATION_COMMANDS)) {
    const options = declared.get(path)!.options;
    expect([path, options.map(option => option.long).sort()]).toEqual([path, Object.keys(rules).sort()]);
    for (const option of options) {
      const takesValue = option.required || option.optional, rule = rules[option.long!]!;
      expect([path, option.long, takesValue ? "value" : "switch"]).toEqual([path, option.long, rule.kind === "switch" ? "switch" : "value"]);
    }
  }
});
