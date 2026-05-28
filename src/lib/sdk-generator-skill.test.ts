import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("sdk-generator premium skill", () => {
  test("writes a TypeScript SDK scaffold into SKILLS_EXPORT_DIR without routing leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-sdk-generator-"));
    const output = join(tmp, "exports");

    try {
      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/sdk-generator/src/index.ts",
        "--api",
        "Billing API for usage meters and invoices",
        "--name",
        "meterkit",
        "--base-url",
        "https://api.meterkit.test",
        "--auth",
        "api-key",
        "--resources",
        "customers,meters,invoices",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_sdk_generator_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated SDK scaffold for meterkit");

      for (const file of [
        "manifest.json",
        "usage-examples.md",
        "api-summary.md",
        "sdk/package.json",
        "sdk/src/index.ts",
        "sdk/src/client.ts",
        "sdk/src/types.ts",
        "sdk/test/client.test.ts",
        "sdk/README.md",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
        expect(statSync(join(output, file)).size).toBeGreaterThan(20);
      }

      const pkg = JSON.parse(readFileSync(join(output, "sdk/package.json"), "utf8"));
      expect(pkg).toMatchObject({
        name: "@example/meterkit-sdk",
        version: "0.1.0",
        type: "module",
      });

      const client = readFileSync(join(output, "sdk/src/client.ts"), "utf8");
      expect(client).toContain("export class ApiClient");
      expect(client).toContain("headers.set(\"x-api-key\", this.apiKey)");
      expect(client).toContain("async listCustomers");
      expect(client).toContain("readonly customers");

      const types = readFileSync(join(output, "sdk/src/types.ts"), "utf8");
      expect(types).toContain("export interface Customer");
      expect(types).toContain("export interface Meter");
      expect(types).toContain("export interface Invoice");

      const testFile = readFileSync(join(output, "sdk/test/client.test.ts"), "utf8");
      expect(testFile).toContain("sends list requests with auth and query params");
      expect(testFile).toContain("https://api.meterkit.test/customers?limit=25");

      const summary = readFileSync(join(output, "api-summary.md"), "utf8");
      expect(summary).toContain("| customers | /customers | list, get, create, update, delete | Customer |");

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "sdk-generator",
        runId: "run_sdk_generator_test",
        input: {
          api: "Billing API for usage meters and invoices",
          name: "meterkit",
          baseUrl: "https://api.meterkit.test",
          auth: "api-key",
          resources: ["customers", "meters", "invoices"],
        },
        endpointCount: 15,
        files: {
          packageJson: "sdk/package.json",
          index: "sdk/src/index.ts",
          client: "sdk/src/client.ts",
          types: "sdk/src/types.ts",
          test: "sdk/test/client.test.ts",
          readme: "sdk/README.md",
          examples: "usage-examples.md",
          apiSummary: "api-summary.md",
          manifest: "manifest.json",
        },
      });

      const combined = [
        stdout,
        client,
        types,
        testFile,
        summary,
        readFileSync(join(output, "usage-examples.md"), "utf8"),
        readFileSync(join(output, "sdk/README.md"), "utf8"),
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
