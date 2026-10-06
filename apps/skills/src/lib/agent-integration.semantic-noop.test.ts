import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyAgentIntegration, planAgentIntegration } from "./agent-integration.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "codex-semantic-noop-")); fixtures.push(home);
  const dataDir = join(home, ".hasna/skills"), configPath = join(home, ".codex/config.toml");
  const skill = join(home, ".codex/skills/sample/SKILL.md");
  const bridge = join(home, ".codex/skills/skills-cli/SKILL.md");
  mkdirSync(dirname(skill), { recursive: true, mode: 0o700 });
  writeFileSync(skill, "---\nname: sample\ndescription: Synthetic skill\n---\nFixture\n", { mode: 0o600 });
  const original = `# Native writer formatting must survive\n[skills]\nnative_allowed_paths = [${JSON.stringify(bridge)}]\nconfig = [{ path = ${JSON.stringify(skill)}, enabled = false }]\n[skills.bundled]\nenabled = false\n[hooks.state.one]\nenabled = false\n[hooks.state.two]\nenabled = false\n[hooks.state.three]\nenabled = false\n[hooks.state.four]\nenabled = false\n[hooks.state.five]\nenabled = false\n`;
  writeFileSync(configPath, original, { mode: 0o600 });
  const options = { home, dataDir, agents: ["codex"] as const, projectDir: home, profileId: "fleet" };
  // Materialize the synthetic installed bridge and hook files, never the
  // proposed config or policy. There is deliberately no corpus admission.
  const initial = planAgentIntegration({ ...options, agents: ["codex"] });
  for (const change of initial.changes.filter(change => change.path !== configPath && change.path !== join(dataDir, "agent-policy.json"))) {
    mkdirSync(dirname(change.path), { recursive: true, mode: 0o700 });
    writeFileSync(change.path, change.after, { mode: 0o600 });
  }
  return { home, dataDir, configPath, original, options: { ...options, agents: ["codex"] as Array<"codex"> } };
}

test("equivalent native TOML permits policy installation without rewriting or corpus admission", () => {
  const f = fixture(), plan = planAgentIntegration(f.options);
  expect(plan.changes.map(change => change.path)).toEqual([join(f.dataDir, "agent-policy.json")]);
  expect(plan.observedSettings).toEqual({ path: f.configPath, before: f.original });
  expect(applyAgentIntegration(plan).changed).toEqual([join(f.dataDir, "agent-policy.json")]);
  expect(readFileSync(f.configPath, "utf8")).toBe(f.original);
});

test("a semantic no-op still refuses concurrent byte changes before any policy write", () => {
  const f = fixture(), plan = planAgentIntegration(f.options);
  writeFileSync(f.configPath, `${f.original}\n# concurrent formatting\n`);
  expect(() => applyAgentIntegration(plan)).toThrow("Native settings changed");
  expect(readFileSync(f.configPath, "utf8")).toBe(`${f.original}\n# concurrent formatting\n`);
});

test("a real disabled-rule addition still requires corpus admission", () => {
  const f = fixture(), extra = join(f.home, ".codex/skills/new-skill/SKILL.md");
  mkdirSync(dirname(extra), { recursive: true, mode: 0o700 });
  writeFileSync(extra, "---\nname: new-skill\ndescription: Synthetic new skill\n---\nFixture\n", { mode: 0o600 });
  const plan = planAgentIntegration(f.options), change = plan.changes.find(change => change.path === f.configPath)!;
  expect(change).toBeDefined();
  expect((Bun.TOML.parse(change.after) as any).skills.config).toContainEqual({ path: extra, enabled: false });
  expect(() => applyAgentIntegration(plan)).toThrow("CODEX_CORPUS_ADMISSION_REQUIRED");
  expect(readFileSync(f.configPath, "utf8")).toBe(f.original);
});
