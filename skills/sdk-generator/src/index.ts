#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, extname, join, resolve } from "path";

const VERSION = "0.1.0";

type AuthMode = "bearer" | "api-key" | "none";

interface CliOptions {
  spec?: string;
  resources?: string[];
  name?: string;
  baseUrl?: string;
  auth: AuthMode;
  output: string;
  json: boolean;
}

interface PropertyDef {
  name: string;
  tsType: string;
  optional: boolean;
  description?: string;
}

interface TypeDef {
  name: string;
  description?: string;
  properties: PropertyDef[];
  /** Set when the schema is an alias (enum, array, primitive) rather than an object. */
  alias?: string;
  additionalProperties: boolean;
}

interface OperationParam {
  name: string;
  argName: string;
  tsType: string;
  required: boolean;
  description?: string;
}

interface Operation {
  methodName: string;
  httpMethod: string;
  pathTemplate: string;
  summary?: string;
  pathParams: OperationParam[];
  queryParams: OperationParam[];
  bodyType?: string;
  responseType: string;
}

interface ResourceDef {
  key: string;
  fileName: string;
  className: string;
  propertyName: string;
  operations: Operation[];
}

interface ApiModel {
  packageName: string;
  clientClassName: string;
  title: string;
  apiVersion: string;
  description: string;
  baseUrl: string;
  auth: AuthMode;
  source: "openapi" | "resources";
  specFile?: string;
  types: TypeDef[];
  resources: ResourceDef[];
}

/* -------------------------------------------------------------------------- */
/* Lazy optional dependencies                                                  */
/* -------------------------------------------------------------------------- */

async function loadYaml() {
  try {
    return (await import("yaml")).default;
  } catch {
    throw new Error("Missing dependency 'yaml'. Run bun install in this skill directory.");
  }
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

function printHelp(): void {
  console.log(`sdk-generator v${VERSION}

USAGE:
  sdk-generator --spec <openapi.json|openapi.yaml> [options]
  sdk-generator --resources users,orders [options]

OPTIONS:
  -s, --spec <path>        OpenAPI 3 / Swagger 2 document (JSON or YAML)
  -r, --resources <list>   Comma-separated resource names (CRUD scaffold mode)
  -n, --name <pkg>         Generated package name (default: derived from spec/resources)
  -b, --base-url <url>     Default API base URL (default: spec server or https://api.example.com)
  -a, --auth <mode>        bearer | api-key | none (default: bearer)
  -o, --output <dir>       Output directory (default: ./sdk)
      --json               Print the manifest as JSON instead of a text summary
  -h, --help               Show this help message
  -v, --version            Show the current version

EXAMPLES:
  sdk-generator --spec ./openapi.yaml --name petstore --auth api-key
  sdk-generator --resources customers,meters,invoices --name meterkit --output ./out
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    auth: "bearer",
    output: "./sdk",
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
      case "--resources":
      case "-r":
        options.resources = (argv[++i] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--name":
      case "-n":
        options.name = argv[++i];
        break;
      case "--base-url":
      case "-b":
        options.baseUrl = argv[++i];
        break;
      case "--auth":
      case "-a": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "bearer" && value !== "api-key" && value !== "none") {
          throw new Error(`Invalid --auth value: ${value}. Use bearer, api-key, or none.`);
        }
        options.auth = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? "./sdk";
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.spec && !options.resources) {
          options.spec = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.spec && (!options.resources || options.resources.length === 0)) {
    throw new Error("Provide either --spec <file> or --resources <list>. See --help.");
  }

  return options;
}

/* -------------------------------------------------------------------------- */
/* Naming helpers                                                              */
/* -------------------------------------------------------------------------- */

const TS_RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import",
  "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "let", "static", "yield", "await", "implements",
  "interface", "package", "private", "protected", "public",
]);

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function pascalCase(value: string): string {
  const parts = words(value);
  if (parts.length === 0) return "Resource";
  const joined = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("");
  return /^[0-9]/.test(joined) ? `N${joined}` : joined;
}

function camelCase(value: string): string {
  const pascal = pascalCase(value);
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return TS_RESERVED.has(camel) ? `${camel}_` : camel;
}

function kebabCase(value: string): string {
  const parts = words(value).map((part) => part.toLowerCase());
  return parts.length > 0 ? parts.join("-") : "sdk";
}

function singularize(value: string): string {
  const lower = value;
  if (/ies$/i.test(lower)) return `${lower.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/i.test(lower)) return lower.slice(0, -2);
  if (/ss$/i.test(lower)) return lower;
  if (/s$/i.test(lower)) return lower.slice(0, -1);
  return lower;
}

function safePropertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function uniqueName(base: string, taken: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Spec loading                                                                */
/* -------------------------------------------------------------------------- */

type Json = Record<string, any>;

async function loadSpec(path: string): Promise<Json> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`Unable to read spec file: ${path}`);
  }

  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    try {
      return JSON.parse(raw) as Json;
    } catch (error) {
      throw new Error(`Spec is not valid JSON: ${(error as Error).message}`);
    }
  }

  try {
    return JSON.parse(raw) as Json;
  } catch {
    const yaml = await loadYaml();
    const parsed = yaml.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Spec did not parse into an object: ${path}`);
    }
    return parsed as Json;
  }
}

/* -------------------------------------------------------------------------- */
/* JSON Schema -> TypeScript                                                   */
/* -------------------------------------------------------------------------- */

function refToTypeName(ref: string): string {
  const parts = ref.split("/");
  return pascalCase(parts[parts.length - 1] ?? "Unknown");
}

function schemaToTsType(schema: Json | undefined, depth = 0): string {
  if (!schema || typeof schema !== "object" || depth > 6) return "unknown";

  if (typeof schema.$ref === "string") return refToTypeName(schema.$ref);

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum
      .map((value: unknown) => (typeof value === "string" ? JSON.stringify(value) : String(value)))
      .join(" | ");
  }

  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const variants = (schema.oneOf ?? schema.anyOf) as Json[];
    const rendered = variants.map((variant) => schemaToTsType(variant, depth + 1));
    return rendered.length > 0 ? Array.from(new Set(rendered)).join(" | ") : "unknown";
  }

  if (Array.isArray(schema.allOf)) {
    const rendered = (schema.allOf as Json[]).map((variant) => schemaToTsType(variant, depth + 1));
    const usable = rendered.filter((value) => value !== "unknown");
    return usable.length > 0 ? usable.join(" & ") : "unknown";
  }

  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type;

  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `Array<${schemaToTsType(schema.items, depth + 1)}>`;
    case "object":
    case undefined: {
      if (schema.properties && typeof schema.properties === "object") {
        const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
        const entries = Object.entries(schema.properties as Json).map(([key, value]) => {
          const optional = required.has(key) ? "" : "?";
          return `${safePropertyKey(key)}${optional}: ${schemaToTsType(value as Json, depth + 1)}`;
        });
        return entries.length > 0 ? `{ ${entries.join("; ")} }` : "Record<string, unknown>";
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `Record<string, ${schemaToTsType(schema.additionalProperties as Json, depth + 1)}>`;
      }
      return "Record<string, unknown>";
    }
    default:
      return "unknown";
  }
}

function schemaToTypeDef(name: string, schema: Json): TypeDef {
  const description = typeof schema.description === "string" ? schema.description : undefined;
  const isObject =
    schema.type === "object" ||
    (schema.type === undefined && schema.properties && !schema.enum && !schema.oneOf && !schema.anyOf);

  if (!isObject || !schema.properties) {
    return {
      name,
      description,
      properties: [],
      alias: schemaToTsType(schema),
      additionalProperties: false,
    };
  }

  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const properties: PropertyDef[] = Object.entries(schema.properties as Json).map(([key, value]) => {
    const propSchema = value as Json;
    return {
      name: key,
      tsType: schemaToTsType(propSchema),
      optional: !required.has(key),
      description: typeof propSchema.description === "string" ? propSchema.description : undefined,
    };
  });

  return {
    name,
    description,
    properties,
    additionalProperties: schema.additionalProperties === true,
  };
}

/* -------------------------------------------------------------------------- */
/* OpenAPI -> model                                                            */
/* -------------------------------------------------------------------------- */

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];

function resourceKeyForPath(path: string, operation: Json): string {
  const tag = Array.isArray(operation.tags) && operation.tags.length > 0 ? String(operation.tags[0]) : undefined;
  if (tag) return tag;
  const segment = path.split("/").filter((part) => part && !part.startsWith("{"))[0];
  return segment ?? "default";
}

function operationMethodName(
  path: string,
  httpMethod: string,
  operation: Json,
  resourceKey: string,
  taken: Set<string>,
): string {
  if (typeof operation.operationId === "string" && operation.operationId.trim()) {
    const resourceWords = words(resourceKey).map((word) => word.toLowerCase());
    const idWords = words(operation.operationId);
    const trimmed = idWords.filter((word, index) => {
      if (index === 0) return true;
      return !resourceWords.includes(word.toLowerCase()) || index === idWords.length - 1;
    });
    const base = camelCase(trimmed.join(" ") || operation.operationId);
    return uniqueName(base, taken);
  }

  const segments = path.split("/").filter(Boolean);
  const trailing = segments[segments.length - 1] ?? "";
  const hasPathParam = trailing.startsWith("{");
  const staticTail = segments
    .slice(1)
    .filter((segment) => !segment.startsWith("{"))
    .join(" ");

  let base: string;
  if (httpMethod === "get") base = hasPathParam ? "get" : "list";
  else if (httpMethod === "post") base = "create";
  else if (httpMethod === "put") base = "replace";
  else if (httpMethod === "patch") base = "update";
  else if (httpMethod === "delete") base = "remove";
  else base = httpMethod;

  const name = camelCase(staticTail ? `${base} ${staticTail}` : base);
  return uniqueName(name, taken);
}

function collectParameters(entries: Json[], resolveRef: (ref: string) => Json | undefined) {
  const pathParams: OperationParam[] = [];
  const queryParams: OperationParam[] = [];
  // A parameter may be declared on the path item and overridden on the operation.
  // Emitting both would produce duplicate function arguments, so keep one per name+location.
  const seen = new Set<string>();

  for (const entry of entries) {
    const param = typeof entry?.$ref === "string" ? resolveRef(entry.$ref) ?? {} : entry;
    if (!param || typeof param.name !== "string") continue;
    const key = `${param.in}:${param.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tsType = schemaToTsType(param.schema ?? { type: param.type });
    const record: OperationParam = {
      name: param.name,
      argName: camelCase(param.name),
      tsType: tsType === "unknown" ? "string" : tsType,
      required: param.required === true,
      description: typeof param.description === "string" ? param.description : undefined,
    };
    if (param.in === "path") {
      record.required = true;
      pathParams.push(record);
    } else if (param.in === "query") {
      queryParams.push(record);
    }
  }

  return { pathParams, queryParams };
}

function successResponseType(operation: Json): string {
  const responses = (operation.responses ?? {}) as Json;
  const codes = Object.keys(responses).filter((code) => /^2\d\d$/.test(code));
  const code = codes.sort()[0] ?? (responses.default ? "default" : undefined);
  if (!code) return "void";

  const response = responses[code] as Json | undefined;
  if (!response) return "void";

  const content = response.content as Json | undefined;
  if (content) {
    const jsonKey = Object.keys(content).find((key) => key.includes("json")) ?? Object.keys(content)[0];
    if (jsonKey && content[jsonKey]?.schema) {
      return schemaToTsType(content[jsonKey].schema as Json);
    }
    return "void";
  }

  if (response.schema) return schemaToTsType(response.schema as Json);
  return "void";
}

function requestBodyType(operation: Json, resolveRef: (ref: string) => Json | undefined): string | undefined {
  const body = operation.requestBody as Json | undefined;
  if (body) {
    const resolved = typeof body.$ref === "string" ? resolveRef(body.$ref) ?? {} : body;
    const content = resolved.content as Json | undefined;
    if (!content) return undefined;
    const jsonKey = Object.keys(content).find((key) => key.includes("json")) ?? Object.keys(content)[0];
    if (jsonKey && content[jsonKey]?.schema) return schemaToTsType(content[jsonKey].schema as Json);
    return "unknown";
  }

  const swaggerBody = (operation.parameters as Json[] | undefined)?.find((param) => param?.in === "body");
  if (swaggerBody?.schema) return schemaToTsType(swaggerBody.schema as Json);
  return undefined;
}

function buildModelFromSpec(spec: Json, options: CliOptions): ApiModel {
  const info = (spec.info ?? {}) as Json;
  const title = typeof info.title === "string" && info.title.trim() ? info.title.trim() : "API";
  const apiVersion = typeof info.version === "string" ? info.version : "1.0.0";
  const description =
    typeof info.description === "string" && info.description.trim()
      ? info.description.trim().split("\n")[0]
      : `TypeScript SDK for ${title}.`;

  const componentSchemas = ((spec.components as Json | undefined)?.schemas ?? spec.definitions ?? {}) as Json;
  const resolveRef = (ref: string): Json | undefined => {
    const parts = ref.replace(/^#\//, "").split("/");
    let cursor: any = spec;
    for (const part of parts) {
      if (cursor && typeof cursor === "object" && part in cursor) cursor = cursor[part];
      else return undefined;
    }
    return cursor as Json;
  };

  const takenTypeNames = new Set<string>(["ListResponse", "RequestOptions", "ClientOptions"]);
  const types: TypeDef[] = Object.entries(componentSchemas).map(([schemaName, schema]) =>
    schemaToTypeDef(uniqueName(pascalCase(schemaName), takenTypeNames), schema as Json),
  );

  const specBaseUrl = (() => {
    const servers = spec.servers as Json[] | undefined;
    if (Array.isArray(servers) && servers.length > 0 && typeof servers[0]?.url === "string") {
      return servers[0].url as string;
    }
    if (typeof spec.host === "string") {
      const scheme = Array.isArray(spec.schemes) && spec.schemes.length > 0 ? spec.schemes[0] : "https";
      return `${scheme}://${spec.host}${typeof spec.basePath === "string" ? spec.basePath : ""}`;
    }
    return undefined;
  })();

  const grouped = new Map<string, ResourceDef>();
  const paths = (spec.paths ?? {}) as Json;

  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = pathItemRaw as Json;
    if (!pathItem || typeof pathItem !== "object") continue;
    const sharedParams = (pathItem.parameters as Json[] | undefined) ?? [];

    for (const httpMethod of HTTP_METHODS) {
      const operation = pathItem[httpMethod] as Json | undefined;
      if (!operation || typeof operation !== "object") continue;

      const key = resourceKeyForPath(path, operation);
      let resource = grouped.get(key);
      if (!resource) {
        resource = {
          key,
          fileName: kebabCase(key),
          className: `${pascalCase(key)}Resource`,
          propertyName: camelCase(key),
          operations: [],
        };
        grouped.set(key, resource);
      }

      const taken = new Set(resource.operations.map((op) => op.methodName));
      const allParams = [...sharedParams, ...((operation.parameters as Json[] | undefined) ?? [])];
      const { pathParams, queryParams } = collectParameters(allParams, resolveRef);

      resource.operations.push({
        methodName: operationMethodName(path, httpMethod, operation, key, taken),
        httpMethod: httpMethod.toUpperCase(),
        pathTemplate: path,
        summary:
          typeof operation.summary === "string"
            ? operation.summary
            : typeof operation.description === "string"
              ? operation.description.split("\n")[0]
              : undefined,
        pathParams,
        queryParams,
        bodyType: requestBodyType(operation, resolveRef),
        responseType: successResponseType(operation),
      });
    }
  }

  if (grouped.size === 0) {
    throw new Error("Spec contains no operations under `paths`. Nothing to generate.");
  }

  const packageName = kebabCase(options.name ?? title);

  return {
    packageName,
    clientClassName: `${pascalCase(packageName)}Client`,
    title,
    apiVersion,
    description,
    baseUrl: options.baseUrl ?? specBaseUrl ?? "https://api.example.com",
    auth: options.auth,
    source: "openapi",
    specFile: options.spec ? resolve(options.spec) : undefined,
    types,
    resources: Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/* -------------------------------------------------------------------------- */
/* Resource list -> model                                                      */
/* -------------------------------------------------------------------------- */

function buildModelFromResources(resourceNames: string[], options: CliOptions): ApiModel {
  const takenTypeNames = new Set<string>(["ListResponse", "RequestOptions", "ClientOptions"]);
  const types: TypeDef[] = [];
  const resources: ResourceDef[] = [];

  for (const raw of resourceNames) {
    const key = raw;
    const entity = uniqueName(pascalCase(singularize(key)), takenTypeNames);
    const createInput = uniqueName(`${entity}CreateInput`, takenTypeNames);
    const updateInput = uniqueName(`${entity}UpdateInput`, takenTypeNames);
    const listParams = uniqueName(`${entity}ListParams`, takenTypeNames);

    types.push({
      name: entity,
      description: `A single ${singularize(key)} record.`,
      properties: [
        { name: "id", tsType: "string", optional: false, description: "Unique identifier." },
        { name: "createdAt", tsType: "string", optional: true, description: "ISO 8601 creation timestamp." },
        { name: "updatedAt", tsType: "string", optional: true, description: "ISO 8601 update timestamp." },
      ],
      additionalProperties: true,
    });

    types.push({
      name: createInput,
      description: `Payload accepted when creating a ${singularize(key)}.`,
      properties: [],
      additionalProperties: true,
    });

    types.push({
      name: updateInput,
      description: `Partial payload accepted when updating a ${singularize(key)}.`,
      properties: [],
      additionalProperties: true,
    });

    types.push({
      name: listParams,
      description: `Query parameters accepted by the ${key} list endpoint.`,
      properties: [
        { name: "limit", tsType: "number", optional: true, description: "Maximum number of records to return." },
        { name: "cursor", tsType: "string", optional: true, description: "Opaque pagination cursor." },
      ],
      additionalProperties: true,
    });

    const basePath = `/${kebabCase(key)}`;
    resources.push({
      key,
      fileName: kebabCase(key),
      className: `${pascalCase(key)}Resource`,
      propertyName: camelCase(key),
      operations: [
        {
          methodName: "list",
          httpMethod: "GET",
          pathTemplate: basePath,
          summary: `List ${key}.`,
          pathParams: [],
          queryParams: [
            { name: "limit", argName: "limit", tsType: "number", required: false },
            { name: "cursor", argName: "cursor", tsType: "string", required: false },
          ],
          responseType: `ListResponse<${entity}>`,
        },
        {
          methodName: "get",
          httpMethod: "GET",
          pathTemplate: `${basePath}/{id}`,
          summary: `Fetch a single ${singularize(key)} by id.`,
          pathParams: [{ name: "id", argName: "id", tsType: "string", required: true }],
          queryParams: [],
          responseType: entity,
        },
        {
          methodName: "create",
          httpMethod: "POST",
          pathTemplate: basePath,
          summary: `Create a ${singularize(key)}.`,
          pathParams: [],
          queryParams: [],
          bodyType: createInput,
          responseType: entity,
        },
        {
          methodName: "update",
          httpMethod: "PATCH",
          pathTemplate: `${basePath}/{id}`,
          summary: `Update a ${singularize(key)}.`,
          pathParams: [{ name: "id", argName: "id", tsType: "string", required: true }],
          queryParams: [],
          bodyType: updateInput,
          responseType: entity,
        },
        {
          methodName: "remove",
          httpMethod: "DELETE",
          pathTemplate: `${basePath}/{id}`,
          summary: `Delete a ${singularize(key)}.`,
          pathParams: [{ name: "id", argName: "id", tsType: "string", required: true }],
          queryParams: [],
          responseType: "void",
        },
      ],
    });
  }

  const packageName = kebabCase(options.name ?? `${resourceNames[0]} sdk`);

  return {
    packageName,
    clientClassName: `${pascalCase(packageName)}Client`,
    title: options.name ?? packageName,
    apiVersion: "1.0.0",
    description: `TypeScript SDK covering ${resourceNames.join(", ")}.`,
    baseUrl: options.baseUrl ?? "https://api.example.com",
    auth: options.auth,
    source: "resources",
    types,
    resources,
  };
}

/* -------------------------------------------------------------------------- */
/* Code generation                                                             */
/* -------------------------------------------------------------------------- */

function docComment(lines: Array<string | undefined>, indent = ""): string[] {
  const usable = lines.filter((line): line is string => Boolean(line && line.trim()));
  if (usable.length === 0) return [];
  if (usable.length === 1) return [`${indent}/** ${usable[0].replace(/\*\//g, "*\\/")} */`];
  return [
    `${indent}/**`,
    ...usable.map((line) => `${indent} * ${line.replace(/\*\//g, "*\\/")}`),
    `${indent} */`,
  ];
}

function renderTypes(model: ApiModel): string {
  const out: string[] = [
    `// Generated by sdk-generator v${VERSION}. Edit freely once generated.`,
    "",
    "/** Envelope returned by list endpoints. */",
    "export interface ListResponse<T> {",
    "  data: T[];",
    "  nextCursor?: string | null;",
    "  hasMore?: boolean;",
    "  total?: number;",
    "}",
    "",
  ];

  for (const type of model.types) {
    out.push(...docComment([type.description]));
    if (type.alias) {
      out.push(`export type ${type.name} = ${type.alias};`, "");
      continue;
    }
    out.push(`export interface ${type.name} {`);
    for (const property of type.properties) {
      out.push(...docComment([property.description], "  "));
      out.push(`  ${safePropertyKey(property.name)}${property.optional ? "?" : ""}: ${property.tsType};`);
    }
    if (type.additionalProperties || type.properties.length === 0) {
      out.push("  [key: string]: unknown;");
    }
    out.push("}", "");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

function authHeaderLines(auth: AuthMode): string[] {
  if (auth === "bearer") {
    return [
      "    if (this.apiKey) {",
      '      headers["Authorization"] = "Bearer " + this.apiKey;',
      "    }",
    ];
  }
  if (auth === "api-key") {
    return [
      "    if (this.apiKey) {",
      '      headers["X-API-Key"] = this.apiKey;',
      "    }",
    ];
  }
  return ["    // Auth mode: none. No credential header is attached."];
}

function renderClient(model: ApiModel): string {
  const authNote =
    model.auth === "none"
      ? "This API is generated with `--auth none`; no credential header is sent."
      : model.auth === "bearer"
        ? "Credentials are sent as `Authorization: Bearer <apiKey>`."
        : "Credentials are sent as `X-API-Key: <apiKey>`.";

  return `// Generated by sdk-generator v${VERSION}. Edit freely once generated.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Options accepted by the HTTP client and the top-level SDK client. */
export interface ClientOptions {
  /** Base URL for every request. Defaults to ${JSON.stringify(model.baseUrl)}. */
  baseUrl?: string;
  /** API credential. ${authNote} */
  apiKey?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Maximum retry attempts for 429 and 5xx responses. Defaults to 2. */
  maxRetries?: number;
  /** Base delay used for exponential backoff, in milliseconds. Defaults to 250. */
  retryBaseDelayMs?: number;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Injectable fetch implementation. Defaults to globalThis.fetch. */
  fetch?: FetchLike;
}

export interface RequestOptions {
  method?: string;
  path: string;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Overrides the client-level retry budget for a single call. */
  maxRetries?: number;
}

/** Error thrown for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body: unknown;
  readonly requestId: string | undefined;

  constructor(params: {
    message: string;
    status: number;
    statusText: string;
    url: string;
    body: unknown;
    requestId?: string | undefined;
  }) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.statusText = params.statusText;
    this.url = params.url;
    this.body = params.body;
    this.requestId = params.requestId;
  }

  /** True when the failure is worth retrying (rate limits and server errors). */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) params.append(key, String(item));
      }
      continue;
    }
    params.append(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? "?" + rendered : "";
}

/** Minimal fetch wrapper with auth, timeout, retry, and typed errors. */
export class HttpClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;

  private readonly apiKey: string | undefined;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? ${JSON.stringify(model.baseUrl)}).replace(/\\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.apiKey = options.apiKey;
    this.extraHeaders = options.headers ?? {};
    const fallback = globalThis.fetch as FetchLike | undefined;
    if (!options.fetch && !fallback) {
      throw new Error("No fetch implementation available. Pass options.fetch.");
    }
    this.fetchImpl = options.fetch ?? (fallback as FetchLike);
  }

  private buildHeaders(extra: Record<string, string> | undefined, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (hasBody) headers["Content-Type"] = "application/json";
${authHeaderLines(model.auth).join("\n")}
    Object.assign(headers, this.extraHeaders, extra ?? {});
    return headers;
  }

  private retryDelay(attempt: number, response: Response | undefined): number {
    const retryAfter = response?.headers?.get?.("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
    const exponential = this.retryBaseDelayMs * Math.pow(2, attempt);
    return exponential + Math.floor(Math.random() * this.retryBaseDelayMs);
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.baseUrl + options.path + buildQuery(options.query);
    const hasBody = options.body !== undefined && options.body !== null;
    const headers = this.buildHeaders(options.headers, hasBody);
    const budget = options.maxRetries ?? this.maxRetries;
    let lastError: unknown;

    for (let attempt = 0; attempt <= budget; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener("abort", onAbort);

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method ?? "GET",
          headers,
          body: hasBody ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted || attempt >= budget) throw error;
        await sleep(this.retryDelay(attempt, undefined));
        continue;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      }

      const rawBody = await response.text().catch(() => "");
      let parsedBody: unknown = rawBody;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
      } catch {
        parsedBody = rawBody;
      }

      const error = new ApiError({
        message:
          "Request failed with status " + response.status + " " + response.statusText + " (" + url + ")",
        status: response.status,
        statusText: response.statusText,
        url,
        body: parsedBody,
        requestId: response.headers?.get?.("x-request-id") ?? undefined,
      });

      if (RETRYABLE_STATUS.has(response.status) && attempt < budget) {
        lastError = error;
        await sleep(this.retryDelay(attempt, response));
        continue;
      }

      throw error;
    }

    throw lastError instanceof Error ? lastError : new Error("Request failed after retries: " + url);
  }

  get<T>(path: string, query?: Record<string, unknown>, options: Partial<RequestOptions> = {}): Promise<T> {
    return this.request<T>({ ...options, method: "GET", path, query });
  }

  post<T>(path: string, body?: unknown, options: Partial<RequestOptions> = {}): Promise<T> {
    return this.request<T>({ ...options, method: "POST", path, body });
  }

  patch<T>(path: string, body?: unknown, options: Partial<RequestOptions> = {}): Promise<T> {
    return this.request<T>({ ...options, method: "PATCH", path, body });
  }

  put<T>(path: string, body?: unknown, options: Partial<RequestOptions> = {}): Promise<T> {
    return this.request<T>({ ...options, method: "PUT", path, body });
  }

  delete<T>(path: string, options: Partial<RequestOptions> = {}): Promise<T> {
    return this.request<T>({ ...options, method: "DELETE", path });
  }
}
`;
}

function renderPathExpression(operation: Operation): string {
  if (operation.pathParams.length === 0) return JSON.stringify(operation.pathTemplate);

  const parts: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(operation.pathTemplate)) !== null) {
    const literal = operation.pathTemplate.slice(cursor, match.index);
    if (literal) parts.push(JSON.stringify(literal));
    const param = operation.pathParams.find((candidate) => candidate.name === match![1]);
    const argName = param ? param.argName : camelCase(match[1]);
    parts.push(`encodeURIComponent(String(${argName}))`);
    cursor = match.index + match[0].length;
  }

  const tail = operation.pathTemplate.slice(cursor);
  if (tail) parts.push(JSON.stringify(tail));
  return parts.join(" + ");
}

function renderResource(model: ApiModel, resource: ResourceDef): string {
  const typeNames = new Set(model.types.map((type) => type.name));
  const referenced = new Set<string>();

  const collect = (value: string | undefined) => {
    if (!value) return;
    for (const token of value.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      if (typeNames.has(token)) referenced.add(token);
      if (token === "ListResponse") referenced.add("ListResponse");
    }
  };

  for (const operation of resource.operations) {
    collect(operation.responseType);
    collect(operation.bodyType);
    for (const param of [...operation.pathParams, ...operation.queryParams]) collect(param.tsType);
  }

  const out: string[] = [`// Generated by sdk-generator v${VERSION}. Edit freely once generated.`, ""];
  out.push(`import type { HttpClient, RequestOptions } from "../client.js";`);
  if (referenced.size > 0) {
    out.push(`import type { ${Array.from(referenced).sort().join(", ")} } from "../types.js";`);
  }
  out.push("");
  out.push(...docComment([`Operations for the \`${resource.key}\` resource.`]));
  out.push(`export class ${resource.className} {`);
  out.push("  constructor(private readonly http: HttpClient) {}");

  for (const operation of resource.operations) {
    const args: string[] = operation.pathParams.map((param) => `${param.argName}: ${param.tsType}`);

    if (operation.bodyType) args.push(`body: ${operation.bodyType}`);

    const queryTypeEntries = operation.queryParams
      .map((param) => `${safePropertyKey(param.name)}?: ${param.tsType}`)
      .join("; ");
    if (operation.queryParams.length > 0) {
      args.push(`query: { ${queryTypeEntries} } = {}`);
    }
    args.push("options: Partial<RequestOptions> = {}");

    const returnType = operation.responseType === "void" ? "Promise<void>" : `Promise<${operation.responseType}>`;
    const requestGeneric = operation.responseType === "void" ? "void" : operation.responseType;

    out.push("");
    out.push(
      ...docComment(
        [operation.summary, `${operation.httpMethod} ${operation.pathTemplate}`],
        "  ",
      ),
    );
    out.push(`  ${operation.methodName}(${args.join(", ")}): ${returnType} {`);
    out.push(`    return this.http.request<${requestGeneric}>({`);
    out.push("      ...options,");
    out.push(`      method: ${JSON.stringify(operation.httpMethod)},`);
    out.push(`      path: ${renderPathExpression(operation)},`);
    if (operation.queryParams.length > 0) out.push("      query,");
    if (operation.bodyType) out.push("      body,");
    out.push("    });");
    out.push("  }");
  }

  out.push("}");
  return `${out.join("\n")}\n`;
}

function renderIndex(model: ApiModel): string {
  const out: string[] = [`// Generated by sdk-generator v${VERSION}. Edit freely once generated.`, ""];
  out.push(`import { HttpClient, type ClientOptions } from "./client.js";`);
  for (const resource of model.resources) {
    out.push(`import { ${resource.className} } from "./resources/${resource.fileName}.js";`);
  }
  out.push("");
  out.push(`export { ApiError, HttpClient } from "./client.js";`);
  out.push(`export type { ClientOptions, FetchLike, RequestOptions } from "./client.js";`);
  out.push(`export * from "./types.js";`);
  for (const resource of model.resources) {
    out.push(`export { ${resource.className} } from "./resources/${resource.fileName}.js";`);
  }
  out.push("");
  out.push(`export const DEFAULT_BASE_URL = ${JSON.stringify(model.baseUrl)};`);
  out.push("");
  out.push(...docComment([`${model.title} SDK client.`, `Generated from ${model.source === "openapi" ? "an OpenAPI document" : "a resource list"}.`]));
  out.push(`export class ${model.clientClassName} {`);
  out.push("  readonly http: HttpClient;");
  for (const resource of model.resources) {
    out.push(`  readonly ${resource.propertyName}: ${resource.className};`);
  }
  out.push("");
  out.push("  constructor(options: ClientOptions = {}) {");
  out.push("    this.http = new HttpClient({ baseUrl: DEFAULT_BASE_URL, ...options });");
  for (const resource of model.resources) {
    out.push(`    this.${resource.propertyName} = new ${resource.className}(this.http);`);
  }
  out.push("  }");
  out.push("}");
  out.push("");
  out.push(`export default ${model.clientClassName};`);
  return `${out.join("\n")}\n`;
}

interface TestTarget {
  resource: ResourceDef;
  operation: Operation;
  callArgs: string;
}

function pickTestTarget(model: ApiModel): TestTarget | undefined {
  for (const resource of model.resources) {
    for (const operation of resource.operations) {
      if (operation.httpMethod !== "GET" || operation.bodyType) continue;
      const args = operation.pathParams.map((param) =>
        param.tsType === "number" ? "1" : JSON.stringify("test-id"),
      );
      if (operation.queryParams.length > 0) args.push("{}");
      return { resource, operation, callArgs: args.join(", ") };
    }
  }
  return undefined;
}

function renderTest(model: ApiModel): string {
  const target = pickTestTarget(model);
  const authAssertion =
    model.auth === "bearer"
      ? '    expect(calls[0]?.init?.headers?.["Authorization"]).toBe("Bearer test-key");'
      : model.auth === "api-key"
        ? '    expect(calls[0]?.init?.headers?.["X-API-Key"]).toBe("test-key");'
        : '    expect(calls[0]?.init?.headers?.["Authorization"]).toBeUndefined();';

  const resourceTest = target
    ? `
  test("${target.resource.propertyName}.${target.operation.methodName} issues a ${target.operation.httpMethod} request", async () => {
    const { fetchImpl, calls } = stubFetch([json({ data: [] })]);
    const client = new ${model.clientClassName}({ apiKey: "test-key", fetch: fetchImpl, retryBaseDelayMs: 1 });

    await client.${target.resource.propertyName}.${target.operation.methodName}(${target.callArgs});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe(${JSON.stringify(target.operation.httpMethod)});
    expect(calls[0]?.url.startsWith(DEFAULT_BASE_URL)).toBe(true);
  });
`
    : "";

  return `// Generated by sdk-generator v${VERSION}. Runs with \`bun test\`.

import { describe, expect, test } from "bun:test";
import { ${model.clientClassName}, ApiError, HttpClient, DEFAULT_BASE_URL } from "../src/index.js";

interface RecordedCall {
  url: string;
  init: (RequestInit & { headers?: Record<string, string> }) | undefined;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stubFetch(responses: Array<Response | (() => Response)>) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init: init as RecordedCall["init"] });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof next === "function" ? next() : next.clone();
  };
  return { fetchImpl, calls };
}

describe("${model.clientClassName}", () => {
  test("attaches configured auth headers and base URL", async () => {
    const { fetchImpl, calls } = stubFetch([json({ ok: true })]);
    const client = new ${model.clientClassName}({ apiKey: "test-key", fetch: fetchImpl, retryBaseDelayMs: 1 });

    await client.http.get("/ping");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(DEFAULT_BASE_URL + "/ping");
${authAssertion}
  });

  test("serializes query parameters and skips undefined values", async () => {
    const { fetchImpl, calls } = stubFetch([json({ data: [] })]);
    const client = new ${model.clientClassName}({ fetch: fetchImpl, retryBaseDelayMs: 1 });

    await client.http.get("/items", { limit: 10, cursor: undefined, tag: ["a", "b"] });

    expect(calls[0]?.url).toContain("limit=10");
    expect(calls[0]?.url).toContain("tag=a&tag=b");
    expect(calls[0]?.url).not.toContain("cursor");
  });

  test("sends JSON bodies with a content-type header", async () => {
    const { fetchImpl, calls } = stubFetch([json({ id: "1" }, 201)]);
    const client = new ${model.clientClassName}({ fetch: fetchImpl, retryBaseDelayMs: 1 });

    await client.http.post("/items", { name: "widget" });

    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "widget" }));
    expect(calls[0]?.init?.headers?.["Content-Type"]).toBe("application/json");
  });

  test("throws a typed ApiError for 4xx responses", async () => {
    const { fetchImpl } = stubFetch([json({ error: "not found" }, 404)]);
    const client = new ${model.clientClassName}({ fetch: fetchImpl, retryBaseDelayMs: 1 });

    let caught: unknown;
    try {
      await client.http.get("/missing");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const apiError = caught as ApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.isRetryable).toBe(false);
    expect(apiError.body).toEqual({ error: "not found" });
  });

  test("retries 429 responses and then resolves", async () => {
    const { fetchImpl, calls } = stubFetch([
      () => json({ error: "slow down" }, 429, { "retry-after": "0" }),
      () => json({ ok: true }),
    ]);
    const client = new HttpClient({ fetch: fetchImpl, retryBaseDelayMs: 1, maxRetries: 3 });

    const result = await client.get<{ ok: boolean }>("/rate-limited");

    expect(result).toEqual({ ok: true });
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  test("gives up after exhausting the retry budget", async () => {
    const { fetchImpl, calls } = stubFetch([() => json({ error: "boom" }, 503)]);
    const client = new HttpClient({ fetch: fetchImpl, retryBaseDelayMs: 1, maxRetries: 1 });

    await expect(client.get("/flaky")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(2);
  });

  test("returns undefined for 204 responses", async () => {
    const { fetchImpl } = stubFetch([new Response(null, { status: 204 })]);
    const client = new HttpClient({ fetch: fetchImpl, retryBaseDelayMs: 1 });

    const result = await client.delete("/items/1");

    expect(result).toBeUndefined();
  });
${resourceTest}});
`;
}

function renderPackageJson(model: ApiModel): string {
  return `${JSON.stringify(
    {
      name: model.packageName,
      version: "0.1.0",
      description: model.description,
      type: "module",
      main: "src/index.ts",
      types: "src/index.ts",
      exports: { ".": "./src/index.ts" },
      files: ["src", "README.md"],
      scripts: {
        test: "bun test",
        typecheck: "tsc --noEmit",
      },
      devDependencies: {
        "@types/bun": "latest",
        typescript: "^5.7.0",
      },
    },
    null,
    2,
  )}\n`;
}

function renderSdkTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022", "DOM"],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: ["src/**/*"],
    },
    null,
    2,
  )}\n`;
}

function usageSnippet(model: ApiModel): string {
  const target = pickTestTarget(model);
  const authLine =
    model.auth === "none" ? "const client = new %C%();" : 'const client = new %C%({ apiKey: process.env.API_KEY });';
  const call = target
    ? `const result = await client.${target.resource.propertyName}.${target.operation.methodName}(${target.callArgs});\nconsole.log(result);`
    : `const result = await client.http.get("/health");\nconsole.log(result);`;

  return [
    `import { ${model.clientClassName} } from "${model.packageName}";`,
    "",
    authLine.replace(/%C%/g, model.clientClassName),
    "",
    call,
  ].join("\n");
}

function renderSdkReadme(model: ApiModel): string {
  const lines: string[] = [
    `# ${model.packageName}`,
    "",
    model.description,
    "",
    "Generated by the `sdk-generator` skill. The output is a normal TypeScript package — edit it freely.",
    "",
    "## Install",
    "",
    "```bash",
    "bun install",
    "```",
    "",
    "## Usage",
    "",
    "```ts",
    usageSnippet(model),
    "```",
    "",
    "## Client options",
    "",
    "| Option | Type | Default | Description |",
    "|--------|------|---------|-------------|",
    `| \`baseUrl\` | string | \`${model.baseUrl}\` | API base URL. |`,
    `| \`apiKey\` | string | — | ${
      model.auth === "none"
        ? "Unused (`--auth none`)."
        : model.auth === "bearer"
          ? "Sent as `Authorization: Bearer <apiKey>`."
          : "Sent as `X-API-Key: <apiKey>`."
    } |`,
    "| `timeoutMs` | number | `30000` | Per-request abort timeout. |",
    "| `maxRetries` | number | `2` | Retries for 408/429/5xx and network failures. |",
    "| `retryBaseDelayMs` | number | `250` | Base delay for exponential backoff with jitter. |",
    "| `headers` | Record<string,string> | `{}` | Extra headers merged into every request. |",
    "| `fetch` | FetchLike | `globalThis.fetch` | Injectable fetch, used by the bundled tests. |",
    "",
    "## Errors",
    "",
    "Every non-2xx response throws `ApiError` with `status`, `statusText`, `url`, `body`, `requestId`, and `isRetryable`.",
    "",
    "## Resources",
    "",
  ];

  for (const resource of model.resources) {
    lines.push(`### \`client.${resource.propertyName}\``, "");
    for (const operation of resource.operations) {
      lines.push(
        `- \`${operation.methodName}()\` — \`${operation.httpMethod} ${operation.pathTemplate}\`${
          operation.summary ? ` — ${operation.summary}` : ""
        }`,
      );
    }
    lines.push("");
  }

  lines.push("## Tests", "", "```bash", "bun test", "```", "");
  return lines.join("\n");
}

function renderApiSummary(model: ApiModel): string {
  const operationCount = model.resources.reduce((sum, resource) => sum + resource.operations.length, 0);
  const lines: string[] = [
    `# ${model.title} — API summary`,
    "",
    `- **Generated:** ${new Date().toISOString()}`,
    `- **Source:** ${model.source === "openapi" ? `OpenAPI document (${model.specFile ?? "spec"})` : "resource list"}`,
    `- **API version:** ${model.apiVersion}`,
    `- **Base URL:** ${model.baseUrl}`,
    `- **Auth:** ${model.auth}`,
    `- **Resources:** ${model.resources.length}`,
    `- **Operations:** ${operationCount}`,
    `- **Types:** ${model.types.length}`,
    "",
    "## Operations",
    "",
    "| Resource | Method | HTTP | Path | Returns |",
    "|----------|--------|------|------|---------|",
  ];

  for (const resource of model.resources) {
    for (const operation of resource.operations) {
      lines.push(
        `| \`${resource.propertyName}\` | \`${operation.methodName}\` | ${operation.httpMethod} | \`${operation.pathTemplate}\` | \`${operation.responseType}\` |`,
      );
    }
  }

  lines.push("", "## Types", "");
  if (model.types.length === 0) {
    lines.push("_No named schemas were found._");
  } else {
    for (const type of model.types) {
      const shape = type.alias ? "alias" : `${type.properties.length} field(s)`;
      lines.push(`- \`${type.name}\` — ${shape}${type.description ? ` — ${type.description}` : ""}`);
    }
  }

  lines.push("", "## Example", "", "```ts", usageSnippet(model), "```", "");
  return lines.join("\n");
}

function renderUsageExamples(model: ApiModel): string {
  const lines: string[] = [
    `# ${model.packageName} — usage examples`,
    "",
    "## Construct a client",
    "",
    "```ts",
    usageSnippet(model),
    "```",
    "",
    "## Handle errors",
    "",
    "```ts",
    `import { ApiError } from "${model.packageName}";`,
    "",
    "try {",
    "  await client.http.get(\"/health\");",
    "} catch (error) {",
    "  if (error instanceof ApiError && error.isRetryable) {",
    "    console.warn(\"transient failure\", error.status, error.requestId);",
    "  } else {",
    "    throw error;",
    "  }",
    "}",
    "```",
    "",
    "## Tune timeouts and retries",
    "",
    "```ts",
    `const client = new ${model.clientClassName}({`,
    "  timeoutMs: 5_000,",
    "  maxRetries: 5,",
    "  retryBaseDelayMs: 100,",
    "});",
    "```",
    "",
    "## Per-resource calls",
    "",
  ];

  for (const resource of model.resources) {
    lines.push(`### \`${resource.propertyName}\``, "", "```ts");
    for (const operation of resource.operations.slice(0, 5)) {
      const args = [
        ...operation.pathParams.map((param) => (param.tsType === "number" ? "1" : '"id_123"')),
        ...(operation.bodyType ? ["{ /* payload */ }"] : []),
      ];
      lines.push(`await client.${resource.propertyName}.${operation.methodName}(${args.join(", ")});`);
    }
    lines.push("```", "");
  }

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function writeOut(root: string, relativePath: string, contents: string): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  return relativePath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const model = options.spec
    ? buildModelFromSpec(await loadSpec(resolve(options.spec)), options)
    : buildModelFromResources(options.resources!, options);

  const outputRoot = resolve(options.output);
  const written: string[] = [];

  written.push(await writeOut(outputRoot, "sdk/package.json", renderPackageJson(model)));
  written.push(await writeOut(outputRoot, "sdk/tsconfig.json", renderSdkTsconfig()));
  written.push(await writeOut(outputRoot, "sdk/src/index.ts", renderIndex(model)));
  written.push(await writeOut(outputRoot, "sdk/src/client.ts", renderClient(model)));
  written.push(await writeOut(outputRoot, "sdk/src/types.ts", renderTypes(model)));
  for (const resource of model.resources) {
    written.push(
      await writeOut(outputRoot, `sdk/src/resources/${resource.fileName}.ts`, renderResource(model, resource)),
    );
  }
  written.push(await writeOut(outputRoot, "sdk/test/client.test.ts", renderTest(model)));
  written.push(await writeOut(outputRoot, "sdk/README.md", renderSdkReadme(model)));
  written.push(await writeOut(outputRoot, "api-summary.md", renderApiSummary(model)));
  written.push(await writeOut(outputRoot, "usage-examples.md", renderUsageExamples(model)));

  const operationCount = model.resources.reduce((sum, resource) => sum + resource.operations.length, 0);
  const manifest = {
    skill: "sdk-generator",
    skillVersion: VERSION,
    generatedAt: new Date().toISOString(),
    source: model.source,
    specFile: model.specFile ?? null,
    package: {
      name: model.packageName,
      clientClass: model.clientClassName,
      baseUrl: model.baseUrl,
      auth: model.auth,
      apiVersion: model.apiVersion,
    },
    counts: {
      resources: model.resources.length,
      operations: operationCount,
      types: model.types.length,
      files: written.length + 1,
    },
    resources: model.resources.map((resource) => ({
      name: resource.key,
      property: resource.propertyName,
      class: resource.className,
      operations: resource.operations.map((operation) => ({
        name: operation.methodName,
        method: operation.httpMethod,
        path: operation.pathTemplate,
        returns: operation.responseType,
      })),
    })),
    outputDir: outputRoot,
    files: [...written, "manifest.json"].sort(),
  };

  await writeOut(outputRoot, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  const summary = [
    `sdk-generator v${VERSION}`,
    `  package     ${model.packageName} (${model.clientClassName})`,
    `  source      ${model.source === "openapi" ? `OpenAPI: ${model.specFile}` : "resource list"}`,
    `  base URL    ${model.baseUrl}`,
    `  auth        ${model.auth}`,
    `  resources   ${model.resources.length} (${model.resources.map((r) => r.propertyName).join(", ")})`,
    `  operations  ${operationCount}`,
    `  types       ${model.types.length}`,
    `  output      ${outputRoot}`,
    "",
    "Files:",
    ...manifest.files.map((file) => `  ${file}`),
    "",
    `Next: cd ${join(outputRoot, "sdk")} && bun install && bun test`,
  ].join("\n");

  console.log(summary);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sdk-generator: ${message}\n`);
  process.exit(1);
});
