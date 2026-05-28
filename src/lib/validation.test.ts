import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { SKILLS } from "./registry";
import { generateSkillMd } from "./skillinfo";
import {
  parseSkillFrontmatter,
  validateRegistryConsistency,
  validateSkillDirectory,
} from "./skill-validation";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECURITY_AUDIT_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".json",
  ".yml",
  ".yaml",
  ".env",
  ".md",
  ".sh",
  ".bash",
]);

// Locate the skills/ directory from the repo root
function findSkillsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills");
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error("Could not find skills/ directory");
}

function countSecurityAuditFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (["node_modules", ".git", "dist", "build"].includes(entry)) {
        continue;
      }
      count += countSecurityAuditFiles(path);
      continue;
    }
    if ([...SECURITY_AUDIT_EXTENSIONS].some((ext) => entry.endsWith(ext))) {
      count += 1;
    }
  }
  return count;
}

const SKILLS_DIR = findSkillsDir();

// Get all bundled skill directories from the filesystem
const skillDirs = readdirSync(SKILLS_DIR).filter((f) => {
  const fullPath = join(SKILLS_DIR, f);
  return f !== "_common" && !f.startsWith(".") && statSync(fullPath).isDirectory();
});

describe("structural validation of all registered skills", () => {
  test("every skill in the SKILLS registry has a corresponding skills/{name}/ directory", () => {
    const result = validateRegistryConsistency(SKILLS, SKILLS_DIR);
    expect(result.missingDirectories).toEqual([]);
  });

  test("no skill directory exists without a registry entry", () => {
    const result = validateRegistryConsistency(SKILLS, SKILLS_DIR);
    expect(result.orphanDirectories).toEqual([]);
  });

  test("registry names are unique", () => {
    const result = validateRegistryConsistency(SKILLS, SKILLS_DIR);
    expect(result.duplicateRegistryNames).toEqual([]);
  });

  test("number of skill directories matches registry count", () => {
    expect(skillDirs.length).toBe(SKILLS.length);
  });

  test("every skill directory has a valid package.json (parseable JSON)", () => {
    const failures = skillDirs
      .map((dir) => validateSkillDirectory(dir, join(SKILLS_DIR, dir), SKILLS.find((skill) => skill.name === dir)))
      .filter((result) => result.issues.some((issue) => issue.code.startsWith("package.")))
      .map((result) => `${result.name}: ${result.issues.map((issue) => issue.message).join(", ")}`);
    expect(failures).toEqual([]);
  });

  test("every skill package declares a bin command", () => {
    const failures = skillDirs
      .map((dir) => validateSkillDirectory(dir, join(SKILLS_DIR, dir), SKILLS.find((skill) => skill.name === dir)))
      .filter((result) => result.issues.some((issue) => issue.code === "package.bin_missing" || issue.code === "package.bin_invalid"))
      .map((result) => result.name);
    expect(failures).toEqual([]);
  });

  test("SKILL.md frontmatter is valid when present", () => {
    const failures = skillDirs
      .map((dir) => validateSkillDirectory(dir, join(SKILLS_DIR, dir), SKILLS.find((skill) => skill.name === dir)))
      .filter((result) => result.issues.some((issue) => issue.code.startsWith("skill.frontmatter")))
      .map((result) => `${result.name}: ${result.issues.map((issue) => issue.message).join(", ")}`);
    expect(failures).toEqual([]);
  });

  test("every skill has at least one doc file (SKILL.md, README.md, or CLAUDE.md)", () => {
    const docFiles = ["SKILL.md", "README.md", "CLAUDE.md"];
    const missing: string[] = [];
    for (const dir of skillDirs) {
      const dirPath = join(SKILLS_DIR, dir);
      const hasDoc = docFiles.some((f) => existsSync(join(dirPath, f)));
      if (!hasDoc) {
        missing.push(dir);
      }
    }
    expect(missing).toEqual([]);
  });

  test("no skills are missing doc files", () => {
    const docFiles = ["SKILL.md", "README.md", "CLAUDE.md"];
    let missingCount = 0;
    for (const dir of skillDirs) {
      const dirPath = join(SKILLS_DIR, dir);
      const hasDoc = docFiles.some((f) => existsSync(join(dirPath, f)));
      if (!hasDoc) missingCount++;
    }
    expect(missingCount).toBe(0);
  });

  test("all skills have a non-trivial src/index.ts", () => {
    const minimal: string[] = [];
    const missing: string[] = [];
    for (const dir of skillDirs) {
      const tsIndexPath = join(SKILLS_DIR, dir, "src", "index.ts");
      const jsIndexPath = join(SKILLS_DIR, dir, "src", "index.js");
      const indexPath = existsSync(tsIndexPath) ? tsIndexPath : jsIndexPath;
      if (!existsSync(indexPath)) {
        missing.push(dir);
        continue;
      }
      const size = statSync(indexPath).size;
      if (size < 50) minimal.push(`${dir} (${size}B)`);
    }

    expect(missing).toEqual([]);
    if (minimal.length > 0) {
      console.warn(`Skills with minimal src/index.ts (<50B): ${minimal.join(", ")}`);
    }
    expect(minimal.length).toBeLessThan(Math.floor(skillDirs.length * 0.1));
  });

  test("every registered skill can generate valid SKILL.md instructions", () => {
    const failures: string[] = [];

    for (const skill of SKILLS) {
      const generated = generateSkillMd(skill.name);
      if (!generated) {
        failures.push(`${skill.name}: generator returned null`);
        continue;
      }

      const frontmatter = parseSkillFrontmatter(generated);
      if (!frontmatter) {
        failures.push(`${skill.name}: generated frontmatter is missing or invalid`);
        continue;
      }

      if (frontmatter.name !== skill.name) {
        failures.push(`${skill.name}: generated name '${frontmatter.name}' does not match registry`);
      }
      if (!frontmatter.description || frontmatter.description.length < 10) {
        failures.push(`${skill.name}: generated description is too short`);
      }
      if (!generated.includes(`# ${skill.displayName}`)) {
        failures.push(`${skill.name}: generated body missing display heading`);
      }
    }

    expect(failures).toEqual([]);
  });

  test("security-audit skill runs without undeclared dependencies or localhost false positives", () => {
    const result = spawnSync(
      "bun",
      ["run", "skills/security-audit/src/index.ts", "path=src"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Findings:** 0");
  });

  test("security-audit skill scans release documentation", () => {
    const expectedFilesScanned = countSecurityAuditFiles(join(process.cwd(), "docs"));
    const result = spawnSync(
      "bun",
      ["run", "skills/security-audit/src/index.ts", "path=docs"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Findings:** 0");
    expect(result.stdout).toContain(`Files Scanned:** ${expectedFilesScanned}`);
  });

  test("security-audit skill scans shell deployment scripts", () => {
    const expectedFilesScanned = countSecurityAuditFiles(join(process.cwd(), "scripts"));
    const result = spawnSync(
      "bun",
      ["run", "skills/security-audit/src/index.ts", "path=scripts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Findings:** 0");
    expect(result.stdout).toContain(`Files Scanned:** ${expectedFilesScanned}`);
  });
});

describe("skill validation helpers", () => {
  test("parses inline and block-list SKILL.md frontmatter", () => {
    const parsed = parseSkillFrontmatter(`---
name: demo
description: Demo skill
display_name: Demo Skill
category: Development Tools
tags:
  - demo
  - testing
---

# Demo
`);

    expect(parsed).toEqual({
      name: "demo",
      description: "Demo skill",
      displayName: "Demo Skill",
      category: "Development Tools",
      tags: ["demo", "testing"],
    });
  });

  test("reports invalid fixture package and frontmatter issues", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: wrong-name
description: Demo skill
---

# Demo
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: "demo", version: "0.1.0" }));

      const result = validateSkillDirectory("demo", skillDir);
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("skill.frontmatter_name_mismatch");
      expect(result.issues.map((issue) => issue.code)).toContain("package.bin_missing");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reports malformed package.json in invalid fixture", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "README.md"), "# Demo\n");
      writeFileSync(join(skillDir, "package.json"), "{ invalid json }");

      const result = validateSkillDirectory("demo", skillDir);
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain("package.invalid_json");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts a hardened valid fixture with explicit provenance", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo-skill");
      mkdirSync(join(skillDir, "src"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: demo-skill
description: Demo skill with complete metadata.
source: official
tags:
  - demo
  - testing
---

# Demo Skill
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({
        name: "demo-skill",
        version: "0.1.0",
        bin: { "demo-skill": "src/index.ts" },
      }, null, 2));
      writeFileSync(join(skillDir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('demo skill validation fixture');\n");

      const result = validateSkillDirectory("demo-skill", skillDir);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.metadata.packageName).toBe("demo-skill");
      expect(result.metadata.binCommands).toEqual(["demo-skill"]);
      expect(result.metadata.skillMdFrontmatter?.source).toBe("official");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reports package, provenance, file-structure, and unsafe path issues deterministically", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "skill-validation-"));
    try {
      const skillDir = join(tempDir, "demo-skill");
      mkdirSync(join(skillDir, "src"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---
name: demo-skill
description: Demo skill with invalid provenance.
source: untrusted-mirror
---

# Demo Skill
`);
      writeFileSync(join(skillDir, "package.json"), JSON.stringify({
        name: "wrong-package",
        version: "0.1.0",
        bin: {
          "../escape": "src/index.ts",
          "demo skill": "src/index.ts",
          "demo-skill": "../outside.ts",
        },
      }, null, 2));
      writeFileSync(join(skillDir, "src", "index.ts"), "#!/usr/bin/env bun\nconsole.log('demo skill validation fixture');\n");
      writeFileSync(join(skillDir, ".env"), "SECRET=value\n");

      const result = validateSkillDirectory("demo-skill", skillDir);
      const codes = result.issues.map((issue) => issue.code);
      expect(result.valid).toBe(false);
      expect(codes).toEqual([...codes].sort());
      expect(codes).toEqual([
        "package.bin_command_invalid",
        "package.bin_command_invalid",
        "package.bin_target_unsafe",
        "package.name_mismatch",
        "skill.frontmatter_source_invalid",
        "skill.reserved_file",
      ]);
      expect(result.issues.map((issue) => issue.message)).toContain("package.json name 'wrong-package' does not match 'demo-skill'");
      expect(result.issues.map((issue) => issue.message)).toContain("package.json bin 'demo-skill' target '../outside.ts' must stay inside the skill directory");
      expect(result.issues.map((issue) => issue.message)).toContain("Reserved file '.env' is not allowed in skill packages");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
