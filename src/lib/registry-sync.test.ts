import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import pkg from "../../package.json" with { type: "json" };
import { BASIC_SKILL_NAMES, SKILLS } from "./registry.js";
import {
  createRegistrySyncArtifact,
  writeRegistrySyncArtifact,
} from "./registry-sync.js";

describe("registry sync artifact", () => {
  test("creates a deterministic basic registry artifact", () => {
    const artifact = createRegistrySyncArtifact({
      profile: "basic",
      includeDocs: false,
      includeRequirements: false,
      includeValidation: false,
    });

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.source).toEqual({
      packageName: pkg.name,
      packageVersion: pkg.version,
      repository: "hasna/skills",
      profile: "basic",
    });
    expect(artifact.summary.skillCount).toBe(BASIC_SKILL_NAMES.length);
    expect(artifact.summary.validSkillCount).toBeNull();
    expect(artifact.skills.map((skill) => skill.name)).toEqual(
      [...BASIC_SKILL_NAMES].sort(),
    );
    expect(artifact.skills[0].docs).toBeUndefined();
    expect(artifact.skills[0].requirements).toBeUndefined();
    expect(artifact.skills[0].validation).toBeUndefined();
  });

  test("includes docs, requirements, validation, and provenance by default", () => {
    const artifact = createRegistrySyncArtifact({ profile: "basic" });
    const image = artifact.skills.find((skill) => skill.name === "image");

    expect(image).toBeDefined();
    expect(image?.source).toMatchObject({
      packageName: "@hasna/skills",
      packageVersion: pkg.version,
      repository: "hasna/skills",
      directory: "skills/skill-image",
    });
    expect(image?.docs?.best).toContain("Generate");
    expect(Array.isArray(image?.requirements?.envVars)).toBe(true);
    expect(image?.validation?.valid).toBe(true);
    expect(artifact.summary.invalidSkillCount).toBe(0);
  });

  test("supports the all profile", () => {
    const artifact = createRegistrySyncArtifact({
      profile: "all",
      includeDocs: false,
      includeRequirements: false,
      includeValidation: false,
    });

    expect(artifact.summary.skillCount).toBe(SKILLS.length);
    expect(artifact.skills.length).toBe(SKILLS.length);
    expect(artifact.summary.categories.length).toBeGreaterThan(1);
  });

  test("writes artifact JSON to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "registry-sync-"));
    const output = join(dir, "nested", "registry.json");
    try {
      const artifact = createRegistrySyncArtifact({
        profile: "basic",
        includeDocs: false,
        includeRequirements: false,
        includeValidation: false,
      });
      writeRegistrySyncArtifact(output, artifact);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(artifact);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
