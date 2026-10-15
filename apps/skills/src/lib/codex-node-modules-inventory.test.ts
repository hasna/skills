import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { applyAgentIntegration, assertManagedAgentBridge, inventoryNativeSkills, planAgentIntegration } from "./agent-integration.js";

// Native Codex 0.162.1 (skills/list over app-server, offline synthetic HOME and
// CODEX_HOME) lists SKILL.md files below `node_modules` inside each skill root:
// `$CODEX_HOME/skills`, `~/.agents/skills`, a repository's `.codex/skills` and
// `.agents/skills`, and a cached plugin's `skills` directory, nested packages
// included, to six directory levels below the root. It skips only dot-named
// entries (so `node_modules/.pnpm` stays hidden) and does not load
// `node_modules` outside a skill root (`$CODEX_HOME/node_modules`, a
// repository's or plugin version's own `node_modules`).
useDefaultTestTimeout();
const homes: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  // Real path: macOS maps /tmp and /var to /private, and inventory compares real paths.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-codex-node-modules-"))); homes.push(home);
  admitCorpusFixture(join(home, ".codex"));
  return { home, dataDir: join(home, ".hasna/skills"), project: join(home, "project"), cache: join(home, ".codex/plugins/cache") };
}
function skill(directory: string): string {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), `---\nname: ${directory.split("/").pop()}\ndescription: Synthetic fixture\n---\nSynthetic native instructions\n`);
  return directory;
}
const paths = (entries: Array<{ path: string }>) => entries.map(entry => entry.path).sort();

test("Codex inventory enters node_modules inside every unconditional Codex skill root", () => {
  const f = fixture();
  const loaded = [
    skill(join(f.home, ".codex/skills/plain")),
    skill(join(f.home, ".codex/skills/node_modules/package")),
    skill(join(f.home, ".codex/skills/node_modules/@scope/scoped")),
    skill(join(f.home, ".codex/skills/node_modules/dependency/node_modules/nested")),
    skill(join(f.home, ".codex/skills/node_modules/dependency/nested/deep")),
    skill(join(f.home, ".agents/skills/node_modules/shared")),
    skill(join(f.project, ".agents/skills/node_modules/repository-shared")),
    skill(join(f.project, ".codex/skills/node_modules/repository-codex")),
  ];
  // Negative controls Codex does not load: node_modules outside a skill root and
  // dot-named directories, including the package manager store below node_modules.
  for (const directory of [
    join(f.home, ".codex/node_modules/codex-home"),
    join(f.home, "node_modules/home"),
    join(f.project, "node_modules/repository"),
    join(f.home, ".codex/skills/node_modules/.pnpm/store"),
    join(f.home, ".codex/skills/.hidden/dot"),
  ]) skill(directory);
  expect(paths(inventoryNativeSkills(f.home, { agents: ["codex"], projectDir: f.project }))).toEqual(loaded.sort());
  // Other agents keep their existing rule; only Codex's loading was measured.
  const claude = skill(join(f.home, ".claude/skills/node_modules/claude-package"));
  expect(paths(inventoryNativeSkills(f.home, { agents: ["claude"] }))).not.toContain(claude);
});

test("node_modules below a Codex skill root keeps the ordinary-root depth limit", () => {
  // Codex loads to six levels below the root; ordinary roots record a skill four
  // levels down and refuse anything deeper, so no loaded depth is ever silent.
  const shallow = fixture(), recorded = skill(join(shallow.home, ".codex/skills/node_modules/a/b/c"));
  expect(paths(inventoryNativeSkills(shallow.home, { agents: ["codex"] }))).toEqual([recorded]);
  for (const levels of [["a", "b", "c", "d"], ["a", "b", "c", "d", "e"]]) {
    const deep = fixture(); skill(join(deep.home, ".codex/skills/node_modules", ...levels));
    expect(() => inventoryNativeSkills(deep.home, { agents: ["codex"] })).toThrow("discovery limit exceeded");
  }
});

test("the Codex prompt guard refuses a native skill copy below ~/.codex/skills/node_modules", () => {
  const f = fixture();
  applyAgentIntegration(planAgentIntegration({ home: f.home, dataDir: f.dataDir, agents: ["codex"], command: "/opt/skills", profileId: "fleet" }));
  const options = { home: f.home, dataDir: f.dataDir, projectDir: f.home };
  expect(() => assertManagedAgentBridge("codex", options)).not.toThrow();
  const copy = skill(join(f.home, ".codex/skills/node_modules/x"));
  expect(() => assertManagedAgentBridge("codex", options)).toThrow(`NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found: ${JSON.stringify(copy)}`);
  expect(() => assertManagedAgentBridge("codex", { ...options, codexPromptHook: true })).toThrow("NATIVE_SKILL_DRIFT: 1 unexpected native skill copies were found");
});

test("Codex plugin-cache inventory enters node_modules only inside a plugin skill root", () => {
  const f = fixture(), version = join(f.cache, "market/plug/1.0.0");
  mkdirSync(join(version, ".codex-plugin"), { recursive: true });
  writeFileSync(join(version, ".codex-plugin/plugin.json"), JSON.stringify({ name: "plug", version: "1.0.0" }));
  const custom = join(f.cache, "market/custom/1.0.0");
  mkdirSync(join(custom, ".codex-plugin"), { recursive: true });
  writeFileSync(join(custom, ".codex-plugin/plugin.json"), JSON.stringify({ name: "custom", version: "1.0.0", skills: "./more" }));
  const malformed = join(f.cache, "market/malformed/1.0.0");
  mkdirSync(join(malformed, ".codex-plugin"), { recursive: true });
  writeFileSync(join(malformed, ".codex-plugin/plugin.json"), "{");
  const loaded = [
    skill(join(version, "skills/plain")),
    skill(join(version, "skills/node_modules/package")),
    skill(join(version, "skills/node_modules/dependency/nested/deep")),
    skill(join(custom, "more/node_modules/declared")),
    // The default root stays walked beside a declared one, as every other
    // visible directory in the cache already is.
    skill(join(custom, "skills/node_modules/package")),
    // Unreadable manifests fail closed: every node_modules in that version is walked.
    skill(join(malformed, "node_modules/unknown")),
    // A marketplace, plugin or version directory named node_modules is an
    // identity, not a dependency tree, so it is walked like any other.
    skill(join(f.cache, "market/plug/node_modules/skills/identity")),
  ];
  // Codex loads neither a plugin version's own dependencies nor a dot-named store.
  for (const directory of [
    join(version, "node_modules/dependency"),
    join(version, "server/node_modules/dependency"),
    join(version, "skills/node_modules/.pnpm/store"),
    join(custom, "node_modules/dependency"),
  ]) skill(directory);
  // A plugin dependency tree outside the skill root is never walked: this one
  // would exceed the vendor depth limit if it were.
  mkdirSync(join(version, "node_modules/dependency/assets", ...Array(34).fill("nested")), { recursive: true });
  const inventory = inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true });
  expect(paths(inventory)).toEqual(loaded.sort());
  expect(inventory.every(entry => entry.vendor)).toBe(true);
});

test("a configured Codex plugin skill root is walked through node_modules", () => {
  const f = fixture(), root = join(f.home, "local-plugin/skills");
  const loaded = skill(join(root, "node_modules/package")), hidden = join(root, "node_modules/.pnpm/store");
  skill(hidden); skill(join(dirname(root), "node_modules/dependency"));
  const inventory = inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true, agentRoots: [{ agent: "codex", path: root }] });
  expect(paths(inventory)).toEqual([loaded]);
  expect(paths(inventoryNativeSkills(f.home, { agents: ["claude"], includeVendor: true, agentRoots: [{ agent: "claude", path: root }] }))).toEqual([]);
});
