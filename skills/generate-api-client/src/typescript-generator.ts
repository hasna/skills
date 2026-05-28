import { openApiTypeToTS } from "./type-mappers";
import type { GenerateOptions, OpenAPISpec, PathItem } from "./types";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function methodNameFor(path: string, method: string, operation: PathItem) {
  const methodName = operation.summary?.replace(/[^a-zA-Z0-9]/g, "") ||
    `${method}${path.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "")}`;
  return methodName.charAt(0).toLowerCase() + methodName.slice(1);
}

export function generateTypeScriptTypes(spec: OpenAPISpec): string {
  let output = "// Generated types from OpenAPI specification\n\n";

  if (!spec.components?.schemas) {
    return output + "export type EmptyTypes = Record<string, never>;\n";
  }

  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    if (schema.description) {
      output += `/**\n * ${schema.description}\n */\n`;
    }
    output += `export interface ${name} ${openApiTypeToTS(schema, spec.components.schemas)}\n\n`;
  }

  return output;
}

function generateConfigFile(spec: OpenAPISpec, options: GenerateOptions) {
  const baseUrl = options.baseUrl || spec.servers?.[0]?.url || "";
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

  return configContent;
}

function appendTypeScriptEndpoint(content: string, path: string, method: string, operation: PathItem, indent: string) {
  const lowerMethodName = methodNameFor(path, method, operation);
  const pathParams = operation.parameters?.filter((param) => param.in === "path") || [];
  const queryParams = operation.parameters?.filter((param) => param.in === "query") || [];
  const hasBody = operation.requestBody && method !== "get";

  content += `${indent}/**\n`;
  content += `${indent} * ${operation.description || operation.summary || `${method.toUpperCase()} ${path}`}\n`;
  content += `${indent} */\n`;
  content += indent ? `${indent}async ${lowerMethodName}(` : `export async function ${lowerMethodName}(`;

  if (pathParams.length > 0 || queryParams.length > 0 || hasBody) {
    if (indent) {
      content += `params: {\n`;
      pathParams.forEach((param) => {
        content += `    ${param.name}${param.required ? "" : "?"}: ${openApiTypeToTS(param.schema)};\n`;
      });
      queryParams.forEach((param) => {
        content += `    ${param.name}${param.required ? "" : "?"}: ${openApiTypeToTS(param.schema)};\n`;
      });
      if (hasBody) {
        content += `    body?: any;\n`;
      }
      content += `  }`;
    } else {
      content += `params: { `;
      pathParams.forEach((param) => {
        content += `${param.name}${param.required ? "" : "?"}: ${openApiTypeToTS(param.schema)}; `;
      });
      queryParams.forEach((param) => {
        content += `${param.name}${param.required ? "" : "?"}: ${openApiTypeToTS(param.schema)}; `;
      });
      if (hasBody) {
        content += `body?: any; `;
      }
      content += `}`;
    }
  }

  content += `): Promise<any> {\n`;
  content += `${indent}  let path = "${path}";\n`;

  pathParams.forEach((param) => {
    content += `${indent}  path = path.replace("{${param.name}}", String(params.${param.name}));\n`;
  });

  if (queryParams.length > 0) {
    content += `${indent}  const queryParams = new URLSearchParams();\n`;
    queryParams.forEach((param) => {
      content += `${indent}  if (params.${param.name} !== undefined) queryParams.append("${param.name}", String(params.${param.name}));\n`;
    });
    content += `${indent}  if (queryParams.toString()) path += \`?\${queryParams.toString()}\`;\n`;
  }

  content += `${indent}  return ${indent ? "this." : ""}request(path, {\n`;
  content += `${indent}    method: "${method.toUpperCase()}",\n`;
  if (hasBody) {
    content += `${indent}    body: JSON.stringify(params.body),\n`;
  }
  content += `${indent}  });\n`;
  content += `${indent}}\n\n`;

  return content;
}

function generateClassClient(spec: OpenAPISpec, options: GenerateOptions, clientName: string) {
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

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.includes(method)) continue;
      clientContent = appendTypeScriptEndpoint(clientContent, path, method, operation, "  ");
    }
  }

  clientContent += `}\n`;
  return clientContent;
}

function generateModularClient(spec: OpenAPISpec, options: GenerateOptions, clientName: string) {
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

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.includes(method)) continue;
      indexContent = appendTypeScriptEndpoint(indexContent, path, method, operation, "");
    }
  }

  return indexContent;
}

function generateTypeScriptReadme(spec: OpenAPISpec, options: GenerateOptions, clientName: string) {
  const baseUrl = options.baseUrl || spec.servers?.[0]?.url || "";
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

  return readme;
}

export function generateTypeScriptFetchClient(spec: OpenAPISpec, options: GenerateOptions): Record<string, string> {
  const files: Record<string, string> = {};
  const clientName = options.name || spec.info.title.replace(/[^a-zA-Z0-9]/g, "") + "Client";

  files["types.ts"] = generateTypeScriptTypes(spec);
  files["config.ts"] = generateConfigFile(spec, options);

  if (options.style === "class") {
    files["client.ts"] = generateClassClient(spec, options, clientName);
  } else if (options.style === "modular") {
    files["index.ts"] = generateModularClient(spec, options, clientName);
  }

  files["README.md"] = generateTypeScriptReadme(spec, options, clientName);
  return files;
}
