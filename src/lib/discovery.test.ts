import { describe, expect, test } from "bun:test";

import { getCompactSkillDiscovery, getPublicSkillDiscovery, publicDiscoveryTags, sanitizePublicDiscoveryText } from "./discovery.js";
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
    expect(compact.description).toBe("Credit-backed skill execution.");
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
      description: "Credit-backed skill execution.",
      tags: ["image"],
      creditQuote: {
        tier: "free",
        creditUnit: "run",
        credits: 0,
        formattedCredits: "0 credits",
        estimated: false,
        quoteDependsOnInput: false,
        quoteRequired: false,
        description: "No credits required.",
      },
    });

    const image = getSkill("image");
    expect(image).toBeDefined();
    expect(JSON.stringify(image)).not.toMatch(/openai|gemini|minimax|seedance|claude-code|provider[- ]cost/i);
  });

  test("removes compound vendor and execution-routing tags", () => {
    const publicSkill = getPublicSkillDiscovery({
      name: "catalog-probe",
      displayName: "Catalog Probe",
      description: "A safe customer-facing description.",
      category: "Development Tools",
      tags: ["safe", "claude-code", "openai-sora", "provider-routing", "model-routing", "margin"],
      source: "official" as const,
    });

    expect(publicSkill.tags).toEqual(["safe", "margin"]);
  });

  test("removes separator and camel-case metadata evasions", () => {
    expect(publicDiscoveryTags([
      "open_ai",
      "Open-AI",
      "providerName",
      "routeId",
      "safe-image",
    ])).toEqual(["safe-image"]);
    expect(sanitizePublicDiscoveryText("Open-AI providerName routeId image generation"))
      .toBe("Credit-backed skill execution.");
  });

  test("preserves legitimate route and model language in prose and tags", () => {
    const description = "Build route lists and compare the financial model.";
    expect(sanitizePublicDiscoveryText(description)).toBe(description);
    expect(publicDiscoveryTags(["route", "financial-modeling", "action-item-router"]))
      .toEqual(["route", "financial-modeling", "action-item-router"]);
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
