import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  BASIC_SKILL_NAMES,
  getSkill,
  isBasicSkillName,
  loadBasicRegistry,
  loadRegistryProfile,
} from "./registry";
import { getSkillDocs, getSkillRequirements } from "./skillinfo";
import { getSkillPath } from "./installer";

const BASIC_SKILLS = [...BASIC_SKILL_NAMES];

const CONNECTOR_BACKED_SKILLS = ["image", "video", "audio", "transcript", "convert"];

const EXPECTED_PACKAGE_DEPS: Record<string, string[]> = {
  "read-pdf": ["pdf-lib"],
  "pdf-read": ["pdf-parse"],
  "doc-read": ["jszip"],
  "read-csv": ["csv-parse", "iconv-lite"],
  "read-excel": ["xlsx"],
  "pdf-generate": ["pdf-lib"],
  "doc-generate": ["docx", "marked", "minimist", "openai"],
  excel: ["openai", "xlsx"],
};

function readPackageJson(skill: string): { bin?: Record<string, string>; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(getSkillPath(skill), "package.json"), "utf8"));
}

function readSkillMdFrontmatterName(skill: string): string | null {
  const docs = getSkillDocs(skill);
  const match = docs?.skillMd?.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key.trim() === "name") return rest.join(":").trim();
  }
  return null;
}

async function runSkillHelp(skill: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const entry = join(getSkillPath(skill), "src", "index.ts");
  const proc = Bun.spawn(["bun", "run", entry, "--help"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("basic skill profile for Takumi", () => {
  test("default profile is compact and excludes polluted full-registry skills", () => {
    const basic = loadBasicRegistry();
    const names = basic.map((skill) => skill.name);

    expect(names).toEqual(BASIC_SKILLS);
    expect(names.length).toBeLessThanOrEqual(25);
    expect(names).not.toContain("logo-design");
    expect(names).not.toContain("deepresearch");
    expect(loadRegistryProfile("all").some((skill) => skill.name === "deepresearch")).toBe(true);
  });

  test("every basic skill is registered, documented, promptable, and callable", () => {
    for (const skill of BASIC_SKILLS) {
      const meta = getSkill(skill);
      expect(meta, skill).toBeDefined();
      expect(isBasicSkillName(skill)).toBe(true);

      const docs = getSkillDocs(skill);
      expect(docs?.skillMd, `${skill} needs SKILL.md system instructions`).toBeTruthy();
      expect(docs!.skillMd!.trim().length, `${skill} needs non-trivial instructions`).toBeGreaterThan(200);
      expect(readSkillMdFrontmatterName(skill), `${skill} frontmatter name should match registry`).toBe(skill);

      const pkg = readPackageJson(skill);
      expect(pkg.bin, `${skill} needs a bin entry`).toBeDefined();
      const entry = Object.values(pkg.bin!)[0];
      expect(entry, `${skill} needs a callable entry`).toBeTruthy();
      expect(existsSync(join(getSkillPath(skill), entry)), `${skill} bin entry must exist`).toBe(true);

      const reqs = getSkillRequirements(skill);
      expect(reqs?.cliCommand, `${skill} needs a CLI command`).toBeTruthy();
    }
  });

  test("connector-backed basic skills declare the hosted runtime key", () => {
    for (const skill of CONNECTOR_BACKED_SKILLS) {
      const reqs = getSkillRequirements(skill);
      expect(reqs?.envVars, `${skill} should disclose SKILL_API_KEY`).toContain("SKILL_API_KEY");
    }
  });

  test("basic skills declare external runtime dependencies they import", () => {
    for (const [skill, deps] of Object.entries(EXPECTED_PACKAGE_DEPS)) {
      const pkg = readPackageJson(skill);
      for (const dep of deps) {
        expect(pkg.dependencies?.[dep], `${skill} package.json should declare ${dep}`).toBeTruthy();
      }
    }
  });

  test("every basic skill exposes help without requiring provider credentials", async () => {
    const failures: string[] = [];

    for (const skill of BASIC_SKILLS) {
      const result = await runSkillHelp(skill);
      if (result.exitCode !== 0 || !/usage|commands?|options?/i.test(result.stdout)) {
        failures.push(`${skill}: exit=${result.exitCode} stdout=${result.stdout.slice(0, 120)} stderr=${result.stderr.slice(0, 120)}`);
      }
    }

    expect(failures).toEqual([]);
  }, 20000);
});
