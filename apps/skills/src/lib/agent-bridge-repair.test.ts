import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "./agent-integration.js";
import { captureDiscoveryByteSources } from "./agent-discovery.js";
import { sumiConfigPath } from "./agent-sumi.js";
import { installSumiPathsFixture } from "./sumi-paths.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
const read = (path: string) => readFileSync(path, "utf8");
function put(path: string, text: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }

/**
 * One managed Sumi bridge whose discovery carries a saved reviewed binding, so
 * `hook install` without `--discovery-inputs` takes the retained-review path.
 * The Sumi path resolver is a synthetic executable: this exercises the real
 * resolver contract, not a stubbed directory.
 */
function sumiFixture() {
  const home = mkdtempSync(join(realpathSync(tmpdir()), "skills-bridge-repair-"));
  homes.push(home);
  const dataDir = join(home, ".hasna/skills"), policyPath = join(dataDir, "agent-policy.json");
  const bin = installSumiPathsFixture(home), savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath ?? ""}`;
  try {
    applyAgentIntegration(planAgentIntegration({ home, dataDir, agents: ["sumi"], command: "/fixture/skills" }));
    const configPath = sumiConfigPath(home);
    const policy = JSON.parse(read(policyPath));
    // The saved review of a real install covers every current source; reuse the automatic
    // binding's own coverage plus the whole-file configuration witness a reviewed
    // binding must also carry, so the retained-review path is the one under test.
    const automatic = policy.bridge.discovery.sumi;
    policy.bridge.discovery.sumi = {
      agent: "sumi", method: "reviewed", roots: automatic.roots,
      sources: [...automatic.sources, ...captureDiscoveryByteSources([configPath])],
      ...(automatic.directories === undefined ? {} : { directories: automatic.directories }),
      pluginHooks: "reviewed-no-skill-injection",
    };
    put(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const pluginPath = join(dirname(configPath), "plugins", "skills-cli.js");
    return {
      home, dataDir, policyPath, pluginPath, configPath,
      restore: () => { process.env.PATH = savedPath; },
      plan: () => planAgentIntegration({ home, dataDir, agents: ["sumi"], command: "/fixture/skills" }),
    };
  } catch (error) { process.env.PATH = savedPath; throw error; }
}

test("a saved reviewed binding is reused while its custody holds", () => {
  const f = sumiFixture();
  try {
    expect(existsSync(f.pluginPath)).toBe(true);
    const pending = f.plan();
    // The retained path is really taken: this is what makes the repair path below the defect.
    expect(pending.retainedReviewChecks?.agents).toEqual(["sumi"]);
  } finally { f.restore(); }
});

test("protection drift is repairable: the plan proceeds, repairs the bridge, and apply proves it", () => {
  const f = sumiFixture();
  try {
    rmSync(f.pluginPath);
    // Before this fix this exact state refused with "run skills hook install" — the command
    // that had just refused. Custody still holds, so the plan is allowed to repair protection.
    const pending = f.plan();
    expect(pending.retainedReviewChecks?.agents).toEqual(["sumi"]);
    expect(pending.changes.map(change => change.path)).toContain(f.pluginPath);
    applyAgentIntegration(pending);
    expect(existsSync(f.pluginPath)).toBe(true);
    // The post-write proof: the full bridge check passes again on the repaired state.
    expect(() => assertManagedAgentBridge("sumi", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).not.toThrow();
  } finally { f.restore(); }
});

test("an unrepaired plan is refused after the writes, and the policy is compensated", () => {
  const f = sumiFixture();
  try {
    // Plan while the bridge is intact, so the plan carries no repair for the plugin.
    const pending = f.plan();
    expect(pending.retainedReviewChecks?.agents).toEqual(["sumi"]);
    expect(pending.changes.map(change => change.path)).not.toContain(f.pluginPath);
    const policyBefore = read(f.policyPath);
    // Then the plugin disappears before apply. Custody still holds, but nothing repairs it,
    // so the post-write full check must refuse and compensate.
    rmSync(f.pluginPath);
    // Direct probe: the same call the apply-time proof makes, with the plan's own options.
    expect(() => assertManagedAgentBridge("sumi", { home: f.home, dataDir: f.dataDir, projectDir: f.home })).toThrow("Sumi bridge protection changed");
    expect(() => applyAgentIntegration(pending)).toThrow("Sumi bridge protection changed");
    expect(read(f.policyPath)).toBe(policyBefore);
    expect(existsSync(f.pluginPath)).toBe(false);
  } finally { f.restore(); }
});

test("a custody failure still refuses: a review that is not this host's is never reused", () => {
  const f = sumiFixture();
  try {
    const policy = JSON.parse(read(f.policyPath));
    policy.bridge.home = "/somewhere/else";
    put(f.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    expect(() => f.plan()).toThrow("bridge binding is missing or incompatible");
  } finally { f.restore(); }
});

test("a drifted review is never silently reused as an automatic one", () => {
  const f = sumiFixture();
  try {
    put(f.configPath, `${JSON.stringify({ ...JSON.parse(read(f.configPath)), "reviewed-change": true }, null, 2)}\n`);
    let message = "";
    try { f.plan(); } catch (error) { message = (error as Error).message; }
    expect(message).not.toBe("");
    expect(message).toMatch(/discovery/i);
    // Never a downgrade: the refusal names the fresh explicit review, and no plan was produced.
    expect(message).toContain("--discovery-inputs");
  } finally { f.restore(); }
});

/**
 * The decisive contract behind a whole-file configuration witness: a reviewed
 * binding must pin the full configuration bytes, so unchanged projected fields
 * never excuse a change outside them. A witness refresh is therefore not a
 * supported substitute for a fresh explicit review.
 */
test("a reviewed binding must carry the whole-file configuration witness, projected fields alone are refused", () => {
  const f = sumiFixture();
  try {
    const policy = JSON.parse(read(f.policyPath));
    policy.bridge.discovery.sumi.sources = policy.bridge.discovery.sumi.sources.filter((source: { path: string; format?: string }) => !(source.path === f.configPath && source.format === undefined));
    put(f.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    expect(() => f.plan()).toThrow("retained review is missing the full agent configuration source");
  } finally { f.restore(); }
});
