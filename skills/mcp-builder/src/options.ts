import * as fs from "fs";
import minimist from "minimist";

import { TEMPLATES } from "./templates";
import type { BuildOptions, PromptDef, ResourceDef, ToolDef } from "./types";

export function parseBuildOptions(argv = process.argv.slice(2)): BuildOptions {
  const args = minimist(argv, {
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

  return options;
}
