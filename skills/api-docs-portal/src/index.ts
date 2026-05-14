#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

type AuthMode = "bearer" | "api-key" | "oauth" | "session" | "none";
type Theme = "light" | "slate";

interface PortalOptions {
  spec: string;
  title: string;
  baseUrl: string;
  authMode: AuthMode;
  theme: Theme;
  outputDir: string;
}

interface Endpoint {
  method: string;
  path: string;
  summary: string;
  group: string;
  operationId: string;
}

const SKILL_NAME = "api-docs-portal";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

const HELP = `API Docs Portal

Usage:
  skills run api-docs-portal --spec "GET /v1/projects, POST /v1/projects" --title "Acme API"
  skills run api-docs-portal --spec-file ./openapi.json --base-url "https://api.example.com"

Options:
  --spec <text>       OpenAPI JSON, route list, or endpoint examples
  --spec-file <path>  Read the API spec or route list from a file
  --title <text>      Portal and API title. Default: API Documentation
  --base-url <url>    Base URL used in examples. Default: https://api.example.com
  --auth <mode>       bearer, api-key, oauth, session, or none. Default: bearer
  --theme <name>      light or slate. Default: light
  --output <dir>      Output directory. Default: current run export directory
  --help              Show this help

Outputs:
  site/index.html, site/styles.css, site/endpoints.json, openapi.json, endpoint-reference.md, auth-guide.md, examples.md, README.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(join(options.outputDir, "site"));

  const endpoints = parseEndpoints(options.spec);
  const openApi = buildOpenApi(options, endpoints);
  const endpointReference = buildEndpointReference(options, endpoints);
  const authGuide = buildAuthGuide(options);
  const examples = buildExamples(options, endpoints);
  const readme = buildReadme(options, endpoints);
  const indexHtml = buildIndexHtml(options, endpoints);
  const styles = buildStyles(options.theme);
  const files = writeArtifacts(options, endpoints, {
    openApi,
    endpointReference,
    authGuide,
    examples,
    readme,
    indexHtml,
    styles,
  });

  console.log(`Generated API docs portal for ${options.title}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.indexHtml}`);
  console.log(`- ${files.styles}`);
  console.log(`- ${files.endpointsJson}`);
  console.log(`- ${files.openApi}`);
  console.log(`- ${files.endpointReference}`);
  console.log(`- ${files.authGuide}`);
  console.log(`- ${files.examples}`);
  console.log(`- ${files.readme}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): PortalOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      spec: { type: "string" },
      "spec-file": { type: "string" },
      title: { type: "string", default: "API Documentation" },
      "base-url": { type: "string", default: "https://api.example.com" },
      auth: { type: "string", default: "bearer" },
      theme: { type: "string", default: "light" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const specFromFile = values["spec-file"] ? readSpecFile(String(values["spec-file"])) : "";
  const spec = String(values.spec || specFromFile || positionals.join(" ")).trim();
  if (!spec) {
    console.error("Spec is required. Pass --spec <text>, --spec-file <path>, or positional text.");
    process.exit(1);
  }

  const authMode = String(values.auth || "bearer");
  if (!isAuthMode(authMode)) {
    console.error("Invalid auth mode. Use bearer, api-key, oauth, session, or none.");
    process.exit(1);
  }

  const theme = String(values.theme || "light");
  if (!isTheme(theme)) {
    console.error("Invalid theme. Use light or slate.");
    process.exit(1);
  }

  return {
    spec,
    title: String(values.title || "API Documentation").trim(),
    baseUrl: String(values["base-url"] || "https://api.example.com").trim().replace(/\/+$/, ""),
    authMode,
    theme,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function readSpecFile(path: string): string {
  if (!existsSync(path)) {
    console.error(`Spec file does not exist: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

function parseEndpoints(spec: string): Endpoint[] {
  const fromOpenApi = parseOpenApiEndpoints(spec);
  if (fromOpenApi.length > 0) return fromOpenApi;

  const matches = Array.from(spec.matchAll(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[a-z0-9/{}/:._-]+)/gi));
  if (matches.length > 0) {
    return uniqueEndpoints(matches.map((match) => {
      const method = match[1].toUpperCase();
      const path = normalizePath(match[2]);
      return {
        method,
        path,
        summary: summaryFromRoute(method, path),
        group: groupFromPath(path),
        operationId: operationId(method, path),
      };
    }));
  }

  return [
    {
      method: "GET",
      path: "/v1/resources",
      summary: "List resources",
      group: "resources",
      operationId: "listResources",
    },
    {
      method: "POST",
      path: "/v1/resources",
      summary: "Create a resource",
      group: "resources",
      operationId: "createResource",
    },
  ];
}

function parseOpenApiEndpoints(spec: string): Endpoint[] {
  try {
    const parsed = JSON.parse(spec) as { paths?: Record<string, Record<string, unknown>> };
    if (!parsed.paths || typeof parsed.paths !== "object") return [];
    const endpoints: Endpoint[] = [];
    for (const [path, operations] of Object.entries(parsed.paths)) {
      if (!operations || typeof operations !== "object") continue;
      for (const method of HTTP_METHODS) {
        const operation = operations[method] as { summary?: string; operationId?: string; tags?: string[] } | undefined;
        if (!operation) continue;
        const upperMethod = method.toUpperCase();
        endpoints.push({
          method: upperMethod,
          path: normalizePath(path),
          summary: operation.summary || summaryFromRoute(upperMethod, path),
          group: operation.tags?.[0] || groupFromPath(path),
          operationId: operation.operationId || operationId(upperMethod, path),
        });
      }
    }
    return uniqueEndpoints(endpoints);
  } catch {
    return [];
  }
}

function buildOpenApi(options: PortalOptions, endpoints: Endpoint[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of endpoints) {
    paths[endpoint.path] ||= {};
    paths[endpoint.path][endpoint.method.toLowerCase()] = {
      summary: endpoint.summary,
      operationId: endpoint.operationId,
      tags: [endpoint.group],
      responses: {
        "200": { description: "Successful response" },
        "400": { description: "Validation error" },
        "401": { description: "Authentication required" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: options.title,
      version: "1.0.0",
      description: `Generated reference for ${options.title}.`,
    },
    servers: [{ url: options.baseUrl }],
    paths,
  };
}

function buildEndpointReference(options: PortalOptions, endpoints: Endpoint[]): string {
  return `# ${options.title} Endpoint Reference

Base URL: \`${options.baseUrl}\`

| Method | Path | Summary | Group |
| --- | --- | --- | --- |
${endpoints.map((endpoint) => `| ${endpoint.method} | \`${endpoint.path}\` | ${cell(endpoint.summary)} | ${cell(endpoint.group)} |`).join("\n")}

${endpoints.map((endpoint) => `## ${endpoint.method} ${endpoint.path}

${endpoint.summary}

- Operation: \`${endpoint.operationId}\`
- Group: ${endpoint.group}
- Authentication: ${authLabel(options.authMode)}
- Success: \`200\` response with JSON content
- Client errors: \`400\` validation error, \`401\` authentication required, \`404\` missing resource
`).join("\n")}
`;
}

function buildAuthGuide(options: PortalOptions): string {
  const body = {
    bearer: "- Send `Authorization: Bearer <ACCESS_TOKEN>` with every protected request.\n- Rotate access tokens regularly and scope them to the smallest required permission set.",
    "api-key": "- Send `X-API-Key: <ACCESS_KEY>` with every protected request.\n- Keep access keys server-side and rotate them when team membership changes.",
    oauth: "- Send `Authorization: Bearer <ACCESS_TOKEN>` after completing the OAuth authorization flow.\n- Document required scopes near each endpoint that needs elevated access.",
    session: "- Authenticate through the application session flow before calling protected routes.\n- Use same-site cookies and CSRF protection for browser-originated writes.",
    none: "- This API does not require authentication for the documented endpoints.\n- Add rate limits and abuse controls before exposing public write routes.",
  } satisfies Record<AuthMode, string>;

  return `# Authentication Guide

Base URL: \`${options.baseUrl}\`

## Mode

${authLabel(options.authMode)}

## Request Requirements

${body[options.authMode]}

## Error Handling

- \`401\` means credentials are missing or invalid.
- \`403\` means the caller is authenticated but lacks permission for the action.
- \`429\` means the caller has exceeded the configured rate limit.
`;
}

function buildExamples(options: PortalOptions, endpoints: Endpoint[]): string {
  return `# API Examples

${endpoints.map((endpoint) => {
    const url = `${options.baseUrl}${examplePath(endpoint.path)}`;
    const bodyFlags = hasBody(endpoint.method)
      ? ' \\\n  -H "Content-Type: application/json" \\\n  -d \'{"name":"Example"}\''
      : "";
    return `## ${endpoint.method} ${endpoint.path}

### cURL

\`\`\`bash
curl -X ${endpoint.method} "${url}"${authCurlHeader(options.authMode)}${bodyFlags}
\`\`\`

### JavaScript

\`\`\`ts
const response = await fetch("${url}", {
  method: "${endpoint.method}",
  headers: {${authFetchHeader(options.authMode)}${hasBody(endpoint.method) ? '\n    "Content-Type": "application/json",' : ""}
  },${hasBody(endpoint.method) ? '\n  body: JSON.stringify({ name: "Example" }),' : ""}
});

if (!response.ok) {
  throw new Error(\`Request failed: \${response.status}\`);
}

const data = await response.json();
\`\`\`
`;
  }).join("\n")}
`;
}

function buildReadme(options: PortalOptions, endpoints: Endpoint[]): string {
  return `# ${options.title} Docs Portal

This generated package contains a static API documentation portal and markdown reference files.

## Files

- \`site/index.html\`: static portal entry point
- \`site/styles.css\`: portal styles
- \`site/endpoints.json\`: endpoint metadata used by the portal
- \`openapi.json\`: normalized OpenAPI 3.1 reference
- \`endpoint-reference.md\`: endpoint reference
- \`auth-guide.md\`: authentication and error handling
- \`examples.md\`: cURL and JavaScript examples

## Summary

- Endpoints: ${endpoints.length}
- Base URL: \`${options.baseUrl}\`
- Authentication: ${authLabel(options.authMode)}
`;
}

function buildIndexHtml(options: PortalOptions, endpoints: Endpoint[]): string {
  const grouped = groupEndpoints(endpoints);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <header class="hero">
      <p class="eyebrow">API Documentation</p>
      <h1>${escapeHtml(options.title)}</h1>
      <p class="summary">${endpoints.length} endpoints documented for <code>${escapeHtml(options.baseUrl)}</code>.</p>
    </header>
    <main>
      <section class="panel">
        <h2>Authentication</h2>
        <p>${escapeHtml(authLabel(options.authMode))}</p>
      </section>
      ${Object.entries(grouped).map(([group, groupEndpoints]) => `<section class="panel">
        <h2>${escapeHtml(titleCase(group))}</h2>
        <div class="endpoint-list">
          ${groupEndpoints.map((endpoint) => `<article class="endpoint">
            <span class="method method-${endpoint.method.toLowerCase()}">${endpoint.method}</span>
            <code>${escapeHtml(endpoint.path)}</code>
            <p>${escapeHtml(endpoint.summary)}</p>
          </article>`).join("\n")}
        </div>
      </section>`).join("\n")}
    </main>
  </body>
</html>
`;
}

function buildStyles(theme: Theme): string {
  const dark = theme === "slate";
  return `:root {
  color-scheme: ${dark ? "dark" : "light"};
  --bg: ${dark ? "#101318" : "#f7f8fb"};
  --panel: ${dark ? "#171c24" : "#ffffff"};
  --text: ${dark ? "#f4f7fb" : "#17202a"};
  --muted: ${dark ? "#a8b3c3" : "#5c6675"};
  --border: ${dark ? "#2a3341" : "#d9dee7"};
  --accent: #2478ff;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
}

.hero,
main {
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
}

.hero {
  padding: 56px 0 24px;
}

.eyebrow {
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0 0 8px;
  text-transform: uppercase;
}

h1 {
  font-size: clamp(32px, 5vw, 64px);
  line-height: 1;
  margin: 0 0 16px;
}

.summary {
  color: var(--muted);
  font-size: 18px;
  margin: 0;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 16px 0;
  padding: 24px;
}

.panel h2 {
  font-size: 20px;
  margin: 0 0 16px;
}

.endpoint-list {
  display: grid;
  gap: 12px;
}

.endpoint {
  align-items: start;
  border-top: 1px solid var(--border);
  display: grid;
  gap: 8px 12px;
  grid-template-columns: 84px minmax(0, 1fr);
  padding-top: 12px;
}

.endpoint:first-child {
  border-top: 0;
  padding-top: 0;
}

.endpoint code {
  overflow-wrap: anywhere;
}

.endpoint p {
  color: var(--muted);
  grid-column: 2;
  margin: 0;
}

.method {
  border-radius: 6px;
  color: white;
  display: inline-flex;
  font-size: 12px;
  font-weight: 800;
  justify-content: center;
  padding: 6px 8px;
}

.method-get { background: #1f7a4d; }
.method-post { background: #8a5a00; }
.method-put,
.method-patch { background: #2457b8; }
.method-delete { background: #b83232; }
.method-head,
.method-options { background: #586174; }
`;
}

function writeArtifacts(
  options: PortalOptions,
  endpoints: Endpoint[],
  content: {
    openApi: unknown;
    endpointReference: string;
    authGuide: string;
    examples: string;
    readme: string;
    indexHtml: string;
    styles: string;
  },
) {
  const indexPath = join(options.outputDir, "site", "index.html");
  const stylesPath = join(options.outputDir, "site", "styles.css");
  const endpointsPath = join(options.outputDir, "site", "endpoints.json");
  const openApiPath = join(options.outputDir, "openapi.json");
  const endpointReferencePath = join(options.outputDir, "endpoint-reference.md");
  const authGuidePath = join(options.outputDir, "auth-guide.md");
  const examplesPath = join(options.outputDir, "examples.md");
  const readmePath = join(options.outputDir, "README.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(indexPath, content.indexHtml);
  writeFileSync(stylesPath, content.styles);
  writeJson(endpointsPath, endpoints);
  writeJson(openApiPath, content.openApi);
  writeFileSync(endpointReferencePath, content.endpointReference);
  writeFileSync(authGuidePath, content.authGuide);
  writeFileSync(examplesPath, content.examples);
  writeFileSync(readmePath, content.readme);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      title: options.title,
      baseUrl: options.baseUrl,
      authMode: options.authMode,
      theme: options.theme,
    },
    endpoints,
    files: {
      indexHtml: toManifestPath(options.outputDir, indexPath),
      styles: toManifestPath(options.outputDir, stylesPath),
      endpointsJson: toManifestPath(options.outputDir, endpointsPath),
      openApi: toManifestPath(options.outputDir, openApiPath),
      endpointReference: toManifestPath(options.outputDir, endpointReferencePath),
      authGuide: toManifestPath(options.outputDir, authGuidePath),
      examples: toManifestPath(options.outputDir, examplesPath),
      readme: toManifestPath(options.outputDir, readmePath),
    },
  });

  return {
    indexHtml: indexPath,
    styles: stylesPath,
    endpointsJson: endpointsPath,
    openApi: openApiPath,
    endpointReference: endpointReferencePath,
    authGuide: authGuidePath,
    examples: examplesPath,
    readme: readmePath,
    manifest: manifestPath,
  };
}

function uniqueEndpoints(endpoints: Endpoint[]): Endpoint[] {
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.method} ${endpoint.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function summaryFromRoute(method: string, path: string): string {
  const resource = titleCase(groupFromPath(path));
  const action = {
    GET: path.includes("{") || path.includes(":") ? "Retrieve" : "List",
    POST: "Create",
    PUT: "Replace",
    PATCH: "Update",
    DELETE: "Delete",
    HEAD: "Check",
    OPTIONS: "Inspect",
  }[method] || "Call";
  return `${action} ${resource}`;
}

function groupFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean).filter((part) => !part.startsWith(":") && !part.startsWith("{"));
  return parts[1] || parts[0] || "default";
}

function operationId(method: string, path: string): string {
  const words = [method.toLowerCase(), ...path.split("/").filter(Boolean)]
    .map((part) => part.replace(/[{}:._-]+/g, " "))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  return words.map((word, index) => index === 0 ? word.toLowerCase() : titleCase(word).replace(/\s+/g, "")).join("");
}

function groupEndpoints(endpoints: Endpoint[]): Record<string, Endpoint[]> {
  return endpoints.reduce<Record<string, Endpoint[]>>((acc, endpoint) => {
    acc[endpoint.group] ||= [];
    acc[endpoint.group].push(endpoint);
    return acc;
  }, {});
}

function authLabel(mode: AuthMode): string {
  return {
    bearer: "Bearer token",
    "api-key": "API key",
    oauth: "OAuth access token",
    session: "Session cookie",
    none: "No authentication",
  }[mode];
}

function authCurlHeader(mode: AuthMode): string {
  if (mode === "bearer" || mode === "oauth") return ' \\\n  -H "Authorization: Bearer <ACCESS_TOKEN>"';
  if (mode === "api-key") return ' \\\n  -H "X-API-Key: <ACCESS_KEY>"';
  if (mode === "session") return ' \\\n  -H "Cookie: session=<SESSION_ID>"';
  return "";
}

function authFetchHeader(mode: AuthMode): string {
  if (mode === "bearer" || mode === "oauth") return '\n    Authorization: "Bearer <ACCESS_TOKEN>",';
  if (mode === "api-key") return '\n    "X-API-Key": "<ACCESS_KEY>",';
  if (mode === "session") return '\n    Cookie: "session=<SESSION_ID>",';
  return "";
}

function hasBody(method: string): boolean {
  return ["POST", "PUT", "PATCH"].includes(method);
}

function examplePath(path: string): string {
  return path.replace(/{[^}]+}/g, "example-id").replace(/:[a-z0-9_]+/gi, "example-id");
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isAuthMode(value: string): value is AuthMode {
  return value === "bearer" || value === "api-key" || value === "oauth" || value === "session" || value === "none";
}

function isTheme(value: string): value is Theme {
  return value === "light" || value === "slate";
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
