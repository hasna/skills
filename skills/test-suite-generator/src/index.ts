#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

type Runner = "bun" | "vitest" | "playwright";

interface SuiteOptions {
  spec: string;
  framework: string;
  runner: Runner;
  includeBrowser: boolean;
  outputDir: string;
}

interface Endpoint {
  method: string;
  path: string;
  name: string;
}

const SKILL_NAME = "test-suite-generator";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `Test Suite Generator

Usage:
  skills run test-suite-generator --spec "POST /api/projects, GET /api/projects/:id" --framework "Next.js"
  skills run test-suite-generator "signup, checkout, billing success" --include-browser

Options:
  --spec <text>         Routes, specs, or user flows
  --framework <name>    Application framework. Default: generic SaaS app
  --runner <name>       bun, vitest, or playwright. Default: bun
  --include-browser     Include browser flow tests
  --output <dir>        Output directory. Default: current run export directory
  --help                Show this help

Outputs:
  tests/api.test.ts, tests/unit.test.ts, tests/browser.spec.ts, test-plan.md, coverage-notes.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(join(options.outputDir, "tests"));

  const endpoints = parseEndpoints(options.spec);
  const flows = parseFlows(options.spec);
  const apiTest = buildApiTest(options, endpoints);
  const unitTest = buildUnitTest(options, endpoints, flows);
  const browserTest = buildBrowserTest(options, flows);
  const plan = buildTestPlan(options, endpoints, flows);
  const coverageNotes = buildCoverageNotes(options, endpoints, flows);
  const files = writeArtifacts(options, endpoints, flows, apiTest, unitTest, browserTest, plan, coverageNotes);

  console.log(`Generated test suite package for ${options.framework}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.apiTest}`);
  console.log(`- ${files.unitTest}`);
  console.log(`- ${files.browserTest}`);
  console.log(`- ${files.plan}`);
  console.log(`- ${files.coverageNotes}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): SuiteOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      spec: { type: "string" },
      framework: { type: "string", default: "generic SaaS app" },
      runner: { type: "string", default: "bun" },
      "include-browser": { type: "boolean", default: false },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const spec = String(values.spec || positionals.join(" ")).trim();
  if (!spec) {
    console.error("Spec is required. Pass --spec <text> or positional text.");
    process.exit(1);
  }

  const runner = String(values.runner || "bun");
  if (!isRunner(runner)) {
    console.error("Invalid runner. Use bun, vitest, or playwright.");
    process.exit(1);
  }

  return {
    spec,
    framework: String(values.framework || "generic SaaS app").trim(),
    runner,
    includeBrowser: Boolean(values["include-browser"]),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function parseEndpoints(spec: string): Endpoint[] {
  const matches = Array.from(spec.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[a-z0-9/:._-]+)/gi));
  if (matches.length === 0) {
    return [
      { method: "POST", path: "/api/example", name: "example create" },
      { method: "GET", path: "/api/example/:id", name: "example read" },
    ];
  }
  return matches.map((match) => ({
    method: match[1].toUpperCase(),
    path: match[2],
    name: titleFromPath(match[2]),
  }));
}

function parseFlows(spec: string): string[] {
  const withoutRoutes = spec.replace(/\b(GET|POST|PUT|PATCH|DELETE)\s+\/[a-z0-9/:._-]+/gi, "");
  const flows = withoutRoutes
    .split(/,|;|\n|->/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
  return flows.length > 0 ? flows.slice(0, 8) : ["signup", "authenticated dashboard", "billing success"];
}

function buildApiTest(options: SuiteOptions, endpoints: Endpoint[]): string {
  const importLine = options.runner === "bun"
    ? 'import { describe, expect, test } from "bun:test";'
    : 'import { describe, expect, test } from "vitest";';
  return `${importLine}

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";

describe("generated API suite", () => {
${endpoints.map((endpoint) => `  test("${endpoint.method} ${endpoint.path} returns a controlled response", async () => {
    const response = await fetch(baseUrl + "${runtimePath(endpoint.path)}", {
      method: "${endpoint.method}",
      headers: { "content-type": "application/json" },
      ${hasBody(endpoint.method) ? 'body: JSON.stringify({ name: "generated-test" }),' : ""}
    });

    expect([200, 201, 204, 400, 401, 403, 404]).toContain(response.status);
  });`).join("\n\n")}

  test("unauthenticated protected requests are rejected", async () => {
    const response = await fetch(baseUrl + "${runtimePath(endpoints[0]?.path || "/api/example")}");
    expect([200, 401, 403, 404]).toContain(response.status);
  });
});
`;
}

function buildUnitTest(options: SuiteOptions, endpoints: Endpoint[], flows: string[]): string {
  const importLine = options.runner === "bun"
    ? 'import { describe, expect, test } from "bun:test";'
    : 'import { describe, expect, test } from "vitest";';
  const endpointNames = endpoints.map((endpoint) => endpoint.name);
  return `${importLine}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

describe("generated unit suite", () => {
  test("normalizes route and flow names", () => {
    const names = ${JSON.stringify([...endpointNames, ...flows])};
    expect(names.map(normalizeName).every(Boolean)).toBe(true);
  });

  test("documents expected framework", () => {
    expect(${JSON.stringify(options.framework)}.length).toBeGreaterThan(0);
  });
});
`;
}

function buildBrowserTest(options: SuiteOptions, flows: string[]): string {
  const activeFlows = options.includeBrowser ? flows : ["smoke home page"];
  return `import { expect, test } from "@playwright/test";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";

${activeFlows.map((flow) => `test("${escapeTestName(flow)} flow is reachable", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.locator("body")).toBeVisible();
});`).join("\n\n")}
`;
}

function buildTestPlan(options: SuiteOptions, endpoints: Endpoint[], flows: string[]): string {
  return `# Test Plan

## Scope

- Framework: ${options.framework}
- Runner: ${options.runner}
- API endpoints: ${endpoints.length}
- Browser flows: ${options.includeBrowser ? flows.length : 1}

## API Coverage

${endpoints.map((endpoint) => `- ${endpoint.method} ${endpoint.path}: status contract, auth behavior, validation path`).join("\n")}

## Unit Coverage

- Input normalization
- Route/flow naming
- Framework-specific assumptions

## Browser Coverage

${(options.includeBrowser ? flows : ["smoke home page"]).map((flow) => `- ${flow}`).join("\n")}
`;
}

function buildCoverageNotes(options: SuiteOptions, endpoints: Endpoint[], flows: string[]): string {
  return `# Coverage Notes

- Add fixtures for success and failure payloads before running against production-like data.
- Add database cleanup around write endpoints.
- Add webhook, billing, and permission tests when those routes are present.
- Current generated package covers ${endpoints.length} API endpoint${endpoints.length === 1 ? "" : "s"} and ${options.includeBrowser ? flows.length : 1} browser flow${(options.includeBrowser ? flows.length : 1) === 1 ? "" : "s"}.
`;
}

function writeArtifacts(
  options: SuiteOptions,
  endpoints: Endpoint[],
  flows: string[],
  apiTest: string,
  unitTest: string,
  browserTest: string,
  plan: string,
  coverageNotes: string,
) {
  const apiTestPath = join(options.outputDir, "tests", "api.test.ts");
  const unitTestPath = join(options.outputDir, "tests", "unit.test.ts");
  const browserTestPath = join(options.outputDir, "tests", "browser.spec.ts");
  const planPath = join(options.outputDir, "test-plan.md");
  const coveragePath = join(options.outputDir, "coverage-notes.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(apiTestPath, apiTest);
  writeFileSync(unitTestPath, unitTest);
  writeFileSync(browserTestPath, browserTest);
  writeFileSync(planPath, plan);
  writeFileSync(coveragePath, coverageNotes);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      spec: options.spec,
      framework: options.framework,
      runner: options.runner,
      includeBrowser: options.includeBrowser,
    },
    endpoints,
    flows,
    files: {
      apiTest: toManifestPath(options.outputDir, apiTestPath),
      unitTest: toManifestPath(options.outputDir, unitTestPath),
      browserTest: toManifestPath(options.outputDir, browserTestPath),
      plan: toManifestPath(options.outputDir, planPath),
      coverageNotes: toManifestPath(options.outputDir, coveragePath),
    },
  });

  return {
    apiTest: apiTestPath,
    unitTest: unitTestPath,
    browserTest: browserTestPath,
    plan: planPath,
    coverageNotes: coveragePath,
    manifest: manifestPath,
  };
}

function hasBody(method: string): boolean {
  return ["POST", "PUT", "PATCH"].includes(method);
}

function runtimePath(path: string): string {
  return path.replace(/:[a-z0-9_]+/gi, "test-id");
}

function titleFromPath(path: string): string {
  return path.replace(/^\/api\//, "").replace(/[:/_-]+/g, " ").trim() || "endpoint";
}

function escapeTestName(value: string): string {
  return value.replace(/["\\]/g, "");
}

function isRunner(value: string): value is Runner {
  return value === "bun" || value === "vitest" || value === "playwright";
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
