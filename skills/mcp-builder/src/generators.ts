import * as fs from "fs";
import * as path from "path";

import { toSnakeCase } from "./naming";
import type { BuildOptions } from "./types";

export function generateTypeScript(options: BuildOptions): void {
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
export function generatePython(options: BuildOptions): void {
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
