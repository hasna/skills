import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { assertPortableAuthoringPath } from "./authoring-path.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
import { scaffoldPortableSkill } from "./portable-skills.js";
import { prepareSkill } from "./prepare-skill.js";
import { installSumiPathsFixture } from "./sumi-paths.fixture.js";
import { resolveAgentDiscovery } from "./agent-discovery.js";
import { sumiSkillRoots } from "./agent-sumi.js";
import { inventoryNativeSkills } from "./agent-integration.js";

useDefaultTestTimeout();

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "authoring-root-closure-"));
  return { home, corpus: join(home, "external-corpus"), privateCorpus: join(home, "private-corpus") };
}

test("every Sumi resolver-produced root participates in the same alias closure", () => {
  const f = fixture();
  withSumi("sumi", f.home, () => {
    const roots = resolveAgentDiscovery({ home: f.home, agent: "sumi" }).roots;
    expect(roots.length).toBeGreaterThan(0);
    for (const [index, root] of roots.entries()) {
      const name = `synthetic-existing-${index}`;
      const seeded = scaffoldPortableSkill(name, { homeDir: f.home, rootDir: f.corpus, kind: "instruction" });
      mkdirSync(root, { recursive: true }); symlinkSync(seeded.path, join(root, name));
      const manifest = join(seeded.path, "skill.json"), before = readFileSync(manifest);
      expect(() => prepareSkill(name, { homeDir: f.home, rootDir: f.corpus, version: "1.0.1" })).toThrow("native discovery root");
      expect(readFileSync(manifest).equals(before)).toBe(true);
    }
    expect(() => scaffoldPortableSkill("synthetic-private", { homeDir: f.home, rootDir: f.privateCorpus, kind: "instruction" })).not.toThrow();
  });
});

test("configured OpenCode roots exclude child aliases while unrelated authoring stays available", () => {
  const f = fixture(), custom = join(f.home, "configured-native");
  const seeded = scaffoldPortableSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" });
  const config = join(f.home, ".config/opencode/opencode.json"); mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, JSON.stringify({ skills: { paths: [custom] } }));
  mkdirSync(custom); symlinkSync(seeded.path, join(custom, "synthetic-existing"));
  const manifest = join(seeded.path, "skill.json"), before = readFileSync(manifest);
  expect(() => prepareSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, version: "1.0.1" })).toThrow("native discovery root");
  expect(readFileSync(manifest).equals(before)).toBe(true);
  expect(() => scaffoldPortableSkill("synthetic-private", { homeDir: f.home, rootDir: f.privateCorpus, kind: "instruction" })).not.toThrow();
});
function withSumi(agent: string, home: string, run: () => void) {
  const previous = process.env.PATH;
  if (agent === "sumi") process.env.PATH = installSumiPathsFixture(home);
  try { run(); } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
  }
}

for (const [agent, root] of NATIVE_SKILL_ROOTS) {
  test(`${root} excludes a child alias from scaffold and prepare without blocking private authoring`, () => {
    const f = fixture();
    withSumi(agent, f.home, () => {
      const seeded = scaffoldPortableSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" });
      const manifest = join(seeded.path, "skill.json"), before = readFileSync(manifest);
      const link = join(f.home, root, "synthetic-existing"); mkdirSync(dirname(link), { recursive: true }); symlinkSync(seeded.path, link);
      expect(() => prepareSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, version: "1.0.1" })).toThrow("native discovery root");
      expect(readFileSync(manifest).equals(before)).toBe(true);
      expect(() => scaffoldPortableSkill("synthetic-new", { homeDir: f.home, rootDir: seeded.path, kind: "instruction" })).toThrow("native discovery root");
      expect(existsSync(join(seeded.path, "synthetic-new"))).toBe(false);
      expect(() => assertPortableAuthoringPath(join(f.corpus, "synthetic-existing-sibling/probe"), { homeDir: f.home })).not.toThrow();
      expect(() => scaffoldPortableSkill("synthetic-private", { homeDir: f.home, rootDir: f.privateCorpus, kind: "instruction" })).not.toThrow();
    });
  });
}

for (const root of [".agents/skills", ".cursor/skills"]) {
  test(`${root} excludes physical root aliases and ancestors`, () => {
    const f = fixture(), external = join(f.home, "external-native"); mkdirSync(external);
    const native = join(f.home, root); mkdirSync(dirname(native), { recursive: true }); symlinkSync(external, native);
    for (const path of [join(native, "probe"), join(external, "probe"), f.home]) {
      expect(() => assertPortableAuthoringPath(path, { homeDir: f.home })).toThrow("native discovery root");
    }
    expect(() => assertPortableAuthoringPath(external + "-sibling/probe", { homeDir: f.home })).not.toThrow();
  });

  test(`${root} project ancestor aliases exclude external authoring targets`, () => {
    const f = fixture(), project = join(f.home, "project"), child = join(project, "nested/work");
    mkdirSync(child, { recursive: true });
    const seeded = scaffoldPortableSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" });
    const link = join(project, root, "synthetic-existing"); mkdirSync(dirname(link), { recursive: true }); symlinkSync(seeded.path, link);
    const cwd = process.cwd(); process.chdir(child);
    try {
      const manifest = join(seeded.path, "skill.json"), before = readFileSync(manifest);
      expect(() => prepareSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, version: "1.0.1" })).toThrow("native discovery root");
      expect(readFileSync(manifest).equals(before)).toBe(true);
      expect(() => scaffoldPortableSkill("synthetic-private", { homeDir: f.home, rootDir: f.privateCorpus, kind: "instruction" })).not.toThrow();
    } finally { process.chdir(cwd); }
  });
}

for (const root of [".agents/skill", ".claude/skill"]) {
  test(`${root} supplemental project tier refuses direct and child-alias authoring`, () => {
    const f = fixture(), project = join(f.home, "project"), child = join(project, "nested/work");
    mkdirSync(child, { recursive: true });
    const seeded = scaffoldPortableSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" });
    const native = join(project, root), direct = join(native, "synthetic-direct"); mkdirSync(direct, { recursive: true });
    writeFileSync(join(direct, "SKILL.md"), "---\nname: synthetic-direct\ndescription: Synthetic inventory fixture\n---\nSynthetic fixture.\n");
    withSumi("sumi", f.home, () => {
      expect(inventoryNativeSkills(f.home, { agents: ["sumi"], projectDir: child }).some(entry => entry.agent === "sumi" && entry.path === direct)).toBe(true);
    });
    symlinkSync(seeded.path, join(native, "synthetic-existing"));
    const cwd = process.cwd(); process.chdir(child);
    try {
      expect(() => assertPortableAuthoringPath(join(native, "new"), { homeDir: f.home })).toThrow("native discovery root");
      const manifest = join(seeded.path, "skill.json"), before = readFileSync(manifest);
      expect(() => prepareSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, version: "1.0.1" })).toThrow("native discovery root");
      expect(readFileSync(manifest).equals(before)).toBe(true);
      expect(() => scaffoldPortableSkill("synthetic-private", { homeDir: f.home, rootDir: f.privateCorpus, kind: "instruction" })).not.toThrow();
    } finally { process.chdir(cwd); }
  });
}

test("Sumi's cwd-relative resolver root is excluded for every project ancestor", () => {
  const f = fixture(), project = join(f.home, "project"), child = join(project, "nested/work");
  mkdirSync(child, { recursive: true });
  const seeded = scaffoldPortableSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, kind: "instruction" });
  withSumi("sumi", f.home, () => {
    const previous = process.env.SUMI_CONFIG_DIR, cwd = process.cwd();
    process.env.SUMI_CONFIG_DIR = ".project-sumi"; process.chdir(child);
    try {
      const root = sumiSkillRoots(f.home, project)[0]!;
      expect(root).toBe(join(project, ".project-sumi/skills"));
      expect(root).not.toBe(sumiSkillRoots(f.home, child)[0]);
      const direct = join(root, "synthetic-direct"); mkdirSync(direct, { recursive: true });
      writeFileSync(join(direct, "SKILL.md"), "---\nname: synthetic-direct\ndescription: Synthetic inventory fixture\n---\nSynthetic fixture.\n");
      expect(inventoryNativeSkills(f.home, { agents: ["sumi"], projectDir: child }).some(entry => entry.agent === "sumi" && entry.path === direct)).toBe(true);
      symlinkSync(seeded.path, join(root, "synthetic-existing"));
      expect(() => assertPortableAuthoringPath(join(root, "new"), { homeDir: f.home })).toThrow("native discovery root");
      const manifest = join(seeded.path, "skill.json"), before = readFileSync(manifest);
      expect(() => prepareSkill("synthetic-existing", { homeDir: f.home, rootDir: f.corpus, version: "1.0.1" })).toThrow("native discovery root");
      expect(readFileSync(manifest).equals(before)).toBe(true);
      expect(() => scaffoldPortableSkill("synthetic-private", { homeDir: f.home, rootDir: f.privateCorpus, kind: "instruction" })).not.toThrow();
    } finally {
      process.chdir(cwd);
      if (previous === undefined) delete process.env.SUMI_CONFIG_DIR; else process.env.SUMI_CONFIG_DIR = previous;
    }
  });
});
