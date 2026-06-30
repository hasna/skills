import { describe, test, expect } from "bun:test";
import * as publicAPI from "./index";

describe("public API exports", () => {
  test("all named exports from src/index.ts are defined (not undefined)", () => {
    const undefinedExports: string[] = [];
    for (const [key, value] of Object.entries(publicAPI)) {
      if (value === undefined) {
        undefinedExports.push(key);
      }
    }
    expect(undefinedExports).toEqual([]);
  });

  test("SKILLS array is populated", () => {
    expect(Array.isArray(publicAPI.SKILLS)).toBe(true);
    expect(publicAPI.SKILLS.length).toBeGreaterThan(200);
  });

  test("CATEGORIES array is populated", () => {
    expect(Array.isArray(publicAPI.CATEGORIES)).toBe(true);
    expect(publicAPI.CATEGORIES.length).toBe(17);
  });

  test("BASIC_SKILL_NAMES array is populated", () => {
    expect(Array.isArray(publicAPI.BASIC_SKILL_NAMES)).toBe(true);
    expect(publicAPI.BASIC_SKILL_NAMES.length).toBe(17);
  });

  test("AGENT_TARGETS array is populated", () => {
    expect(Array.isArray(publicAPI.AGENT_TARGETS)).toBe(true);
    expect(publicAPI.AGENT_TARGETS.length).toBe(7);
  });

  test("getSkill is a function", () => {
    expect(typeof publicAPI.getSkill).toBe("function");
  });

  test("getSkillsByCategory is a function", () => {
    expect(typeof publicAPI.getSkillsByCategory).toBe("function");
  });

  test("searchSkills is a function", () => {
    expect(typeof publicAPI.searchSkills).toBe("function");
  });

  test("basic registry helpers are exported", () => {
    expect(typeof publicAPI.loadBasicRegistry).toBe("function");
    expect(typeof publicAPI.loadRegistryProfile).toBe("function");
    expect(typeof publicAPI.isBasicSkillName).toBe("function");
  });

  test("installSkill is a function", () => {
    expect(typeof publicAPI.installSkill).toBe("function");
  });

  test("installSkills is a function", () => {
    expect(typeof publicAPI.installSkills).toBe("function");
  });

  test("installSkillForAgent is a function", () => {
    expect(typeof publicAPI.installSkillForAgent).toBe("function");
  });

  test("removeSkillForAgent is a function", () => {
    expect(typeof publicAPI.removeSkillForAgent).toBe("function");
  });

  test("getInstalledSkills is a function", () => {
    expect(typeof publicAPI.getInstalledSkills).toBe("function");
  });

  test("removeSkill is a function", () => {
    expect(typeof publicAPI.removeSkill).toBe("function");
  });

  test("skillExists is a function", () => {
    expect(typeof publicAPI.skillExists).toBe("function");
  });

  test("getSkillPath is a function", () => {
    expect(typeof publicAPI.getSkillPath).toBe("function");
  });

  test("getAgentSkillsDir is a function", () => {
    expect(typeof publicAPI.getAgentSkillsDir).toBe("function");
  });

  test("getAgentSkillPath is a function", () => {
    expect(typeof publicAPI.getAgentSkillPath).toBe("function");
  });

  test("getSkillDocs is a function", () => {
    expect(typeof publicAPI.getSkillDocs).toBe("function");
  });

  test("getSkillBestDoc is a function", () => {
    expect(typeof publicAPI.getSkillBestDoc).toBe("function");
  });

  test("getSkillRequirements is a function", () => {
    expect(typeof publicAPI.getSkillRequirements).toBe("function");
  });

  test("runSkill is a function", () => {
    expect(typeof publicAPI.runSkill).toBe("function");
  });

  test("generateEnvExample is a function", () => {
    expect(typeof publicAPI.generateEnvExample).toBe("function");
  });

  test("generateSkillMd is a function", () => {
    expect(typeof publicAPI.generateSkillMd).toBe("function");
  });

  test("MCP contract helpers are exported", () => {
    expect(typeof publicAPI.createMcpContractManifest).toBe("function");
    expect(typeof publicAPI.createSkillMcpMetadata).toBe("function");
    expect(typeof publicAPI.describeMcpToolContracts).toBe("function");
    expect(typeof publicAPI.listMcpToolContracts).toBe("function");
    expect(typeof publicAPI.getMcpResourceContracts).toBe("function");
  });

  test("native storage helpers are exported for wrappers", () => {
    expect(publicAPI.STORAGE_TABLES).toEqual(["skills_sync_records", "skills_sync_cursors"]);
    expect(publicAPI.SKILLS_STORAGE_ENV.databaseUrl).toBe("HASNA_SKILLS_DATABASE_URL");
    expect(publicAPI.SKILLS_STORAGE_FALLBACK_ENV.databaseUrl).toBe("SKILLS_DATABASE_URL");
    expect(typeof publicAPI.resolveStorageConfig).toBe("function");
    expect(typeof publicAPI.getStorageStatus).toBe("function");
    expect(typeof publicAPI.getStorageDatabaseUrl).toBe("function");
    expect(typeof publicAPI.getSkillsStorageStatus).toBe("function");
  });

  test("native storage helpers are available from the storage subpath source", async () => {
    const storage = await import("./storage.js");

    expect(storage.STORAGE_TABLES).toEqual(["skills_sync_records", "skills_sync_cursors"]);
    expect(storage.SKILLS_STORAGE_ENV.databaseUrl).toBe("HASNA_SKILLS_DATABASE_URL");
    expect(storage.SKILLS_STORAGE_FALLBACK_ENV.databaseUrl).toBe("SKILLS_DATABASE_URL");
    expect(typeof storage.resolveStorageConfig).toBe("function");
    expect(typeof storage.getStorageStatus).toBe("function");
    expect(typeof storage.createSkillsPostgresSyncStore).toBe("function");
    expect(typeof storage.createSkillsS3ObjectStore).toBe("function");
  });

  test("key functions return expected results", () => {
    // Verify getSkill works through the public API
    const skill = publicAPI.getSkill("image");
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("image");

    // Verify searchSkills works through the public API
    const results = publicAPI.searchSkills("image");
    expect(results.length).toBeGreaterThan(0);

    // Verify clean basic profile works through the public API
    const basic = publicAPI.loadRegistryProfile("basic");
    expect(basic.filter((s) => s.source !== "custom").map((s) => s.name)).toEqual([...publicAPI.BASIC_SKILL_NAMES]);
    expect(publicAPI.isBasicSkillName("image")).toBe(true);
    expect(publicAPI.isBasicSkillName("deepresearch")).toBe(false);

    // Verify skillExists works through the public API
    expect(publicAPI.skillExists("image")).toBe(true);
    expect(publicAPI.skillExists("nonexistent-xyz")).toBe(false);
  });
});
