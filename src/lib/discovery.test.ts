import { describe, expect, test } from "bun:test";

import { getCompactSkillDiscovery, getPublicSkillDiscovery, sanitizePublicDiscoveryText } from "./discovery.js";
import { getSkill, loadBasicRegistry, loadRegistryProfile } from "./registry.js";
import type { SkillMeta } from "./registry-types.js";

describe("getCompactSkillDiscovery", () => {
  test("never infers a missing remote quote as free", () => {
    const compact = getCompactSkillDiscovery({
      name: "remote-unknown",
      displayName: "Remote Unknown",
      description: "Remote skill without a quote",
      category: "Remote",
      tags: ["remote"],
      source: "remote",
      availability: { status: "unavailable" },
    });
    expect(compact.creditQuote).toBeUndefined();
  });

  test("includes name, category, credits, and a description", () => {
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
    expect(compact.creditQuote).toHaveProperty("formattedCredits");
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

  test("sanitizes the full public catalog contract, including source descriptions and tags", () => {
    const raw = {
      name: "vendor-skill",
      displayName: "Vendor Skill",
      description: "Provider-cost generation through OpenAI and Gemini models.",
      category: "Content Generation",
      tags: ["image", "openai", "gemini", "provider-cost"],
      source: "official" as const,
    };

    expect(getPublicSkillDiscovery(raw)).toEqual({
      ...raw,
      description: "Credit-backed generation through hosted AI and hosted AI models.",
      tags: ["image"],
      creditQuote: expect.any(Object),
    });

    const image = getSkill("image");
    expect(image).toBeDefined();
    expect(JSON.stringify(image)).not.toMatch(/openai|gemini|minimax|seedance|provider[- ]cost/i);
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
