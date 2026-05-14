import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("pdf-to-markdown premium skill", () => {
  test("writes markdown artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-pdf-markdown-"));
    const input = join(tmp, "report.pdf");
    const output = join(tmp, "exports");
    writeFileSync(input, [
      "%PDF-1.4",
      "Executive Summary",
      "The platform converted the source document into readable markdown.",
      "Name  Value  Notes",
      "Alpha  42  Imported",
      "Reference: https://skills.md/docs",
      "%EOF",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/pdf-to-markdown/src/index.ts",
        "--input",
        input,
        "--preserve-pages",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_pdf_markdown_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Converted");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of ["manifest.json", "document.md", "pages.json", "references.json"]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const markdown = readFileSync(join(output, "document.md"), "utf8");
      expect(markdown).toContain("# Report");
      expect(markdown).not.toContain("%PDF");
      expect(markdown).not.toContain("%EOF");
      expect(markdown).toContain("## Executive Summary");
      expect(markdown).toContain("| Name | Value | Notes |");
      expect(markdown).toContain("> Reference: https://skills.md/docs");
      expect(markdown.toLowerCase()).not.toContain("cerebras");
      expect(markdown.toLowerCase()).not.toContain("gpt-oss");

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "pdf-to-markdown",
        runId: "run_pdf_markdown_test",
        files: {
          markdown: "document.md",
          pages: "pages.json",
          references: "references.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
