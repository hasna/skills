import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("ad-creative-pack premium skill", () => {
  test("writes paid ad artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-ad-creative-pack-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/ad-creative-pack/src/index.ts",
        "--product",
        "Usage-based billing for AI SaaS",
        "--audience",
        "founders and operators",
        "--goal",
        "book demos",
        "--offer",
        "Launch usage billing without rebuilding your billing stack",
        "--platforms",
        "Meta,Google,LinkedIn",
        "--tone",
        "technical",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_ad_creative_pack_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated ad creative pack");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "platform-copy.md",
        "ad-copy.json",
        "creative-concepts.md",
        "image-prompts.md",
        "audience-angles.csv",
        "test-matrix.csv",
        "launch-checklist.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const platformCopy = readFileSync(join(output, "platform-copy.md"), "utf8");
      expect(platformCopy).toContain("# Ad Creative Pack: Usage Based Billing For AI SaaS");
      expect(platformCopy).toContain("Meta");
      expect(platformCopy).toContain("Google");
      expect(platformCopy).toContain("LinkedIn");
      expect(platformCopy).toContain("CTA: Book a demo");

      const imagePrompts = readFileSync(join(output, "image-prompts.md"), "utf8");
      expect(imagePrompts).toContain("Before / After Workflow");
      expect(imagePrompts).toContain("no text embedded in the image");

      const testMatrix = readFileSync(join(output, "test-matrix.csv"), "utf8");
      expect(testMatrix).toContain("platform,audience_angle,copy_variant,creative_concept,primary_metric,success_signal");
      expect(testMatrix).toContain("ad_book-demos_conversion");

      const combined = [
        platformCopy,
        imagePrompts,
        testMatrix,
        readFileSync(join(output, "creative-concepts.md"), "utf8"),
        readFileSync(join(output, "audience-angles.csv"), "utf8"),
        readFileSync(join(output, "launch-checklist.md"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "ad-creative-pack",
        runId: "run_ad_creative_pack_test",
        input: {
          product: "Usage-based billing for AI SaaS",
          audience: "founders and operators",
          offer: "Launch usage billing without rebuilding your billing stack",
          goal: "book demos",
          platforms: ["Meta", "Google", "LinkedIn"],
          tone: "technical",
        },
        adCount: 6,
        conceptCount: 3,
        files: {
          platformCopy: "platform-copy.md",
          adCopy: "ad-copy.json",
          creativeConcepts: "creative-concepts.md",
          imagePrompts: "image-prompts.md",
          audienceAngles: "audience-angles.csv",
          testMatrix: "test-matrix.csv",
          launchChecklist: "launch-checklist.md",
          manifest: "manifest.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
