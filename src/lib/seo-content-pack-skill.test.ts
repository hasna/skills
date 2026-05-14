import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("seo-content-pack premium skill", () => {
  test("writes SEO package artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-seo-content-pack-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/seo-content-pack/src/index.ts",
        "--topic",
        "usage-based billing for AI SaaS",
        "--brand",
        "Acme",
        "--audience",
        "founders and operators",
        "--articles",
        "5",
        "--tone",
        "technical",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_seo_content_pack_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated SEO content pack");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "topic-cluster.md",
        "pillar-article.md",
        "metadata.csv",
        "internal-linking-plan.md",
        "faqs.md",
        "publishing-cadence.csv",
        "supporting-articles/article-1-usage-based-billing-for-ai-saas-implementation-checklist.md",
        "supporting-articles/article-5-usage-based-billing-for-ai-saas-metrics-dashboard.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const cluster = readFileSync(join(output, "topic-cluster.md"), "utf8");
      expect(cluster).toContain("Topic Cluster");
      expect(cluster).toContain("usage-based billing for AI SaaS");

      const metadata = readFileSync(join(output, "metadata.csv"), "utf8");
      expect(metadata).toContain("meta_title");
      expect(metadata).toContain("supporting");

      const combined = [
        cluster,
        metadata,
        readFileSync(join(output, "pillar-article.md"), "utf8"),
        readFileSync(join(output, "internal-linking-plan.md"), "utf8"),
        readFileSync(join(output, "faqs.md"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "seo-content-pack",
        runId: "run_seo_content_pack_test",
        input: {
          topic: "usage-based billing for AI SaaS",
          brand: "Acme",
          audience: "founders and operators",
          articles: 5,
          tone: "technical",
        },
        articleCount: 5,
        files: {
          topicCluster: "topic-cluster.md",
          pillarArticle: "pillar-article.md",
          metadata: "metadata.csv",
          internalLinks: "internal-linking-plan.md",
          faqs: "faqs.md",
          cadence: "publishing-cadence.csv",
        },
      });
      expect(manifest.files.supportingArticles).toHaveLength(5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
