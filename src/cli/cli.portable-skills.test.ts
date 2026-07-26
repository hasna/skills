import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

import { runCliInCwd } from "./cli.test-utils";

describe("CLI portable skills", () => {
  test("new, list, show, validate, and run work against ~/.hasna/skills", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-portable-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "cli-portable-cwd-"));
    try {
      const env = { HOME: home };
      const created = await runCliInCwd([
        "new",
        "my-skill",
        "--description",
        "My portable skill for CLI tests.",
        "--json",
      ], cwd, env);
      expect(created.exitCode).toBe(0);
      expect(created.stderr).toBe("");
      const createdData = JSON.parse(created.stdout);
      expect(createdData).toMatchObject({
        name: "my-skill",
        created: true,
      });
      expect(createdData.path).toBe(join(home, ".hasna", "skills", "installed", "my-skill"));
      expect(existsSync(join(createdData.path, "AGENTS.md"))).toBe(true);

      // Custom skills are gated out of the default (basic) profile (I5) but remain
      // discoverable via `list --all`.
      const basicListed = await runCliInCwd(["list", "--json"], cwd, env);
      expect(basicListed.exitCode).toBe(0);
      expect(JSON.parse(basicListed.stdout).find((skill: any) => skill.name === "my-skill")).toBeUndefined();

      const listed = await runCliInCwd(["list", "--all", "--json"], cwd, env);
      expect(listed.exitCode).toBe(0);
      const listData = JSON.parse(listed.stdout);
      const localSkill = listData.find((skill: any) => skill.name === "my-skill");
      expect(localSkill).toMatchObject({
        name: "my-skill",
        source: "custom",
        description: "My portable skill for CLI tests.",
      });

      const shown = await runCliInCwd(["show", "my-skill", "--json"], cwd, env);
      expect(shown.exitCode).toBe(0);
      const shownData = JSON.parse(shown.stdout);
      expect(shownData).toMatchObject({
        name: "my-skill",
        source: "custom",
        cliCommand: "skills run my-skill",
      });

      const validation = await runCliInCwd(["validate", "my-skill", "--json"], cwd, env);
      expect(validation.exitCode).toBe(0);
      const validationData = JSON.parse(validation.stdout);
      expect(validationData.valid).toBe(true);
      expect(validationData.metadata.portableManifest.commands[0]).toMatchObject({
        name: "my-skill",
        entry: "src/index.ts",
      });

      const run = await runCliInCwd(["run", "--json", "my-skill", "hello"], cwd, env);
      expect(run.exitCode).toBe(0);
      const runData = JSON.parse(run.stdout);
      expect(runData).toMatchObject({
        skill: "my-skill",
        args: ["hello"],
        exitCode: 0,
      });
      expect(runData.stdout).toContain('"hello"');
      expect(runData.run.paths.exportDir).toContain(".skills/exports/my-skill/");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("scaffold alias and add/port normalize existing folders", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-portable-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "cli-portable-cwd-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "cli-portable-source-"));
    try {
      const env = { HOME: home };
      const scaffolded = await runCliInCwd(["scaffold", "alias-skill", "--json"], cwd, env);
      expect(scaffolded.exitCode).toBe(0);
      expect(JSON.parse(scaffolded.stdout).name).toBe("alias-skill");

      const source = join(sourceRoot, "source-skill");
      mkdirSync(join(source, "src"), { recursive: true });
      writeFileSync(join(source, "SKILL.md"), `---
name: source-skill
description: Existing source skill ready to port.
version: 0.2.0
---

# Source Skill
`);
      writeFileSync(join(source, "package.json"), JSON.stringify({
        name: "source-skill",
        version: "0.2.0",
      }, null, 2));
      writeFileSync(join(source, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('from source skill');\n");

      const added = await runCliInCwd(["add", source, "--json"], cwd, env);
      expect(added.exitCode).toBe(0);
      const addedData = JSON.parse(added.stdout);
      expect(addedData).toMatchObject({ name: "source-skill", created: true });
      expect(existsSync(join(addedData.path, "skill.json"))).toBe(true);
      expect(existsSync(join(addedData.path, "AGENTS.md"))).toBe(true);
      const validation = await runCliInCwd(["validate", "source-skill", "--json"], cwd, env);
      expect(validation.exitCode).toBe(0);
      expect(JSON.parse(validation.stdout).valid).toBe(true);

      const portedAgain = await runCliInCwd(["port", source, "--json", "--overwrite"], cwd, env);
      expect(portedAgain.exitCode).toBe(0);
      expect(JSON.parse(portedAgain.stdout)).toMatchObject({ name: "source-skill", created: true });
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  test("scaffold --kind instruction writes prose skill without executable stubs", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-portable-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "cli-portable-cwd-"));
    try {
      const env = { HOME: home };
      const created = await runCliInCwd([
        "scaffold",
        "prose-skill",
        "--kind",
        "instruction",
        "--description",
        "A prose instruction skill.",
        "--json",
      ], cwd, env);
      expect(created.exitCode).toBe(0);
      const data = JSON.parse(created.stdout);
      expect(data.name).toBe("prose-skill");
      expect(data.manifest.kind).toBe("instruction");
      const skillDir = join(home, ".hasna", "skills", "installed", "prose-skill");
      expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillDir, "skill.json"))).toBe(true);
      expect(existsSync(join(skillDir, "package.json"))).toBe(false);
      expect(existsSync(join(skillDir, "src"))).toBe(false);

      const invalidKind = await runCliInCwd(["scaffold", "bad-kind-skill", "--kind", "nonsense", "--json"], cwd, env);
      expect(invalidKind.exitCode).toBe(1);
      expect(JSON.parse(invalidKind.stdout).error).toMatch(/Invalid --kind/);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("read commands still work when HASNA_SKILLS_DIR names a file", async () => {
    // The symptom this guards: getDataDir() returned the file path, existsSync()
    // said it existed, and readdirSync threw ENOTDIR - so `skills list`, `search`,
    // and `info` all exited 1 instead of simply reporting no custom skills.
    const cwd = mkdtempSync(join(tmpdir(), "cli-override-file-cwd-"));
    const file = join(cwd, "not-a-directory.txt");
    writeFileSync(file, "this is a file, not a skills root");
    try {
      const env = { HASNA_SKILLS_DIR: file };

      const listed = await runCliInCwd(["list", "--json"], cwd, env);
      expect(listed.exitCode).toBe(0);
      expect(JSON.parse(listed.stdout).length).toBeGreaterThan(0);

      const searched = await runCliInCwd(["search", "logo-design", "--json"], cwd, env);
      expect(searched.exitCode).toBe(0);

      const info = await runCliInCwd(["info", "logo-design", "--json"], cwd, env);
      expect(info.exitCode).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("HASNA_SKILLS_DIR relocates the whole app folder, corpus included", async () => {
    // One variable, one coherent relocation: it names the app folder, and the
    // corpus is always <app folder>/installed. Before this change getDataDir()
    // ignored it, so `skills new` wrote to the override while `skills list --all`
    // kept reading $HOME and never saw the result.
    const home = mkdtempSync(join(tmpdir(), "cli-override-home-"));
    const root = mkdtempSync(join(tmpdir(), "cli-override-root-"));
    const cwd = mkdtempSync(join(tmpdir(), "cli-override-cwd-"));
    try {
      const env = { HOME: home, HASNA_SKILLS_DIR: root };
      const created = await runCliInCwd(["new", "override-skill", "--json"], cwd, env);
      expect(created.exitCode).toBe(0);
      expect(JSON.parse(created.stdout).path).toBe(join(root, "installed", "override-skill"));
      expect(existsSync(join(home, ".hasna", "skills", "installed", "override-skill"))).toBe(false);

      const listed = await runCliInCwd(["list", "--all", "--json"], cwd, env);
      expect(listed.exitCode).toBe(0);
      expect(JSON.parse(listed.stdout).find((s: any) => s.name === "override-skill")).toBeDefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("port --all bulk-imports every subfolder with a summary", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-portable-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "cli-portable-cwd-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "cli-portable-bulk-"));
    try {
      const env = { HOME: home };
      for (const name of ["one", "two"]) {
        const dir = join(sourceRoot, name);
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Skill ${name}.\nversion: 0.1.0\n---\n\n# ${name}\n`);
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.1.0" }, null, 2));
        writeFileSync(join(dir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('x');\n");
      }
      mkdirSync(join(sourceRoot, "junk"), { recursive: true });
      writeFileSync(join(sourceRoot, "junk", "readme.txt"), "not a skill");

      const bulk = await runCliInCwd(["port", sourceRoot, "--all", "--json"], cwd, env);
      const summary = JSON.parse(bulk.stdout);
      expect(summary.succeeded).toBe(2);
      expect(summary.imported.map((e: any) => e.name).sort()).toEqual(["one", "two"]);
      expect(summary.skipped.some((e: any) => e.sourcePath.endsWith("junk"))).toBe(true);
      // Non-zero exit because there was a skip.
      expect(bulk.exitCode).toBe(1);
      expect(existsSync(join(home, ".hasna", "skills", "installed", "one", "SKILL.md"))).toBe(true);
      expect(existsSync(join(home, ".hasna", "skills", "installed", "two", "SKILL.md"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
