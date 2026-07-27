import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findPrivatePacklistLeaks,
  isPrivateSkillDir,
  isPrivateVisibility,
  listPrivateSkillSlugs,
} from "./public-boundary";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

function makeSkill(root: string, slug: string, files: Record<string, string>): string {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe("isPrivateVisibility", () => {
  test("treats team/private/internal as private and public/undefined as not", () => {
    for (const v of ["team", "private", "internal", "PRIVATE", " Team "]) {
      expect(isPrivateVisibility(v)).toBe(true);
    }
    for (const v of ["public", undefined, "", "remote", "hosted"]) {
      expect(isPrivateVisibility(v)).toBe(false);
    }
  });
});

describe("isPrivateSkillDir detects every private marker", () => {
  test("package.json skills.visibility=private", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-"));
    try {
      const dir = makeSkill(root, "fleet", {
        "package.json": JSON.stringify({ name: "fleet", skills: { visibility: "private" } }),
      });
      expect(isPrivateSkillDir(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("package.json skills.publish=false", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-"));
    try {
      const dir = makeSkill(root, "ops", {
        "package.json": JSON.stringify({ name: "ops", skills: { publish: false } }),
      });
      expect(isPrivateSkillDir(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(".private marker file", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-"));
    try {
      const dir = makeSkill(root, "secret", { ".private": "", "package.json": JSON.stringify({ name: "secret" }) });
      expect(isPrivateSkillDir(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("SKILL.md frontmatter visibility: team", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-"));
    try {
      const dir = makeSkill(root, "fronted", {
        "SKILL.md": "---\nname: fronted\nvisibility: team\n---\n\n# Fronted\n",
      });
      expect(isPrivateSkillDir(dir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a normal public skill is NOT private", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-"));
    try {
      const dir = makeSkill(root, "public-one", {
        "package.json": JSON.stringify({ name: "public-one", skills: { visibility: "public" } }),
        "SKILL.md": "---\nname: public-one\n---\n\n# Public\n",
      });
      expect(isPrivateSkillDir(dir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("hosted/remote metadata skills are not treated as private by this boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-"));
    try {
      const dir = makeSkill(root, "hosted-one", {
        "package.json": JSON.stringify({ name: "hosted-one", skills: { source: "remote", runtime: "hosted" } }),
      });
      expect(isPrivateSkillDir(dir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listPrivateSkillSlugs", () => {
  test("returns only private slugs, sorted", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-root-"));
    try {
      makeSkill(root, "zeta-private", { ".private": "" });
      makeSkill(root, "alpha-private", { "package.json": JSON.stringify({ skills: { visibility: "internal" } }) });
      makeSkill(root, "public-skill", { "package.json": JSON.stringify({ skills: { visibility: "public" } }) });
      expect(listPrivateSkillSlugs(root)).toEqual(["alpha-private", "zeta-private"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("missing skills root yields empty list", () => {
    expect(listPrivateSkillSlugs(join(tmpdir(), "does-not-exist-xyz"))).toEqual([]);
  });
});

describe("findPrivatePacklistLeaks — the enforcement primitive", () => {
  const packed = [
    "README.md",
    "package.json",
    "skills/public-one/SKILL.md",
    "skills/public-one/package.json",
    "skills/fleet-ops/SKILL.md",
    "skills/fleet-ops/scripts/run.ts",
    "skills/fleet-opsx/keep.md", // must NOT be caught by the fleet-ops prefix
  ];

  test("flags every packed file belonging to a private skill", () => {
    expect(findPrivatePacklistLeaks(packed, ["fleet-ops"])).toEqual([
      "skills/fleet-ops/SKILL.md",
      "skills/fleet-ops/scripts/run.ts",
    ]);
  });

  test("does not flag prefix-collision siblings", () => {
    expect(findPrivatePacklistLeaks(packed, ["fleet-ops"])).not.toContain("skills/fleet-opsx/keep.md");
  });

  test("returns empty when no private skill leaks", () => {
    expect(findPrivatePacklistLeaks(packed, ["not-present"])).toEqual([]);
    expect(findPrivatePacklistLeaks(packed, [])).toEqual([]);
  });

  test("catches a bare skill directory entry", () => {
    expect(findPrivatePacklistLeaks(["skills/fleet-ops"], ["fleet-ops"])).toEqual(["skills/fleet-ops"]);
  });
});
