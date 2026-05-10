import { describe, test, expect } from "bun:test";
import { normalizeSkillName } from "./utils";

describe("utils", () => {
  describe("normalizeSkillName", () => {
    test("keeps bare names unchanged", () => {
      expect(normalizeSkillName("deepresearch")).toBe("deepresearch");
    });

    test("does not normalize legacy skill-prefixed names", () => {
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

    test("keeps image unchanged", () => {
      expect(normalizeSkillName("image")).toBe("image");
    });
  });
});
