import { describe, test, expect } from "bun:test";
import { normalizeSkillName } from "./utils";

describe("utils", () => {
  describe("normalizeSkillName", () => {
    test("adds skill- prefix when missing", () => {
      expect(normalizeSkillName("deepresearch")).toBe("skill-deepresearch");
    });

    test("does not double-prefix when already has skill-", () => {
      expect(normalizeSkillName("skill-deepresearch")).toBe("skill-deepresearch");
    });

    test("handles empty string", () => {
      expect(normalizeSkillName("")).toBe("skill-");
    });

    test("handles name with hyphens", () => {
      expect(normalizeSkillName("api-test-suite")).toBe("skill-api-test-suite");
    });

    test("handles name that starts with 'skill' but not 'skill-'", () => {
      expect(normalizeSkillName("skillful")).toBe("skill-skillful");
    });

    test("preserves exact prefix 'skill-'", () => {
      expect(normalizeSkillName("skill-image")).toBe("skill-image");
    });
  });
});
