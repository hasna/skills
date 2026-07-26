import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSkill } from "./registry";
import { requireHostedMetadataSlugs } from "./hosted-skill-set";
import { getSkillRequirements } from "./skillinfo";
import {
  getPublicSkillPricing,
  getSkillRunCostCents,
  isPremiumSkill,
  MUSIC_ALBUM_SONG_COUNTS,
} from "./pricing";

const NEW_MEDIA_SKILLS = [
  "music-album",
  "photo-album",
  "short-video-pack",
  "voiceover-jingle-pack",
  "brand-photo-shoot",
] as const;

describe("premium media catalog", () => {
  test("routes every hosted metadata skill through premium hosted billing", () => {
    // Iterate the authoritative hosted set rather than filtering the loaded
    // registry: the set refuses to be empty, so this can never silently check
    // nothing once the hosted directories are deleted or converted.
    const hosted = requireHostedMetadataSlugs(join(process.cwd(), "skills"));
    for (const slug of hosted) {
      expect(isPremiumSkill(slug), `${slug} hosted metadata should be premium`).toBe(true);
      expect(getPublicSkillPricing(slug).tier, `${slug} public pricing should be premium`).toBe("premium");
    }
  });

  test("registers new hosted media skills as premium remote catalog entries", () => {
    for (const slug of NEW_MEDIA_SKILLS) {
      const skill = getSkill(slug);
      expect(skill, `${slug} should be registered`).toBeDefined();
      expect(skill?.tags).toContain("premium");
      expect(skill?.tags).toContain("remote");
      expect(isPremiumSkill(slug), `${slug} should be premium`).toBe(true);
      expect(existsSync(join(process.cwd(), "skills", slug, "SKILL.md"))).toBe(true);
      expect(existsSync(join(process.cwd(), "skills", slug, "package.json"))).toBe(true);
    }
  });

  test("documents hosted auth without exposing provider keys", () => {
    for (const slug of NEW_MEDIA_SKILLS) {
      const reqs = getSkillRequirements(slug);
      expect(reqs?.envVars, `${slug} should require hosted auth`).toContain("SKILLS_API_KEY");
      expect(reqs?.envVars, `${slug} should not expose legacy hosted auth env`).not.toContain("SKILL_API_KEY");
      const docs = readFileSync(join(process.cwd(), "skills", slug, "SKILL.md"), "utf8");
      expect(docs).toContain("Hosted premium execution requires `SKILLS_API_KEY`");
      expect(docs).toContain("Provider keys stay server-side");
      expect(docs).not.toContain("OPENAI_API_KEY");
      expect(docs).not.toContain("MINIMAX_API_KEY");
      expect(docs).not.toContain("GEMINI_API_KEY");
    }
  });

  test("prices music albums by allowed song count", () => {
    expect(MUSIC_ALBUM_SONG_COUNTS).toEqual([7, 14, 21]);
    expect(getSkillRunCostCents("music-album", {}, ["--songs", "7"])).toBe(1050);
    expect(getSkillRunCostCents("music-album", {}, ["--songs", "14"])).toBe(2100);
    expect(getSkillRunCostCents("music-album", {}, ["--songs", "21"])).toBe(3150);

    expect(getPublicSkillPricing("music-album", {}, ["--songs", "14"])).toMatchObject({
      tier: "premium",
      billingUnit: "song",
      unitCount: 14,
      formattedUnitCost: "$1.50/song",
      quoteDependsOnInput: true,
      quoteRequired: true,
    });
  });

  test("documents pricing, approval, storage, and refund policy", () => {
    const policy = readFileSync(join(process.cwd(), "docs/product/premium-media-skill-policy.md"), "utf8");
    for (const phrase of [
      "`music-album`",
      "150 credits per song",
      "allowed album sizes are 7, 14, and 21 songs",
      "Require human approval",
      "Run prompt and asset moderation",
      "provider credentials",
      "manifest.json",
      "receipt.json",
      "refund unused reserved credits",
    ]) {
      expect(policy).toContain(phrase);
    }
  });
});
