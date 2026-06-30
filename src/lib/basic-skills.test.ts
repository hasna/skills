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

const CONNECTOR_BACKED_SKILLS = ["image", "video", "audio", "music", "transcript", "convert"];
const HOSTED_RUNTIME_PROVIDER_KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "GOOGLE_PROJECT_ID"];

const EXPECTED_PACKAGE_DEPS: Record<string, string[]> = {
  "doc-read": ["jszip"],
  "read-csv": ["csv-parse", "iconv-lite"],
  "read-excel": ["xlsx"],
  "pdf-generate": ["pdf-lib"],
  "doc-generate": ["docx", "marked", "openai"],
  excel: ["openai", "xlsx"],
};

function readPackageJson(skill: string): {
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  skills?: { runtime?: string; source?: string };
} {
  return JSON.parse(readFileSync(join(getSkillPath(skill), "package.json"), "utf8"));
}

function isHostedMetadataSkill(skill: string): boolean {
  const pkg = readPackageJson(skill);
  return pkg.skills?.runtime === "hosted" || pkg.skills?.source === "remote" || pkg.skills?.source === "private-hosted";
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

    expect(names.slice(0, BASIC_SKILLS.length)).toEqual(BASIC_SKILLS);
    expect(names.filter((name) => isBasicSkillName(name))).toEqual(BASIC_SKILLS);
    expect(basic.filter((skill) => skill.source !== "custom").length).toBeLessThanOrEqual(25);
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
      if (isHostedMetadataSkill(skill)) {
        expect(pkg.bin, `${skill} hosted metadata must not expose local bin`).toBeUndefined();
        expect(existsSync(join(getSkillPath(skill), "src")), `${skill} hosted metadata must not include local source`).toBe(false);
      } else {
        expect(pkg.bin, `${skill} needs a bin entry`).toBeDefined();
        const entry = Object.values(pkg.bin!)[0];
        expect(entry, `${skill} needs a callable entry`).toBeTruthy();
        expect(existsSync(join(getSkillPath(skill), entry)), `${skill} bin entry must exist`).toBe(true);
      }

      const reqs = getSkillRequirements(skill);
      expect(reqs?.cliCommand, `${skill} needs a CLI command`).toBeTruthy();
    }
  });

  test("connector-backed basic skills declare the hosted runtime key", () => {
    for (const skill of [...CONNECTOR_BACKED_SKILLS, "read-pdf", "pdf-read", "pdf-to-markdown"]) {
      const reqs = getSkillRequirements(skill);
      expect(reqs?.envVars, `${skill} should disclose SKILLS_API_KEY`).toContain("SKILLS_API_KEY");
      expect(reqs?.envVars, `${skill} should not expose legacy SKILL_API_KEY`).not.toContain("SKILL_API_KEY");
      for (const envVar of HOSTED_RUNTIME_PROVIDER_KEYS) {
        expect(reqs?.envVars, `${skill} should not require local ${envVar}`).not.toContain(envVar);
      }
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

    for (const skill of BASIC_SKILLS.filter((name) => !isHostedMetadataSkill(name))) {
      const result = await runSkillHelp(skill);
      if (result.exitCode !== 0 || !/usage|commands?|options?/i.test(result.stdout)) {
        failures.push(`${skill}: exit=${result.exitCode} stdout=${result.stdout.slice(0, 120)} stderr=${result.stderr.slice(0, 120)}`);
      }
    }

    expect(failures).toEqual([]);
  }, 20000);
});
