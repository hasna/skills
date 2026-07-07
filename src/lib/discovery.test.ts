import { describe, expect, test } from "bun:test";

import { getCompactSkillDiscovery, sanitizePublicDiscoveryText } from "./discovery.js";
import { loadBasicRegistry, loadRegistryProfile } from "./registry.js";
import type { SkillMeta } from "./registry-types.js";

describe("getCompactSkillDiscovery", () => {
  test("includes name, category, pricing, and a description", () => {
    const skill: SkillMeta = {
      name: "sample-skill",
      displayName: "Sample Skill",
      description: "Does a useful thing.",
      category: "Development Tools",
      tags: ["util"],
      source: "official",
    };

    const compact = getCompactSkillDiscovery(skill);

    expect(compact).toMatchObject({
      name: "sample-skill",
      category: "Development Tools",
      description: "Does a useful thing.",
    });
    expect(compact.pricing).toHaveProperty("formattedCost");
  });

  test("sanitizes vendor terms out of the compact description", () => {
    const skill: SkillMeta = {
      name: "vendor-skill",
      displayName: "Vendor Skill",
      description: "Generate images using OpenAI DALL-E 3 and Google Gemini.",
      category: "Media Processing",
      tags: [],
      source: "official",
    };

    const compact = getCompactSkillDiscovery(skill);

    expect(compact.description).toBe(sanitizePublicDiscoveryText(skill.description));
    expect(compact.description).not.toContain("OpenAI");
    expect(compact.description).not.toContain("Gemini");
    expect(compact.description).toContain("hosted AI");
  });

  test("every basic-profile skill exposes a non-empty compact description", () => {
    const basic = loadBasicRegistry();
    expect(basic.length).toBeGreaterThan(0);
    for (const skill of basic) {
      const compact = getCompactSkillDiscovery(skill);
      expect(typeof compact.description).toBe("string");
      expect(compact.description.length).toBeGreaterThan(0);
    }
  });

  test("every full-profile skill exposes a compact description field", () => {
    for (const skill of loadRegistryProfile("all")) {
      const compact = getCompactSkillDiscovery(skill);
      expect(compact).toHaveProperty("description");
      expect(typeof compact.description).toBe("string");
    }
  });
});
