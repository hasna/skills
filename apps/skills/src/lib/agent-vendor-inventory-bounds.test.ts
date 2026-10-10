import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { inventoryNativeSkills, archiveNativeSkills, planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
useDefaultTestTimeout();
const homes: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-vendor-bounds-")); homes.push(home);
  admitCorpusFixture(join(home, ".codex"));
  return { home, dataDir: join(home, ".hasna/skills"), cache: join(home, ".codex/plugins/cache") };
}
function put(path: string, value = "retained asset\n") { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, value); }

test("retiring a vendor document preserves deep assets and still detects a new nested skill", () => {
  const f = fixture(), skill = join(f.cache, "market/presentations/1.0.0/skills/presentations"), document = join(skill, "SKILL.md");
  const asset = join(skill, "artifact_tool_docs/api/references/cookbook/example.md");
  put(document, "Vendor presentation instructions\n"); put(asset);
  const inventory = inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true }); expect(inventory).toHaveLength(1);
  const archived = archiveNativeSkills(inventory, { dataDir: f.dataDir, includeVendor: true });
  expect(archived.entries).toHaveLength(1); expect(existsSync(document)).toBe(false);
  expect(readFileSync(archived.entries[0]!.archive, "utf8")).toBe("Vendor presentation instructions\n");
  expect(readFileSync(asset, "utf8")).toBe("retained asset\n");
  expect(inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true })).toEqual([]);
  const options = { home: f.home, dataDir: f.dataDir, agents: ["codex"] as const, command: "/opt/skills", profileId: "fleet" };
  applyAgentIntegration(planAgentIntegration({ ...options, agents: [...options.agents] }));
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).not.toThrow();
  put(join(asset, "../new-skill/SKILL.md"), "New native instructions\n");
  expect(inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true }).some(entry => entry.path.endsWith("new-skill"))).toBe(true);
  expect(() => assertManagedAgentBridge("codex", { ...f, projectDir: f.home })).toThrow("NATIVE_SKILL_DRIFT");
  expect(readFileSync(asset, "utf8")).toBe("retained asset\n");
});

test("vendor discovery retains a finite depth limit and the existing ordinary-root limit", () => {
  const f = fixture(); mkdirSync(join(f.cache, ...Array(34).fill("nested")), { recursive: true });
  expect(() => inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true })).toThrow("discovery limit exceeded");
  const ordinary = fixture(); mkdirSync(join(ordinary.home, ".claude/skills/a/b/c/d/e"), { recursive: true });
  expect(() => inventoryNativeSkills(ordinary.home, { agents: ["claude"] })).toThrow("discovery limit exceeded");
});

test("deep vendor assets cannot introduce linked directories", () => {
  const f = fixture(), nested = join(f.cache, ...Array(9).fill("asset")), outside = join(f.home, "outside");
  mkdirSync(nested, { recursive: true }); mkdirSync(outside); put(join(outside, "SKILL.md"), "Outside instructions\n");
  symlinkSync(outside, join(nested, "escape"));
  expect(() => inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true })).toThrow("symlink");
  expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe("Outside instructions\n");
});

test("vendor discovery refuses a real FIFO without opening it", () => {
  const f = fixture(); mkdirSync(f.cache, { recursive: true });
  const fifo = join(f.cache, "pipe"), command = spawnSync("mkfifo", [fifo]); expect(command.status).toBe(0);
  expect(() => inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true })).toThrow("Unsupported native discovery entry");
});

test("native discovery limits directory entry allocation even when files contain no skills", () => {
  const f = fixture(); mkdirSync(f.cache, { recursive: true });
  for (let i = 0; i < 20_001; i++) writeFileSync(join(f.cache, `asset-${i}`), "");
  expect(() => inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true })).toThrow("entry limit exceeded");
});

test("native discovery bounds UTF-8 path metadata below the entry limit", () => {
  // Keep individual paths portable while distinguishing UTF-8 bytes from characters.
  const f = fixture(), component = "é".repeat(100), directory = join(f.cache, component, component);
  const fileCount = 9_000, prefix = "a".repeat(100);
  expect(fileCount + 2).toBeLessThan(20_000);
  expect(fileCount * Buffer.byteLength(`${component}/${component}/${prefix}0`)).toBeGreaterThan(4 * 1024 * 1024);
  expect((fileCount + 2) * join(directory, `${prefix}${fileCount - 1}`).length).toBeLessThan(4 * 1024 * 1024);
  mkdirSync(directory, { recursive: true });
  for (let i = 0; i < fileCount; i++) writeFileSync(join(directory, `${prefix}${i}`), "");
  expect(() => inventoryNativeSkills(f.home, { agents: ["codex"], includeVendor: true })).toThrow("metadata limit exceeded");
});
