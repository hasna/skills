import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { resolveAgentDiscovery } from "./agent-discovery.js";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";

// HC-01329: `skills prepare` refused on every station because Codex
// config.toml carries [mcp_servers.*] (and on station01 a scalar [agents]
// setting and skills.native_allowed_paths; on station07 and station14 a
// marketplace last_updated time). The fixtures below copy the measured shapes
// (names and fields, synthetic values). The runner confines TMPDIR and HOME to
// a credential-free sandbox; fixtures are left for evidence.
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function fixture(codex: string) {
  const home = mkdtempSync(join(tmpdir(), "authoring-codex-root-free-"));
  const config = join(home, ".claude/settings.json");
  put(config, "{}");
  const binding = resolveAgentDiscovery({ home, agent: "claude" });
  binding.method = "reviewed";
  binding.sources[0] = { path: config, sha256: createHash("sha256").update("{}").digest("hex") };
  put(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home, discovery: { claude: binding } } }));
  put(join(home, ".codex/config.toml"), codex.replaceAll("<HOME>", home));
  return { home, homeDir: home, rootDir: join(home, ".hasna/skills/authoring") };
}
const name = "root-free-fixture";
const allowed = (f: ReturnType<typeof fixture>): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  scaffoldPortableSkill(name, { ...f, kind: "instruction" });
  const dry = prepareSkill(name, { ...f, version: "0.1.1", dryRun: true });
  expect(dry.written).toBe(false);
  // The default native roots stay excluded whatever the MCP rows name.
  for (const root of [".codex/skills", ".agents/skills", ".codex/plugins/cache"]) {
    expect(() => assertPortableAuthoringPath(join(f.home, root, name), f)).toThrow("native discovery root");
  }
};
const refused = (f: ReturnType<typeof fixture>, message: string): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).toThrow(message);
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow(message);
  expect(existsSync(join(f.rootDir, name))).toBe(false);
};

// The fleet's rows: /usr/bin/env -i launchers with cwd = HOME, a plain
// command, a relative command, env_vars and per-tool approval tables.
const fleetServers = `
[mcp_servers.trash]
command = "/usr/bin/env"
args = ["-i", "HOME=<HOME>", "PATH=/usr/bin:/bin", "<HOME>/.bun/bin/bun", "--no-install", "--cwd=<HOME>/.hasna/trash/runtime", "<HOME>/.hasna/trash/runtime/node_modules/trash/bin/mcp.js", "--stdio"]
cwd = "<HOME>"
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 120
env = { }

[mcp_servers.hasna-codex]
command = "/usr/bin/env"
args = ["-i", "HOME=<HOME>", "<HOME>/.hasna-internal/codex-bridge/runtime/bin/codex-hasna.mjs", "--stdio"]
cwd = "<HOME>"
enabled = true

[mcp_servers.hasna-codex.tools.activate_hook]
approval_mode = "approve"

[mcp_servers.skills]
command = "<HOME>/.local/bin/skills-mcp"
args = ["--stdio"]

[mcp_servers.computer-use]
command = "./Codex Computer Use.app/Contents/MacOS/computer-use"
args = ["mcp"]
cwd = "."
enabled = false

[mcp_servers.node_repl]
command = "/Applications/Codex.app/Contents/Resources/node_repl"
args = []
env_vars = ["LANG", { name = "TERM", source = "local" }]
startup_timeout_sec = 15
`;

test("local stdio MCP servers add no root: prepare, scaffold and the default-root refusals all hold", () => {
  allowed(fixture(fleetServers));
});

test("an MCP server's cwd and args are not discovery roots, so authoring under them is not refused for that reason", () => {
  const f = fixture(fleetServers);
  // cwd = HOME on the measured stations; deriving roots from it would refuse
  // every corpus in the account. A path named only in args is not a root either.
  expect(() => assertPortableAuthoringPath(join(f.home, "authoring-elsewhere", name), f)).not.toThrow();
  expect(() => assertPortableAuthoringPath(join(f.home, ".hasna/trash/runtime/drafts", name), f)).not.toThrow();
});

test("MCP rows outside the local stdio contract keep the control unresolved", () => {
  for (const row of [
    '[mcp_servers.remote]\nurl = "https://mcp.invalid/mcp"\n',
    '[mcp_servers.remote]\nurl = "https://mcp.invalid/mcp"\nbearer_token_env_var = "TOKEN"\n',
    '[mcp_servers.codex_apps]\ncommand = "codex-apps"\n',
    '[mcp_servers._codex_apps]\ncommand = "codex-apps"\n',
    '[mcp_servers.unknown]\ncommand = "server"\nskills_root = "/somewhere"\n',
    '[mcp_servers.blank]\ncommand = " "\n',
    'mcp_servers = "not a table"\n',
    'mcp_servers = { broken = "row" }\n',
    // One unsupported row refuses the whole control, even beside fleet rows.
    `${fleetServers}\n[mcp_servers.remote]\nurl = "https://mcp.invalid/mcp"\n`,
  ]) refused(fixture(row), 'unknown discovery controls have no root-exclusion adapter for "mcp_servers"');
  // The row count stays bounded like the other enumerated controls.
  const many = Array.from({ length: 513 }, (_, index) => `[mcp_servers.s${index}]\ncommand = "server"\n`).join("");
  refused(fixture(many), 'unknown discovery controls have no root-exclusion adapter for "mcp_servers"');
  allowed(fixture(Array.from({ length: 512 }, (_, index) => `[mcp_servers.s${index}]\ncommand = "server"\n`).join("")));
});

test("scalar [agents] settings add no root; agent roles and other values still refuse", () => {
  allowed(fixture("[agents]\nmax_concurrent_threads_per_session = 4\nmax_depth = 2\nenabled = true\n"));
  allowed(fixture("[agents]\n"));
  for (const text of [
    '[agents.reviewer]\nconfig_file = "/elsewhere/reviewer.toml"\n',
    '[agents.reviewer]\ndescription = "Reviews"\n',
    '[agents]\nmax_threads = 4\n[agents.reviewer]\nconfig_file = "/elsewhere/reviewer.toml"\n',
    '[agents]\ndefault_config_file = "/elsewhere/agents.toml"\n',
    "[agents]\nlimits = [1, 2]\n",
    'agents = "all"\n',
  ]) refused(fixture(text), 'unknown discovery controls have no root-exclusion adapter for "agents"');
});

test("skills.native_allowed_paths is excluded like a skill root and must be absolute paths", () => {
  const f = fixture('[skills]\nnative_allowed_paths = ["<HOME>/allowed/skills-cli/SKILL.md", "<HOME>/allowed-root"]\n');
  allowed(f);
  expect(() => assertPortableAuthoringPath(join(f.home, "allowed/skills-cli", name), f)).toThrow("configured native discovery root");
  expect(() => assertPortableAuthoringPath(join(f.home, "allowed-root", name), f)).toThrow("configured native discovery root");
  expect(() => assertPortableAuthoringPath(join(f.home, "allowed", name), f)).not.toThrow();
  refused(fixture('[skills]\nnative_allowed_paths = ["relative/SKILL.md"]\n'), "relative Codex native allowed skill path");
  refused(fixture('[skills]\nnative_allowed_paths = "<HOME>/allowed"\n'), "malformed or unbounded Codex native allowed skill paths");
  refused(fixture('[skills]\nnative_allowed_paths = ["$HOME/allowed"]\n'), "malformed or unbounded Codex native allowed skill paths");
  refused(fixture('[skills]\nother_paths = ["<HOME>/allowed"]\n'), "unsupported Codex skills controls");
});

test("a marketplace refresh time is accepted; other marketplace fields still refuse", () => {
  allowed(fixture('[marketplaces.openai-bundled]\nsource_type = "local"\nsource = "<HOME>/.codex/.tmp/bundled-marketplaces/openai-bundled"\nlast_updated = "2026-11-04T10:00:00Z"\n'));
  for (const [text, message] of [
    ['[marketplaces.m]\nsource_type = "local"\nsource = "<HOME>/m"\nlast_updated = "<HOME>/m"\n', "malformed Codex marketplace refresh time"],
    ['[marketplaces.m]\nsource_type = "local"\nsource = "<HOME>/m"\nlast_updated = 1\n', "malformed Codex marketplace refresh time"],
    ['[marketplaces.m]\nsource_type = "local"\nsource = "<HOME>/m"\nlast_updated = "2026-11-04"\n', "malformed Codex marketplace refresh time"],
    ['[marketplaces.m]\nsource_type = "local"\nsource = "<HOME>/m"\nskills = "<HOME>/m"\n', "unsupported Codex marketplace registration controls"],
  ] as const) refused(fixture(text), message);
});

test("instruction sources, profiles and feature flags still have no adapter", () => {
  for (const text of [
    'model_instructions_file = "/unknown"\n',
    `${fleetServers}\nmodel_instructions_file = "/unknown"\n`,
    '[profiles.test.skills]\npaths = ["/unknown"]\n',
    '[features]\nnew_skill_discovery = true\n',
  ]) refused(fixture(text), "unknown discovery controls have no root-exclusion adapter");
});

test("Codex hooks keep their review requirement beside local MCP servers", () => {
  refused(fixture(`${fleetServers}\n[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "mcp_tool"\nserver = "hasna-codex"\ntool = "activate_hook"\n`), "non-enumerable hooks require a current settings review");
});

test("station01's measured control set prepares", () => {
  allowed(fixture(`model = "synthetic"\n[agents]\nmax_concurrent_threads_per_session = 8\n${fleetServers}\n[skills]\nnative_allowed_paths = ["<HOME>/.codex/skills/skills-cli/SKILL.md"]\nconfig = [{ name = "fixture", enabled = false }, { path = "<HOME>/disabled/SKILL.md", enabled = false }]\n[skills.bundled]\nenabled = false\n[hooks.state.one]\nenabled = false\n`));
});
