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
import { getSkillBestDoc, getSkillDocs, getSkillRequirements } from "./skillinfo";
import { getSkillPath } from "./installer";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// The OSS catalog is declarative-only: every shipped skill (and therefore every
// basic-profile skill) is a kind: "instruction" prose skill — no bin, no src/, no
// runtime dependencies, no provider credentials. The basic profile is a compact,
// curated subset of that catalog (see BASIC_SKILL_NAMES in registry-types.ts).
const BASIC_SKILLS = [...BASIC_SKILL_NAMES];

function readPackageJson(skill: string): {
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  skills?: { kind?: string; runtime?: string; source?: string };
} {
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

describe("basic skill profile", () => {
  test("default profile is compact and excludes non-basic full-registry skills", () => {
    const basic = loadBasicRegistry();
    const names = basic.map((skill) => skill.name);

    expect(names.slice(0, BASIC_SKILLS.length)).toEqual(BASIC_SKILLS);
    expect(names.filter((name) => isBasicSkillName(name))).toEqual(BASIC_SKILLS);
    expect(basic.filter((skill) => skill.source !== "custom").length).toBeLessThanOrEqual(25);
    // brand-kit ships in the catalog but is deliberately NOT in the basic profile.
    expect(names).not.toContain("brand-kit");
    expect(loadRegistryProfile("all").some((skill) => skill.name === "brand-kit")).toBe(true);
  });

  test("every basic skill is registered, documented, instruction-kind, and promptable", () => {
    for (const skill of BASIC_SKILLS) {
      const meta = getSkill(skill);
      expect(meta, skill).toBeDefined();
      expect(isBasicSkillName(skill)).toBe(true);
      expect(meta!.kind, `${skill} must be an instruction skill`).toBe("instruction");

      const docs = getSkillDocs(skill);
      expect(docs?.skillMd, `${skill} needs SKILL.md system instructions`).toBeTruthy();
      expect(docs!.skillMd!.trim().length, `${skill} needs non-trivial instructions`).toBeGreaterThan(200);
      expect(readSkillMdFrontmatterName(skill), `${skill} frontmatter name should match registry`).toBe(skill);

      // Declarative shape: no local bin, no src/ implementation.
      const pkg = readPackageJson(skill);
      expect(pkg.bin, `${skill} is an instruction skill and must not expose a bin`).toBeUndefined();
      expect(pkg.skills?.kind, `${skill} package must declare skills.kind instruction`).toBe("instruction");
      expect(existsSync(join(getSkillPath(skill), "src")), `${skill} must not ship local source`).toBe(false);

      const reqs = getSkillRequirements(skill);
      expect(reqs?.cliCommand, `${skill} needs a CLI command`).toBe(`skills run ${skill}`);
    }
  });

  test("basic skills are prose-only and declare no runtime dependencies", () => {
    for (const skill of BASIC_SKILLS) {
      const pkg = readPackageJson(skill);
      const deps = Object.keys(pkg.dependencies ?? {});
      expect(deps, `${skill} (instruction) must declare no runtime dependencies`).toEqual([]);
    }
  });

  test("every basic skill surfaces its guidance as SKILL.md prose (its deliverable)", () => {
    for (const skill of BASIC_SKILLS) {
      const best = getSkillBestDoc(skill);
      expect(best, `${skill} must resolve a best doc`).toBeTruthy();
      // The SKILL.md prose IS the skill — no CLI/executable help surface to invoke.
      expect(existsSync(join(getSkillPath(skill), "src", "index.ts"))).toBe(false);
    }
  });
});
