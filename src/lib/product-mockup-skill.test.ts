import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("product-mockup premium skill", () => {
  test("writes product mockup artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-product-mockup-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/product-mockup/src/index.ts",
        "--product",
        "Usage-based billing dashboard",
        "--audience",
        "founders and operators",
        "--scene",
        "homepage hero and sales deck",
        "--style",
        "quiet premium with crisp product UI",
        "--variants",
        "3",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_product_mockup_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated product mockup package");
      expect(stdout).toContain("Variants: 3");

      for (const file of [
        "manifest.json",
        "mockup-brief.md",
        "image-prompts.md",
        "scene-plan.json",
        "usage-notes.md",
        "asset-metadata.json",
        "variants/variant-01.svg",
        "variants/variant-02.svg",
        "variants/variant-03.svg",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
        expect(statSync(join(output, file)).size).toBeGreaterThan(20);
      }

      expect(readdirSync(join(output, "variants"))).toHaveLength(3);

      const brief = readFileSync(join(output, "mockup-brief.md"), "utf8");
      expect(brief).toContain("# Product Mockup Brief: Usage Based Billing Dashboard");
      expect(brief).toContain("Audience: founders and operators");
      expect(brief).toContain("Variant 1: Product Dashboard");

      const promptSheet = readFileSync(join(output, "image-prompts.md"), "utf8");
      expect(promptSheet).toContain("Create a dashboard product mockup");
      expect(promptSheet).toContain("quiet premium with crisp product UI");

      const svg = readFileSync(join(output, "variants/variant-01.svg"), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("Usage Based Billing Dashboard");

      const scenePlan = JSON.parse(readFileSync(join(output, "scene-plan.json"), "utf8"));
      expect(scenePlan.recommendedOrder).toHaveLength(3);
      expect(scenePlan.recommendedOrder[0]).toMatchObject({
        file: "variants/variant-01.svg",
        layout: "dashboard",
      });

      const assetMetadata = JSON.parse(readFileSync(join(output, "asset-metadata.json"), "utf8"));
      expect(assetMetadata.assets).toHaveLength(3);
      expect(assetMetadata.assets[0]).toMatchObject({
        file: "variants/variant-01.svg",
        dimensions: { width: 1200, height: 900 },
      });

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "product-mockup",
        runId: "run_product_mockup_test",
        input: {
          product: "Usage-based billing dashboard",
          audience: "founders and operators",
          scene: "homepage hero and sales deck",
          style: "quiet premium with crisp product UI",
          variants: 3,
        },
        variantCount: 3,
        files: {
          brief: "mockup-brief.md",
          prompts: "image-prompts.md",
          scenePlan: "scene-plan.json",
          usageNotes: "usage-notes.md",
          assetMetadata: "asset-metadata.json",
          manifest: "manifest.json",
        },
      });

      const combined = [
        stdout,
        brief,
        promptSheet,
        svg,
        readFileSync(join(output, "scene-plan.json"), "utf8"),
        readFileSync(join(output, "usage-notes.md"), "utf8"),
        readFileSync(join(output, "asset-metadata.json"), "utf8"),
        readFileSync(join(output, "manifest.json"), "utf8"),
      ].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
