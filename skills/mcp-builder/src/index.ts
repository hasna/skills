#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";
import OpenAI from "openai";

// Types
interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
}

interface ParameterDef {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  default?: any;
  items?: { type: string };
}

interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

interface PromptDef {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
}

interface BuildOptions {
  name: string;
  language: "typescript" | "python";
  template: string | null;
  tools: ToolDef[];
  resources: ResourceDef[];
  prompts: PromptDef[];
  output: string;
  overwrite: boolean;
  aiDescriptions: boolean;
  withTests: boolean;
  withDocker: boolean;
}

// Templates
const TEMPLATES: Record<string, { tools: ToolDef[]; resources: ResourceDef[]; prompts: PromptDef[] }> = {
  weather: {
    tools: [
      {
        name: "get_current_weather",
        description: "Get current weather conditions for a location",
        parameters: {
          location: { type: "string", description: "City name or coordinates", required: true },
          units: { type: "string", description: "Temperature units: celsius or fahrenheit", default: "celsius" },
        },
      },
      {
        name: "get_forecast",
        description: "Get weather forecast for the next few days",
        parameters: {
          location: { type: "string", description: "City name or coordinates", required: true },
          days: { type: "number", description: "Number of days to forecast", default: 5 },
        },
      },
    ],
    resources: [{ uri: "weather://locations", name: "Saved Locations", description: "List of saved weather locations", mimeType: "application/json" }],
    prompts: [{ name: "weather_summary", description: "Generate a weather summary", arguments: [{ name: "location", description: "Location to summarize", required: true }] }],
  },
  database: {
    tools: [
      {
        name: "query",
        description: "Execute a SQL query and return results",
        parameters: {
          sql: { type: "string", description: "SQL query to execute", required: true },
          params: { type: "array", description: "Query parameters", items: { type: "string" } },
        },
      },
      {
        name: "insert",
        description: "Insert a record into a table",
        parameters: {
          table: { type: "string", description: "Table name", required: true },
          data: { type: "object", description: "Data to insert", required: true },
        },
      },
      {
        name: "update",
        description: "Update records in a table",
        parameters: {
          table: { type: "string", description: "Table name", required: true },
          data: { type: "object", description: "Data to update", required: true },
          where: { type: "string", description: "WHERE clause", required: true },
        },
      },
      {
        name: "delete",
        description: "Delete records from a table",
        parameters: {
          table: { type: "string", description: "Table name", required: true },
          where: { type: "string", description: "WHERE clause", required: true },
        },
      },
    ],
    resources: [
      { uri: "db://schema", name: "Database Schema", description: "Database schema information", mimeType: "application/json" },
      { uri: "db://tables", name: "Tables List", description: "List of all tables", mimeType: "application/json" },
    ],
    prompts: [],
  },
  api: {
    tools: [
      {
        name: "get",
        description: "Make a GET request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
      {
        name: "post",
        description: "Make a POST request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          body: { type: "object", description: "Request body", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
      {
        name: "put",
        description: "Make a PUT request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          body: { type: "object", description: "Request body", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
      {
        name: "delete",
        description: "Make a DELETE request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
    ],
    resources: [],
    prompts: [],
  },
  filesystem: {
    tools: [
      {
        name: "read_file",
        description: "Read contents of a file",
        parameters: {
          path: { type: "string", description: "File path", required: true },
          encoding: { type: "string", description: "File encoding", default: "utf-8" },
        },
      },
      {
        name: "write_file",
        description: "Write contents to a file",
        parameters: {
          path: { type: "string", description: "File path", required: true },
          content: { type: "string", description: "Content to write", required: true },
          encoding: { type: "string", description: "File encoding", default: "utf-8" },
        },
      },
      {
        name: "list_directory",
        description: "List contents of a directory",
        parameters: {
          path: { type: "string", description: "Directory path", required: true },
          recursive: { type: "boolean", description: "List recursively", default: false },
        },
      },
      {
        name: "search_files",
        description: "Search for files matching a pattern",
        parameters: {
          pattern: { type: "string", description: "Search pattern (glob)", required: true },
          path: { type: "string", description: "Starting directory", default: "." },
        },
      },
    ],
    resources: [{ uri: "file://{path}", name: "File Content", description: "Content of a file", mimeType: "text/plain" }],
    prompts: [],
  },
};

// Parse arguments
const args = minimist(process.argv.slice(2), {
  string: ["language", "template", "tools", "tool-file", "resources", "resource-file", "prompts", "prompt-file", "output"],
  boolean: ["overwrite", "ai-descriptions", "with-tests", "with-docker", "help"],
  default: {
    language: "typescript",
  },
  alias: {
    o: "output",
    h: "help",
  },
});

// Show help
if (args.help || args._.length === 0) {
  console.log(`
MCP Builder - Generate MCP server projects

Usage:
  skills run mcp-builder -- <name> [options]

Basic Options:
  <name>                  Server name (required)
  --language <lang>       Language: typescript, python (default: typescript)
  --template <name>       Template: weather, database, api, filesystem

Tool Options:
  --tools <list>          Comma-separated tool names
  --tool-file <path>      JSON file with tool definitions

Resource Options:
  --resources <list>      Comma-separated resource URIs
  --resource-file <path>  JSON file with resource definitions

Prompt Options:
  --prompts <list>        Comma-separated prompt names
  --prompt-file <path>    JSON file with prompt definitions

Output Options:
  -o, --output <path>     Output directory (default: ./<name>)
  --overwrite             Overwrite existing files

Generation Options:
  --ai-descriptions       Generate descriptions with AI
  --with-tests            Include test files
  --with-docker           Include Dockerfile
  -h, --help              Show this help message

Examples:
  skills run mcp-builder -- my-server --tools "search,fetch,analyze"
  skills run mcp-builder -- weather-mcp --template weather
  skills run mcp-builder -- api-server --tool-file tools.json --language python
`);
  process.exit(0);
}

// Get server name
const serverName = args._[0] as string;
if (!serverName) {
  console.error("Error: Server name is required");
  process.exit(1);
}

// Validate name
if (!/^[a-z][a-z0-9-]*$/.test(serverName)) {
  console.error("Error: Server name must start with a letter and contain only lowercase letters, numbers, and hyphens");
  process.exit(1);
}

// Parse tool names into definitions
function parseToolNames(names: string): ToolDef[] {
  return names.split(",").map((name) => ({
    name: name.trim().replace(/\s+/g, "_"),
    description: `TODO: Add description for ${name.trim()}`,
    parameters: {},
  }));
}

// Parse resource URIs into definitions
function parseResourceURIs(uris: string): ResourceDef[] {
  return uris.split(",").map((uri) => ({
    uri: uri.trim(),
    name: uri.trim().split("://")[1] || uri.trim(),
    description: `TODO: Add description`,
    mimeType: "application/json",
  }));
}

// Parse prompt names into definitions
function parsePromptNames(names: string): PromptDef[] {
  return names.split(",").map((name) => ({
    name: name.trim().replace(/\s+/g, "_"),
    description: `TODO: Add description for ${name.trim()}`,
    arguments: [],
  }));
}

// Load definitions from file
function loadFromFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);
  return Array.isArray(data) ? data : data.tools || data.resources || data.prompts || [];
}

// Build options
const options: BuildOptions = {
  name: serverName,
  language: args.language as BuildOptions["language"],
  template: args.template || null,
  tools: [],
  resources: [],
  prompts: [],
  output: args.output || `./${serverName}`,
  overwrite: args.overwrite,
  aiDescriptions: args["ai-descriptions"],
  withTests: args["with-tests"],
  withDocker: args["with-docker"],
};

// Load template if specified
if (options.template) {
  const template = TEMPLATES[options.template];
  if (!template) {
    console.error(`Error: Unknown template: ${options.template}`);
    console.error(`Available templates: ${Object.keys(TEMPLATES).join(", ")}`);
    process.exit(1);
  }
  options.tools = [...template.tools];
  options.resources = [...template.resources];
  options.prompts = [...template.prompts];
}

// Add tools from arguments
if (args.tools) {
  options.tools.push(...parseToolNames(args.tools));
}
if (args["tool-file"]) {
  options.tools.push(...loadFromFile<ToolDef>(args["tool-file"]));
}

// Add resources from arguments
if (args.resources) {
  options.resources.push(...parseResourceURIs(args.resources));
}
if (args["resource-file"]) {
  options.resources.push(...loadFromFile<ResourceDef>(args["resource-file"]));
}

// Add prompts from arguments
if (args.prompts) {
  options.prompts.push(...parsePromptNames(args.prompts));
}
if (args["prompt-file"]) {
  options.prompts.push(...loadFromFile<PromptDef>(args["prompt-file"]));
}

// Generate AI descriptions
async function generateDescriptions(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("Warning: OPENAI_API_KEY not set, skipping AI descriptions");
    return;
  }

  const openai = new OpenAI({ apiKey });

  console.log("Generating AI descriptions...");

  for (const tool of options.tools) {
    if (tool.description.startsWith("TODO:")) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Generate a concise, clear description for an MCP tool. One sentence, no markdown.",
          },
          {
            role: "user",
            content: `Tool name: ${tool.name}\nParameters: ${JSON.stringify(tool.parameters)}`,
          },
        ],
        max_tokens: 100,
      });
      tool.description = response.choices[0]?.message?.content || tool.description;
    }
  }
}

// Convert name to various formats
function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function toSnakeCase(name: string): string {
  return name.replace(/-/g, "_");
}

// Generate TypeScript project
function generateTypeScript(): void {
  const dir = options.output;
  const srcDir = path.join(dir, "src");
  const toolsDir = path.join(srcDir, "tools");
  const resourcesDir = path.join(srcDir, "resources");
  const promptsDir = path.join(srcDir, "prompts");

  // Create directories
  [dir, srcDir, toolsDir, resourcesDir, promptsDir].forEach((d) => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  });

  // package.json
  const packageJson = {
    name: options.name,
    version: "1.0.0",
    description: `MCP server: ${options.name}`,
    type: "module",
    main: "dist/index.js",
    scripts: {
      build: "tsc",
      start: "node dist/index.js",
      dev: "tsx src/index.ts",
      ...(options.withTests ? { test: "vitest" } : {}),
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.0.0",
    },
    devDependencies: {
      "@types/node": "^20.0.0",
      typescript: "^5.0.0",
      tsx: "^4.0.0",
      ...(options.withTests ? { vitest: "^1.0.0" } : {}),
    },
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson, null, 2));

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "./dist",
      rootDir: "./src",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: true,
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist"],
  };
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

  // src/index.ts
  const indexTs = `#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setupTools } from "./tools/index.js";
import { setupResources } from "./resources/index.js";
import { setupPrompts } from "./prompts/index.js";

const server = new Server(
  {
    name: "${options.name}",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Setup handlers
setupTools(server);
setupResources(server);
setupPrompts(server);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("${options.name} MCP server running on stdio");
}

main().catch(console.error);
`;
  fs.writeFileSync(path.join(srcDir, "index.ts"), indexTs);

  // src/tools/index.ts
  const toolImports = options.tools.map((t) => `import { ${t.name} } from "./${t.name}.js";`).join("\n");
  const toolHandlers = options.tools
    .map(
      (t) => `
    case "${t.name}":
      return await ${t.name}(args);`
    )
    .join("");

  const toolsIndexTs = `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

${toolImports}

export const tools = [
${options.tools
  .map(
    (t) => `  {
    name: "${t.name}",
    description: "${t.description}",
    inputSchema: {
      type: "object",
      properties: {
${Object.entries(t.parameters)
  .map(
    ([name, param]) => `        ${name}: {
          type: "${param.type}",
          description: "${param.description}",
          ${param.default !== undefined ? `default: ${JSON.stringify(param.default)},` : ""}
        }`
  )
  .join(",\n")}
      },
      required: [${Object.entries(t.parameters)
        .filter(([, p]) => p.required)
        .map(([n]) => `"${n}"`)
        .join(", ")}],
    },
  }`
  )
  .join(",\n")}
];

export function setupTools(server: Server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {${toolHandlers}
      default:
        throw new Error(\`Unknown tool: \${name}\`);
    }
  });
}
`;
  fs.writeFileSync(path.join(toolsDir, "index.ts"), toolsIndexTs);

  // Individual tool files
  for (const tool of options.tools) {
    const paramTypes = Object.entries(tool.parameters)
      .map(([name, param]) => `${name}${param.required ? "" : "?"}: ${param.type === "array" ? "string[]" : param.type}`)
      .join("; ");

    const toolTs = `export async function ${tool.name}(args: { ${paramTypes} }) {
  // TODO: Implement ${tool.name}
  return {
    content: [
      {
        type: "text",
        text: \`${tool.name} called with: \${JSON.stringify(args)}\`,
      },
    ],
  };
}
`;
    fs.writeFileSync(path.join(toolsDir, `${tool.name}.ts`), toolTs);
  }

  // src/resources/index.ts
  const resourcesIndexTs = `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const resources = [
${options.resources.map((r) => `  { uri: "${r.uri}", name: "${r.name}", description: "${r.description}", mimeType: "${r.mimeType || "application/json"}" }`).join(",\n")}
];

export function setupResources(server: Server) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // TODO: Implement resource handlers
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ message: "Resource content for " + uri }),
        },
      ],
    };
  });
}
`;
  fs.writeFileSync(path.join(resourcesDir, "index.ts"), resourcesIndexTs);

  // src/prompts/index.ts
  const promptsIndexTs = `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const prompts = [
${options.prompts.map((p) => `  { name: "${p.name}", description: "${p.description}", arguments: ${JSON.stringify(p.arguments || [])} }`).join(",\n")}
];

export function setupPrompts(server: Server) {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // TODO: Implement prompt handlers
    return {
      description: \`Prompt: \${name}\`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: \`Executing prompt \${name} with args: \${JSON.stringify(args)}\`,
          },
        },
      ],
    };
  });
}
`;
  fs.writeFileSync(path.join(promptsDir, "index.ts"), promptsIndexTs);

  // README.md
  const readme = `# ${options.name}

MCP server generated by skills.md/mcp-builder.

## Installation

\`\`\`bash
npm install
npm run build
\`\`\`

## Usage

Add to your Claude configuration:

\`\`\`json
{
  "mcpServers": {
    "${options.name}": {
      "command": "node",
      "args": ["${path.resolve(dir)}/dist/index.js"]
    }
  }
}
\`\`\`

## Tools

${options.tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n")}

## Resources

${options.resources.map((r) => `- **${r.uri}**: ${r.description}`).join("\n") || "None"}

## Prompts

${options.prompts.map((p) => `- **${p.name}**: ${p.description}`).join("\n") || "None"}
`;
  fs.writeFileSync(path.join(dir, "README.md"), readme);

  // Dockerfile
  if (options.withDocker) {
    const dockerfile = `FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
`;
    fs.writeFileSync(path.join(dir, "Dockerfile"), dockerfile);
  }
}

// Generate Python project
function generatePython(): void {
  const dir = options.output;
  const srcDir = path.join(dir, "src", toSnakeCase(options.name));

  // Create directories
  [dir, path.join(dir, "src"), srcDir].forEach((d) => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  });

  // pyproject.toml
  const pyproject = `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "${options.name}"
version = "1.0.0"
description = "MCP server: ${options.name}"
requires-python = ">=3.10"
dependencies = [
    "mcp>=1.0.0",
]

[project.scripts]
${options.name} = "${toSnakeCase(options.name)}:main"
`;
  fs.writeFileSync(path.join(dir, "pyproject.toml"), pyproject);

  // __init__.py
  const initPy = `from .server import main

__all__ = ["main"]
`;
  fs.writeFileSync(path.join(srcDir, "__init__.py"), initPy);

  // __main__.py
  const mainPy = `from .server import main

if __name__ == "__main__":
    main()
`;
  fs.writeFileSync(path.join(srcDir, "__main__.py"), mainPy);

  // server.py
  const serverPy = `import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server

from .tools import setup_tools
from .resources import setup_resources
from .prompts import setup_prompts

server = Server("${options.name}")

setup_tools(server)
setup_resources(server)
setup_prompts(server)


def main():
    asyncio.run(run_server())


async def run_server():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())
`;
  fs.writeFileSync(path.join(srcDir, "server.py"), serverPy);

  // tools.py
  const toolFunctions = options.tools
    .map(
      (t) => `
@server.tool()
async def ${t.name}(${Object.entries(t.parameters)
        .map(([name, param]) => `${name}: ${param.type === "number" ? "float" : param.type === "boolean" ? "bool" : param.type === "array" ? "list" : "str"}${param.required ? "" : " = None"}`)
        .join(", ")}):
    """${t.description}"""
    # TODO: Implement ${t.name}
    return f"${t.name} called"
`
    )
    .join("\n");

  const toolsPy = `from mcp.server import Server

server: Server = None


def setup_tools(s: Server):
    global server
    server = s
${toolFunctions}
`;
  fs.writeFileSync(path.join(srcDir, "tools.py"), toolsPy);

  // resources.py
  const resourcesPy = `from mcp.server import Server

server: Server = None


def setup_resources(s: Server):
    global server
    server = s

    @server.list_resources()
    async def list_resources():
        return [
${options.resources.map((r) => `            {"uri": "${r.uri}", "name": "${r.name}", "description": "${r.description}"}`).join(",\n")}
        ]

    @server.read_resource()
    async def read_resource(uri: str):
        # TODO: Implement resource handlers
        return f"Resource content for {uri}"
`;
  fs.writeFileSync(path.join(srcDir, "resources.py"), resourcesPy);

  // prompts.py
  const promptsPy = `from mcp.server import Server

server: Server = None


def setup_prompts(s: Server):
    global server
    server = s

    @server.list_prompts()
    async def list_prompts():
        return [
${options.prompts.map((p) => `            {"name": "${p.name}", "description": "${p.description}"}`).join(",\n")}
        ]

    @server.get_prompt()
    async def get_prompt(name: str, arguments: dict = None):
        # TODO: Implement prompt handlers
        return {
            "messages": [
                {"role": "user", "content": f"Prompt {name} with {arguments}"}
            ]
        }
`;
  fs.writeFileSync(path.join(srcDir, "prompts.py"), promptsPy);

  // README.md
  const readme = `# ${options.name}

MCP server generated by skills.md/mcp-builder.

## Installation

\`\`\`bash
pip install -e .
\`\`\`

## Usage

Add to your Claude configuration:

\`\`\`json
{
  "mcpServers": {
    "${options.name}": {
      "command": "python",
      "args": ["-m", "${toSnakeCase(options.name)}"]
    }
  }
}
\`\`\`

## Tools

${options.tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n")}
`;
  fs.writeFileSync(path.join(dir, "README.md"), readme);

  // Dockerfile
  if (options.withDocker) {
    const dockerfile = `FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/

RUN pip install -e .

CMD ["python", "-m", "${toSnakeCase(options.name)}"]
`;
    fs.writeFileSync(path.join(dir, "Dockerfile"), dockerfile);
  }
}

// Main execution
async function main(): Promise<void> {
  console.log("\nMCP Builder");
  console.log("===========\n");

  // Check if output exists
  if (fs.existsSync(options.output) && !options.overwrite) {
    console.error(`Error: Directory already exists: ${options.output}`);
    console.error("Use --overwrite to replace existing files");
    process.exit(1);
  }

  // Generate AI descriptions if requested
  if (options.aiDescriptions) {
    await generateDescriptions();
  }

  console.log(`Server name: ${options.name}`);
  console.log(`Language: ${options.language}`);
  console.log(`Tools: ${options.tools.length}`);
  console.log(`Resources: ${options.resources.length}`);
  console.log(`Prompts: ${options.prompts.length}`);
  console.log("");

  // Generate project
  if (options.language === "typescript") {
    generateTypeScript();
  } else {
    generatePython();
  }

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log("MCP Server Generated");
  console.log("=".repeat(50));
  console.log(`  Output: ${options.output}`);
  console.log(`  Language: ${options.language}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${options.output}`);
  if (options.language === "typescript") {
    console.log("  npm install");
    console.log("  npm run build");
  } else {
    console.log("  pip install -e .");
  }
  console.log("");
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
