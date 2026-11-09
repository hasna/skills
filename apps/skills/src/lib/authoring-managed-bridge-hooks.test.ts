import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { resolveAgentDiscovery } from "./agent-discovery.js";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";

// HC-01329: Skills-managed bridge hooks and empty instruction lists. With the
// Codex fixes, station06, 07 and 08 stopped at
// "gemini: non-enumerable hooks require a current settings review". Their
// ~/.gemini/settings.json hooks are exactly the three Skills bridge entries
// `skills hook install --agent gemini` writes (measured 04.11, read-only).
// Commands below are literal strings, not rendered by the code under test.
// The runner confines TMPDIR and HOME to a credential-free sandbox; fixtures
// are left for evidence.
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
const bin = (home: string): string => join(home, ".local/bin/skills");
const managed = (home: string, event: string, profile = "fleet"): string => `'${bin(home)}' hook user-prompt --agent gemini --selection-profile ${profile} --event ${event}`;
const entry = (command: string, extra: Record<string, unknown> = {}) => ({ hooks: [{ type: "command", command, timeout: 15000, ...extra }] });
const bridgeHooks = (home: string): Record<string, unknown> => ({
  BeforeAgent: [entry(managed(home, "BeforeAgent"))],
  SessionStart: [entry(managed(home, "SessionStart"))],
  BeforeTool: [{ matcher: "activate_skill", ...entry(managed(home, "BeforeTool")) }],
});

function station(hooks: (home: string) => unknown, bridge: (home: string) => Record<string, unknown> = home => ({ commands: { gemini: bin(home) }, profiles: { gemini: "fleet" } })) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "authoring-gemini-managed-")));
  const claudeConfig = join(home, ".claude/settings.json"); put(claudeConfig, "{}");
  const claude = resolveAgentDiscovery({ home, agent: "claude" });
  claude.method = "reviewed"; claude.sources[0] = { path: claudeConfig, sha256: sha("{}") };
  put(bin(home), "#!/bin/sh\n");
  put(join(home, ".gemini/settings.json"), JSON.stringify({ hooks: hooks(home), skills: { enabled: true, disabled: ["skill-creator"] } }));
  // The binding hook install recorded: automatic, as on the three stations.
  const gemini = resolveAgentDiscovery({ home, agent: "gemini", executable: null });
  put(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home, ...bridge(home), discovery: { claude, gemini } } }));
  return { home, homeDir: home, rootDir: join(home, ".hasna/skills/authoring") };
}
const name = "gemini-managed-fixture";
const allowed = (f: ReturnType<typeof station>): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  scaffoldPortableSkill(name, { ...f, kind: "instruction" });
  expect(prepareSkill(name, { ...f, version: "0.1.1", dryRun: true }).written).toBe(false);
  expect(() => assertPortableAuthoringPath(join(f.home, ".gemini/skills", name), f)).toThrow("native discovery root");
};
const opaque = "gemini: non-enumerable hooks require a current settings review";
const refused = (f: ReturnType<typeof station>): void => {
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).toThrow(opaque);
  expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow(opaque);
  expect(existsSync(join(f.rootDir, name))).toBe(false);
};

test("the Skills bridge hooks hook install writes for Gemini add no opaque hook", () => {
  allowed(station(bridgeHooks));
});

test("a subset of the managed entries is still only the bridge", () => {
  allowed(station(home => ({ BeforeAgent: [entry(managed(home, "BeforeAgent"))] })));
});

test("empty event lists register no handler and add no opaque hook", () => {
  allowed(station(() => ({ BeforeAgent: [], SessionStart: [], BeforeTool: [] })));
  allowed(station(home => ({ BeforeAgent: [], SessionStart: [entry(managed(home, "SessionStart"))] })));
  // An unknown event name stays refused even when its list is empty: the shape
  // is not one this adapter can enumerate.
  refused(station(() => ({ AfterAgent: [] })));
});

test("anything beside or instead of the managed entries keeps refusing", () => {
  const variants: Array<(home: string) => unknown> = [
    // an extra command in a managed entry, or an extra entry for an event
    home => ({ ...bridgeHooks(home), BeforeAgent: [{ hooks: [...entry(managed(home, "BeforeAgent")).hooks, { type: "command", command: "/usr/bin/true", timeout: 15000 }] }] }),
    home => ({ ...bridgeHooks(home), SessionStart: [entry(managed(home, "SessionStart")), entry("/usr/bin/true")] }),
    // a different binary, a different profile, appended text
    home => ({ ...bridgeHooks(home), BeforeAgent: [entry(managed(home, "BeforeAgent").replace(bin(home), join(home, "other/skills")))] }),
    home => ({ ...bridgeHooks(home), BeforeAgent: [entry(managed(home, "BeforeAgent", "default"))] }),
    home => ({ ...bridgeHooks(home), BeforeAgent: [entry(`${managed(home, "BeforeAgent")}; /usr/bin/true`)] }),
    // the managed command under another event name, or for an unknown event
    home => ({ ...bridgeHooks(home), SessionStart: [entry(managed(home, "BeforeAgent"))] }),
    home => ({ ...bridgeHooks(home), AfterAgent: [entry(managed(home, "AfterAgent"))] }),
    // matcher, timeout, extra fields
    home => ({ ...bridgeHooks(home), BeforeTool: [entry(managed(home, "BeforeTool"))] }),
    home => ({ ...bridgeHooks(home), BeforeTool: [{ matcher: "*", ...entry(managed(home, "BeforeTool")) }] }),
    home => ({ ...bridgeHooks(home), BeforeAgent: [{ matcher: "activate_skill", ...entry(managed(home, "BeforeAgent")) }] }),
    home => ({ ...bridgeHooks(home), BeforeAgent: [entry(managed(home, "BeforeAgent"), { timeout: 1 })] }),
    home => ({ ...bridgeHooks(home), BeforeAgent: [entry(managed(home, "BeforeAgent"), { name: "x" })] }),
    home => ({ ...bridgeHooks(home), BeforeAgent: [{ hooks: [{ type: "command", command: managed(home, "BeforeAgent") }] }] }),
    // non-enumerable forms
    home => ({ ...bridgeHooks(home), BeforeAgent: entry(managed(home, "BeforeAgent")) }),
    home => ({ ...bridgeHooks(home), BeforeAgent: [{ hooks: [{ type: "mcp", command: managed(home, "BeforeAgent"), timeout: 15000 }] }] }),
  ];
  for (const hooks of variants) refused(station(hooks));
});

test("the managed command comes from the policy's own binding", () => {
  refused(station(bridgeHooks, () => ({})));
  refused(station(bridgeHooks, home => ({ commands: { gemini: bin(home) } })));
  refused(station(bridgeHooks, home => ({ commands: { claude: bin(home) }, profiles: { gemini: "fleet" } })));
  // A relative recorded command, even when the settings repeat it exactly.
  refused(station(() => ({ BeforeAgent: [entry("'skills' hook user-prompt --agent gemini --selection-profile fleet --event BeforeAgent")] }), () => ({ commands: { gemini: "skills" }, profiles: { gemini: "fleet" } })));
});

// Cursor: station06, 07 and 08 hold exactly the two bridge entries hook install
// writes in ~/.cursor/hooks.json (measured 04.11, read-only).
const cursorManaged = (home: string, event: string, profile = "fleet"): string => `'${bin(home)}' hook user-prompt --agent cursor --selection-profile ${profile} --event ${event}`;
function cursorStation(hooks: (home: string) => unknown, bridge: (home: string) => Record<string, unknown> = home => ({ commands: { cursor: bin(home) }, profiles: { cursor: "fleet" } })) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "authoring-cursor-managed-")));
  const claudeConfig = join(home, ".claude/settings.json"); put(claudeConfig, "{}");
  const claude = resolveAgentDiscovery({ home, agent: "claude" });
  claude.method = "reviewed"; claude.sources[0] = { path: claudeConfig, sha256: sha("{}") };
  put(bin(home), "#!/bin/sh\n");
  put(join(home, ".cursor/hooks.json"), JSON.stringify({ version: 1, hooks: hooks(home) }));
  const cursor = resolveAgentDiscovery({ home, agent: "cursor", executable: null });
  put(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home, ...bridge(home), discovery: { claude, cursor } } }));
  return { home, homeDir: home, rootDir: join(home, ".hasna/skills/authoring") };
}
const cursorBridge = (home: string) => ({
  beforeSubmitPrompt: [{ command: cursorManaged(home, "beforeSubmitPrompt"), timeout: 15 }],
  sessionStart: [{ command: cursorManaged(home, "sessionStart"), timeout: 15 }],
});
const cursorOpaque = "cursor: non-enumerable hooks require a current settings review";

test("the Skills bridge hooks hook install writes for Cursor add no opaque hook", () => {
  const f = cursorStation(cursorBridge);
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
  scaffoldPortableSkill(name, { ...f, kind: "instruction" });
  expect(prepareSkill(name, { ...f, version: "0.1.1", dryRun: true }).written).toBe(false);
});

test("empty Cursor event lists register no handler and add no opaque hook", () => {
  const f = cursorStation(() => ({ beforeSubmitPrompt: [], sessionStart: [] }));
  expect(() => assertPortableAuthoringPath(join(f.rootDir, name), f)).not.toThrow();
});

test("anything beside or instead of the Cursor bridge entries keeps refusing", () => {
  const variants: Array<(home: string) => unknown> = [
    home => ({ ...cursorBridge(home), beforeSubmitPrompt: [...cursorBridge(home).beforeSubmitPrompt, { command: "/usr/bin/true", timeout: 15 }] }),
    home => ({ ...cursorBridge(home), beforeSubmitPrompt: [{ command: cursorManaged(home, "beforeSubmitPrompt").replace(bin(home), join(home, "other/skills")), timeout: 15 }] }),
    home => ({ ...cursorBridge(home), beforeSubmitPrompt: [{ command: cursorManaged(home, "beforeSubmitPrompt", "default"), timeout: 15 }] }),
    home => ({ ...cursorBridge(home), sessionStart: [{ command: `${cursorManaged(home, "sessionStart")}; /usr/bin/true`, timeout: 15 }] }),
    home => ({ ...cursorBridge(home), sessionStart: [{ command: cursorManaged(home, "beforeSubmitPrompt"), timeout: 15 }] }),
    home => ({ ...cursorBridge(home), stop: [{ command: cursorManaged(home, "stop"), timeout: 15 }] }),
    home => ({ ...cursorBridge(home), sessionStart: [{ command: cursorManaged(home, "sessionStart"), timeout: 30 }] }),
    home => ({ ...cursorBridge(home), sessionStart: [{ command: cursorManaged(home, "sessionStart"), timeout: 15, matcher: "*" }] }),
    home => ({ ...cursorBridge(home), sessionStart: { command: cursorManaged(home, "sessionStart"), timeout: 15 } }),
    // The Gemini shape is not the Cursor shape.
    home => ({ beforeSubmitPrompt: [{ hooks: [{ type: "command", command: cursorManaged(home, "beforeSubmitPrompt"), timeout: 15 }] }] }),
  ];
  for (const hooks of variants) {
    const f = cursorStation(hooks);
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow(cursorOpaque);
    expect(existsSync(join(f.rootDir, name))).toBe(false);
  }
  const unbound = cursorStation(cursorBridge, home => ({ commands: { gemini: bin(home) }, profiles: { gemini: "fleet" } }));
  expect(() => scaffoldPortableSkill(name, { ...unbound, kind: "instruction" })).toThrow(cursorOpaque);
});

// OpenCode: station06 and 07 carry `"instructions": []` in opencode.json.
test("an empty OpenCode instructions list adds no root; any instruction file still refuses", () => {
  const opencode = (instructions: unknown) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "authoring-opencode-instructions-")));
    const claudeConfig = join(home, ".claude/settings.json"); put(claudeConfig, "{}");
    const claude = resolveAgentDiscovery({ home, agent: "claude" });
    claude.method = "reviewed"; claude.sources[0] = { path: claudeConfig, sha256: sha("{}") };
    put(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home, discovery: { claude } } }));
    put(join(home, ".config/opencode/opencode.json"), JSON.stringify({ instructions, permission: {} }));
    return { home, homeDir: home, rootDir: join(home, ".hasna/skills/authoring") };
  };
  const empty = opencode([]);
  expect(() => assertPortableAuthoringPath(join(empty.rootDir, name), empty)).not.toThrow();
  for (const instructions of [["/elsewhere/AGENTS.md"], ["docs/*.md"], "AGENTS.md", {}]) {
    const f = opencode(instructions);
    expect(() => scaffoldPortableSkill(name, { ...f, kind: "instruction" })).toThrow('unknown discovery controls have no root-exclusion adapter for "instructions"');
    expect(existsSync(join(f.rootDir, name))).toBe(false);
  }
});
