#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { extname, join, resolve } from "path";

const VERSION = "0.1.0";

type Theme = "light" | "slate";

interface CliOptions {
  spec?: string;
  output: string;
  theme: Theme;
  baseUrl?: string;
  title?: string;
  json: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

interface ParamModel {
  name: string;
  in: string;
  required: boolean;
  description: string;
  type: string;
  enum?: string[];
  example?: string;
}

interface BodyModel {
  contentType: string;
  required: boolean;
  description: string;
  schema: SchemaField[];
  raw: unknown;
}

interface ResponseModel {
  status: string;
  description: string;
  contentType: string | null;
  schema: SchemaField[];
}

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string;
  children?: SchemaField[];
}

interface EndpointModel {
  id: string;
  method: string;
  path: string;
  operationId: string | null;
  summary: string;
  description: string;
  tags: string[];
  group: string;
  deprecated: boolean;
  parameters: ParamModel[];
  requestBody: BodyModel | null;
  responses: ResponseModel[];
  security: string[];
}

interface PortalModel {
  title: string;
  version: string;
  description: string;
  baseUrl: string;
  servers: string[];
  theme: Theme;
  generatedAt: string;
  groups: Array<{ name: string; description: string; endpoints: EndpointModel[] }>;
  endpointCount: number;
  securitySchemes: Array<{ name: string; type: string; detail: string }>;
}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/* ------------------------------------------------------------------ *
 * dependency loading
 * ------------------------------------------------------------------ */

async function loadYaml(): Promise<{ parse: (text: string) => unknown }> {
  try {
    return await import("yaml");
  } catch {
    throw new Error("Missing dependency 'yaml'. Run bun install in this skill directory.");
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function printHelp(): void {
  console.log(`api-docs-portal v${VERSION}

USAGE:
  api-docs-portal --spec <openapi.json|openapi.yaml> [options]

OPTIONS:
  -s, --spec <path>      OpenAPI 3.x or Swagger 2.0 document (JSON or YAML)
  -o, --output <dir>     Output directory (default: ./api-portal)
      --theme <name>     Portal theme: light | slate (default: light)
      --base-url <url>   Base URL shown in the portal and cURL examples
      --title <text>     Override the portal title (default: spec info.title)
      --json             Print a JSON summary on stdout
      --help             Show this help message
      --version          Show the current version

OUTPUT FILES:
  index.html             Self-contained portal (inline CSS, no external requests)
  endpoints.json         Normalized endpoint model
  reference.md           Markdown API reference

EXAMPLES:
  api-docs-portal --spec ./openapi.yaml
  api-docs-portal --spec ./openapi.json --output ./docs/api --theme slate
  api-docs-portal --spec ./openapi.yaml --base-url https://api.example.com --json
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: "./api-portal",
    theme: "light",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--spec":
      case "-s":
        options.spec = argv[++i];
        break;
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--theme": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "light" && value !== "slate") {
          throw new Error(`Invalid --theme value: ${value || "(empty)"} (expected light or slate)`);
        }
        options.theme = value;
        break;
      }
      case "--base-url":
        options.baseUrl = argv[++i];
        break;
      case "--title":
        options.title = argv[++i];
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        if (!options.spec) {
          options.spec = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.spec) throw new Error("Missing required --spec <path> argument");
  return options;
}

/* ------------------------------------------------------------------ *
 * spec loading + $ref resolution
 * ------------------------------------------------------------------ */

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

async function loadSpec(path: string): Promise<JsonObject> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new Error(`Cannot read spec file: ${path}`);
  }
  if (!fileStat.isFile()) throw new Error(`Spec path is not a file: ${path}`);

  const text = await readFile(path, "utf8");
  if (text.trim() === "") throw new Error(`Spec file is empty: ${path}`);

  const extension = extname(path).toLowerCase();
  const looksJson = extension === ".json" || text.trimStart().startsWith("{");

  let parsed: unknown;
  if (looksJson) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Spec file is not valid JSON (${path}): ${message}`);
    }
  } else {
    const yaml = await loadYaml();
    try {
      parsed = yaml.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Spec file is not valid YAML (${path}): ${message}`);
    }
  }

  if (!isObject(parsed)) throw new Error(`Spec file did not contain an object: ${path}`);
  if (!isObject(parsed.paths)) {
    throw new Error(`Spec file has no "paths" object; this does not look like an OpenAPI document: ${path}`);
  }
  return parsed;
}

/** Resolve a local `#/...` JSON pointer against the root document. */
function resolvePointer(root: JsonObject, pointer: string): unknown {
  if (!pointer.startsWith("#/")) return undefined;
  const segments = pointer
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));

  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isFinite(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!isObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function deref(root: JsonObject, node: unknown, seen: Set<string> = new Set()): unknown {
  if (Array.isArray(node)) return node.map((item) => deref(root, item, seen));
  if (!isObject(node)) return node;

  if (typeof node.$ref === "string") {
    const pointer = node.$ref;
    if (!pointer.startsWith("#/")) {
      return { ...node, "x-unresolved-ref": pointer };
    }
    if (seen.has(pointer)) return { type: "object", description: `Circular reference to ${pointer}` };
    const target = resolvePointer(root, pointer);
    if (target === undefined) return { ...node, "x-unresolved-ref": pointer };
    const nextSeen = new Set(seen);
    nextSeen.add(pointer);
    const resolved = deref(root, target, nextSeen);
    const rest = { ...node };
    delete rest.$ref;
    return isObject(resolved) ? { ...resolved, ...rest } : resolved;
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) out[key] = deref(root, value, seen);
  return out;
}

/* ------------------------------------------------------------------ *
 * schema flattening
 * ------------------------------------------------------------------ */

function schemaTypeLabel(schema: unknown): string {
  if (!isObject(schema)) return "any";
  if (typeof schema["x-unresolved-ref"] === "string") return `ref(${schema["x-unresolved-ref"]})`;

  const compose = ["oneOf", "anyOf", "allOf"] as const;
  for (const key of compose) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      const parts = branches.map((branch) => schemaTypeLabel(branch));
      return key === "allOf" ? parts.join(" & ") : parts.join(" | ");
    }
  }

  const type = asString(schema.type);
  if (type === "array") return `${schemaTypeLabel(schema.items)}[]`;
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.map((value) => asString(value)).join(" | ");
    return type ? `${type} (${values})` : values;
  }
  if (schema.format) return `${type || "string"}<${asString(schema.format)}>`;
  if (type) return type;
  if (isObject(schema.properties)) return "object";
  return "any";
}

function flattenSchema(schema: unknown, depth = 0): SchemaField[] {
  if (!isObject(schema) || depth > 3) return [];

  let target = schema;
  if (asString(schema.type) === "array" && isObject(schema.items)) target = schema.items;

  if (Array.isArray(target.allOf)) {
    const merged: SchemaField[] = [];
    for (const branch of target.allOf) merged.push(...flattenSchema(branch, depth));
    return merged;
  }

  if (!isObject(target.properties)) return [];
  const required = new Set(Array.isArray(target.required) ? target.required.map((item) => asString(item)) : []);

  return Object.entries(target.properties).map(([name, value]) => {
    const field: SchemaField = {
      name,
      type: schemaTypeLabel(value),
      required: required.has(name),
      description: isObject(value) ? asString(value.description) : "",
    };
    const children = flattenSchema(value, depth + 1);
    if (children.length > 0) field.children = children;
    return field;
  });
}

/* ------------------------------------------------------------------ *
 * endpoint model
 * ------------------------------------------------------------------ */

function firstContent(content: unknown): { contentType: string | null; media: JsonObject | null } {
  if (!isObject(content)) return { contentType: null, media: null };
  const preferred = Object.keys(content).find((key) => key.includes("json")) ?? Object.keys(content)[0];
  if (!preferred) return { contentType: null, media: null };
  const media = content[preferred];
  return { contentType: preferred, media: isObject(media) ? media : null };
}

function buildParameters(raw: unknown): ParamModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).map((parameter) => {
    const schema = isObject(parameter.schema) ? parameter.schema : parameter;
    return {
      name: asString(parameter.name, "(unnamed)"),
      in: asString(parameter.in, "query"),
      required: parameter.required === true || asString(parameter.in) === "path",
      description: asString(parameter.description),
      type: schemaTypeLabel(schema),
      enum: Array.isArray(schema.enum) ? schema.enum.map((value) => asString(value)) : undefined,
      example: parameter.example !== undefined ? asString(parameter.example) : undefined,
    };
  });
}

function buildRequestBody(operation: JsonObject): BodyModel | null {
  const body = operation.requestBody;
  if (!isObject(body)) return null;
  const { contentType, media } = firstContent(body.content);
  const schema = media?.schema;
  return {
    contentType: contentType ?? "application/json",
    required: body.required === true,
    description: asString(body.description),
    schema: flattenSchema(schema),
    raw: schema ?? null,
  };
}

function buildResponses(operation: JsonObject): ResponseModel[] {
  if (!isObject(operation.responses)) return [];
  return Object.entries(operation.responses).map(([status, value]) => {
    const response = isObject(value) ? value : {};
    const { contentType, media } = firstContent(response.content);
    return {
      status,
      description: asString(response.description),
      contentType,
      schema: flattenSchema(media?.schema),
    };
  });
}

function groupName(tags: string[], path: string): string {
  if (tags.length > 0) return tags[0];
  const segment = path.split("/").filter((part) => part && !part.startsWith("{"))[0];
  return segment ? segment.replace(/[-_]/gu, " ") : "default";
}

function buildModel(spec: JsonObject, options: CliOptions): PortalModel {
  const info = isObject(spec.info) ? spec.info : {};
  const servers = Array.isArray(spec.servers)
    ? spec.servers.filter(isObject).map((server) => asString(server.url)).filter(Boolean)
    : [];
  if (typeof spec.host === "string") {
    const scheme = Array.isArray(spec.schemes) && spec.schemes.length > 0 ? asString(spec.schemes[0]) : "https";
    servers.push(`${scheme}://${spec.host}${asString(spec.basePath)}`);
  }

  const baseUrl = options.baseUrl ?? servers[0] ?? "";
  const paths = isObject(spec.paths) ? spec.paths : {};
  const groups = new Map<string, EndpointModel[]>();
  let counter = 0;

  for (const [path, rawItem] of Object.entries(paths)) {
    if (!isObject(rawItem)) continue;
    const item = deref(spec, rawItem) as JsonObject;
    const sharedParameters = buildParameters(item.parameters);

    for (const method of METHODS) {
      const rawOperation = item[method];
      if (!isObject(rawOperation)) continue;
      const operation = rawOperation;

      const tags = Array.isArray(operation.tags) ? operation.tags.map((tag) => asString(tag)).filter(Boolean) : [];
      const group = groupName(tags, path);
      const parameters = [...sharedParameters, ...buildParameters(operation.parameters)];
      const security = Array.isArray(operation.security)
        ? operation.security.flatMap((entry) => (isObject(entry) ? Object.keys(entry) : []))
        : Array.isArray(spec.security)
          ? spec.security.flatMap((entry) => (isObject(entry) ? Object.keys(entry) : []))
          : [];

      counter += 1;
      const endpoint: EndpointModel = {
        id: `${method}-${path}`.replace(/[^a-zA-Z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").toLowerCase() || `endpoint-${counter}`,
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId ? asString(operation.operationId) : null,
        summary: asString(operation.summary) || asString(operation.operationId) || `${method.toUpperCase()} ${path}`,
        description: asString(operation.description),
        tags,
        group,
        deprecated: operation.deprecated === true,
        parameters,
        requestBody: buildRequestBody(operation),
        responses: buildResponses(operation),
        security: [...new Set(security)],
      };

      const bucket = groups.get(group);
      if (bucket) bucket.push(endpoint);
      else groups.set(group, [endpoint]);
    }
  }

  if (counter === 0) throw new Error("Spec contains no operations under \"paths\"");

  const tagDescriptions = new Map<string, string>();
  if (Array.isArray(spec.tags)) {
    for (const tag of spec.tags) {
      if (isObject(tag)) tagDescriptions.set(asString(tag.name), asString(tag.description));
    }
  }

  const components = isObject(spec.components) ? spec.components : {};
  const schemes = isObject(components.securitySchemes)
    ? components.securitySchemes
    : isObject(spec.securityDefinitions)
      ? spec.securityDefinitions
      : {};

  const securitySchemes = Object.entries(schemes)
    .filter((entry): entry is [string, JsonObject] => isObject(entry[1]))
    .map(([name, scheme]) => ({
      name,
      type: asString(scheme.type, "unknown"),
      detail: [
        scheme.scheme ? `scheme: ${asString(scheme.scheme)}` : "",
        scheme.bearerFormat ? `format: ${asString(scheme.bearerFormat)}` : "",
        scheme.in ? `in: ${asString(scheme.in)}` : "",
        scheme.name ? `name: ${asString(scheme.name)}` : "",
        asString(scheme.description),
      ]
        .filter(Boolean)
        .join(", "),
    }));

  return {
    title: options.title ?? asString(info.title, "API Documentation"),
    version: asString(info.version, "unversioned"),
    description: asString(info.description),
    baseUrl,
    servers,
    theme: options.theme,
    generatedAt: new Date().toISOString(),
    groups: [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, endpoints]) => ({
        name,
        description: tagDescriptions.get(name) ?? "",
        endpoints: endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
      })),
    endpointCount: counter,
    securitySchemes,
  };
}

/* ------------------------------------------------------------------ *
 * rendering
 * ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

const THEMES: Record<Theme, Record<string, string>> = {
  light: {
    bg: "#f7f8fa",
    surface: "#ffffff",
    text: "#1b1f24",
    muted: "#5b6472",
    border: "#e2e6ec",
    accent: "#2c5fd8",
    code: "#f2f4f7",
    sidebar: "#ffffff",
  },
  slate: {
    bg: "#11151c",
    surface: "#182029",
    text: "#e6ebf2",
    muted: "#93a1b3",
    border: "#26313d",
    accent: "#63a4ff",
    code: "#0d1219",
    sidebar: "#151c24",
  },
};

const METHOD_COLORS: Record<string, string> = {
  GET: "#1f8a4c",
  POST: "#2c5fd8",
  PUT: "#a86a12",
  PATCH: "#8a5cd6",
  DELETE: "#c2392e",
  HEAD: "#5b6472",
  OPTIONS: "#5b6472",
  TRACE: "#5b6472",
};

function renderSchemaRows(fields: SchemaField[], prefix = "", depth = 0): string {
  return fields
    .map((field) => {
      const name = prefix ? `${prefix}.${field.name}` : field.name;
      const row = `<tr${depth > 0 ? ' class="nested"' : ""}><td><code>${escapeHtml(name)}</code></td><td><span class="type">${escapeHtml(
        field.type,
      )}</span></td><td>${
        field.required ? '<span class="req">required</span>' : '<span class="opt">optional</span>'
      }</td><td>${escapeHtml(field.description)}</td></tr>`;
      return field.children ? row + renderSchemaRows(field.children, name, depth + 1) : row;
    })
    .join("");
}

function renderSchemaTable(fields: SchemaField[]): string {
  if (fields.length === 0) return "";
  return `<div class="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead><tbody>${renderSchemaRows(
    fields,
  )}</tbody></table></div>`;
}

function curlExample(endpoint: EndpointModel, baseUrl: string): string {
  const url = `${baseUrl.replace(/\/+$/u, "")}${endpoint.path}`;
  const parts = [`curl -X ${endpoint.method} "${url}"`];
  if (endpoint.security.length > 0) parts.push(`  -H "Authorization: Bearer $TOKEN"`);
  if (endpoint.requestBody) {
    parts.push(`  -H "Content-Type: ${endpoint.requestBody.contentType}"`);
    const sample = endpoint.requestBody.schema
      .slice(0, 3)
      .map((field) => `"${field.name}": "..."`)
      .join(", ");
    parts.push(`  -d '{${sample}}'`);
  }
  return parts.join(" \\\n");
}

function renderEndpoint(endpoint: EndpointModel, baseUrl: string): string {
  const paramGroups = new Map<string, ParamModel[]>();
  for (const parameter of endpoint.parameters) {
    const bucket = paramGroups.get(parameter.in);
    if (bucket) bucket.push(parameter);
    else paramGroups.set(parameter.in, [parameter]);
  }

  const params = [...paramGroups.entries()]
    .map(
      ([location, list]) => `<h4>${escapeHtml(location)} parameters</h4>
<div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th></th><th>Description</th></tr></thead><tbody>${list
        .map(
          (parameter) =>
            `<tr><td><code>${escapeHtml(parameter.name)}</code></td><td><span class="type">${escapeHtml(parameter.type)}</span></td><td>${
              parameter.required ? '<span class="req">required</span>' : '<span class="opt">optional</span>'
            }</td><td>${escapeHtml(parameter.description)}${
              parameter.enum ? ` <em>(${escapeHtml(parameter.enum.join(", "))})</em>` : ""
            }</td></tr>`,
        )
        .join("")}</tbody></table></div>`,
    )
    .join("");

  const body = endpoint.requestBody
    ? `<h4>Request body <span class="muted">(${escapeHtml(endpoint.requestBody.contentType)}${
        endpoint.requestBody.required ? ", required" : ""
      })</span></h4>${
        endpoint.requestBody.description ? `<p>${escapeHtml(endpoint.requestBody.description)}</p>` : ""
      }${renderSchemaTable(endpoint.requestBody.schema) || '<p class="muted">No object schema declared.</p>'}`
    : "";

  const responses = endpoint.responses.length
    ? `<h4>Responses</h4>${endpoint.responses
        .map(
          (response) =>
            `<div class="response"><span class="status status-${response.status.startsWith("2") ? "ok" : "err"}">${escapeHtml(
              response.status,
            )}</span> <span class="muted">${escapeHtml(response.description)}${
              response.contentType ? ` — ${escapeHtml(response.contentType)}` : ""
            }</span>${renderSchemaTable(response.schema)}</div>`,
        )
        .join("")}`
    : "";

  return `<article class="endpoint" id="${escapeHtml(endpoint.id)}">
  <header>
    <span class="method method-${escapeHtml(endpoint.method.toLowerCase())}">${escapeHtml(endpoint.method)}</span>
    <code class="path">${escapeHtml(endpoint.path)}</code>
    ${endpoint.deprecated ? '<span class="deprecated">deprecated</span>' : ""}
  </header>
  <h3>${escapeHtml(endpoint.summary)}</h3>
  ${endpoint.description ? `<p>${escapeHtml(endpoint.description)}</p>` : ""}
  ${endpoint.security.length ? `<p class="muted">Security: ${escapeHtml(endpoint.security.join(", "))}</p>` : ""}
  ${params}
  ${body}
  ${responses}
  <h4>Example</h4>
  <pre><code>${escapeHtml(curlExample(endpoint, baseUrl))}</code></pre>
</article>`;
}

function renderHtml(model: PortalModel): string {
  const palette = THEMES[model.theme];
  const methodCss = Object.entries(METHOD_COLORS)
    .map(([method, color]) => `.method-${method.toLowerCase()}{background:${color};}`)
    .join("");

  const nav = model.groups
    .map(
      (group) => `<li class="nav-group"><span>${escapeHtml(group.name)}</span><ul>${group.endpoints
        .map(
          (endpoint) =>
            `<li><a href="#${escapeHtml(endpoint.id)}"><span class="tag method-${escapeHtml(
              endpoint.method.toLowerCase(),
            )}">${escapeHtml(endpoint.method)}</span>${escapeHtml(endpoint.path)}</a></li>`,
        )
        .join("")}</ul></li>`,
    )
    .join("");

  const sections = model.groups
    .map(
      (group) => `<section class="group">
  <h2 id="group-${escapeHtml(group.name.replace(/[^a-zA-Z0-9]+/gu, "-").toLowerCase())}">${escapeHtml(group.name)}</h2>
  ${group.description ? `<p class="muted">${escapeHtml(group.description)}</p>` : ""}
  ${group.endpoints.map((endpoint) => renderEndpoint(endpoint, model.baseUrl)).join("\n")}
</section>`,
    )
    .join("\n");

  const security = model.securitySchemes.length
    ? `<section class="group"><h2 id="group-authentication">Authentication</h2>${model.securitySchemes
        .map(
          (scheme) =>
            `<p><code>${escapeHtml(scheme.name)}</code> — <strong>${escapeHtml(scheme.type)}</strong>${
              scheme.detail ? ` <span class="muted">(${escapeHtml(scheme.detail)})</span>` : ""
            }</p>`,
        )
        .join("")}</section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)} — API Reference</title>
<style>
:root{--bg:${palette.bg};--surface:${palette.surface};--text:${palette.text};--muted:${palette.muted};--border:${palette.border};--accent:${palette.accent};--code:${palette.code};--sidebar:${palette.sidebar};}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
code,pre{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;}
.layout{display:flex;min-height:100vh;align-items:flex-start;}
aside{width:290px;flex:0 0 290px;background:var(--sidebar);border-right:1px solid var(--border);padding:24px 18px;position:sticky;top:0;max-height:100vh;overflow-y:auto;}
aside h1{font-size:17px;margin:0 0 4px;}
aside .version{color:var(--muted);font-size:12px;margin-bottom:18px;display:block;}
aside ul{list-style:none;margin:0;padding:0;}
aside .nav-group>span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px;}
aside a{display:flex;gap:8px;align-items:center;color:var(--text);text-decoration:none;font-size:13px;padding:3px 6px;border-radius:5px;word-break:break-all;}
aside a:hover{background:var(--code);color:var(--accent);}
main{flex:1;padding:32px 40px 80px;max-width:1000px;min-width:0;}
.intro{margin-bottom:32px;}
.intro h1{margin:0 0 6px;font-size:28px;}
.base-url{display:inline-block;background:var(--code);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:13px;}
.group{margin-bottom:40px;}
.group>h2{font-size:22px;border-bottom:1px solid var(--border);padding-bottom:8px;text-transform:capitalize;}
.endpoint{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin:18px 0;}
.endpoint header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.endpoint h3{margin:12px 0 4px;font-size:16px;}
.endpoint h4{margin:18px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}
.method,.tag{color:#fff;border-radius:4px;font-size:11px;font-weight:700;padding:2px 7px;letter-spacing:.04em;}
.tag{min-width:52px;text-align:center;}
${methodCss}
.path{font-size:14px;word-break:break-all;}
.deprecated{background:#c2392e;color:#fff;border-radius:4px;font-size:11px;padding:2px 7px;}
.muted{color:var(--muted);}
.table-wrap{overflow-x:auto;}
table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 4px;}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:top;}
th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;}
tr.nested td:first-child{padding-left:22px;}
.type{color:var(--accent);font-family:ui-monospace,monospace;font-size:12px;}
.req{color:#c2392e;font-size:11px;text-transform:uppercase;letter-spacing:.05em;}
.opt{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;}
.response{margin:10px 0;}
.status{border-radius:4px;padding:2px 8px;font-size:12px;font-weight:700;color:#fff;}
.status-ok{background:#1f8a4c;}
.status-err{background:#c2392e;}
pre{background:var(--code);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow-x:auto;font-size:12.5px;}
footer{color:var(--muted);font-size:12px;border-top:1px solid var(--border);padding-top:14px;}
@media (max-width:860px){.layout{flex-direction:column;}aside{width:100%;flex:none;position:static;max-height:none;border-right:none;border-bottom:1px solid var(--border);}main{padding:24px 18px 60px;}}
</style>
</head>
<body>
<div class="layout">
<aside>
  <h1>${escapeHtml(model.title)}</h1>
  <span class="version">v${escapeHtml(model.version)} · ${model.endpointCount} endpoints</span>
  <ul>${nav}</ul>
</aside>
<main>
  <div class="intro">
    <h1>${escapeHtml(model.title)}</h1>
    ${model.description ? `<p>${escapeHtml(model.description)}</p>` : ""}
    ${model.baseUrl ? `<p><span class="base-url">${escapeHtml(model.baseUrl)}</span></p>` : ""}
  </div>
  ${security}
  ${sections}
  <footer>Generated by api-docs-portal v${VERSION} on ${escapeHtml(model.generatedAt)}. Static, self-contained, no external requests.</footer>
</main>
</div>
</body>
</html>
`;
}

function renderMarkdown(model: PortalModel): string {
  const lines: string[] = [];
  lines.push(`# ${model.title}`, "");
  lines.push(`Version: ${model.version}`);
  if (model.baseUrl) lines.push(`Base URL: \`${model.baseUrl}\``);
  lines.push(`Endpoints: ${model.endpointCount}`, "");
  if (model.description) lines.push(model.description, "");

  if (model.securitySchemes.length > 0) {
    lines.push("## Authentication", "");
    for (const scheme of model.securitySchemes) {
      lines.push(`- \`${scheme.name}\` — ${scheme.type}${scheme.detail ? ` (${scheme.detail})` : ""}`);
    }
    lines.push("");
  }

  for (const group of model.groups) {
    lines.push(`## ${group.name}`, "");
    if (group.description) lines.push(group.description, "");
    for (const endpoint of group.endpoints) {
      lines.push(`### ${endpoint.method} ${endpoint.path}`, "");
      if (endpoint.summary) lines.push(`${endpoint.summary}${endpoint.deprecated ? " **(deprecated)**" : ""}`, "");
      if (endpoint.description) lines.push(endpoint.description, "");
      if (endpoint.security.length > 0) lines.push(`Security: ${endpoint.security.join(", ")}`, "");

      if (endpoint.parameters.length > 0) {
        lines.push("| Parameter | In | Type | Required | Description |");
        lines.push("|-----------|----|------|----------|-------------|");
        for (const parameter of endpoint.parameters) {
          lines.push(
            `| \`${parameter.name}\` | ${parameter.in} | ${parameter.type} | ${parameter.required ? "yes" : "no"} | ${parameter.description.replace(/\|/gu, "\\|")} |`,
          );
        }
        lines.push("");
      }

      if (endpoint.requestBody) {
        lines.push(`Request body (\`${endpoint.requestBody.contentType}\`${endpoint.requestBody.required ? ", required" : ""}):`, "");
        if (endpoint.requestBody.schema.length > 0) {
          lines.push("| Field | Type | Required | Description |");
          lines.push("|-------|------|----------|-------------|");
          for (const field of endpoint.requestBody.schema) {
            lines.push(`| \`${field.name}\` | ${field.type} | ${field.required ? "yes" : "no"} | ${field.description.replace(/\|/gu, "\\|")} |`);
          }
          lines.push("");
        } else {
          lines.push("_No object schema declared._", "");
        }
      }

      if (endpoint.responses.length > 0) {
        lines.push("Responses:", "");
        for (const response of endpoint.responses) {
          const fields = response.schema.map((field) => `\`${field.name}\` (${field.type})`).join(", ");
          lines.push(
            `- **${response.status}** ${response.description}${response.contentType ? ` — ${response.contentType}` : ""}${fields ? ` — ${fields}` : ""}`,
          );
        }
        lines.push("");
      }

      lines.push("```bash", curlExample(endpoint, model.baseUrl), "```", "");
    }
  }

  lines.push(`_Generated by api-docs-portal v${VERSION} on ${model.generatedAt}._`);
  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const specPath = resolve(options.spec!);
  const outputDir = resolve(options.output);

  const spec = await loadSpec(specPath);
  const model = buildModel(spec, options);

  await mkdir(outputDir, { recursive: true });
  const files: string[] = [];
  const write = async (name: string, content: string) => {
    await writeFile(join(outputDir, name), content, "utf8");
    files.push(name);
  };

  await write("index.html", renderHtml(model));
  await write(
    "endpoints.json",
    `${JSON.stringify(
      {
        title: model.title,
        version: model.version,
        baseUrl: model.baseUrl,
        servers: model.servers,
        generatedAt: model.generatedAt,
        securitySchemes: model.securitySchemes,
        endpoints: model.groups.flatMap((group) => group.endpoints),
      },
      null,
      2,
    )}\n`,
  );
  await write("reference.md", renderMarkdown(model));

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          spec: specPath,
          outputDir,
          title: model.title,
          version: model.version,
          theme: model.theme,
          baseUrl: model.baseUrl,
          endpointCount: model.endpointCount,
          groups: model.groups.map((group) => ({ name: group.name, endpoints: group.endpoints.length })),
          files,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  console.log(`api-docs-portal: ${specPath}`);
  console.log(`  title      ${model.title} v${model.version}`);
  console.log(`  base url   ${model.baseUrl || "(none declared)"}`);
  console.log(`  theme      ${model.theme}`);
  console.log(`  endpoints  ${model.endpointCount} in ${model.groups.length} groups`);
  for (const group of model.groups) console.log(`    ${group.name}: ${group.endpoints.length}`);
  console.log(`  output     ${outputDir}`);
  console.log(`  files      ${files.join(", ")}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`api-docs-portal: ${message}\n`);
  process.exit(1);
});
