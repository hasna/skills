import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("invoice-reconciliation premium skill", () => {
  test("writes reconciliation artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-invoice-reconciliation-"));
    const output = join(tmp, "exports");
    const invoices = join(tmp, "invoices.csv");
    const payments = join(tmp, "payments.csv");
    writeFileSync(invoices, [
      "invoice_id,customer,amount,due_date,status",
      "INV-100,Acme,1200,2026-05-31,open",
      "INV-101,Beta,800,2026-05-20,open",
      "INV-102,Core,500,2026-05-15,paid",
      "INV-103,Delta,300,2026-05-25,open",
    ].join("\n"));
    writeFileSync(payments, [
      "payment_id,invoice_id,customer,amount,paid_at",
      "PAY-1,INV-100,Acme,1200,2026-05-10",
      "PAY-2,INV-101,Beta,600,2026-05-11",
      "PAY-3,,Delta,300,2026-05-12",
      "PAY-4,INV-999,Unknown,75,2026-05-12",
    ].join("\n"));

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/invoice-reconciliation/src/index.ts",
        "--invoices",
        invoices,
        "--payments",
        payments,
        "--company",
        "Acme Finance",
        "--currency",
        "USD",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_invoice_reconciliation_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated invoice reconciliation package");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "reconciliation-report.md",
        "matched-invoices.csv",
        "discrepancies.csv",
        "anomalies.json",
        "summary.json",
        "manifest.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const report = readFileSync(join(output, "reconciliation-report.md"), "utf8");
      expect(report).toContain("# Invoice Reconciliation Report: Acme Finance");
      expect(report).toContain("INV-100");
      expect(report).toContain("underpaid");
      expect(report.toLowerCase()).not.toContain("cerebras");
      expect(report.toLowerCase()).not.toContain("gpt-oss");

      const discrepancies = readFileSync(join(output, "discrepancies.csv"), "utf8");
      expect(discrepancies).toContain("type,severity,invoiceId,paymentId,customer,amount,note,recommendation");
      expect(discrepancies).toContain("\"underpaid\"");
      expect(discrepancies).toContain("\"unmatched-payment\"");

      const summary = JSON.parse(readFileSync(join(output, "summary.json"), "utf8"));
      expect(summary).toMatchObject({
        skill: "invoice-reconciliation",
        runId: "run_invoice_reconciliation_test",
        company: "Acme Finance",
        currency: "USD",
        invoiceCount: 4,
        paymentCount: 4,
      });

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "invoice-reconciliation",
        runId: "run_invoice_reconciliation_test",
        input: {
          company: "Acme Finance",
          currency: "USD",
          invoiceCount: 4,
          paymentCount: 4,
        },
        files: {
          report: "reconciliation-report.md",
          matches: "matched-invoices.csv",
          discrepancies: "discrepancies.csv",
          anomalies: "anomalies.json",
          summary: "summary.json",
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
