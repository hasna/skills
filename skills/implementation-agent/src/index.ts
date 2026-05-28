#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import minimist from "minimist";

import { generateAgentsWithAI } from "./ai-generation";
import { TEMPLATES } from "./templates";
import type { AgentData, AgentJsonData, AgentTemplate } from "./types";

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["slug", "description", "tools", "model", "template", "prompt", "data", "generate"],
  boolean: ["global", "skip-sync", "skip-index", "list-templates", "help", "dry-run"],
  default: {
    model: "inherit",
    global: false,
    "skip-sync": false,
    "skip-index": false,
    "dry-run": false,
  },
  alias: {
    s: "slug",
    d: "description",
    t: "tools",
    m: "model",
    g: "global",
    p: "prompt",
    h: "help",
    "no-sync": "skip-sync",
    "no-index": "skip-index",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Agent - Create Claude Code agent definitions

Usage:
  skills run implementation-agent -- "<name>" [options]
  skills run implementation-agent -- --template <template> --slug <slug>
  skills run implementation-agent -- --generate "<prompt>"

Options:
  -s, --slug <name>         Slug identifier for the agent (required for manual creation)
  -d, --description <text>  When to invoke this agent
  -t, --tools <tools>       Comma-separated list of allowed tools
  -m, --model <model>       Model: sonnet, opus, haiku, inherit (default: inherit)
  --template <name>         Use a built-in template as base
  -p, --prompt <text>       Custom system prompt
  --data <json>             Full JSON configuration
  -g, --global              Save to ~/.claude/agents/ instead of project
  --no-sync, --skip-sync    Don't sync to .claude/agents/
  --no-index, --skip-index  Skip updating AGENTS.md index
  --list-templates          List all available templates
  --generate <prompt>       AI-powered agent generation from prompt
  --dry-run                 Preview generated agents without creating files
  -h, --help                Show this help

Templates:
  code-reviewer, debugger, test-writer, refactorer, documenter,
  security-auditor, performance-optimizer, api-designer,
  database-expert, devops-engineer

Examples:
  skills run implementation-agent -- "Code Reviewer" --slug code-reviewer
  skills run implementation-agent -- --template debugger --slug my-debugger
  skills run implementation-agent -- "Custom" --slug custom --tools "Read,Edit,Bash" --model sonnet
  skills run implementation-agent -- "Helper" --slug helper --global

  # AI-powered generation
  skills run implementation-agent -- --generate "I need agents for this e-commerce project"
  skills run implementation-agent -- --generate "Create a reviewer and debugger for this TypeScript API"
  skills run implementation-agent -- --generate "What agents would be useful for this Next.js app?" --dry-run
`);
  process.exit(0);
}

// List templates
if (args["list-templates"]) {
  console.log(`\nAvailable Agent Templates`);
  console.log(`=========================\n`);

  for (const [key, template] of Object.entries(TEMPLATES)) {
    console.log(`  ${key}`);
    console.log(`    ${template.description.substring(0, 70)}...`);
    console.log(`    Tools: ${template.tools.join(", ")}`);
    console.log();
  }

  console.log(`\nUsage: skills run implementation-agent -- --template <name> --slug <slug>`);
  process.exit(0);
}

// Get name (first positional argument)
const name = args._[0] as string;

// Check for template
const templateName = args.template as string;
let baseTemplate: AgentTemplate | null = null;

if (templateName) {
  if (!TEMPLATES[templateName]) {
    console.error(`Error: Unknown template "${templateName}"`);
    console.error(`Available templates: ${Object.keys(TEMPLATES).join(", ")}`);
    process.exit(1);
  }
  baseTemplate = TEMPLATES[templateName];
}

// Check for AI generation mode - skip validation if --generate is used
const isGenerateMode = !!args.generate;

// Require either name, template, or generate
if (!name && !baseTemplate && !isGenerateMode) {
  console.error("Error: Agent name, --template, or --generate is required");
  console.error('Usage: skills run implementation-agent -- "<name>" --slug <slug>');
  console.error("   or: skills run implementation-agent -- --template <template> --slug <slug>");
  console.error('   or: skills run implementation-agent -- --generate "<prompt>"');
  process.exit(1);
}

// Get slug (not required for generate mode)
const rawSlug = args.slug as string;

if (!rawSlug && !isGenerateMode) {
  console.error("Error: --slug is required");
  process.exit(1);
}

// Normalize slug (only if provided)
const slug = rawSlug ? rawSlug.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "") : "";

// Find .implementation directory
function findImplementationDir(): string | null {
  let currentDir = process.env.SKILLS_CWD || process.cwd();

  while (currentDir !== path.dirname(currentDir)) {
    const implDir = path.join(currentDir, ".implementation");
    if (fs.existsSync(implDir)) {
      return implDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

// Get project root (where .implementation is or cwd)
function getProjectRoot(): string {
  const implDir = findImplementationDir();
  if (implDir) {
    return path.dirname(implDir);
  }
  return process.env.SKILLS_CWD || process.cwd();
}

const implDir = findImplementationDir();
const isGlobal = args.global as boolean;

// For non-global agents, require .implementation directory
if (!isGlobal && !implDir) {
  console.error("Error: .implementation directory not found");
  console.error("Run 'skills run implementation-init' first to create the folder structure");
  console.error("Or use --global to create a global agent");
  process.exit(1);
}

// Output directories
const outputDir = isGlobal ? null : path.join(implDir!, "data", "agents");
const claudeAgentsDir = isGlobal
  ? path.join(os.homedir(), ".claude", "agents")
  : path.join(getProjectRoot(), ".claude", "agents");

// Ensure directories exist
if (outputDir && !fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

if (!args["skip-sync"] && !fs.existsSync(claudeAgentsDir)) {
  fs.mkdirSync(claudeAgentsDir, { recursive: true });
}

// Get next sequence number
function getNextSequence(): number {
  if (!outputDir || !fs.existsSync(outputDir)) return 1;

  const files = fs.readdirSync(outputDir);
  let maxSeq = 0;

  for (const file of files) {
    const match = file.match(/^agent_(\d{5})_/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  return maxSeq + 1;
}

const sequence = getNextSequence();
const agentId = `agent_${String(sequence).padStart(5, "0")}`;
const timestamp = new Date().toISOString().split("T")[0];

// Parse JSON data if provided
let jsonData: AgentJsonData | undefined;
if (args.data) {
  try {
    jsonData = JSON.parse(args.data as string);
  } catch (e) {
    console.error("Error: Invalid JSON data provided");
    process.exit(1);
  }
}

// Build agent data
const agentName = name || baseTemplate?.name || slug;
const description = args.description || jsonData?.description || baseTemplate?.description || `Agent for ${agentName}`;

// Parse tools
let tools: string[] = [];
if (args.tools) {
  tools = (args.tools as string).split(",").map((t) => t.trim());
} else if (jsonData?.tools) {
  tools = jsonData.tools;
} else if (baseTemplate?.tools) {
  tools = baseTemplate.tools;
}

// Get model
const model = args.model || jsonData?.model || baseTemplate?.model || "inherit";

// Get permission mode
const permissionMode = jsonData?.permissionMode || "default";

// Get skills
const skills = jsonData?.skills || [];

// Build prompt
let prompt: string;
if (args.prompt) {
  prompt = args.prompt as string;
} else if (baseTemplate?.prompt) {
  prompt = baseTemplate.prompt;
} else if (jsonData?.sections) {
  // Build from sections
  const parts: string[] = [];
  for (const section of jsonData.sections) {
    parts.push(`## ${section.title}\n`);
    if (section.content) {
      parts.push(section.content + "\n");
    }
    if (section.items) {
      for (const item of section.items) {
        parts.push(`- ${item}`);
      }
      parts.push("");
    }
  }
  prompt = parts.join("\n");
} else {
  prompt = `You are ${agentName}, a specialized AI assistant.

## When Invoked

1. Analyze the request carefully
2. Gather necessary context from the codebase
3. Execute the task systematically
4. Verify your work

## Guidelines

- Focus on the specific task at hand
- Use available tools effectively
- Provide clear, actionable output
- Ask for clarification if needed`;
}

const agentData: AgentData = {
  id: agentId,
  slug,
  name: agentName,
  description,
  tools,
  model,
  permissionMode,
  skills,
  prompt,
  created: timestamp,
  updated: timestamp,
  isGlobal,
  jsonData,
};

// Generate Claude Code agent markdown
function generateClaudeAgentMarkdown(data: AgentData): string {
  let content = `---\n`;
  content += `name: ${data.slug}\n`;
  content += `description: ${data.description}\n`;

  if (data.tools.length > 0) {
    content += `tools: ${data.tools.join(", ")}\n`;
  }

  if (data.model && data.model !== "inherit") {
    content += `model: ${data.model}\n`;
  }

  if (data.permissionMode && data.permissionMode !== "default") {
    content += `permissionMode: ${data.permissionMode}\n`;
  }

  if (data.skills.length > 0) {
    content += `skills: ${data.skills.join(", ")}\n`;
  }

  content += `---\n\n`;
  content += data.prompt;
  content += "\n";

  return content;
}

// Generate archived agent markdown (with metadata)
function generateArchivedMarkdown(data: AgentData): string {
  let content = `# Agent: ${data.name}\n\n`;

  content += `- **ID**: ${data.id}\n`;
  content += `- **Slug**: ${data.slug}\n`;
  content += `- **Description**: ${data.description}\n`;

  if (data.tools.length > 0) {
    content += `- **Tools**: ${data.tools.join(", ")}\n`;
  }

  content += `- **Model**: ${data.model}\n`;

  if (data.skills.length > 0) {
    content += `- **Skills**: ${data.skills.join(", ")}\n`;
  }

  content += `- **Global**: ${data.isGlobal ? "Yes" : "No"}\n`;
  content += `- **Created**: ${data.created}\n`;
  content += `- **Updated**: ${data.updated}\n`;

  content += `\n---\n\n`;
  content += `## System Prompt\n\n`;
  content += "```markdown\n";
  content += data.prompt;
  content += "\n```\n";

  content += `\n## Claude Code Format\n\n`;
  content += "```markdown\n";
  content += generateClaudeAgentMarkdown(data);
  content += "```\n";

  return content;
}

// Update index file
function updateIndex(data: AgentData, filename: string): void {
  if (!implDir) return;

  const indexPath = path.join(implDir, "data", "indexes", "AGENTS.md");

  if (!fs.existsSync(indexPath)) {
    // Create the index file if it doesn't exist
    const indexContent = `# Agents Index

Project: ${path.basename(getProjectRoot())}
Created: ${timestamp}

## Overview

This file indexes all agent definitions in this implementation.

## Agents

| ID | File | Name | Slug | Global | Created |
|----|------|------|------|--------|---------|
| - | - | No agents yet | - | - | - |

---

*Updated automatically by implementation-agent skill*
`;
    fs.writeFileSync(indexPath, indexContent);
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  const globalStr = data.isGlobal ? "Yes" : "No";
  const newRow = `| ${data.id} | ${filename} | ${data.name} | ${data.slug} | ${globalStr} | ${data.created} |`;

  if (content.includes("| - | - | No agents yet | - | - | - |")) {
    content = content.replace("| - | - | No agents yet | - | - | - |", newRow);
  } else {
    const tableMatch = content.match(/(## Agents[\s\S]*?\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|)/);
    if (tableMatch) {
      const insertPoint = tableMatch.index! + tableMatch[0].length;
      content = content.slice(0, insertPoint) + "\n" + newRow + content.slice(insertPoint);
    }
  }

  content = content.replace(/\*Updated.*\*/, `*Updated: ${timestamp}*`);
  fs.writeFileSync(indexPath, content);
}

// Main execution with AI generation support
async function mainWithGenerate(): Promise<void> {
  console.log(`\nImplementation Agent - AI Generation Mode`);
  console.log(`==========================================\n`);

  const generatePrompt = args.generate as string;
  const projectRoot = process.env.SKILLS_CWD || process.cwd();
  const isDryRun = args["dry-run"] as boolean;

  console.log(`Project: ${path.basename(projectRoot)}`);
  console.log(`Prompt: "${generatePrompt}"`);
  if (isDryRun) {
    console.log(`Mode: Dry run (no files will be created)\n`);
  } else {
    console.log();
  }

  // Generate agents
  const result = await generateAgentsWithAI(generatePrompt, projectRoot);

  console.log(`\n${"=".repeat(50)}`);
  console.log(`\nAI Analysis:`);
  console.log(`${result.reasoning}\n`);
  console.log(`Generated ${result.agents.length} agents:\n`);

  // Display agents
  for (const agent of result.agents) {
    console.log(`  ${agent.name} (${agent.slug})`);
    console.log(`    ${agent.description.substring(0, 70)}...`);
    console.log(`    Tools: ${agent.tools.join(", ")}`);
    console.log();
  }

  if (isDryRun) {
    console.log(`Dry run complete. No files created.`);
    console.log(`Remove --dry-run to create these agents.`);
    return;
  }

  // Create the agents
  console.log(`Creating agents...`);

  const localImplDir = findImplementationDir();
  const localProjectRoot = localImplDir ? path.dirname(localImplDir) : projectRoot;
  const localClaudeAgentsDir = args.global
    ? path.join(os.homedir(), ".claude", "agents")
    : path.join(localProjectRoot, ".claude", "agents");

  // Ensure directories exist
  if (!fs.existsSync(localClaudeAgentsDir)) {
    fs.mkdirSync(localClaudeAgentsDir, { recursive: true });
  }

  let localOutputDir: string | null = null;
  if (!args.global && localImplDir) {
    localOutputDir = path.join(localImplDir, "data", "agents");
    if (!fs.existsSync(localOutputDir)) {
      fs.mkdirSync(localOutputDir, { recursive: true });
    }
  }

  // Get starting sequence number
  let localSequence = 1;
  if (localOutputDir && fs.existsSync(localOutputDir)) {
    const files = fs.readdirSync(localOutputDir);
    for (const file of files) {
      const match = file.match(/^agent_(\d{5})_/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq >= localSequence) localSequence = seq + 1;
      }
    }
  }

  const localTimestamp = new Date().toISOString().split("T")[0];

  for (const agent of result.agents) {
    const localAgentId = `agent_${String(localSequence).padStart(5, "0")}`;

    const localAgentData: AgentData = {
      id: localAgentId,
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      tools: agent.tools,
      model: agent.model,
      permissionMode: "default",
      skills: [],
      prompt: agent.prompt,
      created: localTimestamp,
      updated: localTimestamp,
      isGlobal: args.global as boolean,
    };

    // Generate Claude Code agent file
    const claudeAgentContent = generateClaudeAgentMarkdown(localAgentData);
    const claudeAgentPath = path.join(localClaudeAgentsDir, `${agent.slug}.md`);

    if (!args["skip-sync"]) {
      fs.writeFileSync(claudeAgentPath, claudeAgentContent);
      console.log(`  Created: ${claudeAgentPath}`);
    }

    // Generate archived file (only for non-global)
    if (localOutputDir) {
      const archiveFilename = `${localAgentId}_${agent.slug.replace(/-/g, "_")}.md`;
      const archivePath = path.join(localOutputDir, archiveFilename);
      const archivedContent = generateArchivedMarkdown(localAgentData);
      fs.writeFileSync(archivePath, archivedContent);

      // Update index
      if (!args["skip-index"] && localImplDir) {
        updateIndex(localAgentData, archiveFilename);
      }
    }

    localSequence++;
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`\nSuccessfully created ${result.agents.length} agents!`);
  console.log(`\nUsage in Claude Code:`);
  for (const agent of result.agents) {
    console.log(`  > Use the ${agent.slug} agent to...`);
  }
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Agent`);
  console.log(`====================\n`);

  // Generate Claude Code agent file
  const claudeAgentContent = generateClaudeAgentMarkdown(agentData);
  const claudeAgentPath = path.join(claudeAgentsDir, `${slug}.md`);

  if (!args["skip-sync"]) {
    fs.writeFileSync(claudeAgentPath, claudeAgentContent);
    console.log(`Created Claude agent: ${claudeAgentPath}`);
  }

  // Generate archived file (only for non-global)
  let archiveFilename = "";
  if (outputDir) {
    archiveFilename = `${agentId}_${slug.replace(/-/g, "_")}.md`;
    const archivePath = path.join(outputDir, archiveFilename);
    const archivedContent = generateArchivedMarkdown(agentData);
    fs.writeFileSync(archivePath, archivedContent);
    console.log(`Created archive: ${archivePath}`);
  }

  console.log(`\nAgent Details:`);
  console.log(`  ID: ${agentData.id}`);
  console.log(`  Name: ${agentData.name}`);
  console.log(`  Slug: ${agentData.slug}`);
  console.log(`  Description: ${agentData.description.substring(0, 60)}...`);

  if (agentData.tools.length > 0) {
    console.log(`  Tools: ${agentData.tools.join(", ")}`);
  }

  console.log(`  Model: ${agentData.model}`);
  console.log(`  Global: ${agentData.isGlobal ? "Yes" : "No"}`);

  if (baseTemplate) {
    console.log(`  Template: ${templateName}`);
  }

  // Update index
  if (!args["skip-index"] && !isGlobal && outputDir) {
    console.log(`\nUpdating AGENTS.md index...`);
    updateIndex(agentData, archiveFilename);
    console.log(`Index updated.`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nAgent created successfully!`);

  if (!args["skip-sync"]) {
    console.log(`\nUsage in Claude Code:`);
    console.log(`  > Use the ${slug} agent to...`);
    console.log(`  > Have ${slug} review my code`);
  }
}

// Entry point - route to appropriate mode
if (args.generate) {
  mainWithGenerate().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}
