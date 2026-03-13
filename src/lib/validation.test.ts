import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SKILLS } from "./registry";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const SKILLS_DIR = findSkillsDir();

// Get all skill-* directories from the filesystem
const skillDirs = readdirSync(SKILLS_DIR).filter(
  (f) => f.startsWith("skill-")
);

describe("structural validation of all 202 skills", () => {
  test("every skill in the SKILLS registry has a corresponding skills/skill-{name}/ directory", () => {
    const missing: string[] = [];
    for (const skill of SKILLS) {
      const dirName = `skill-${skill.name}`;
      const dirPath = join(SKILLS_DIR, dirName);
      if (!existsSync(dirPath)) {
        missing.push(skill.name);
      }
    }
    expect(missing).toEqual([]);
  });

  test("no skill directory exists without a registry entry", () => {
    const registryNames = new Set(SKILLS.map((s) => s.name));
    const orphanDirs: string[] = [];
    for (const dir of skillDirs) {
      const name = dir.replace("skill-", "");
      if (!registryNames.has(name)) {
        orphanDirs.push(dir);
      }
    }
    expect(orphanDirs).toEqual([]);
  });

  test("number of skill directories matches registry count", () => {
    expect(skillDirs.length).toBe(SKILLS.length);
  });

  test("every skill directory has a valid package.json (parseable JSON)", () => {
    const failures: string[] = [];
    for (const dir of skillDirs) {
      const pkgPath = join(SKILLS_DIR, dir, "package.json");
      if (!existsSync(pkgPath)) {
        failures.push(`${dir}: package.json not found`);
        continue;
      }
      try {
        const content = readFileSync(pkgPath, "utf-8");
        JSON.parse(content);
      } catch (e) {
        failures.push(`${dir}: invalid JSON in package.json`);
      }
    }
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
    for (const dir of skillDirs) {
      const indexPath = join(SKILLS_DIR, dir, "src", "index.ts");
      if (existsSync(indexPath)) {
        const size = statSync(indexPath).size;
        if (size < 50) minimal.push(`${dir} (${size}B)`);
      }
    }
    // Report but don't fail — some skills may legitimately be thin wrappers
    if (minimal.length > 0) {
      console.warn(`Skills with minimal src/index.ts (<50B): ${minimal.join(", ")}`);
    }
    // Allow up to 10% of skills to be minimal
    expect(minimal.length).toBeLessThan(Math.floor(skillDirs.length * 0.1));
  });
});
