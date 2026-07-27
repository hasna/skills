import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

import {
  getPortableSkillsRoot,
  isOfficialSkillName,
  listPortableSkills,
  portPortableSkill,
  readPortableSkillManifest,
  runPortableSkill,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
} from "./portable-skills";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("portable skills", () => {
  test("scaffolds a standard skill folder with agent instructions and a runnable command", async () => {
    const home = mkdtempSync(join(tmpdir(), "portable-skill-home-"));
    try {
      const result = scaffoldPortableSkill("Demo Skill", {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        description: "Demonstrates portable skill scaffolding.",
      });

      expect(result.created).toBe(true);
      expect(result.name).toBe("demo-skill");
      expect(result.path).toBe(join(home, ".hasna", "skills", "installed", "demo-skill"));
      expect(existsSync(join(result.path, "SKILL.md"))).toBe(true);
      expect(existsSync(join(result.path, "skill.json"))).toBe(true);
      expect(existsSync(join(result.path, "AGENTS.md"))).toBe(true);
      expect(existsSync(join(result.path, "src", "index.ts"))).toBe(true);

      const manifest = readPortableSkillManifest(result.path);
      expect(manifest).toMatchObject({
        name: "demo-skill",
        description: "Demonstrates portable skill scaffolding.",
        version: "0.1.0",
        commands: [{ name: "demo-skill", entry: "src/index.ts" }],
      });

      const validation = validatePortableSkillDirectory("demo-skill", result.path);
      expect(validation.valid).toBe(true);
      expect(validation.issues).toEqual([]);
      expect(validation.metadata.portableManifest?.standard).toBe("hasna.skill.v1");

      const run = await runPortableSkill("demo-skill", ["alpha", "beta"], {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        stdio: "pipe",
      });
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('"skill": "demo-skill"');
      expect(run.stdout).toContain('"alpha"');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("ports an existing skill folder into the portable standard", () => {
    const home = mkdtempSync(join(tmpdir(), "portable-skill-home-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "portable-skill-source-"));
    try {
      const source = join(sourceRoot, "legacy-skill");
      mkdirSync(join(source, "src"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: legacy-skill
description: Legacy skill using existing SKILL.md conventions.
version: 1.2.3
tags:
  - legacy
---

# Legacy Skill

Use this skill when porting an existing folder.
`);
      writeFileSync(join(source, "package.json"), JSON.stringify({
        name: "legacy-skill",
        version: "1.2.3",
      }, null, 2));
      writeFileSync(join(source, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('ported legacy skill');\n");

      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });

      expect(result.created).toBe(true);
      expect(result.name).toBe("legacy-skill");
      expect(existsSync(join(result.path, "skill.json"))).toBe(true);
      expect(existsSync(join(result.path, "AGENTS.md"))).toBe(true);
      expect(readFileSync(join(result.path, "SKILL.md"), "utf8")).toContain("Legacy skill");

      const listed = listPortableSkills({ rootDir: getPortableSkillsRoot({ homeDir: home }) });
      expect(listed.map((skill) => skill.name)).toEqual(["legacy-skill"]);
      expect(listed[0]?.version).toBe("1.2.3");

      const validation = validatePortableSkillDirectory("legacy-skill", result.path);
      expect(validation.valid).toBe(true);
      expect(validation.metadata.portableManifest?.commands[0]?.entry).toBe("src/index.ts");
      const pkg = JSON.parse(readFileSync(join(result.path, "package.json"), "utf8"));
      expect(pkg.bin).toEqual({ "legacy-skill": "src/index.ts" });
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  test("validates an instruction skill with only SKILL.md (no commands, inputs, or AGENTS.md)", () => {
    const home = mkdtempSync(join(tmpdir(), "portable-skill-home-"));
    try {
      const root = getPortableSkillsRoot({ homeDir: home });
      const skillDir = join(root, "skill-project");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: skill-project
description: Open or resume an existing Hasna repo project using the projects CLI.
kind: instruction
source: private
---

# Skill Project

Prose-only instruction skill.
`);

      const manifest = readPortableSkillManifest(skillDir, "skill-project");
      expect(manifest.kind).toBe("instruction");
      expect(manifest.commands).toEqual([]);

      const validation = validatePortableSkillDirectory("skill-project", skillDir);
      expect(validation.valid).toBe(true);
      const codes = validation.issues.map((issue) => issue.code);
      expect(codes).not.toContain("portable.commands_missing");
      expect(codes).not.toContain("portable.agents_missing");
      expect(codes).not.toContain("package.missing");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("runPortableSkill returns a not-runnable error for instruction skills", async () => {
    const home = mkdtempSync(join(tmpdir(), "portable-skill-home-"));
    try {
      const root = getPortableSkillsRoot({ homeDir: home });
      const skillDir = join(root, "skill-project");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: skill-project
description: Prose-only instruction skill.
kind: instruction
source: private
---

# Skill Project
`);

      const run = await runPortableSkill("skill-project", [], { rootDir: root, stdio: "pipe" });
      expect(run.exitCode).toBe(1);
      expect(run.error).toContain("instruction skill");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("port robustness", () => {
  function withDirs(fn: (home: string, sourceRoot: string) => void): void {
    const home = mkdtempSync(join(tmpdir(), "portable-skill-home-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "portable-skill-source-"));
    try {
      fn(home, sourceRoot);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  }

  // ---- I1: port respects instruction kind (no fabricated executable stubs) ----

  test("ports a prose instruction skill without fabricating executable stubs", () => {
    withDirs((home, sourceRoot) => {
      const source = join(sourceRoot, "prose-skill");
      mkdirSync(join(source, "references"), { recursive: true });
      const skillMd = `---
name: prose-skill
description: A prose-only instruction skill.
kind: instruction
version: 2.0.0
tags:
  - agent
---

# Prose Skill

Use this when you need guidance, not a runnable command.
`;
      writeFileSync(join(source, "SKILL.md"), skillMd);
      writeFileSync(join(source, "references", "notes.md"), "# Notes\n");

      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });

      expect(result.name).toBe("prose-skill");
      // No fabricated executable stubs.
      expect(existsSync(join(result.path, "package.json"))).toBe(false);
      expect(existsSync(join(result.path, "src", "index.ts"))).toBe(false);
      expect(existsSync(join(result.path, "src"))).toBe(false);
      expect(existsSync(join(result.path, "tsconfig.json"))).toBe(false);
      expect(existsSync(join(result.path, "AGENTS.md"))).toBe(false);
      // SKILL.md is preserved verbatim.
      expect(readFileSync(join(result.path, "SKILL.md"), "utf8")).toBe(skillMd);
      // Non-entry helper docs are preserved.
      expect(existsSync(join(result.path, "references", "notes.md"))).toBe(true);
      // skill.json declares the instruction kind and no commands.
      const skillJson = JSON.parse(readFileSync(join(result.path, "skill.json"), "utf8"));
      expect(skillJson.kind).toBe("instruction");
      expect(skillJson.commands).toBeUndefined();
      expect(result.manifest.kind).toBe("instruction");
      expect(result.manifest.commands).toEqual([]);
    });
  });

  // ---- Merge-ordering guarantee: a PORTED prose/instruction skill validates clean ----
  // Guards the reconciliation of instruction-kind + port-robustness + bulk-authoring:
  // porting an instruction skill must produce a directory that validatePortableSkillDirectory
  // accepts (valid === true) with no commands/inputs/executable stubs demanded.
  test("a ported prose/instruction skill validates as valid", () => {
    withDirs((home, sourceRoot) => {
      const source = join(sourceRoot, "guidance-skill");
      mkdirSync(join(source, "references"), { recursive: true });
      writeFileSync(
        join(source, "SKILL.md"),
        `---
name: guidance-skill
description: A prose-only instruction skill for agents.
kind: instruction
version: 1.2.0
tags:
  - agent
---

# Guidance Skill

Prose guidance an agent reads; there is nothing to run.
`,
      );
      writeFileSync(join(source, "references", "playbook.md"), "# Playbook\n");

      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });
      expect(result.manifest.kind).toBe("instruction");

      const validation = validatePortableSkillDirectory(result.name, result.path);
      expect(validation.valid).toBe(true);
      expect(validation.issues).toEqual([]);
    });
  });

  test("still fabricates executable stubs for skills without an instruction kind", () => {
    withDirs((home, sourceRoot) => {
      const source = join(sourceRoot, "exec-skill");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: exec-skill
description: Executable skill.
---

# Exec Skill
`);

      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });
      expect(existsSync(join(result.path, "package.json"))).toBe(true);
      expect(existsSync(join(result.path, "src", "index.ts"))).toBe(true);
      expect(existsSync(join(result.path, "AGENTS.md"))).toBe(true);
    });
  });

  // ---- I2: copySkillDirectory does not crash / does not import junk ----

  test("ports a symlinked source folder without crashing", () => {
    withDirs((home, sourceRoot) => {
      const real = join(sourceRoot, "real-skill");
      mkdirSync(join(real, "src"), { recursive: true });
      writeFileSync(join(real, "SKILL.md"), `---
name: linked-skill
description: A skill reached through a symlink.
---

# Linked Skill
`);
      writeFileSync(join(real, "src", "index.ts"), "console.log('hi');\n");
      const link = join(sourceRoot, "linked-skill");
      symlinkSync(real, link, "dir");

      const result = portPortableSkill(link, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });
      expect(result.name).toBe("linked-skill");
      expect(readFileSync(join(result.path, "SKILL.md"), "utf8")).toContain("Linked Skill");
      expect(existsSync(join(result.path, "src", "index.ts"))).toBe(true);
    });
  });

  test("excludes AppleDouble files and .system dirs when porting junky sources", () => {
    withDirs((home, sourceRoot) => {
      const source = join(sourceRoot, "junky-skill");
      mkdirSync(join(source, ".system"), { recursive: true });
      mkdirSync(join(source, "references"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: junky-skill
description: Skill folder polluted with macOS/agent junk.
kind: instruction
---

# Junky Skill
`);
      writeFileSync(join(source, "._SKILL.md"), "appledouble sidecar");
      writeFileSync(join(source, ".system", "state.json"), "{}");
      writeFileSync(join(source, "references", "._nested.md"), "nested appledouble");
      writeFileSync(join(source, "references", "guide.md"), "# Guide\n");

      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });

      expect(existsSync(join(result.path, "._SKILL.md"))).toBe(false);
      expect(existsSync(join(result.path, ".system"))).toBe(false);
      expect(existsSync(join(result.path, "references", "._nested.md"))).toBe(false);
      // Legitimate content survives.
      expect(existsSync(join(result.path, "SKILL.md"))).toBe(true);
      expect(existsSync(join(result.path, "references", "guide.md"))).toBe(true);
    });
  });

  test("drops build output only at the skill root, keeping nested build/dist content", () => {
    withDirs((home, sourceRoot) => {
      const source = join(sourceRoot, "layered-skill");
      mkdirSync(join(source, "build"), { recursive: true });
      mkdirSync(join(source, "dist"), { recursive: true });
      mkdirSync(join(source, "node_modules", "left-pad"), { recursive: true });
      mkdirSync(join(source, "references", "build"), { recursive: true });
      mkdirSync(join(source, "docs", "dist"), { recursive: true });
      mkdirSync(join(source, "references", "node_modules"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: layered-skill
description: Skill with real nested build/dist references.
kind: instruction
---

# Layered Skill
`);
      // Top-level build output = junk.
      writeFileSync(join(source, "build", "artifact.js"), "// generated\n");
      writeFileSync(join(source, "dist", "bundle.js"), "// generated\n");
      writeFileSync(join(source, "node_modules", "left-pad", "index.js"), "// dep\n");
      // Nested build/dist = legitimate authored content.
      writeFileSync(join(source, "references", "build", "howto.md"), "# How to build\n");
      writeFileSync(join(source, "docs", "dist", "distribution.md"), "# Distribution\n");
      // node_modules is junk at ANY depth.
      writeFileSync(join(source, "references", "node_modules", "junk.js"), "// nested dep\n");

      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
      });

      // Root build output dropped.
      expect(existsSync(join(result.path, "build"))).toBe(false);
      expect(existsSync(join(result.path, "dist"))).toBe(false);
      // node_modules dropped at any depth.
      expect(existsSync(join(result.path, "node_modules"))).toBe(false);
      expect(existsSync(join(result.path, "references", "node_modules"))).toBe(false);
      // Nested build/dist references preserved.
      expect(existsSync(join(result.path, "references", "build", "howto.md"))).toBe(true);
      expect(existsSync(join(result.path, "docs", "dist", "distribution.md"))).toBe(true);
    });
  });

  // ---- duplicate name handling (single-folder port) ----

  test("refuses to overwrite an existing portable skill unless --overwrite is set", () => {
    withDirs((home, sourceRoot) => {
      const makeSource = (dir: string) => {
        const source = join(sourceRoot, dir);
        mkdirSync(source, { recursive: true });
        writeFileSync(join(source, "SKILL.md"), `---
name: dup-skill
description: Duplicate skill name across tool dirs.
kind: instruction
---

# Dup Skill
`);
        return source;
      };
      const rootDir = getPortableSkillsRoot({ homeDir: home });
      portPortableSkill(makeSource("a"), { rootDir });
      expect(() => portPortableSkill(makeSource("b"), { rootDir })).toThrow(/already exists/);
      // With --overwrite it succeeds.
      const result = portPortableSkill(makeSource("b"), { rootDir, overwrite: true });
      expect(result.name).toBe("dup-skill");
    });
  });

  // ---- I3: guard inferred name against the official corpus ----

  test("blocks a silent shadow of a bundled official skill via inferred name", () => {
    withDirs((home, sourceRoot) => {
      expect(isOfficialSkillName("brand-kit")).toBe(true);
      const source = join(sourceRoot, "skill-image");
      mkdirSync(source, { recursive: true });
      // Folder is 'skill-image' but frontmatter name is the official 'brand-kit'.
      writeFileSync(join(source, "SKILL.md"), `---
name: brand-kit
description: Imported skill that would shadow the bundled brand-kit skill.
kind: instruction
---

# Brand Kit
`);

      expect(() =>
        portPortableSkill(source, { rootDir: getPortableSkillsRoot({ homeDir: home }) }),
      ).toThrow(/shadow/i);
      // Nothing was written.
      expect(existsSync(join(getPortableSkillsRoot({ homeDir: home }), "brand-kit"))).toBe(false);
    });
  });

  test("allows shadowing an official skill only with an explicit opt-in", () => {
    withDirs((home, sourceRoot) => {
      const source = join(sourceRoot, "skill-image");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: brand-kit
description: Deliberate override of the bundled brand-kit skill.
kind: instruction
---

# Brand Kit
`);
      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        allowShadow: true,
      });
      expect(result.name).toBe("brand-kit");
    });
  });

  test("renaming to a non-official name avoids the shadow guard", () => {
    withDirs((home, sourceRoot) => {
      const source = join(sourceRoot, "skill-image");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: brand-kit
description: Imported skill renamed to avoid shadowing.
kind: instruction
---

# Brand Kit
`);
      const result = portPortableSkill(source, {
        rootDir: getPortableSkillsRoot({ homeDir: home }),
        name: "skill-image",
      });
      expect(result.name).toBe("skill-image");
      expect(isOfficialSkillName("skill-image")).toBe(false);
    });
  });
});
