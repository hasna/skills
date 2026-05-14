import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("landing-page-pack premium skill", () => {
  test("writes landing page artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-landing-page-pack-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/landing-page-pack/src/index.ts",
        "--product",
        "Usage-based billing for AI SaaS",
        "--audience",
        "founders and operators",
        "--goal",
        "book demos",
        "--offer",
        "Launch usage billing without rebuilding your billing stack",
        "--proof",
        "migration benchmarks and customer quotes",
        "--sections",
        "hero,problem,solution,proof,pricing,faq,cta",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_landing_page_pack_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated landing page pack");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "landing-page.md",
        "copy-blocks.json",
        "wireframe.md",
        "preview.html",
        "style-guide.md",
        "cta-map.csv",
        "experiment-plan.md",
        "implementation-notes.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const page = readFileSync(join(output, "landing-page.md"), "utf8");
      expect(page).toContain("# Landing Page Pack: Usage Based Billing For AI SaaS");
      expect(page).toContain("Launch usage billing without rebuilding your billing stack");
      expect(page).toContain("Primary CTA: Book a demo");

      const preview = readFileSync(join(output, "preview.html"), "utf8");
      expect(preview).toContain("<!doctype html>");
      expect(preview).toContain("Usage Based Billing For AI SaaS");

      const ctaMap = readFileSync(join(output, "cta-map.csv"), "utf8");
      expect(ctaMap).toContain("section,primary_cta,secondary_cta,tracking_event");
      expect(ctaMap).toContain("landing_hero_book-a-demo");

      const combined = [
        page,
        preview,
        ctaMap,
        readFileSync(join(output, "wireframe.md"), "utf8"),
        readFileSync(join(output, "style-guide.md"), "utf8"),
        readFileSync(join(output, "experiment-plan.md"), "utf8"),
        readFileSync(join(output, "implementation-notes.md"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "landing-page-pack",
        runId: "run_landing_page_pack_test",
        input: {
          product: "Usage-based billing for AI SaaS",
          audience: "founders and operators",
          goal: "book demos",
          tone: "direct",
          sections: ["hero", "problem", "solution", "proof", "pricing", "faq", "cta"],
        },
        sectionCount: 7,
        files: {
          landingPage: "landing-page.md",
          copyBlocks: "copy-blocks.json",
          wireframe: "wireframe.md",
          preview: "preview.html",
          styleGuide: "style-guide.md",
          ctaMap: "cta-map.csv",
          experimentPlan: "experiment-plan.md",
          implementationNotes: "implementation-notes.md",
          manifest: "manifest.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
