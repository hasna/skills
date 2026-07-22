import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSkill, loadRegistry } from "./registry";
import { getSkillPath } from "./installer";
import { getSkillRequirements } from "./skillinfo";
import {
  getSkillCreditQuote,
  isPremiumSkill,
  MUSIC_ALBUM_SONG_COUNTS,
} from "./credit-catalog";

const NEW_MEDIA_SKILLS = [
  "music-album",
  "photo-album",
  "short-video-pack",
  "voiceover-jingle-pack",
  "brand-photo-shoot",
] as const;

const BASE_MEDIA_SKILLS = ["image", "audio", "music", "video"] as const;

function isHostedMetadataSkill(slug: string): boolean {
  const pkgPath = join(getSkillPath(slug), "package.json");
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { skills?: { runtime?: string; source?: string } };
  return pkg.skills?.runtime === "hosted" || pkg.skills?.source === "remote" || pkg.skills?.source === "private-hosted";
}

describe("premium media catalog", () => {
  test("routes every hosted metadata skill through premium hosted billing", () => {
    for (const skill of loadRegistry()) {
      if (!isHostedMetadataSkill(skill.name)) continue;
      expect(isPremiumSkill(skill.name), `${skill.name} hosted metadata should be premium`).toBe(true);
      expect(getSkillCreditQuote(skill.name).tier, `${skill.name} credit quote should be premium`).toBe("premium");
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

  test("describes base hosted media execution in credits only", () => {
    for (const slug of BASE_MEDIA_SKILLS) {
      const pkg = readFileSync(join(process.cwd(), "skills", slug, "package.json"), "utf8");
      const docs = readFileSync(join(process.cwd(), "skills", slug, "SKILL.md"), "utf8");
      const customerCopy = `${pkg}\n${docs}`;
      expect(customerCopy, `${slug} should describe credit quotes`).toMatch(/credit/i);
      expect(customerCopy, `${slug} should not expose provider-cost copy`).not.toMatch(/provider[- ]cost|pricing/i);
    }
    const imageReadme = readFileSync(join(process.cwd(), "skills", "image", "README.md"), "utf8");
    expect(imageReadme).toContain("skills setup --mode self-hosted --api-url https://operator.example");
  });

  test("quotes music albums in credits by allowed song count", () => {
    expect(MUSIC_ALBUM_SONG_COUNTS).toEqual([7, 14, 21]);
    expect(getSkillCreditQuote("music-album", {}, ["--songs", "7"]).credits).toBe(1050);
    expect(getSkillCreditQuote("music-album", {}, ["--songs", "14"]).credits).toBe(2100);
    expect(getSkillCreditQuote("music-album", {}, ["--songs", "21"]).credits).toBe(3150);

    expect(getSkillCreditQuote("music-album", {}, ["--songs", "14"])).toMatchObject({
      tier: "premium",
      creditUnit: "song",
      unitCount: 14,
      formattedUnitCredits: "150 credits/song",
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
