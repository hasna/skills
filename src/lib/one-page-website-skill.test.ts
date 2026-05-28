import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("one-page-website premium skill", () => {
  test("writes a static website bundle into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-one-page-website-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/one-page-website/src/index.ts",
        "--brief",
        "Usage-based billing for AI SaaS",
        "--name",
        "MeterKit",
        "--audience",
        "founders and operators",
        "--goal",
        "book a demo",
        "--style",
        "sharp SaaS page with confident copy",
        "--proof",
        "migration benchmarks and customer quotes",
        "--sections",
        "hero,features,proof,pricing,faq,cta",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_one_page_website_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated one-page website for MeterKit");

      for (const file of [
        "manifest.json",
        "copy.md",
        "section-map.json",
        "deploy-notes.md",
        "site/index.html",
        "site/styles.css",
        "site/script.js",
        "site/README.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
        expect(statSync(join(output, file)).size).toBeGreaterThan(20);
      }

      const html = readFileSync(join(output, "site/index.html"), "utf8");
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("<title>MeterKit</title>");
      expect(html).toContain("Book A Demo");

      const css = readFileSync(join(output, "site/styles.css"), "utf8");
      expect(css).toContain(".hero");
      expect(css).toContain("@media (max-width: 820px)");

      const script = readFileSync(join(output, "site/script.js"), "utf8");
      expect(script).toContain("scrollIntoView");

      const copy = readFileSync(join(output, "copy.md"), "utf8");
      expect(copy).toContain("# Website Copy: MeterKit");
      expect(copy).toContain("Brief: Usage-based billing for AI SaaS");
      expect(copy).toContain("Audience: founders and operators");

      const sectionMap = JSON.parse(readFileSync(join(output, "section-map.json"), "utf8"));
      expect(sectionMap.sections).toHaveLength(6);
      expect(sectionMap.sections[0]).toMatchObject({
        order: 1,
        id: "hero",
        kind: "hero",
      });

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "one-page-website",
        runId: "run_one_page_website_test",
        input: {
          brief: "Usage-based billing for AI SaaS",
          name: "MeterKit",
          audience: "founders and operators",
          goal: "book a demo",
          style: "sharp SaaS page with confident copy",
          proof: "migration benchmarks and customer quotes",
          sections: ["hero", "features", "proof", "pricing", "faq", "cta"],
        },
        fileCount: 8,
        files: {
          html: "site/index.html",
          css: "site/styles.css",
          script: "site/script.js",
          readme: "site/README.md",
          copy: "copy.md",
          sectionMap: "section-map.json",
          deployNotes: "deploy-notes.md",
          manifest: "manifest.json",
        },
      });

      const combined = [
        stdout,
        html,
        css,
        script,
        copy,
        readFileSync(join(output, "site/README.md"), "utf8"),
        readFileSync(join(output, "section-map.json"), "utf8"),
        readFileSync(join(output, "deploy-notes.md"), "utf8"),
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
