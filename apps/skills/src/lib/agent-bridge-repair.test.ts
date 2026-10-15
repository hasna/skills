import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyAgentIntegration, planAgentIntegration } from "./agent-integration.js";
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
      home, dataDir, policyPath, pluginPath,
      restore: () => { process.env.PATH = savedPath; },
      plan: () => planAgentIntegration({ home, dataDir, agents: ["sumi"], command: "/fixture/skills" }),
    };
  } catch (error) { process.env.PATH = savedPath; throw error; }
}

test("a saved reviewed binding is reused while its bridge still verifies", () => {
  const f = sumiFixture();
  try {
    expect(existsSync(f.pluginPath)).toBe(true);
    const pending = f.plan();
    // The retained path is really taken: this is what makes the repair refusal below the defect.
    expect(pending.retainedReviewChecks?.agents).toEqual(["sumi"]);
  } finally { f.restore(); }
});

test("a repair command never names itself: a broken bridge refusal says how to reach a fresh review", () => {
  const f = sumiFixture();
  try {
    rmSync(f.pluginPath);
    const policyBefore = read(f.policyPath);
    let message = "";
    try { f.plan(); } catch (error) { message = (error as Error).message; }
    // Before this fix the refusal was the bare "run skills hook install" — the exact command
    // that had just refused, with no way forward.
    expect(message).toContain("Sumi bridge protection changed");
    expect(message).toContain("skills hook install --agent sumi --discovery-inputs <review> --apply");
    expect(message).toContain("cannot reuse or repair it here");
    // The refusal is a read-only plan refusal: the preserved policy is untouched.
    expect(read(f.policyPath)).toBe(policyBefore);
    expect(existsSync(f.pluginPath)).toBe(false);
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
    const configPath = sumiConfigPath(f.home);
    policy.bridge.discovery.sumi.sources = policy.bridge.discovery.sumi.sources.filter((source: { path: string; format?: string }) => !(source.path === configPath && source.format === undefined));
    put(f.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    expect(() => f.plan()).toThrow("retained review is missing the full agent configuration source");
  } finally { f.restore(); }
});
