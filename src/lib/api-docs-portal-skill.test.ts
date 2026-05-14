import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("api-docs-portal premium skill", () => {
  test("writes portal artifacts into SKILLS_EXPORT_DIR without provider leakage", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "skills-api-docs-portal-"));
    const output = join(tmp, "exports");

    try {
      const spec = JSON.stringify({
        openapi: "3.1.0",
        paths: {
          "/v1/projects": {
            get: { summary: "List projects", operationId: "listProjects", tags: ["projects"] },
            post: { summary: "Create project", operationId: "createProject", tags: ["projects"] },
          },
          "/v1/projects/{id}": {
            get: { summary: "Get project", operationId: "getProject", tags: ["projects"] },
          },
        },
      });

      const proc = Bun.spawn([
        "bun",
        "run",
        "skills/api-docs-portal/src/index.ts",
        "--spec",
        spec,
        "--title",
        "Acme API",
        "--base-url",
        "https://api.acme.test",
        "--auth",
        "bearer",
        "--theme",
        "slate",
      ], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SKILLS_TEST_MODE: "1",
          SKILLS_RUN_ID: "run_api_docs_portal_test",
          SKILLS_EXPORT_DIR: output,
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("Generated API docs portal");
      expect(stdout.toLowerCase()).not.toContain("cerebras");
      expect(stdout.toLowerCase()).not.toContain("gpt-oss");

      for (const file of [
        "manifest.json",
        "README.md",
        "openapi.json",
        "endpoint-reference.md",
        "auth-guide.md",
        "examples.md",
        "site/index.html",
        "site/styles.css",
        "site/endpoints.json",
      ]) {
        expect(existsSync(join(output, file))).toBe(true);
      }

      const endpointReference = readFileSync(join(output, "endpoint-reference.md"), "utf8");
      expect(endpointReference).toContain("GET /v1/projects");
      expect(endpointReference).toContain("POST /v1/projects");

      const portal = readFileSync(join(output, "site/index.html"), "utf8");
      expect(portal).toContain("Acme API");
      expect(portal).toContain("/v1/projects/{id}");

      const examples = readFileSync(join(output, "examples.md"), "utf8");
      expect(examples).toContain("curl -X GET");
      expect(examples).toContain("Authorization: Bearer <ACCESS_TOKEN>");

      const combined = [endpointReference, portal, examples].join("\n").toLowerCase();
      for (const hidden of ["cerebras", "gpt-oss", "openai", "anthropic", "gemini", "provider", "model"]) {
        expect(combined).not.toContain(hidden);
      }

      const manifest = JSON.parse(readFileSync(join(output, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        skill: "api-docs-portal",
        runId: "run_api_docs_portal_test",
        input: {
          title: "Acme API",
          baseUrl: "https://api.acme.test",
          authMode: "bearer",
          theme: "slate",
        },
        files: {
          indexHtml: "site/index.html",
          styles: "site/styles.css",
          endpointsJson: "site/endpoints.json",
          openApi: "openapi.json",
          endpointReference: "endpoint-reference.md",
          authGuide: "auth-guide.md",
          examples: "examples.md",
          readme: "README.md",
        },
      });
      expect(manifest.endpoints).toHaveLength(3);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
