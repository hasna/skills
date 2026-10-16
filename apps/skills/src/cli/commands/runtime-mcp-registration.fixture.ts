import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { Command } from "commander";
import { selectCliSkillsCredentialProfile } from "../../lib/cli-credential-profile.js";
import { skillsMcpRegistrationEnvironment } from "../../lib/mcp-registration-environment.js";
import { resolveSkillsFleet } from "../../lib/fleet-credentials.js";
import { handleMcp } from "./runtime-mcp.js";
import { assertTestStartupIsolation } from "../../test-isolation.fixture.js";

// Invoked only in a freshly created synthetic HOME. Never start an agent or dial a server.
const root = resolve(process.env.REGISTRATION_FIXTURE_ROOT!);
assert(basename(root).startsWith("skills-mcp-registration-"));
assert.equal(homedir(), join(root, "home"));
assert.equal(process.env.TMPDIR, join(root, "tmp"));
assertTestStartupIsolation();
const mode = process.argv[2];
const origin = "http://127.0.0.1:9/customer", fleetOrigin = "http://127.0.0.1:9/internal";
const fleetKey = randomUUID(), customerKey = randomUUID(), unrelatedKey = randomUUID();
let requests = 0, nativeCalls = 0;
globalThis.fetch = (async () => { requests++; throw new Error("Fixture network is disabled"); }) as typeof fetch;
Bun.spawnSync = (() => { throw new Error("Fixture native process refused"); }) as typeof Bun.spawnSync;
const deny = () => { throw new Error("Fixture native process refused"); };
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
  (childProcess as unknown as Record<string, unknown>)[name] = deny;
syncBuiltinESMExports();
const write = (path: string, bytes: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { mode: 0o600 }); };
const defaultMode = mode === "default";
if (!defaultMode) {
  process.env.HASNA_HOME = join(root, "app-home");
  process.env.HASNA_CONFIG_HOME = join(root, "config");
}
if (mode === "profile") for (const name of ["HASNA_SKILLS_API_KEY_OVERRIDE", "HASNA_SKILLS_API_KEY_REF", "HASNA_SKILLS_API_KEY", "SKILLS_API_KEY", "SESSION_TOKEN"])
  process.env[name] = unrelatedKey;
const credentials = join(defaultMode ? join(homedir(), ".hasna", "skills", "config") : join(root, "config", "skills"), "credentials");
write(credentials, `HASNA_SKILLS_API_KEY=${fleetKey}\nHASNA_SKILLS_API_URL=${fleetOrigin}\n`);
write(credentials + "-customer", `HASNA_SKILLS_API_KEY=${customerKey}\nHASNA_SKILLS_API_URL=${mode === "gateway" ? "https://api.hasna.com/skills" : origin}\n`);
const credentialBefore = readFileSync(credentials);
const customerBefore = readFileSync(credentials + "-customer");
const files: Record<string, string> = {
  claude: join(homedir(), ".claude", ".mcp.json"), codex: join(homedir(), ".codex", "config.toml"),
  gemini: join(homedir(), ".gemini", "settings.json"), pi: join(homedir(), ".pi", "agent", "mcp.json"),
  opencode: join(homedir(), ".config", "opencode", "opencode.json"), cursor: join(homedir(), ".cursor", "mcp.json"),
  windsurf: join(homedir(), ".windsurf", "mcp.json"),
};
const unrelated = { command: "/owned/other", args: ["keep"], env: { PRIVATE_FIXTURE: unrelatedKey } };
const codexBefore = `model = "fixture-model"\n[mcp_servers.other]\ncommand = "/owned/other"\n[mcp_servers.other.env]\nKEEP = "yes"\n[mcp_servers.skills]\ncommand = "/old/skills"\n[mcp_servers.skills.env]\nHASNA_PROFILE = "old-profile"\nHASNA_SKILLS_API_URL = "http://127.0.0.1:9/old"\nSKILLS_API_URL = "http://127.0.0.1:9/conflict"\n[projects."/owned/project"]\ntrust_level = "trusted"\n`;
for (const [agent, path] of Object.entries(files)) {
  if (agent === "codex") write(path, mode === "invalid-toml" ? `broken = [${JSON.stringify(unrelatedKey)}\n` : codexBefore);
  else write(path, JSON.stringify(agent === "opencode"
    ? { theme: "system", mcp: { other: unrelated, skills: { type: "local", command: ["/old"], environment: { HASNA_PROFILE: "old-profile" } } } }
    : { retained: true, mcpServers: { other: unrelated, skills: { command: "/old", env: { HASNA_PROFILE: "old-profile" } } } }));
}
const originals = new Map(Object.values(files).map(path => [path, readFileSync(path)]));
const nativeArguments: string[][] = [];
Bun.spawn = ((command: string[]) => {
  assert.equal(command[0], "claude"); nativeCalls++; nativeArguments.push(command);
  if (mode === "claude-native") {
    const env: Record<string, string> = {};
    for (let i = 0; i < command.length; i++) if (command[i] === "--env") {
      const item = command[++i]!, split = item.indexOf("="); env[item.slice(0, split)] = item.slice(split + 1);
    }
    const separator = command.indexOf("--"); assert(separator > 0);
    const data = JSON.parse(readFileSync(files.claude!, "utf8"));
    data.mcpServers.skills = { command: command[separator + 1], args: command.slice(separator + 2), env };
    write(files.claude!, JSON.stringify(data));
  }
  return { stdout: new Blob(["fixture child output"]).stream(), stderr: new Blob([unrelatedKey]).stream(),
    exited: Promise.resolve(mode === "claude-native" ? 0 : 1) };
}) as unknown as typeof Bun.spawn;

const logs: string[] = [], output = console.log, errors = console.error;
console.log = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
console.error = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
if (!defaultMode) {
  process.env.HASNA_PROFILE = mode === "environment-profile" ? "customer" : "ambient-profile";
  selectCliSkillsCredentialProfile(mode === "environment-profile" ? undefined : "customer");
}
const transient = ["transient", "gateway"].includes(mode!);
if (transient) process.env.HASNA_SKILLS_API_URL = origin + "/api/v1";
if (mode === "bad-url") {
  const unsafe = new URL("https://example.invalid/"); unsafe.searchParams.set("token", unrelatedKey);
  process.env.HASNA_SKILLS_API_URL = unsafe.href;
}
if (mode === "aliases") { process.env.HASNA_SKILLS_API_URL = origin; process.env.SKILLS_API_URL = fleetOrigin; }
if (mode === "setup") {
  const { registerRuntime } = await import("./runtime.js");
  const program = new Command(); registerRuntime(program);
  await program.parseAsync(["setup", "--api-url", origin + "/api/v1", "agents", "--json"], { from: "user" });
} else if (mode === "auth") {
  const { mock } = await import("bun:test");
  const readline = await import("readline");
  mock.module("readline", () => ({ ...readline, createInterface: () => ({ once() { return this; }, close() {},
    question(_question: string, callback: (answer: string) => void) { queueMicrotask(() => callback("yes")); } }) }));
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  // A fresh login may create only this new synthetic profile.
  selectCliSkillsCredentialProfile("signed-in");
  delete process.env.HASNA_PROFILE;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requests++; const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "http://127.0.0.1:9"); assert.equal(url.pathname, "/customer/api/auth/verify");
    return Response.json({ apiKey: customerKey, user: { id: randomUUID(), email: "fixture@example.invalid" } });
  }) as typeof fetch;
  const { registerAccountCommands } = await import("./auth.js");
  const program = new Command(); registerAccountCommands(program);
  await program.parseAsync(["login", "--url", origin, "--email", "fixture@example.invalid", "--code", "123456"], { from: "user" });
} else await handleMcp({ register: "all", json: true });

const refused = mode === "bad-url" || mode === "aliases";
if (refused) {
  assert.equal(process.exitCode, 1); assert.equal(nativeCalls, 0);
  for (const [path, bytes] of originals) assert.equal(readFileSync(path).equals(bytes), true);
} else {
  assert.equal(process.exitCode ?? 0, mode === "invalid-toml" ? 1 : 0);
  assert.equal(nativeCalls, 1);
  const expectedProfile = defaultMode ? undefined : mode === "auth" ? "signed-in" : "customer";
  const expectedOrigin = defaultMode ? fleetOrigin : origin;
  // Fresh consumer selection has no in-process CLI profile singleton.
  selectCliSkillsCredentialProfile(undefined);
  const { assertSkillsMcpConfigured } = await import("../../mcp/index.js");
  const { isMcpStdioMode } = await import("../../mcp/http.js");
  for (const [agent, path] of Object.entries(files)) {
    if (agent === "codex" && mode === "invalid-toml") { assert.equal(readFileSync(path).equals(originals.get(path)!), true); continue; }
    let server: { command: string | string[]; args?: string[]; env?: Record<string, string>; environment?: Record<string, string> };
    if (agent === "codex") {
      const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as any;
      server = parsed.mcp_servers.skills;
      assert.deepEqual(parsed.mcp_servers.other, { command: "/owned/other", env: { KEEP: "yes" } });
      assert.equal(parsed.model, "fixture-model"); assert.deepEqual(parsed.projects, { "/owned/project": { trust_level: "trusted" } });
      assert.equal(readFileSync(path, "utf8").includes("[mcp_servers.skills.env]"), false);
    } else {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      const container = agent === "opencode" ? parsed.mcp : parsed.mcpServers;
      server = container.skills; assert.equal(JSON.stringify(container.other) === JSON.stringify(unrelated), true);
      assert.equal(agent === "opencode" ? parsed.theme : parsed.retained, agent === "opencode" ? "system" : true);
    }
    const args = Array.isArray(server.command) ? server.command.slice(1) : server.args;
    assert.deepEqual(args, ["--stdio"]); assert.equal(isMcpStdioMode(args!), true); assert.equal(isMcpStdioMode([]), false);
    const selectors = server.environment ?? server.env ?? {};
    for (const secret of [fleetKey, customerKey, unrelatedKey]) assert.equal(JSON.stringify(server).includes(secret), false);
    assert.equal(selectors.HASNA_PROFILE, expectedProfile);
    assert(Object.keys(selectors).every(key => ["HASNA_PROFILE", "HASNA_HOME", "HASNA_CONFIG_HOME", "HASNA_SKILLS_API_URL", "SKILLS_API_URL"].includes(key)));
    if (defaultMode) assert.deepEqual(selectors, {});
    if (["transient", "setup", "auth", "gateway"].includes(mode!)) {
      assert.equal(selectors.HASNA_SKILLS_API_URL, origin); assert.equal(selectors.SKILLS_API_URL, origin);
    }
    const fresh = { HOME: homedir(), PATH: "/nonexistent-fixture-bin", HASNA_STATION: "mcp-registration-fixture", ...selectors };
    if (mode === "gateway") assert.throws(() => resolveSkillsFleet(fresh), (error: any) => error.code === "INSTANCE_CREDENTIAL_MISMATCH");
    else {
      assertSkillsMcpConfigured(fresh);
      const selected = resolveSkillsFleet(fresh); assert.equal(selected.mode, "hosted");
      assert.equal(selected.apiOrigin, expectedOrigin); assert.equal(selected.apiKey === (defaultMode ? fleetKey : customerKey), true);
      assert.throws(() => resolveSkillsFleet({ ...fresh, HASNA_PROFILE: "missing-profile" }));
    }
  }
  assert(nativeArguments[0]!.includes("--stdio"));
  assert.equal(nativeArguments[0]!.includes("HASNA_PROFILE=old-profile"), false);
}
assert.equal(readFileSync(credentials).equals(credentialBefore), true);
assert.equal(readFileSync(credentials + "-customer").equals(customerBefore), true);
assert.equal(requests, mode === "auth" ? 1 : 0);
const rendered = logs.join("\n");
for (const secret of [fleetKey, customerKey, unrelatedKey]) assert.equal(rendered.includes(secret), false);
assert.deepEqual(skillsMcpRegistrationEnvironment({}), {});
console.log = output; console.error = errors; process.exitCode = 0;
console.log(JSON.stringify({ mode, adapters: refused ? 0 : mode === "invalid-toml" ? 6 : 7, refused, consumerSelectionVerified: !refused,
  stdioSelected: !refused, unrelatedEntriesPreserved: true, credentialsUnchanged: true, credentialsNotDisclosed: true,
  networkCalls: 0, mockedAuthRequests: requests }));
