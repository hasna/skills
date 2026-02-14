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
    expect(publicAPI.SKILLS.length).toBe(200);
  });

  test("CATEGORIES array is populated", () => {
    expect(Array.isArray(publicAPI.CATEGORIES)).toBe(true);
    expect(publicAPI.CATEGORIES.length).toBe(17);
  });

  test("AGENT_TARGETS array is populated", () => {
    expect(Array.isArray(publicAPI.AGENT_TARGETS)).toBe(true);
    expect(publicAPI.AGENT_TARGETS.length).toBe(3);
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

  test("key functions return expected results", () => {
    // Verify getSkill works through the public API
    const skill = publicAPI.getSkill("image");
    expect(skill).toBeDefined();
    expect(skill!.name).toBe("image");

    // Verify searchSkills works through the public API
    const results = publicAPI.searchSkills("image");
    expect(results.length).toBeGreaterThan(0);

    // Verify skillExists works through the public API
    expect(publicAPI.skillExists("image")).toBe(true);
    expect(publicAPI.skillExists("nonexistent-xyz")).toBe(false);
  });
});
