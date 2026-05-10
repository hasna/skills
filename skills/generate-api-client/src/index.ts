#!/usr/bin/env bun
/**
 * Generate API Client Skill
 * Generates typed API clients from OpenAPI/Swagger specifications
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "fs";
import { join, basename, extname, dirname } from "path";
import { randomUUID } from "crypto";
import * as yaml from "yaml";

// Types
interface GenerateOptions {
  specPath: string;
  language: "typescript" | "javascript" | "python";
  client: "fetch" | "axios" | "ky" | "requests";
  output?: string;
  auth: "bearer" | "apikey" | "oauth2" | "basic" | "none";
  style: "modular" | "class" | "functional";
  async: boolean;
  sync: boolean;
  baseUrl?: string;
  name?: string;
  typesOnly: boolean;
}

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, PathItem>>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
}

interface PathItem {
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, Response>;
  security?: Array<Record<string, string[]>>;
}

interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: SchemaObject;
  description?: string;
}

interface RequestBody {
  required?: boolean;
  content?: Record<string, { schema?: SchemaObject }>;
}

interface Response {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  enum?: Array<string | number>;
  $ref?: string;
  description?: string;
  nullable?: boolean;
  format?: string;
}

interface SecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

// Constants
const SKILL_NAME = "generate-api-client";
const SESSION_ID = randomUUID().slice(0, 8);

// Use SKILLS_OUTPUT_DIR from CLI if available, otherwise fall back to cwd
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Session timestamp for log filename
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();

// Logger
function log(message: string, level: "info" | "error" | "success" | "warn" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️";
  console.log(`${prefix} ${message}`);
}

// Load OpenAPI spec from URL or file
async function loadSpec(specPath: string): Promise<OpenAPISpec> {
  log(`Loading OpenAPI spec from: ${specPath}`);

  let content: string;

  if (specPath.startsWith("http://") || specPath.startsWith("https://")) {
    log("Fetching spec from URL...");
    const response = await fetch(specPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch spec: ${response.statusText}`);
    }
    content = await response.text();
  } else {
    log("Reading spec from local file...");
    if (!existsSync(specPath)) {
      throw new Error(`Spec file not found: ${specPath}`);
    }
    content = readFileSync(specPath, "utf-8");
  }

  const ext = extname(specPath).toLowerCase();
  let spec: OpenAPISpec;

  if (ext === ".yaml" || ext === ".yml" || content.trim().startsWith("openapi:") || content.trim().startsWith("swagger:")) {
    log("Parsing YAML spec...");
    spec = yaml.parse(content);
  } else {
    log("Parsing JSON spec...");
    spec = JSON.parse(content);
  }

  // Validate spec
  if (!spec.openapi && !spec.swagger) {
    throw new Error("Invalid OpenAPI/Swagger specification: missing version field");
  }

  if (!spec.info?.title) {
    throw new Error("Invalid OpenAPI/Swagger specification: missing info.title");
  }

  log(`Loaded spec: ${spec.info.title} v${spec.info.version}`, "success");
  return spec;
}

// Convert OpenAPI type to TypeScript type
function openApiTypeToTS(schema: SchemaObject | undefined, refs: Record<string, SchemaObject> = {}): string {
  if (!schema) return "any";

  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop() || "any";
    return refName;
  }

  if (schema.enum) {
    return schema.enum.map(v => typeof v === "string" ? `"${v}"` : v).join(" | ");
  }

  const baseType = (() => {
    switch (schema.type) {
      case "string":
        if (schema.format === "date-time") return "Date | string";
        if (schema.format === "date") return "Date | string";
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return `Array<${openApiTypeToTS(schema.items, refs)}>`;
      case "object":
        if (!schema.properties) return "Record<string, any>";
        const props = Object.entries(schema.properties).map(([key, prop]) => {
          const optional = !schema.required?.includes(key) ? "?" : "";
          return `  ${key}${optional}: ${openApiTypeToTS(prop, refs)};`;
        }).join("\n");
        return `{\n${props}\n}`;
      default:
        return "any";
    }
  })();

  return schema.nullable ? `${baseType} | null` : baseType;
}

// Convert OpenAPI type to Python type
function openApiTypeToPython(schema: SchemaObject | undefined): string {
  if (!schema) return "Any";

  if (schema.$ref) {
    const refName = schema.$ref.split("/").pop() || "Any";
    return refName;
  }

  if (schema.enum) {
    return "Literal[" + schema.enum.map(v => typeof v === "string" ? `"${v}"` : v).join(", ") + "]";
  }

  const baseType = (() => {
    switch (schema.type) {
      case "string":
        if (schema.format === "date-time") return "datetime";
        if (schema.format === "date") return "date";
        return "str";
      case "number":
        return "float";
      case "integer":
        return "int";
      case "boolean":
        return "bool";
      case "array":
        return `List[${openApiTypeToPython(schema.items)}]`;
      case "object":
        if (!schema.properties) return "Dict[str, Any]";
        return "dict";  // For complex objects, we'll generate Pydantic models separately
      default:
        return "Any";
    }
  })();

  return schema.nullable ? `Optional[${baseType}]` : baseType;
}

// Generate TypeScript types
function generateTypeScriptTypes(spec: OpenAPISpec): string {
  let output = "// Generated types from OpenAPI specification\n\n";

  if (!spec.components?.schemas) {
    return output + "export type EmptyTypes = Record<string, never>;\n";
  }

  // Generate interfaces for each schema
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    if (schema.description) {
      output += `/**\n * ${schema.description}\n */\n`;
    }
    output += `export interface ${name} ${openApiTypeToTS(schema, spec.components.schemas)}\n\n`;
  }

  return output;
}

// Generate TypeScript fetch client
function generateTypeScriptFetchClient(spec: OpenAPISpec, options: GenerateOptions): Record<string, string> {
  const files: Record<string, string> = {};
  const clientName = options.name || spec.info.title.replace(/[^a-zA-Z0-9]/g, "") + "Client";
  const baseUrl = options.baseUrl || spec.servers?.[0]?.url || "";

  // Generate types file
  files["types.ts"] = generateTypeScriptTypes(spec);

  // Generate config file
  let configContent = `// API Client Configuration\n\n`;
  configContent += `export interface ApiConfig {\n`;
  configContent += `  baseURL?: string;\n`;
  configContent += `  timeout?: number;\n`;
  configContent += `  headers?: Record<string, string>;\n`;

  if (options.auth !== "none") {
    configContent += `  auth?: {\n`;
    configContent += `    type: "${options.auth}";\n`;
    if (options.auth === "bearer") {
      configContent += `    token: string;\n`;
    } else if (options.auth === "apikey") {
      configContent += `    key: string;\n`;
      configContent += `    header?: string;\n`;
    }
    configContent += `  };\n`;
  }

  configContent += `}\n\n`;
  configContent += `export const defaultConfig: ApiConfig = {\n`;
  configContent += `  baseURL: "${baseUrl}",\n`;
  configContent += `  timeout: 30000,\n`;
  configContent += `  headers: {\n`;
  configContent += `    "Content-Type": "application/json",\n`;
  configContent += `  },\n`;
  configContent += `};\n`;

  files["config.ts"] = configContent;

  // Generate main client file based on style
  if (options.style === "class") {
    let clientContent = `// ${clientName}\n`;
    clientContent += `import type { ApiConfig } from "./config";\n`;
    clientContent += `import { defaultConfig } from "./config";\n\n`;

    clientContent += `export class ${clientName} {\n`;
    clientContent += `  private config: ApiConfig;\n\n`;
    clientContent += `  constructor(config: Partial<ApiConfig> = {}) {\n`;
    clientContent += `    this.config = { ...defaultConfig, ...config };\n`;
    clientContent += `  }\n\n`;

    clientContent += `  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {\n`;
    clientContent += `    const url = \`\${this.config.baseURL}\${path}\`;\n`;
    clientContent += `    const headers = { ...this.config.headers, ...options.headers };\n\n`;

    if (options.auth === "bearer") {
      clientContent += `    if (this.config.auth?.type === "bearer") {\n`;
      clientContent += `      headers["Authorization"] = \`Bearer \${this.config.auth.token}\`;\n`;
      clientContent += `    }\n\n`;
    }

    clientContent += `    const response = await fetch(url, { ...options, headers });\n\n`;
    clientContent += `    if (!response.ok) {\n`;
    clientContent += `      throw new Error(\`API Error: \${response.status} \${response.statusText}\`);\n`;
    clientContent += `    }\n\n`;
    clientContent += `    return response.json();\n`;
    clientContent += `  }\n\n`;

    // Generate methods for each endpoint
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;

        const methodName = operation.summary?.replace(/[^a-zA-Z0-9]/g, "") ||
                          `${method}${path.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "")}`;
        const lowerMethodName = methodName.charAt(0).toLowerCase() + methodName.slice(1);

        clientContent += `  /**\n`;
        clientContent += `   * ${operation.description || operation.summary || `${method.toUpperCase()} ${path}`}\n`;
        clientContent += `   */\n`;
        clientContent += `  async ${lowerMethodName}(`;

        // Add parameters
        const pathParams = operation.parameters?.filter(p => p.in === "path") || [];
        const queryParams = operation.parameters?.filter(p => p.in === "query") || [];
        const hasBody = operation.requestBody && method !== "get";

        if (pathParams.length > 0 || queryParams.length > 0 || hasBody) {
          clientContent += `params: {\n`;
          pathParams.forEach(p => {
            clientContent += `    ${p.name}${p.required ? "" : "?"}: ${openApiTypeToTS(p.schema)};\n`;
          });
          queryParams.forEach(p => {
            clientContent += `    ${p.name}${p.required ? "" : "?"}: ${openApiTypeToTS(p.schema)};\n`;
          });
          if (hasBody) {
            clientContent += `    body?: any;\n`;
          }
          clientContent += `  }`;
        }

        clientContent += `): Promise<any> {\n`;

        // Build URL with path params
        clientContent += `    let path = "${path}";\n`;
        pathParams.forEach(p => {
          clientContent += `    path = path.replace("{${p.name}}", String(params.${p.name}));\n`;
        });

        // Add query params
        if (queryParams.length > 0) {
          clientContent += `    const queryParams = new URLSearchParams();\n`;
          queryParams.forEach(p => {
            clientContent += `    if (params.${p.name} !== undefined) queryParams.append("${p.name}", String(params.${p.name}));\n`;
          });
          clientContent += `    if (queryParams.toString()) path += \`?\${queryParams.toString()}\`;\n`;
        }

        // Make request
        clientContent += `    return this.request(path, {\n`;
        clientContent += `      method: "${method.toUpperCase()}",\n`;
        if (hasBody) {
          clientContent += `      body: JSON.stringify(params.body),\n`;
        }
        clientContent += `    });\n`;
        clientContent += `  }\n\n`;
      }
    }

    clientContent += `}\n`;
    files["client.ts"] = clientContent;

  } else if (options.style === "modular") {
    // Generate modular exports
    let indexContent = `// ${clientName} - Modular API\n`;
    indexContent += `import type { ApiConfig } from "./config";\n`;
    indexContent += `import { defaultConfig } from "./config";\n\n`;

    indexContent += `let config: ApiConfig = defaultConfig;\n\n`;
    indexContent += `export function configure(newConfig: Partial<ApiConfig>) {\n`;
    indexContent += `  config = { ...config, ...newConfig };\n`;
    indexContent += `}\n\n`;

    indexContent += `async function request<T>(path: string, options: RequestInit = {}): Promise<T> {\n`;
    indexContent += `  const url = \`\${config.baseURL}\${path}\`;\n`;
    indexContent += `  const headers = { ...config.headers, ...options.headers };\n\n`;

    if (options.auth === "bearer") {
      indexContent += `  if (config.auth?.type === "bearer") {\n`;
      indexContent += `    headers["Authorization"] = \`Bearer \${config.auth.token}\`;\n`;
      indexContent += `  }\n\n`;
    }

    indexContent += `  const response = await fetch(url, { ...options, headers });\n\n`;
    indexContent += `  if (!response.ok) {\n`;
    indexContent += `    throw new Error(\`API Error: \${response.status} \${response.statusText}\`);\n`;
    indexContent += `  }\n\n`;
    indexContent += `  return response.json();\n`;
    indexContent += `}\n\n`;

    // Generate function exports
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;

        const methodName = operation.summary?.replace(/[^a-zA-Z0-9]/g, "") ||
                          `${method}${path.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "")}`;
        const lowerMethodName = methodName.charAt(0).toLowerCase() + methodName.slice(1);

        indexContent += `/**\n * ${operation.description || operation.summary || `${method.toUpperCase()} ${path}`}\n */\n`;
        indexContent += `export async function ${lowerMethodName}(`;

        const pathParams = operation.parameters?.filter(p => p.in === "path") || [];
        const queryParams = operation.parameters?.filter(p => p.in === "query") || [];
        const hasBody = operation.requestBody && method !== "get";

        if (pathParams.length > 0 || queryParams.length > 0 || hasBody) {
          indexContent += `params: { `;
          pathParams.forEach(p => {
            indexContent += `${p.name}${p.required ? "" : "?"}: ${openApiTypeToTS(p.schema)}; `;
          });
          queryParams.forEach(p => {
            indexContent += `${p.name}${p.required ? "" : "?"}: ${openApiTypeToTS(p.schema)}; `;
          });
          if (hasBody) {
            indexContent += `body?: any; `;
          }
          indexContent += `}`;
        }

        indexContent += `): Promise<any> {\n`;
        indexContent += `  let path = "${path}";\n`;

        pathParams.forEach(p => {
          indexContent += `  path = path.replace("{${p.name}}", String(params.${p.name}));\n`;
        });

        if (queryParams.length > 0) {
          indexContent += `  const queryParams = new URLSearchParams();\n`;
          queryParams.forEach(p => {
            indexContent += `  if (params.${p.name} !== undefined) queryParams.append("${p.name}", String(params.${p.name}));\n`;
          });
          indexContent += `  if (queryParams.toString()) path += \`?\${queryParams.toString()}\`;\n`;
        }

        indexContent += `  return request(path, { method: "${method.toUpperCase()}"`;
        if (hasBody) {
          indexContent += `, body: JSON.stringify(params.body)`;
        }
        indexContent += ` });\n`;
        indexContent += `}\n\n`;
      }
    }

    files["index.ts"] = indexContent;
  }

  // Generate README
  let readme = `# ${spec.info.title} API Client\n\n`;
  readme += `${spec.info.description || "Generated API client"}\n\n`;
  readme += `## Installation\n\n\`\`\`bash\nnpm install\n\`\`\`\n\n`;
  readme += `## Usage\n\n`;

  if (options.style === "class") {
    readme += `\`\`\`typescript\nimport { ${clientName} } from "./client";\n\n`;
    readme += `const client = new ${clientName}({\n`;
    readme += `  baseURL: "${baseUrl}",\n`;
    if (options.auth === "bearer") {
      readme += `  auth: { type: "bearer", token: "your-token" },\n`;
    }
    readme += `});\n\n`;
    readme += `// Use the client\nconst data = await client.someMethod();\n\`\`\`\n`;
  } else {
    readme += `\`\`\`typescript\nimport { configure } from "./index";\n\n`;
    readme += `configure({\n`;
    readme += `  baseURL: "${baseUrl}",\n`;
    if (options.auth === "bearer") {
      readme += `  auth: { type: "bearer", token: "your-token" },\n`;
    }
    readme += `});\n\`\`\`\n`;
  }

  files["README.md"] = readme;

  return files;
}

// Generate Python client
function generatePythonClient(spec: OpenAPISpec, options: GenerateOptions): Record<string, string> {
  const files: Record<string, string> = {};
  const clientName = options.name || spec.info.title.replace(/[^a-zA-Z0-9]/g, "");
  const className = clientName.charAt(0).toUpperCase() + clientName.slice(1) + "Client";
  const baseUrl = options.baseUrl || spec.servers?.[0]?.url || "";

  // Generate __init__.py
  files["__init__.py"] = `"""${spec.info.title} API Client"""\n\nfrom .client import ${className}\n\n__all__ = ["${className}"]\n`;

  // Generate models.py with Pydantic
  let modelsContent = `"""Pydantic models for ${spec.info.title}"""\n\n`;
  modelsContent += `from typing import Any, Optional, List, Dict\n`;
  modelsContent += `from datetime import datetime, date\n`;
  modelsContent += `from pydantic import BaseModel\n\n`;

  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      if (schema.description) {
        modelsContent += `class ${name}(BaseModel):\n`;
        modelsContent += `    """${schema.description}"""\n`;
      } else {
        modelsContent += `class ${name}(BaseModel):\n`;
      }

      if (schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const required = schema.required?.includes(propName);
          const pyType = openApiTypeToPython(propSchema);
          modelsContent += `    ${propName}: ${required ? pyType : `Optional[${pyType}]`}${required ? "" : " = None"}\n`;
        }
      } else {
        modelsContent += `    pass\n`;
      }
      modelsContent += `\n`;
    }
  }

  files["models.py"] = modelsContent;

  // Generate client.py
  let clientContent = `"""${spec.info.title} API Client"""\n\n`;
  clientContent += `from typing import Any, Optional, Dict\n`;
  clientContent += `import requests\n`;
  if (options.async) {
    clientContent += `import aiohttp\n`;
  }
  clientContent += `\n`;

  clientContent += `class ${className}:\n`;
  clientContent += `    """API client for ${spec.info.title}"""\n\n`;
  clientContent += `    def __init__(self, base_url: str = "${baseUrl}", `;

  if (options.auth === "bearer") {
    clientContent += `token: Optional[str] = None, `;
  } else if (options.auth === "apikey") {
    clientContent += `api_key: Optional[str] = None, `;
  }

  clientContent += `timeout: int = 30):\n`;
  clientContent += `        self.base_url = base_url\n`;
  clientContent += `        self.timeout = timeout\n`;

  if (options.auth === "bearer") {
    clientContent += `        self.token = token\n`;
  } else if (options.auth === "apikey") {
    clientContent += `        self.api_key = api_key\n`;
  }

  clientContent += `        self.session = requests.Session()\n`;
  clientContent += `        self._setup_headers()\n\n`;

  clientContent += `    def _setup_headers(self) -> None:\n`;
  clientContent += `        """Setup default headers"""\n`;
  clientContent += `        self.session.headers.update({"Content-Type": "application/json"})\n`;

  if (options.auth === "bearer") {
    clientContent += `        if self.token:\n`;
    clientContent += `            self.session.headers.update({"Authorization": f"Bearer {self.token}"})\n`;
  }

  clientContent += `\n`;

  // Add sync request method
  if (options.sync) {
    clientContent += `    def _request(self, method: str, path: str, **kwargs) -> Any:\n`;
    clientContent += `        """Make HTTP request"""\n`;
    clientContent += `        url = f"{self.base_url}{path}"\n`;
    clientContent += `        response = self.session.request(method, url, timeout=self.timeout, **kwargs)\n`;
    clientContent += `        response.raise_for_status()\n`;
    clientContent += `        return response.json()\n\n`;
  }

  // Add async request method
  if (options.async) {
    clientContent += `    async def _request_async(self, method: str, path: str, **kwargs) -> Any:\n`;
    clientContent += `        """Make async HTTP request"""\n`;
    clientContent += `        url = f"{self.base_url}{path}"\n`;
    clientContent += `        async with aiohttp.ClientSession() as session:\n`;
    clientContent += `            async with session.request(method, url, timeout=self.timeout, **kwargs) as response:\n`;
    clientContent += `                response.raise_for_status()\n`;
    clientContent += `                return await response.json()\n\n`;
  }

  // Generate methods for endpoints
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;

      const methodName = operation.summary?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() ||
                        `${method}_${path.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;

      const pathParams = operation.parameters?.filter(p => p.in === "path") || [];
      const queryParams = operation.parameters?.filter(p => p.in === "query") || [];
      const hasBody = operation.requestBody && method !== "get";

      // Sync version
      if (options.sync) {
        clientContent += `    def ${methodName}(self`;

        pathParams.forEach(p => {
          clientContent += `, ${p.name}: ${openApiTypeToPython(p.schema)}`;
        });

        queryParams.forEach(p => {
          const pyType = openApiTypeToPython(p.schema);
          clientContent += `, ${p.name}: ${p.required ? pyType : `Optional[${pyType}]`}${p.required ? "" : " = None"}`;
        });

        if (hasBody) {
          clientContent += `, data: Optional[Dict[str, Any]] = None`;
        }

        clientContent += `) -> Any:\n`;
        clientContent += `        """${operation.description || operation.summary || `${method.toUpperCase()} ${path}`}"""\n`;
        clientContent += `        path = "${path}"\n`;

        pathParams.forEach(p => {
          clientContent += `        path = path.replace("{${p.name}}", str(${p.name}))\n`;
        });

        if (queryParams.length > 0) {
          clientContent += `        params = {}\n`;
          queryParams.forEach(p => {
            clientContent += `        if ${p.name} is not None:\n`;
            clientContent += `            params["${p.name}"] = ${p.name}\n`;
          });
          clientContent += `        return self._request("${method.toUpperCase()}", path, params=params`;
        } else {
          clientContent += `        return self._request("${method.toUpperCase()}", path`;
        }

        if (hasBody) {
          clientContent += `, json=data`;
        }

        clientContent += `)\n\n`;
      }

      // Async version
      if (options.async) {
        clientContent += `    async def ${methodName}_async(self`;

        pathParams.forEach(p => {
          clientContent += `, ${p.name}: ${openApiTypeToPython(p.schema)}`;
        });

        queryParams.forEach(p => {
          const pyType = openApiTypeToPython(p.schema);
          clientContent += `, ${p.name}: ${p.required ? pyType : `Optional[${pyType}]`}${p.required ? "" : " = None"}`;
        });

        if (hasBody) {
          clientContent += `, data: Optional[Dict[str, Any]] = None`;
        }

        clientContent += `) -> Any:\n`;
        clientContent += `        """${operation.description || operation.summary || `${method.toUpperCase()} ${path}`} (async)"""\n`;
        clientContent += `        path = "${path}"\n`;

        pathParams.forEach(p => {
          clientContent += `        path = path.replace("{${p.name}}", str(${p.name}))\n`;
        });

        if (queryParams.length > 0) {
          clientContent += `        params = {}\n`;
          queryParams.forEach(p => {
            clientContent += `        if ${p.name} is not None:\n`;
            clientContent += `            params["${p.name}"] = ${p.name}\n`;
          });
          clientContent += `        return await self._request_async("${method.toUpperCase()}", path, params=params`;
        } else {
          clientContent += `        return await self._request_async("${method.toUpperCase()}", path`;
        }

        if (hasBody) {
          clientContent += `, json=data`;
        }

        clientContent += `)\n\n`;
      }
    }
  }

  files["client.py"] = clientContent;

  // Generate README
  let readme = `# ${spec.info.title} API Client\n\n`;
  readme += `${spec.info.description || "Generated Python API client"}\n\n`;
  readme += `## Installation\n\n\`\`\`bash\npip install requests pydantic\n\`\`\`\n\n`;
  if (options.async) {
    readme += `For async support:\n\`\`\`bash\npip install aiohttp\n\`\`\`\n\n`;
  }
  readme += `## Usage\n\n\`\`\`python\nfrom ${clientName} import ${className}\n\n`;
  readme += `client = ${className}(base_url="${baseUrl}"`;
  if (options.auth === "bearer") {
    readme += `, token="your-token"`;
  }
  readme += `)\n\n`;
  readme += `# Use the client\ndata = client.some_method()\n\`\`\`\n`;

  files["README.md"] = readme;

  return files;
}

// Generate API client
async function generateApiClient(options: GenerateOptions): Promise<string> {
  log(`Generating ${options.language} API client...`);

  // Load spec
  const spec = await loadSpec(options.specPath);

  // Generate files based on language
  let files: Record<string, string>;

  if (options.language === "typescript" || options.language === "javascript") {
    if (options.typesOnly) {
      files = { "types.ts": generateTypeScriptTypes(spec) };
    } else {
      files = generateTypeScriptFetchClient(spec, options);
    }
  } else if (options.language === "python") {
    files = generatePythonClient(spec, options);
  } else {
    throw new Error(`Unsupported language: ${options.language}`);
  }

  // Determine output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "_").replace(/-/g, "_").slice(0, 19).toLowerCase();
  const apiName = spec.info.title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const defaultOutput = join(EXPORTS_DIR, `export_${timestamp}_${apiName}`);
  const outputDir = options.output || defaultOutput;

  // Write files
  log(`Writing files to: ${outputDir}`);
  ensureDir(outputDir);

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(outputDir, filename);
    ensureDir(dirname(filePath));
    writeFileSync(filePath, content, "utf-8");
    log(`Created: ${filename}`);
  }

  log(`Generated ${Object.keys(files).length} files`, "success");
  return outputDir;
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      language: { type: "string", short: "l", default: "typescript" },
      client: { type: "string", default: "fetch" },
      output: { type: "string", short: "o" },
      auth: { type: "string", default: "bearer" },
      style: { type: "string", default: "modular" },
      async: { type: "boolean", default: true },
      sync: { type: "boolean", default: false },
      "base-url": { type: "string" },
      name: { type: "string" },
      "types-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help || positionals.length === 0) {
    console.log(`
Generate API Client - Generate typed API clients from OpenAPI/Swagger specs

Usage:
  bun run src/index.ts <spec-url-or-file> [options]

Options:
  --language, -l <lang>   Output language (typescript, javascript, python) [default: typescript]
  --client <client>       HTTP client (fetch, axios, ky, requests) [default: fetch]
  --output, -o <path>     Output directory path
  --auth <type>           Auth type (bearer, apikey, oauth2, basic, none) [default: bearer]
  --style <style>         Code style (modular, class, functional) [default: modular]
  --async                 Generate async methods (Python) [default: true]
  --sync                  Generate sync methods [default: false]
  --base-url <url>        Override base URL from spec
  --name <name>           Client class/module name
  --types-only            Generate only TypeScript types
  --help, -h              Show this help

Examples:
  bun run src/index.ts "https://api.example.com/openapi.json"
  bun run src/index.ts "./spec.yaml" --language python --client requests
  bun run src/index.ts "https://petstore.swagger.io/v2/swagger.json" --output ./api
`);
    process.exit(0);
  }

  const specPath = positionals[0];

  if (!specPath) {
    log("Please provide an OpenAPI spec URL or file path", "error");
    process.exit(1);
  }

  try {
    log(`Session ID: ${SESSION_ID}`);

    const outputDir = await generateApiClient({
      specPath,
      language: values.language as "typescript" | "javascript" | "python",
      client: values.client as "fetch" | "axios" | "ky" | "requests",
      output: values.output as string | undefined,
      auth: values.auth as "bearer" | "apikey" | "oauth2" | "basic" | "none",
      style: values.style as "modular" | "class" | "functional",
      async: values.async as boolean,
      sync: values.sync as boolean,
      baseUrl: values["base-url"] as string | undefined,
      name: values.name as string | undefined,
      typesOnly: values["types-only"] as boolean,
    });

    console.log(`\n✨ API client generated successfully!`);
    console.log(`   📁 Output: ${outputDir}`);
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);

  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
