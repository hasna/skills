import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { captureDiscoveryReview } from "./discovery-review-capture.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import type { AgentDiscoveryBinding, ReviewedDiscoveryInputs } from "./agent-discovery.js";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-discovery-review-capture-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const put = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { mode: 0o644 }); };

/** One user-scope Claude cache plugin, as station03/04 carry it. */
function fixture() {
  const home = mkdtempSync(join(scratch, "home-"));
  const dataDir = join(home, "skills-data"), projectDir = join(home, "project");
  mkdirSync(projectDir, { recursive: true });
  const claude = join(home, ".claude");
  const pluginRoot = join(claude, "plugins/cache/claude-plugins-official/swift-lsp/1.0.0");
  const settings = join(claude, "settings.json"), registry = join(claude, "plugins/installed_plugins.json"), manifest = join(pluginRoot, ".claude-plugin/plugin.json");
  put(settings, { enabledPlugins: { "swift-lsp@claude-plugins-official": true }, permissions: { allow: ["Read"] }, model: "sonnet" });
  put(registry, { version: 2, plugins: { "swift-lsp@claude-plugins-official": [{ scope: "user", installPath: pluginRoot, version: "1.0.0" }] } });
  put(manifest, { name: "swift-lsp", version: "1.0.0" });
  mkdirSync(join(pluginRoot, "skills"), { recursive: true });
  const options = { home, dataDir, projectDir, agents: ["claude" as const], command: "/fixture/skills" };
  const policy = (): Record<string, any> => JSON.parse(readFileSync(join(dataDir, "agent-policy.json"), "utf8"));
  const saved = (): AgentDiscoveryBinding => policy().bridge.discovery.claude;
  const plan = (discoveryInputs?: ReviewedDiscoveryInputs) => planAgentIntegration({ ...options, ...(discoveryInputs ? { discoveryInputs } : {}) });
  /** A first reviewed binding: capture the current state exactly as the CLI
   * command does, then install it. */
  const install = () => {
    const captured = captureDiscoveryReview({ home, agent: "claude" });
    applyAgentIntegration(plan(captured.review));
    return captured;
  };
  const capture = () => captureDiscoveryReview({ home, agent: "claude", previous: saved() });
  return { home, dataDir, projectDir, settings, registry, manifest, pluginRoot, options, policy, saved, plan, install, capture };
}

test("a stale saved review is regenerated as a full-hash review and applied after a settings change", () => {
  const f = fixture();
  f.install();
  const stale = f.saved();
  // A Skill deny rule is a discovery control, so removing it is real drift and
  // it survives the install write. Ordinary preferences would stay unbound.
  put(f.settings, { enabledPlugins: { "swift-lsp@claude-plugins-official": true }, permissions: { allow: ["Read"], deny: ["Skill(retired-skill)"] }, model: "sonnet" });
  expect(() => f.plan()).toThrow("NATIVE_SKILL_DRIFT");

  // The stored binding cannot be fed back verbatim: automatic projections are
  // not explicit-review witnesses. This is the exact operator failure.
  const copied = { version: 1 as const, agents: [{ agent: "claude" as const, pluginHooks: "reviewed-no-skill-injection" as const, roots: stale.roots, sources: stale.sources, ...(stale.directories ? { directories: stale.directories } : {}) }] };
  expect(() => f.plan(copied)).toThrow("Explicit discovery reviews require full source-file hashes");
  expect(() => f.plan(copied)).toThrow(`skills hook discovery-review --agent claude --output <new-review-file>`);
  expect(() => f.plan(copied)).toThrow(f.settings);

  const captured = f.capture();
  expect(captured.previousMethod).toBe("reviewed");
  expect(captured.changes).toEqual([expect.objectContaining({ path: f.settings, kind: "changed" })]);
  expect(captured.review.agents[0]!.sources.some(source => source.format !== undefined || source.fields !== undefined)).toBe(false);
  expect(captured.review.agents[0]!.sources.some(source => source.path === f.settings && source.sha256 !== null)).toBe(true);

  const applied = f.plan(captured.review);
  expect(applied.changes.some(change => change.path === join(f.dataDir, "agent-policy.json"))).toBe(true);
  applyAgentIntegration(applied);
  // The policy now verifies against the post-write settings, and a plain
  // install reuses it without another explicit review.
  expect(f.plan().changes).toEqual([]);
  expect(() => assertManagedAgentBridge("claude", { home: f.home, dataDir: f.dataDir, projectDir: f.projectDir })).not.toThrow();
});

test("a stale explicit review is still refused when the configuration changes again", () => {
  const f = fixture();
  f.install();
  put(f.settings, { enabledPlugins: { "swift-lsp@claude-plugins-official": true }, permissions: { allow: ["Read"], deny: ["Skill(first)"] }, model: "sonnet" });
  const captured = f.capture();
  // Change again between capture and apply: the captured bytes are now stale.
  put(f.settings, { enabledPlugins: { "swift-lsp@claude-plugins-official": true }, permissions: { allow: ["Read"], deny: ["Skill(second)"] }, model: "sonnet" });
  expect(() => f.plan(captured.review)).toThrow("Native discovery input changed");
});

test("a bound plugin manifest change is regenerated and applied without accepting a forged witness", () => {
  const f = fixture();
  f.install();
  // Descriptive fields do not change the manifest witness; `skills` does.
  put(f.manifest, { name: "swift-lsp", version: "1.0.1", skills: "./skills" });
  expect(() => f.plan()).toThrow("NATIVE_SKILL_DRIFT");
  const captured = f.capture();
  expect(captured.changes).toEqual([expect.objectContaining({ path: f.manifest, kind: "changed" })]);
  applyAgentIntegration(f.plan(captured.review));
  expect(f.plan().changes).toEqual([]);
  // A review that keeps the old manifest digest is stale, never accepted.
  const forged = JSON.parse(JSON.stringify(captured.review)) as ReviewedDiscoveryInputs;
  const source = forged.agents[0]!.sources.find(item => item.path === f.manifest)!;
  source.sha256 = "0".repeat(64);
  expect(() => f.plan(forged)).toThrow("Native discovery input changed");
});

test("capture refuses a state that still needs a dedicated plugin-hook review", () => {
  const f = fixture();
  f.install();
  put(join(f.pluginRoot, "hooks/hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "/bin/true" }] }] } }));
  // The capture must not manufacture the no-skill-injection attestation for a
  // plugin whose hooks were never reviewed.
  expect(() => captureDiscoveryReview({ home: f.home, agent: "claude" })).toThrow("plugin hooks require a separate no-skill-injection review");
});
