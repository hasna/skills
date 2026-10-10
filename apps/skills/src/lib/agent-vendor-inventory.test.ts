import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, closeSync, existsSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { archiveNativeSkills, inventoryNativeSkills, parseNativeMigrationTargetManifest, planAgentIntegration } from "./agent-integration.js";

useDefaultTestTimeout();
const roots: string[] = [];
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function put(path: string, body: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
function fixture(agent: "claude" | "codex", alias = false) {
  const home = mkdtempSync(join(tmpdir(), "skills-vendor-inventory-")); roots.push(home);
  const root = alias ? join(home, ".hasna", "workspaces", "selected", `.${agent}`) : join(home, `.${agent}`);
  mkdirSync(root, { recursive: true });
  if (agent === "codex") admitCorpusFixture(root);
  if (alias) symlinkSync(relative(home, root), join(home, `.${agent}`));
  const plugin = join(root, "plugins", "cache", "official", "superpowers", "6.3.0");
  const skill = join(plugin, "skills", "review");
  put(join(skill, "SKILL.md"), "Review instructions\n");
  return { home, root, plugin, skill, dataDir: join(home, ".hasna", "skills"), includeVendor: true, allowRootAliases: alias, agents: [agent] as const };
}

for (const agent of ["claude", "codex"] as const) for (const alias of [false, true]) {
  test(`${agent} vendor metadata file links do not hide neighboring skills${alias ? " through an opted-in root alias" : ""}`, () => {
    const f = fixture(agent, alias), metadata = join(f.plugin, "CLAUDE.md"), link = join(f.plugin, "AGENTS.md");
    put(metadata, "Plugin metadata, not a skill\n"); symlinkSync("CLAUDE.md", link);
    symlinkSync("CLAUDE.md", join(f.plugin, "metadata-without-extension"));
    // Inventory needs target metadata only; reading this file's contents is unnecessary.
    chmodSync(metadata, 0o000);
    expect(inventoryNativeSkills(f.home, { agents: [agent], allowRootAliases: alias })).toHaveLength(0);
    const plan = planAgentIntegration({ ...f, agents: [agent] });
    expect(plan.nativeSkills).toMatchObject([{ agent, path: f.skill, vendor: true, managed: false }]);
    expect(plan.nativeSkills).toHaveLength(1);
    if (alias) expect(plan.rootAliases).toMatchObject([{ alias: join(f.home, `.${agent}`), target: f.root }]);
    if (agent === "codex") {
      const config = plan.changes.find(change => change.path === join(f.root, "config.toml"))!;
      expect((Bun.TOML.parse(config.after) as any).skills.config).toEqual([{ path: join(f.skill, "SKILL.md"), enabled: false }]);
    } else {
      const config = plan.changes.find(change => change.path === join(f.root, "settings.json"))!;
      expect(JSON.parse(config.after).permissions.deny).toContain("Skill");
    }
    expect(archiveNativeSkills(plan.nativeSkills, { dataDir: f.dataDir, includeUnmanaged: true, allowRootAliases: alias }).entries).toHaveLength(0);
    expect(readFileSync(join(f.skill, "SKILL.md"), "utf8")).toBe("Review instructions\n");
    expect(lstatSync(link).isSymbolicLink()).toBe(true); expect(readlinkSync(link)).toBe("CLAUDE.md");
    expect(existsSync(join(f.root, "hooks.json"))).toBe(false);
    chmodSync(metadata, 0o600); expect(readFileSync(metadata, "utf8")).toBe("Plugin metadata, not a skill\n");
  });
  test(`${agent} ignores an empty sibling cache version alias that sorts before its target${alias ? " through an opted-in root alias" : ""}`, () => {
    const f = fixture(agent, alias), parent = dirname(f.plugin), target = join(parent, "z-empty-version"), link = join(parent, "0-version-alias");
    mkdirSync(join(target, "skills"), { recursive: true });
    put(join(target, ".codex-plugin", "plugin.json"), JSON.stringify({ skills: ["./skills/"] }));
    symlinkSync(alias ? target : "z-empty-version", link);
    const plan = planAgentIntegration({ ...f, agents: [agent] });
    expect(plan.nativeSkills).toMatchObject([{ agent, path: f.skill, vendor: true }]);
    expect(plan.nativeSkills).toHaveLength(1);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(target, "skills"))).toBe(true);
    expect(readFileSync(join(f.skill, "SKILL.md"), "utf8")).toBe("Review instructions\n");
  });
}

for (const agent of ["claude", "codex"] as const) {
  for (const kind of ["directory", "skill-root", "dangling", "special-file", "loop"] as const) test(`${agent} vendor discovery still refuses ${kind} symlinks`, () => {
    const f = fixture(agent), target = join(f.home, "outside");
    if (kind === "loop") symlinkSync(target, target);
    else if (kind === "special-file") execFileSync("mkfifo", [target]);
    else if (kind !== "dangling") mkdirSync(target);
    if (kind === "skill-root") put(join(target, "SKILL.md"), "Outside skill must not be discovered\n");
    symlinkSync(target, join(f.plugin, "metadata.md"));
    expect(() => inventoryNativeSkills(f.home, f)).toThrow(kind === "loop" ? "ELOOP" : "symlink");
  });
  for (const name of ["SKILL.md", "reference.txt"]) test(`${agent} vendor skill still refuses a ${name} file symlink`, () => {
    const f = fixture(agent), target = join(f.plugin, "metadata.txt"), link = join(f.skill, name);
    put(target, "Must never be read through a skill symlink\n");
    rmSync(link, { force: true }); symlinkSync(target, link);
    expect(() => inventoryNativeSkills(f.home, f)).toThrow("symlink");
  });
}

test("an exact reviewed skill-containing cache alias permits vendor retirement without weakening hook inventory", () => {
  const f = fixture("codex"), parent = dirname(f.plugin), link = join(parent, "latest");
  symlinkSync(f.plugin, link);
  expect(() => inventoryNativeSkills(f.home, f)).toThrow("symlink");
  expect(() => inventoryNativeSkills(f.home, { ...f, reviewedCacheAlias: join(parent, "other") })).toThrow("symlink");
  expect(() => inventoryNativeSkills(f.home, { agents: ["codex"], reviewedCacheAlias: link })).toThrow("vendor inventory");
  const reviewed = inventoryNativeSkills(f.home, { ...f, reviewedCacheAlias: link });
  expect(reviewed).toMatchObject([{ agent: "codex", path: f.skill, vendor: true }]);
  expect(reviewed).toHaveLength(1);
  const manifest = parseNativeMigrationTargetManifest(JSON.stringify({ schema: "hasna.skills-native-migration-targets.v1",
    targets: [{ agent: "codex", projectRoot: f.home, path: relative(f.home, f.skill), treeSha256: reviewed[0]!.hash, vendor: true }] }));
  const retired = archiveNativeSkills(reviewed, { dataDir: f.dataDir, targetManifest: manifest });
  expect(retired.entries).toHaveLength(1);
  expect(existsSync(join(f.skill, "SKILL.md"))).toBe(false);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(inventoryNativeSkills(f.home, f)).toEqual([]);
});

for (const agent of ["claude", "codex"] as const) {
  for (const kind of ["skill-containing", "outside", "chained", "dangling", "depth-limited", "component-escape"] as const) {
    test(`${agent} refuses a ${kind} cache directory alias`, () => {
      const f = fixture(agent), parent = dirname(f.plugin), target = join(parent, "z-empty-version"), link = join(parent, "0-version-alias");
      mkdirSync(target);
      let destination = target;
      if (kind === "skill-containing") destination = f.plugin;
      if (kind === "outside") { destination = join(f.home, "outside"); mkdirSync(destination); }
      if (kind === "chained") { destination = join(parent, ".hidden-alias"); symlinkSync(target, destination); }
      if (kind === "dangling") destination = join(parent, "missing");
      if (kind === "depth-limited") put(join(target, ...Array.from({ length: 10 }, (_, index) => `nested-${index}`), "SKILL.md"), "Beyond the discovery depth\n");
      if (kind === "component-escape") {
        const outside = join(f.home, "outside"); mkdirSync(join(outside, "child"), { recursive: true }); mkdirSync(join(outside, "z-empty-version"));
        symlinkSync(join(outside, "child"), join(parent, ".redirect"));
        destination = ".redirect/../z-empty-version";
      }
      symlinkSync(destination, link);
      expect(() => inventoryNativeSkills(f.home, f)).toThrow("symlink");
    });
  }
}

test("an empty cache directory exceeding the alias proof entry bound is not ignored", () => {
  const f = fixture("codex"), parent = dirname(f.plugin), target = join(parent, "z-large-empty-version");
  mkdirSync(target);
  for (let index = 0; index < 10000; index++) writeFileSync(join(target, `metadata-${index}`), "");
  symlinkSync(target, join(parent, "0-version-alias"));
  expect(() => inventoryNativeSkills(f.home, f)).toThrow("symlink");
});

for (const system of [false, true]) test(`${system ? "system" : "native"} discovery still refuses empty sibling directory aliases`, () => {
  const f = fixture("codex"), root = join(f.home, ".codex", "skills", ...(system ? [".system"] : []));
  mkdirSync(join(root, "empty"), { recursive: true }); symlinkSync("empty", join(root, "alias"));
  expect(() => inventoryNativeSkills(f.home, f)).toThrow("symlink");
});

test("vendor skill hashing still rejects special files and oversized content", () => {
  const f = fixture("codex"), special = join(f.skill, "pipe");
  execFileSync("mkfifo", [special]);
  expect(() => inventoryNativeSkills(f.home, f)).toThrow("Unsupported skill file");
  rmSync(special);
  const large = join(f.skill, "large.dat"), fd = openSync(large, "w");
  try { ftruncateSync(fd, 64 * 1024 * 1024 + 1); } finally { closeSync(fd); }
  expect(() => inventoryNativeSkills(f.home, f)).toThrow("migration size limits");
});
