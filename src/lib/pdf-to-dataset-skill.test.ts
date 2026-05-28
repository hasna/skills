import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("pdf-to-dataset premium skill", () => {
  test("writes dataset artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-pdf-dataset-"));
    const input = join(tmp, "invoice.pdf");
    const output = join(tmp, "exports");
    writeFileSync(input, [
      "%PDF-1.4",
      "Invoice Number: INV-2042",
      "Date: 2026-05-10",
      "Vendor: Example Studio",
      "Total: $2,500.00",
      "Item  Quantity  Amount",
      "Design  2  1200.00",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/pdf-to-dataset/src/index.ts",
        "--input",
        input,
        "--schema",
        "invoice_number,date,total,vendor",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_pdf_dataset_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Extracted");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of ["manifest.json", "dataset.json", "dataset.csv", "schema.json", "extraction-report.md"]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "pdf-to-dataset",
        runId: "run_pdf_dataset_test",
      });
      expect(manifest.files).toMatchObject({
        datasetJson: "dataset.json",
        datasetCsv: "dataset.csv",
        schemaJson: "schema.json",
        report: "extraction-report.md",
      });

      const dataset = JSON.parse(readFileSync(join(output, "dataset.json"), "utf8"));
      expect(dataset.rows.some((row: { field: string; value: string }) => row.field === "invoice_number" && row.value.includes("INV-2042"))).toBe(true);
      expect(JSON.stringify(dataset).toLowerCase()).not.toContain("cerebras");
      expect(JSON.stringify(dataset).toLowerCase()).not.toContain("gpt-oss");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
