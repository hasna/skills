import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { installSumiPathsFixture } from "./sumi-paths.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { archiveNativeSkills, inventoryNativeSkills, parseNativeMigrationTargetManifest, selectNativeMigrationTargets, type NativeMigrationTargetManifest } from "./agent-integration.js";
import { INTEGRATION_AGENTS } from "./agent-adapters.js";

useDefaultTestTimeout();
const roots: string[] = [];
const originalPath = process.env.PATH;
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); process.env.PATH = originalPath; });

function fixture(count = 1): { root: string; home: string; project: string } {
  const root = mkdtempSync(join(tmpdir(), "skills-native-target-")); roots.push(root);
  const home = join(root, "home"), project = join(root, "project");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(join(project, ".codex"), { mode: 0o700 });
  mkdirSync(join(project, ".codex", "skills"), { mode: 0o700 });
  // Preserve the admitted synthetic Codex inspector installed by beforeEach;
  // add the opt-in Sumi path helper without replacing the trusted fixture PATH.
  process.env.PATH = installSumiPathsFixture(home) + ":" + (process.env.PATH ?? originalPath ?? "");
  admitCorpusFixture(join(project, ".codex"));
  for (let index = 0; index < count; index++) {
    const skill = join(project, ".codex", "skills", `reviewed-${index}`);
    mkdirSync(skill, { recursive: true }); writeFileSync(join(skill, "SKILL.md"), `# reviewed ${index}\n`);
  }
  return { root, home, project };
}

test("exact target manifest archives one reviewed skill and leaves unreviewed skills untouched", () => {
  const { root, home, project } = fixture(32);
  const inventory = inventoryNativeSkills(home, { projectDir: project });
  const target = inventory.find(entry => entry.path === resolve(project, ".codex", "skills", "reviewed-7"));
  expect(target).toBeDefined();
  const manifest = parseNativeMigrationTargetManifest(JSON.stringify({
    schema: "hasna.skills-native-migration-targets.v1",
    targets: [{ agent: "codex", projectRoot: resolve(project), path: ".codex/skills/reviewed-7", treeSha256: target!.hash }],
  }));
  expect(selectNativeMigrationTargets(inventory, manifest)).toHaveLength(1);
  const result = archiveNativeSkills(inventory, { dataDir: join(root, "data"), targetManifest: manifest });
  expect(result.entries).toHaveLength(1);
  expect(existsSync(target!.path)).toBe(false);
  expect(inventory.filter(entry => entry.path !== target!.path).every(entry => existsSync(entry.path))).toBe(true);
  expect(result.targetManifest?.targetCount).toBe(1);
  expect(JSON.parse(readFileSync(result.receiptPath!, "utf8")).targetManifest.digest).toBe(manifest.digest);
});

test.each([
  ["codewith", ".codewith/skills"],
  ["windsurf", ".windsurf/skills"],
  ["pi", ".pi/agent/skills"],
  ["amp", ".amp/skills"],
  ["cline", ".cline/skills"],
  ["roo", ".roo/skills"],
  ["copilot", ".github/skills"],
])("exact target manifest migrates inventory-only %s without enabling integration", (agent, skillsRoot) => {
  const { root, home, project } = fixture();
  const path = `${skillsRoot}/reviewed`;
  const skill = join(project, path);
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "# Synthetic reviewed migration fixture\n");
  writeFileSync(join(skill, "reference.txt"), "Synthetic companion file\n");
  const inventory = inventoryNativeSkills(home, { projectDir: project });
  expect(inventory).toHaveLength(2);
  const target = inventory.find(entry => entry.agent === agent && entry.path === skill)!;
  expect(target).toBeDefined();
  expect((INTEGRATION_AGENTS as readonly string[]).includes(agent)).toBe(false);
  const manifest = parseNativeMigrationTargetManifest(JSON.stringify({
    schema: "hasna.skills-native-migration-targets.v1",
    targets: [{ agent, projectRoot: resolve(project), path, treeSha256: target.hash }],
  }));
  expect(selectNativeMigrationTargets(inventory, manifest)).toEqual([target]);
  expect(() => selectNativeMigrationTargets(inventory.map(entry => entry === target ? { ...entry, vendor: true } : entry), manifest)).toThrow(/protected or vendor/);
  expect(() => selectNativeMigrationTargets(inventory, { ...manifest, targets: [{ ...manifest.targets[0]!, vendor: true }] })).toThrow(/protected or vendor/);
  expect(() => selectNativeMigrationTargets(inventory, { ...manifest, targets: [{ ...manifest.targets[0]!, agent: "codex" }] })).toThrow(/exactly once/);
  const result = archiveNativeSkills(inventory, { dataDir: join(root, "data"), targetManifest: manifest });
  expect(result.entries).toHaveLength(1);
  expect(existsSync(skill)).toBe(false);
  expect(readFileSync(join(result.entries[0]!.archive, "SKILL.md"), "utf8")).toBe("# Synthetic reviewed migration fixture\n");
  expect(readFileSync(join(result.entries[0]!.archive, "reference.txt"), "utf8")).toBe("Synthetic companion file\n");
  expect(inventoryNativeSkills(home, { projectDir: project })).toEqual(inventory.filter(entry => entry !== target));
  const receipt = JSON.parse(readFileSync(result.receiptPath!, "utf8"));
  expect(receipt.status).toBe("completed");
  expect(receipt.targetManifest.digest).toBe(manifest.digest);
  expect(receipt.targetManifest.targetCount).toBe(1);
});

test("target digest drift fails before creating an archive", () => {
  const { root, home, project } = fixture();
  const inventory = inventoryNativeSkills(home, { projectDir: project });
  const target = inventory[0]!;
  const manifest = parseNativeMigrationTargetManifest(JSON.stringify({
    schema: "hasna.skills-native-migration-targets.v1",
    targets: [{ agent: target.agent, projectRoot: resolve(project), path: ".codex/skills/reviewed-0", treeSha256: "0".repeat(64) }],
  }));
  expect(() => archiveNativeSkills(inventory, { dataDir: join(root, "data"), targetManifest: manifest })).toThrow(/changed after review/);
  expect(existsSync(target.path)).toBe(true);
  expect(existsSync(join(root, "data", "migration"))).toBe(false);
});

test("target manifests reject traversal, duplicates, and symlinked project roots", () => {
  const { root, project } = fixture();
  const base = { schema: "hasna.skills-native-migration-targets.v1" };
  const target = { agent: "codex", projectRoot: resolve(project), path: ".codex/skills/reviewed-0", treeSha256: "a".repeat(64) };
  expect(() => parseNativeMigrationTargetManifest(JSON.stringify({ ...base, targets: [{ ...target, agent: "unknown-agent" }] }))).toThrow(/Unsupported native migration target agent/);
  expect(() => parseNativeMigrationTargetManifest(JSON.stringify({ ...base, targets: [{ ...target, path: "../outside" }] }))).toThrow(/escapes/);
  expect(() => parseNativeMigrationTargetManifest(JSON.stringify({ ...base, targets: [target, target] }))).toThrow(/Duplicate/);
  expect(() => parseNativeMigrationTargetManifest(JSON.stringify({ ...base, targets: [{ ...target, vendor: false }] }))).toThrow(/fields/);
  const link = join(root, "project-link"); symlinkSync(project, link);
  expect(() => parseNativeMigrationTargetManifest(JSON.stringify({ ...base, targets: [{ ...target, projectRoot: link }] }))).toThrow(/existing absolute directory/);
});

test("direct SDK selection rejects traversal before creating a journal", () => {
  const { root, home, project } = fixture();
  const inventory = inventoryNativeSkills(home, { projectDir: project });
  const outside = inventory[0]!;
  const forged: NativeMigrationTargetManifest = {
    schema: "hasna.skills-native-migration-targets.v1", digest: "a".repeat(64),
    targets: [{ agent: outside.agent, projectRoot: resolve(project, ".codex"), path: "../../home/escape", treeSha256: outside.hash }],
  };
  expect(() => selectNativeMigrationTargets(inventory, forged)).toThrow(/Invalid native migration target/);
  expect(() => archiveNativeSkills(inventory, { dataDir: join(root, "data"), targetManifest: forged })).toThrow(/Invalid native migration target/);
  expect(existsSync(join(root, "data", "migration"))).toBe(false);
});

test("target selection rejects ambiguity, protected entries, and post-review changes", () => {
  const { home, project } = fixture();
  const inventory = inventoryNativeSkills(home, { projectDir: project });
  const target = inventory[0]!;
  const manifest = parseNativeMigrationTargetManifest(JSON.stringify({ schema: "hasna.skills-native-migration-targets.v1", targets: [{ agent: target.agent, projectRoot: resolve(project), path: ".codex/skills/reviewed-0", treeSha256: target.hash }] }));
  expect(() => selectNativeMigrationTargets([...inventory, { ...target }], manifest)).toThrow(/exactly once/);
  expect(() => selectNativeMigrationTargets([{ ...target, vendor: true }], manifest)).toThrow(/protected or vendor/);
  writeFileSync(join(target.path, "SKILL.md"), "changed after review\n");
  expect(() => selectNativeMigrationTargets(inventory, manifest)).toThrow(/changed after review/);
});
