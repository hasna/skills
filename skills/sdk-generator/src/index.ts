#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type AuthMode = "bearer" | "api-key" | "none";

interface SdkOptions {
  api: string;
  name: string;
  baseUrl: string;
  auth: AuthMode;
  resources: string[];
  outputDir: string;
}

interface EndpointPlan {
  resource: string;
  typeName: string;
  path: string;
  methods: Array<"list" | "get" | "create" | "update" | "delete">;
}

interface SdkFiles {
  packageJson: string;
  index: string;
  client: string;
  types: string;
  test: string;
  readme: string;
  examples: string;
  apiSummary: string;
  manifest: string;
}

const SKILL_NAME = "sdk-generator";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const DEFAULT_RESOURCES = ["users", "projects", "events"];

const HELP = `SDK Generator

Usage:
  skills run sdk-generator "Billing API for usage meters and invoices" --name "meterkit" --resources "customers,meters,invoices"
  skills run sdk-generator --api "Project management API" --base-url "https://api.example.com" --auth api-key

Options:
  --api <text>        API or product description. Positional text also works.
  --name <text>       SDK package name stem. Default: derived from API description
  --base-url <url>    Default API base URL. Default: https://api.example.com
  --auth <mode>       bearer, api-key, or none. Default: bearer
  --resources <list>  Comma-separated resource names. Default: users,projects,events
  --output <dir>      Output directory. Default: current run export directory
  --help              Show help

Outputs:
  sdk/package.json, sdk/src/index.ts, sdk/src/client.ts, sdk/src/types.ts, sdk/test/client.test.ts, sdk/README.md, usage-examples.md, api-summary.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const endpoints = buildEndpointPlan(options);
  const files = writeArtifacts(options, endpoints);

  console.log(`Generated SDK scaffold for ${options.name}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const file of Object.values(files)) {
    console.log(`- ${file}`);
  }
}

function parseCliOptions(): SdkOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      api: { type: "string" },
      name: { type: "string" },
      "base-url": { type: "string", default: "https://api.example.com" },
      auth: { type: "string", default: "bearer" },
      resources: { type: "string" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const api = String(values.api || positionals.join(" ")).trim();
  if (!api) {
    console.error("API description is required. Pass --api <text> or positional text.");
    process.exit(1);
  }

  const auth = normalizeAuth(String(values.auth || "bearer"));
  return {
    api,
    name: packageStem(String(values.name || deriveName(api))),
    baseUrl: String(values["base-url"] || "https://api.example.com").trim(),
    auth,
    resources: splitList(values.resources, DEFAULT_RESOURCES).map(packageStem),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildEndpointPlan(options: SdkOptions): EndpointPlan[] {
  return options.resources.map((resource) => ({
    resource,
    typeName: pascal(singular(resource)),
    path: `/${resource}`,
    methods: ["list", "get", "create", "update", "delete"],
  }));
}

function writeArtifacts(options: SdkOptions, endpoints: EndpointPlan[]) {
  const files: SdkFiles = {
    packageJson: "sdk/package.json",
    index: "sdk/src/index.ts",
    client: "sdk/src/client.ts",
    types: "sdk/src/types.ts",
    test: "sdk/test/client.test.ts",
    readme: "sdk/README.md",
    examples: "usage-examples.md",
    apiSummary: "api-summary.md",
    manifest: "manifest.json",
  };

  writeJson(join(options.outputDir, files.packageJson), renderPackageJson(options));
  writeFile(join(options.outputDir, files.index), renderIndexTs());
  writeFile(join(options.outputDir, files.client), renderClientTs(options, endpoints));
  writeFile(join(options.outputDir, files.types), renderTypesTs(options, endpoints));
  writeFile(join(options.outputDir, files.test), renderClientTestTs(options, endpoints));
  writeFile(join(options.outputDir, files.readme), renderReadme(options, endpoints));
  writeFile(join(options.outputDir, files.examples), renderExamples(options, endpoints));
  writeFile(join(options.outputDir, files.apiSummary), renderApiSummary(options, endpoints));
  writeJson(join(options.outputDir, files.manifest), {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      api: options.api,
      name: options.name,
      baseUrl: options.baseUrl,
      auth: options.auth,
      resources: options.resources,
    },
    endpointCount: endpoints.length * 5,
    files,
  });

  return files;
}

function renderPackageJson(options: SdkOptions) {
  return {
    name: `@example/${options.name}-sdk`,
    version: "0.1.0",
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "bun test",
      typecheck: "tsc -p tsconfig.json --noEmit",
    },
    dependencies: {},
    devDependencies: {
      typescript: "^5.7.0",
      "@types/bun": "latest",
    },
    files: ["dist", "README.md"],
  };
}

function renderIndexTs() {
  return `export { ApiClient, ApiError } from "./client";
export type {
  ApiClientOptions,
  ApiRequestOptions,
  ApiListResponse,
  ApiResourceRecord,
} from "./types";
`;
}

function renderClientTs(options: SdkOptions, endpoints: EndpointPlan[]) {
  const methods = endpoints.map((endpoint) => renderResourceMethods(endpoint)).join("\n\n");
  const authLine = authHeaderLine(options.auth);

  return `import type {
  ApiClientOptions,
  ApiListResponse,
  ApiRequestOptions,
  ApiResourceRecord,
  CreateInput,
  UpdateInput,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl || "${options.baseUrl}");
    this.token = options.token;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl || fetch;
  }

${methods}

  private async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }

    const headers = new Headers(options.headers);
    headers.set("accept", "application/json");
    if (options.body !== undefined) headers.set("content-type", "application/json");
${authLine}

    const response = await this.fetchImpl(url, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const payload = text ? safeJson(text) : undefined;
    if (!response.ok) {
      throw new ApiError(readErrorMessage(payload, response.status), response.status, payload);
    }
    return payload as T;
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\\/+$/, "");
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return \`Request failed with status \${status}\`;
}
`;
}

function renderResourceMethods(endpoint: EndpointPlan) {
  const plural = camel(endpoint.resource);
  const singularName = camel(singular(endpoint.resource));
  const typeName = endpoint.typeName;
  return `  async list${pascal(endpoint.resource)}(query?: Record<string, string | number | boolean>): Promise<ApiListResponse<${typeName}>> {
    return this.request<ApiListResponse<${typeName}>>("${endpoint.path}", { query });
  }

  async get${typeName}(id: string): Promise<${typeName}> {
    return this.request<${typeName}>(\`${endpoint.path}/\${encodeURIComponent(id)}\`);
  }

  async create${typeName}(input: CreateInput<${typeName}>): Promise<${typeName}> {
    return this.request<${typeName}>("${endpoint.path}", { method: "POST", body: input });
  }

  async update${typeName}(id: string, input: UpdateInput<${typeName}>): Promise<${typeName}> {
    return this.request<${typeName}>(\`${endpoint.path}/\${encodeURIComponent(id)}\`, { method: "PATCH", body: input });
  }

  async delete${typeName}(id: string): Promise<void> {
    await this.request<void>(\`${endpoint.path}/\${encodeURIComponent(id)}\`, { method: "DELETE" });
  }

  readonly ${plural} = {
    list: this.list${pascal(endpoint.resource)}.bind(this),
    get: this.get${typeName}.bind(this),
    create: this.create${typeName}.bind(this),
    update: this.update${typeName}.bind(this),
    delete: this.delete${typeName}.bind(this),
  };

  readonly ${singularName} = this.${plural};`;
}

function renderTypesTs(options: SdkOptions, endpoints: EndpointPlan[]) {
  const recordTypes = endpoints.map((endpoint) => renderResourceType(endpoint)).join("\n\n");
  return `export interface ApiClientOptions {
  baseUrl?: string;
  token?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  headers?: HeadersInit;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

export interface ApiListResponse<T> {
  data: T[];
  nextCursor?: string;
}

export interface ApiResourceRecord {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

export type CreateInput<T extends ApiResourceRecord> = Omit<T, "id" | "createdAt" | "updatedAt">;
export type UpdateInput<T extends ApiResourceRecord> = Partial<CreateInput<T>>;

export type AuthMode = "${options.auth}";

${recordTypes}
`;
}

function renderResourceType(endpoint: EndpointPlan) {
  return `export interface ${endpoint.typeName} extends ApiResourceRecord {
  name: string;
  status: "active" | "archived";
  metadata?: Record<string, string | number | boolean>;
}`;
}

function renderClientTestTs(options: SdkOptions, endpoints: EndpointPlan[]) {
  const first = endpoints[0] || buildEndpointPlan({ ...options, resources: ["items"] })[0];
  return `import { describe, expect, test } from "bun:test";
import { ApiClient } from "../src/client";

describe("${options.name} SDK", () => {
  test("sends list requests with auth and query params", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ApiClient({
      baseUrl: "${options.baseUrl}",
      token: "test-token",
      apiKey: "test-key",
      fetchImpl: (async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({ data: [] });
      }) as typeof fetch,
    });

    await client.list${pascal(first.resource)}({ limit: 25 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("${options.baseUrl}${first.path}?limit=25");
    expect(calls[0].init?.method).toBe("GET");
    expect(new Headers(calls[0].init?.headers).get("accept")).toBe("application/json");
  });

  test("throws ApiError for failed requests", async () => {
    const client = new ApiClient({
      baseUrl: "${options.baseUrl}",
      fetchImpl: (async () => Response.json({ error: "not found" }, { status: 404 })) as typeof fetch,
    });

    await expect(client.get${first.typeName}("missing")).rejects.toThrow("not found");
  });
});
`;
}

function renderReadme(options: SdkOptions, endpoints: EndpointPlan[]) {
  return [
    `# ${titleCase(options.name)} SDK`,
    "",
    `TypeScript SDK scaffold for ${options.api}.`,
    "",
    "## Install",
    "",
    "```bash",
    `bun add @example/${options.name}-sdk`,
    "```",
    "",
    "## Quickstart",
    "",
    "```ts",
    `import { ApiClient } from "@example/${options.name}-sdk";`,
    "",
    "const client = new ApiClient({",
    `  baseUrl: "${options.baseUrl}",`,
    options.auth === "bearer" ? '  token: process.env.API_TOKEN,' : options.auth === "api-key" ? '  apiKey: process.env.API_KEY,' : "  // No auth configured by default.",
    "});",
    "",
    `const result = await client.${camel(endpoints[0]?.resource || "items")}.list();`,
    "console.log(result.data);",
    "```",
    "",
    "## Resources",
    "",
    ...endpoints.map((endpoint) => `- \`${endpoint.path}\`: ${endpoint.methods.join(", ")}`),
    "",
    "## Next Steps",
    "",
    "- Replace placeholder types with the exact API response shapes.",
    "- Add pagination helpers if the API returns cursors.",
    "- Expand tests around errors, retries, and request payload validation.",
  ].join("\n");
}

function renderExamples(options: SdkOptions, endpoints: EndpointPlan[]) {
  const blocks = endpoints.map((endpoint) => {
    const plural = camel(endpoint.resource);
    const typeName = endpoint.typeName;
    return [
      `## ${titleCase(endpoint.resource)}`,
      "",
      "```ts",
      `const ${plural} = await client.${plural}.list({ limit: 20 });`,
      `const created${typeName} = await client.${plural}.create({`,
      `  name: "Example ${typeName}",`,
      '  status: "active",',
      "});",
      `await client.${plural}.update(created${typeName}.id, { status: "archived" });`,
      "```",
      "",
    ].join("\n");
  });

  return [
    `# Usage Examples: ${titleCase(options.name)} SDK`,
    "",
    "```ts",
    'import { ApiClient } from "./sdk/src";',
    "",
    "const client = new ApiClient({",
    `  baseUrl: "${options.baseUrl}",`,
    options.auth === "bearer" ? '  token: process.env.API_TOKEN,' : options.auth === "api-key" ? '  apiKey: process.env.API_KEY,' : "  // Add credentials here if the API later requires them.",
    "});",
    "```",
    "",
    ...blocks,
  ].join("\n");
}

function renderApiSummary(options: SdkOptions, endpoints: EndpointPlan[]) {
  return [
    `# API Summary: ${titleCase(options.name)} SDK`,
    "",
    `API brief: ${options.api}`,
    `Base URL: ${options.baseUrl}`,
    `Auth: ${options.auth}`,
    "",
    "| Resource | Path | Methods | Type |",
    "| --- | --- | --- | --- |",
    ...endpoints.map((endpoint) => `| ${endpoint.resource} | ${endpoint.path} | ${endpoint.methods.join(", ")} | ${endpoint.typeName} |`),
    "",
    "## Implementation Notes",
    "",
    "- The generated client keeps network behavior in one request helper.",
    "- Resource helpers expose both direct methods and grouped resource handles.",
    "- Tests use an injected fetch function so SDK behavior can be verified without network calls.",
    "- Package defaults are intentionally minimal so teams can add retries, validation, and release automation deliberately.",
  ].join("\n");
}

function authHeaderLine(auth: AuthMode) {
  if (auth === "bearer") {
    return `    if (this.token) headers.set("authorization", \`Bearer \${this.token}\`);`;
  }
  if (auth === "api-key") {
    return `    if (this.apiKey) headers.set("x-api-key", this.apiKey);`;
  }
  return "    // No auth header configured.";
}

function normalizeAuth(value: string): AuthMode {
  const normalized = value.toLowerCase();
  if (normalized === "api-key" || normalized === "apikey" || normalized === "key") return "api-key";
  if (normalized === "none" || normalized === "public") return "none";
  return "bearer";
}

function splitList(value: unknown, fallback: string[]) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const items = value.split(",").map((item) => packageStem(item)).filter(Boolean);
  return items.length ? items : fallback;
}

function deriveName(api: string) {
  return packageStem(api.split(/\s+/).filter(Boolean).slice(0, 3).join("-")) || "api";
}

function packageStem(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function singular(value: string) {
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("ses")) return value.slice(0, -2);
  if (value.endsWith("s") && value.length > 1) return value.slice(0, -1);
  return value;
}

function camel(value: string) {
  const words = value.split(/[^a-z0-9]+/).filter(Boolean);
  return words
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("");
}

function pascal(value: string) {
  return camel(value).replace(/^./, (char) => char.toUpperCase());
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, content: string) {
  ensureDir(dirname(path));
  writeFileSync(path, content);
}

function writeJson(path: string, value: unknown) {
  writeFile(path, JSON.stringify(value, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
