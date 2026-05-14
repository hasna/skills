import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("repo-onboarding-report premium skill", () => {
  test("writes onboarding artifacts into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-repo-onboarding-"));
    const target = join(tmp, "app");
    const output = join(tmp, "exports");
    mkdirSync(join(target, "src"), { recursive: true });
    mkdirSync(join(target, "tests"), { recursive: true });
    writeFileSync(join(target, "package.json"), JSON.stringify({
      name: "meterkit",
      type: "module",
      scripts: {
        dev: "next dev",
        test: "bun test",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        next: "16.2.6",
        react: "19.2.1",
      },
      devDependencies: {
        typescript: "5.9.3",
      },
    }, null, 2));
    writeFileSync(join(target, "README.md"), "# Meterkit\n\nBilling API dashboard.\n");
    writeFileSync(join(target, ".env.example"), "DATABASE_URL=\n");
    writeFileSync(join(target, "bun.lock"), "\n");
    writeFileSync(join(target, "src", "index.ts"), "export function main() { return 'ok'; }\n");
    writeFileSync(join(target, "tests", "billing.test.ts"), "import { test } from 'bun:test';\ntest('billing', () => {});\n");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/repo-onboarding-report/src/index.ts",
        "--target",
        target,
        "--name",
        "Meterkit",
        "--stack",
        "Next.js SaaS",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_repo_onboarding_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated repo onboarding report for Meterkit");

      for (const file of [
        "manifest.json",
        "repo-onboarding-report.md",
        "architecture-map.md",
        "setup-quickstart.md",
        "first-week-plan.md",
        "code-inventory.json",
        "risk-register.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const report = readFileSync(join(output, "repo-onboarding-report.md"), "utf8");
      expect(report).toContain("# Repo Onboarding Report");
      expect(report).toContain("Meterkit");
      expect(report).toContain("Next.js SaaS");
      expect(report).toContain("src/index.ts");

      const quickstart = readFileSync(join(output, "setup-quickstart.md"), "utf8");
      expect(quickstart).toContain("bun install");
      expect(quickstart).toContain("bun run test");
      expect(quickstart).toContain(".env.example");

      const inventory = JSON.parse(readFileSync(join(output, "code-inventory.json"), "utf8"));
      expect(inventory).toMatchObject({
        skill: "repo-onboarding-report",
        runId: "run_repo_onboarding_test",
        summary: {
          sourceDirs: ["src", "tests"],
          entrypoints: ["src/index.ts"],
        },
        package: {
          name: "meterkit",
          dependencies: ["next", "react"],
        },
      });

      const risks = JSON.parse(readFileSync(join(output, "risk-register.json"), "utf8"));
      expect(risks.skill).toBe("repo-onboarding-report");
      expect(Array.isArray(risks.risks)).toBe(true);

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "repo-onboarding-report",
        runId: "run_repo_onboarding_test",
        input: {
          target,
          name: "Meterkit",
          stack: "Next.js SaaS",
          focus: ["architecture", "setup", "testing", "risks", "first-week"],
        },
        files: {
          report: "repo-onboarding-report.md",
          architectureMap: "architecture-map.md",
          quickstart: "setup-quickstart.md",
          firstWeekPlan: "first-week-plan.md",
          inventory: "code-inventory.json",
          risks: "risk-register.json",
          manifest: "manifest.json",
        },
      });

      const combined = [
        stdout,
        report,
        quickstart,
        readFileSync(join(output, "architecture-map.md"), "utf8"),
        readFileSync(join(output, "first-week-plan.md"), "utf8"),
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
