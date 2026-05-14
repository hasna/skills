import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getPublicSkillPricing } from "../platform/skills/pricing.js";
import { getSkill } from "./registry.js";
import { getSkillRequirements, runSkill } from "./skillinfo.js";

describe("blog-article premium skill", () => {
  test("documents hosted auth through the generic skill API key", () => {
    const reqs = getSkillRequirements("blog-article");
    const docs = readFileSync("skills/blog-article/SKILL.md", "utf8");
    expect(reqs?.envVars).toContain("SKILL_API_KEY");
    expect(reqs?.cliCommand).toBe("skills run blog-article");
    expect(docs).toContain("skills.blogArticle.outputs.v1");
    expect(docs).toContain("title`, `slug`, `summary`, `keywords`");
  });

  test("accepts the product create-blog-article command as an alias", () => {
    const alias = "create-blog-article";
    expect(getSkill(alias)?.name).toBe("blog-article");
    expect(getSkillRequirements(alias)?.envVars).toContain("SKILL_API_KEY");
    expect(getPublicSkillPricing(getSkill(alias)?.name || alias, { count: 8 })).toMatchObject({
      tier: "premium",
      billingUnit: "article",
      costCents: 200,
      unitCount: 8,
    });
  });

  test("writes single article artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "blog-article-single-"));
    const exportDir = join(tmp, "exports");
    try {
      const result = await runSkill("blog-article", [
        "SaaS onboarding",
        "--count",
        "1",
        "--seo",
        "--audience",
        "founders",
        "--outline",
        "Problem, workflow, rollout",
      ], {
        stdio: "pipe",
        env: {
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_blog_single",
          SKILLS_EXPORT_DIR: exportDir,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout?.toLowerCase()).not.toContain("cerebras");
      expect(result.stdout?.toLowerCase()).not.toContain("gpt-oss");
      expect(result.stdout?.toLowerCase()).not.toContain("openai");
      expect(existsSync(join(exportDir, "article.md"))).toBe(true);
      expect(existsSync(join(exportDir, "article.html"))).toBe(true);
      expect(existsSync(join(exportDir, "article.json"))).toBe(true);
      expect(existsSync(join(exportDir, "manifest.json"))).toBe(true);
      expect(existsSync(join(tmp, ".skills", "skills"))).toBe(false);

      const manifest = JSON.parse(readFileSync(join(exportDir, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "blog-article",
        runId: "run_blog_single",
        topic: "SaaS onboarding",
        audience: "founders",
        outline: "Problem, workflow, rollout",
        count: 1,
      });
      expect(manifest.articles).toHaveLength(1);
      expect(manifest.articles[0].files.markdown).toBe("article.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects invalid article counts clearly", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "blog-article-invalid-count-"));
    try {
      const result = await runSkill("blog-article", ["Product analytics", "--count", "13"], {
        stdio: "pipe",
        env: {
          SKILLS_TEST_MODE: "1",
          SKILLS_EXPORT_DIR: join(tmp, "exports"),
        },
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Count must be an integer between 1 and 12.");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("supports batch article counts up to 12", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "blog-article-batch-"));
    const exportDir = join(tmp, "exports");
    try {
      const result = await runSkill("blog-article", ["Product analytics", "--count", "12", "--length", "short"], {
        stdio: "pipe",
        env: {
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_blog_batch",
          SKILLS_RUN_COST_CENTS: "300",
          SKILLS_EXPORT_DIR: exportDir,
        },
      });

      expect(result.exitCode).toBe(0);
      const manifest = JSON.parse(readFileSync(join(exportDir, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        contract: "skills.blogArticle.outputs.v1",
        skill: "blog-article",
        runId: "run_blog_batch",
        count: 12,
        inputs: {
          prompt: "Product analytics",
          topic: "Product analytics",
          tone: "professional",
          length: "short",
          seo: false,
          count: 12,
        },
        receipt: {
          costCents: 300,
          formattedCost: "$3.00",
        },
      });
      expect(manifest.articles).toHaveLength(12);
      expect(manifest.articles[0]).toMatchObject({
        index: 1,
        title: "Product Analytics: Strategy Guide",
        slug: "product-analytics-strategy-guide",
        summary: "Product Analytics: Strategy Guide with practical guidance, examples, and next steps.",
        keywords: ["product", "analytics", "guide", "strategy"],
        featuredImage: null,
      });
      expect(existsSync(join(exportDir, "article-01-product-analytics-strategy-guide", "article.md"))).toBe(true);
      expect(existsSync(join(exportDir, "article-12-product-analytics-future-trends", "article.json"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
