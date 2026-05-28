import { describe, test, expect } from "bun:test";
import { normalizeSkillName } from "./utils";

describe("utils", () => {
  describe("normalizeSkillName", () => {
    test("preserves bare skill names", () => {
      expect(normalizeSkillName("deepresearch")).toBe("deepresearch");
    });

    test("does not strip legacy skill- prefixes", () => {
      expect(normalizeSkillName("skill-deepresearch")).toBe("skill-deepresearch");
    });

    test("handles empty string", () => {
      expect(normalizeSkillName("")).toBe("");
    });

    test("handles name with hyphens", () => {
      expect(normalizeSkillName("api-test-suite")).toBe("api-test-suite");
    });

    test("handles name that starts with 'skill' but not 'skill-'", () => {
      expect(normalizeSkillName("skillful")).toBe("skillful");
    });

    test("preserves image name", () => {
      expect(normalizeSkillName("image")).toBe("image");
    });
  });
});
