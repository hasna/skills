import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveAgentDiscovery, verifyAgentDiscovery, type DiscoverySource } from "./agent-discovery.js";
import { captureCodexSettingsV2, captureCodexSettingsV3, captureCodexSettingsV4, captureCodexSettingsV5, captureCodexSettingsV6, captureCodexSettingsV7 } from "./codex-settings-witness.js";
import { captureClaudeSettingsV5 } from "./claude-settings-witness.js";
import { openNarrowedWitnessLedger } from "./narrowed-witness-ledger.js";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";

function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const name = "codex-mcp-fixture";
const reviewedText = 'model = "gpt-5"\n\n[mcp_servers.fixture]\ncommand = "/usr/bin/true"\nargs = ["serve"]\n';
const redirected = reviewedText.replace("/usr/bin/true", "/tmp/attacker-server");
const UNKNOWN = "unknown discovery controls have no root-exclusion adapter";
const bytesWitness = (path: string): DiscoverySource => ({ path, hashMode: "bytes", sha256: sha(readFileSync(path, "utf8")) });

function fixture(witness: (config: string) => DiscoverySource, text = reviewedText) {
  const home = mkdtempSync(join(tmpdir(), "rv181-"));
  const rootDir = join(home, "corpus");
  scaffoldPortableSkill(name, { rootDir, homeDir: home, kind: "instruction" });
  const config = join(home, ".codex/config.toml");
  put(config, text);
  const binding = resolveAgentDiscovery({ home, agent: "codex", executable: null, reviewed: { version: 1, agents: [{
    agent: "codex", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [witness(config)],
  }] } });
  const dataDir = join(home, ".hasna/skills");
  const policy = join(dataDir, "agent-policy.json");
  put(policy, JSON.stringify({ loading: "cli", bridge: { home, discovery: { codex: binding } } }));
  const prepare = () => prepareSkill(name, { rootDir, homeDir: home, version: "0.1.1", dryRun: true });
  return { home, config, binding, policy, dataDir, rootDir, prepare };
}
// What the live hook does (agent-integration.ts liveHook): verify with a
// recording ledger; a still-matching legacy witness is observed and flushed.
function liveHookObserves(f: ReturnType<typeof fixture>): void {
  const ledger = openNarrowedWitnessLedger(f.dataDir);
  verifyAgentDiscovery(f.binding, undefined, undefined, undefined, ledger);
  ledger.flush();
}

// Positive control for the bypass harness: a V7 review of the unchanged file.
test("control: V7 review of the unchanged file is honoured", () => {
  expect(() => fixture(captureCodexSettingsV7).prepare()).not.toThrow();
});

for (const [label, capture] of [["v3", captureCodexSettingsV3], ["v4", captureCodexSettingsV4], ["v5", captureCodexSettingsV5]] as const) {
  test(`${label}: no ledger refuses`, () => {
    expect(() => fixture(capture).prepare()).toThrow(UNKNOWN);
  });
  test(`${label}: a server redirected after the review, then observed by the live hook, must still refuse`, () => {
    const f = fixture(capture);
    put(f.config, redirected);
    expect(() => verifyAgentDiscovery(f.binding)).not.toThrow(); // legacy witness blind to the redirect
    liveHookObserves(f);
    expect(readFileSync(join(f.dataDir, "native-witness-narrowed.json"), "utf8")).toContain(label === "v3" ? "codex-settings-v3" : `codex-settings-${label}`);
    expect(() => f.prepare()).toThrow(UNKNOWN);
  });
  test(`${label}: unchanged file observed by the live hook must still refuse (changelog: v3-v6 refuse while mcp_servers is present)`, () => {
    const f = fixture(capture);
    liveHookObserves(f);
    expect(() => f.prepare()).toThrow(UNKNOWN);
  });
}

test("v6-moded stored witness refuses while mcp_servers is present", () => {
  const f = fixture(captureCodexSettingsV7);
  const v6 = { ...f.binding, sources: f.binding.sources.map(s => ({ ...s, hashMode: "codex-settings-v6", hookSources: [] })) };
  put(f.policy, JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { codex: v6 } } }));
  expect(() => f.prepare()).toThrow();
});
test("v2 review of unchanged file is honoured; redirected server refuses", () => {
  const f = fixture(captureCodexSettingsV2);
  expect(() => f.prepare()).not.toThrow();
  put(f.config, redirected);
  expect(() => f.prepare()).toThrow(UNKNOWN);
});
test("bytes review + ledger: harmless change honoured via narrowed digest, MCP change refuses", () => {
  const f = fixture(bytesWitness);
  liveHookObserves(f);
  put(f.config, reviewedText.replace('model = "gpt-5"', 'model = "gpt-6"'));
  expect(() => f.prepare()).not.toThrow();
  put(f.config, redirected.replace('model = "gpt-5"', 'model = "gpt-6"'));
  expect(() => f.prepare()).toThrow(UNKNOWN);
});
test("added [agents.*] role refuses", () => {
  const f = fixture(captureCodexSettingsV7);
  put(f.config, `${reviewedText}\n[agents.evil]\nconfig_file = "/tmp/x.toml"\n`);
  expect(() => f.prepare()).toThrow(UNKNOWN);
});
test("added profile instruction source refuses", () => {
  const f = fixture(captureCodexSettingsV7);
  put(f.config, `${reviewedText}\n[profiles.p]\ndeveloper_instructions = "x"\n`);
  expect(() => f.prepare()).toThrow(UNKNOWN);
});
test("no stored review refuses", () => {
  const f = fixture(captureCodexSettingsV7);
  put(f.policy, JSON.stringify({ loading: "cli" }));
  expect(() => f.prepare()).toThrow(UNKNOWN);
});
test("method automatic refuses", () => {
  const f = fixture(captureCodexSettingsV7);
  put(f.policy, JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { codex: { ...f.binding, method: "automatic" } } } }));
  expect(() => f.prepare()).toThrow();
});
test("review of a different file refuses", () => {
  const f = fixture(captureCodexSettingsV7);
  const other = join(f.home, "other/.codex/config.toml"); put(other, reviewedText);
  put(f.policy, JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { codex: { ...f.binding, sources: [captureCodexSettingsV7(other)] } } } }));
  expect(() => f.prepare()).toThrow();
});
test("config symlinked to an unreviewed file refuses", () => {
  const f = fixture(captureCodexSettingsV7);
  const other = join(f.home, "elsewhere.toml"); put(other, redirected);
  renameSync(f.config, join(f.home, "orig.toml"));
  symlinkSync(other, f.config);
  expect(() => f.prepare()).toThrow();
});
test("Claude: unknown control under a current v5 review still refuses (unchanged)", () => {
  const home = mkdtempSync(join(tmpdir(), "rv181c-"));
  const rootDir = join(home, "corpus");
  scaffoldPortableSkill(name, { rootDir, homeDir: home, kind: "instruction" });
  const config = join(home, ".claude/settings.json");
  put(config, JSON.stringify({ skillOverrides: { a: "on" } }));
  const binding = resolveAgentDiscovery({ home, agent: "claude", executable: null, reviewed: { version: 1, agents: [{
    agent: "claude", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [captureClaudeSettingsV5(config)],
  }] } });
  put(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { home, discovery: { claude: binding } } }));
  expect(() => prepareSkill(name, { rootDir, homeDir: home, version: "0.1.1", dryRun: true })).toThrow(UNKNOWN);
});
