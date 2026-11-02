import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { resolveAgentDiscovery, verifyAgentDiscovery, type DiscoverySource } from "./agent-discovery.js";
import { captureCodexSettingsV3, captureCodexSettingsV7 } from "./codex-settings-witness.js";
import { portPortableSkill, scaffoldPortableSkill } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";

// SH-00042. A Codex config.toml with an `[mcp_servers.*]` table made portable
// authoring (`skills prepare`, `skills port`) refuse with "unknown discovery
// controls have no root-exclusion adapter for \"mcp_servers\"", although the
// explicit review that `skills hook install --discovery-inputs` retained binds
// the same file. The runner confines HOME and TMPDIR to a credential-free
// sandbox; fixtures are retained there as evidence.
function put(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const name = "codex-mcp-fixture";
const reviewedText = 'model = "gpt-5"\n\n[mcp_servers.fixture]\ncommand = "/usr/bin/true"\nargs = ["serve"]\n';

function codexFixture(witness: (config: string) => DiscoverySource) {
  const home = mkdtempSync(join(tmpdir(), "authoring-codex-mcp-"));
  // The skill exists before the Codex configuration does, so each test
  // reaches the authoring guard of the command it exercises.
  const rootDir = join(home, "corpus");
  scaffoldPortableSkill(name, { rootDir, homeDir: home, kind: "instruction" });
  const config = join(home, ".codex/config.toml");
  put(config, reviewedText);
  // The same explicit review hook install retains: the full configuration
  // under one settings witness, confirmed free of skill injection.
  const binding = resolveAgentDiscovery({ home, agent: "codex", executable: null, reviewed: { version: 1, agents: [{
    agent: "codex", roots: [], pluginHooks: "reviewed-no-skill-injection", sources: [witness(config)],
  }] } });
  expect(binding.method).toBe("reviewed");
  expect(() => verifyAgentDiscovery(binding)).not.toThrow();
  const policy = join(home, ".hasna/skills/agent-policy.json");
  put(policy, JSON.stringify({ loading: "cli", bridge: { home, discovery: { codex: binding } } }));
  return { home, config, binding, policy, rootDir, homeDir: home };
}
function bytes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (path: string, prefix: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(path, entry.name), `${prefix}${entry.name}/`);
      else result[prefix + entry.name] = sha(readFileSync(join(path, entry.name), "utf8"));
    }
  };
  visit(root, ""); return result;
}
const refusal = 'unknown discovery controls have no root-exclusion adapter for "mcp_servers"';

test("prepare and port honour the retained review of a Codex config with MCP servers", () => {
  for (const witness of [captureCodexSettingsV7, (path: string): DiscoverySource => ({ path, hashMode: "bytes", sha256: sha(readFileSync(path, "utf8")) })]) {
    const f = codexFixture(witness);
    const before = bytes(f.home);
    const dry = prepareSkill(name, { rootDir: f.rootDir, homeDir: f.homeDir, version: "0.1.1", dryRun: true });
    expect(dry.written).toBe(false);
    expect(bytes(f.home)).toEqual(before);
    portPortableSkill(join(f.rootDir, name), { rootDir: join(f.home, "ported"), homeDir: f.homeDir });
    expect(existsSync(join(f.home, "ported", name, "SKILL.md"))).toBe(true);
    expect(readFileSync(f.policy, "utf8")).toBe(JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { codex: f.binding } } }));
    // Native roots stay excluded under the honoured review.
    expect(() => assertPortableAuthoringPath(join(f.home, ".codex/skills", name), f)).toThrow("native discovery root");
  }
});

test("a Codex config that differs from its retained review still refuses prepare and port", () => {
  for (const change of [
    reviewedText.replace("/usr/bin/true", "/usr/bin/false"),
    `${reviewedText}\n[mcp_servers.added]\ncommand = "/usr/bin/true"\n`,
    'model = "gpt-5"\nmodel_instructions_file = "/elsewhere"\n\n[mcp_servers.fixture]\ncommand = "/usr/bin/true"\nargs = ["serve"]\n',
  ]) {
    const f = codexFixture(captureCodexSettingsV7);
    put(f.config, change);
    const before = bytes(f.home);
    expect(() => prepareSkill(name, { rootDir: f.rootDir, homeDir: f.homeDir, version: "0.1.1", dryRun: true })).toThrow("unknown discovery controls have no root-exclusion adapter");
    expect(() => portPortableSkill(join(f.rootDir, name), { rootDir: join(f.home, "ported"), homeDir: f.homeDir })).toThrow("unknown discovery controls have no root-exclusion adapter");
    expect(bytes(f.home)).toEqual(before);
    expect(existsSync(join(f.home, "ported"))).toBe(false);
  }
});

test("a review whose witness omits local MCP servers cannot cover them", () => {
  // codex-settings-v3 omits ordinary local stdio MCP rows, so its match says
  // nothing about the server table: a redirected server would still match.
  const f = codexFixture(captureCodexSettingsV3);
  expect(() => prepareSkill(name, { rootDir: f.rootDir, homeDir: f.homeDir, version: "0.1.1", dryRun: true })).toThrow(refusal);
  put(f.config, reviewedText.replace("/usr/bin/true", "/usr/bin/false"));
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
  expect(() => prepareSkill(name, { rootDir: f.rootDir, homeDir: f.homeDir, version: "0.1.1", dryRun: true })).toThrow(refusal);
});

test("a stale retained source still refuses even when the configuration matches", () => {
  const f = codexFixture(captureCodexSettingsV7);
  const helper = join(f.home, "reviewed-helper.txt"); put(helper, "reviewed");
  f.binding.sources.push({ path: helper, hashMode: "bytes", sha256: sha("reviewed") });
  put(f.policy, JSON.stringify({ loading: "cli", bridge: { home: f.home, discovery: { codex: f.binding } } }));
  expect(() => prepareSkill(name, { rootDir: f.rootDir, homeDir: f.homeDir, version: "0.1.1", dryRun: true })).not.toThrow();
  put(helper, "changed");
  expect(() => prepareSkill(name, { rootDir: f.rootDir, homeDir: f.homeDir, version: "0.1.1", dryRun: true })).toThrow("Native discovery input changed");
});
