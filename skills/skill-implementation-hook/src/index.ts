#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import minimist from "minimist";

// Types
type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Notification"
  | "Stop"
  | "SubagentStop"
  | "SessionStart"
  | "SessionEnd"
  | "PermissionRequest"
  | "PreCompact";

interface HookConfig {
  type: "command" | "prompt";
  command?: string;
  prompt?: string;
  timeout?: number;
}

interface HookMatcher {
  matcher: string;
  hooks: HookConfig[];
}

interface ClaudeHooksSettings {
  hooks: {
    [key in HookEvent]?: HookMatcher[];
  };
}

interface HookJsonData {
  event?: HookEvent;
  matcher?: string;
  type?: "command" | "prompt";
  command?: string;
  prompt?: string;
  timeout?: number;
  description?: string;
}

interface HookData {
  id: string;
  slug: string;
  name: string;
  description: string;
  event: HookEvent;
  matcher: string;
  type: "command" | "prompt";
  command?: string;
  prompt?: string;
  timeout: number;
  created: string;
  updated: string;
  jsonData?: HookJsonData;
}

interface HookTemplate {
  name: string;
  description: string;
  event: HookEvent;
  matcher: string;
  type: "command" | "prompt";
  command?: string;
  prompt?: string;
  timeout?: number;
}

// Built-in hook templates
const TEMPLATES: Record<string, HookTemplate> = {
  // Code Quality
  "format-prettier": {
    name: "Prettier Formatter",
    description: "Auto-format files with Prettier after edits",
    event: "PostToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -r '.tool_input.file_path' | { read file_path; if [[ "$file_path" =~ \\.(ts|tsx|js|jsx|json|css|scss|md|yaml|yml)$ ]]; then npx prettier --write "$file_path" 2>/dev/null || true; fi; }`,
    timeout: 30,
  },

  "format-biome": {
    name: "Biome Formatter",
    description: "Auto-format files with Biome after edits",
    event: "PostToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -r '.tool_input.file_path' | { read file_path; if [[ "$file_path" =~ \\.(ts|tsx|js|jsx|json)$ ]]; then npx biome format --write "$file_path" 2>/dev/null || true; fi; }`,
    timeout: 30,
  },

  "lint-eslint": {
    name: "ESLint Checker",
    description: "Run ESLint after JavaScript/TypeScript changes",
    event: "PostToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -r '.tool_input.file_path' | { read file_path; if [[ "$file_path" =~ \\.(ts|tsx|js|jsx)$ ]]; then npx eslint --fix "$file_path" 2>/dev/null || true; fi; }`,
    timeout: 60,
  },

  "lint-typescript": {
    name: "TypeScript Checker",
    description: "Type-check after TypeScript file changes",
    event: "PostToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -r '.tool_input.file_path' | { read file_path; if [[ "$file_path" =~ \\.tsx?$ ]]; then npx tsc --noEmit 2>&1 | head -20 || true; fi; }`,
    timeout: 120,
  },

  "test-on-change": {
    name: "Test Runner",
    description: "Run related tests after code changes",
    event: "PostToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -r '.tool_input.file_path' | { read file_path; if [[ "$file_path" =~ \\.(ts|tsx|js|jsx)$ ]] && [[ ! "$file_path" =~ \\.test\\. ]] && [[ ! "$file_path" =~ \\.spec\\. ]]; then npx jest --findRelatedTests "$file_path" --passWithNoTests 2>/dev/null || true; fi; }`,
    timeout: 300,
  },

  // Security
  "protect-env": {
    name: "Protect .env Files",
    description: "Block edits to .env files",
    event: "PreToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -e '.tool_input.file_path | test("\\.env") | not' > /dev/null || { echo "Blocked: Cannot edit .env files" >&2; exit 2; }`,
    timeout: 5,
  },

  "protect-secrets": {
    name: "Protect Sensitive Files",
    description: "Block edits to sensitive files (.env, credentials, keys)",
    event: "PreToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -e '.tool_input.file_path | test("\\.env|credentials|secret|key\\.json|\\.pem$") | not' > /dev/null || { echo "Blocked: Cannot edit sensitive files" >&2; exit 2; }`,
    timeout: 5,
  },

  "protect-lockfiles": {
    name: "Protect Lock Files",
    description: "Block edits to package lock files",
    event: "PreToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -e '.tool_input.file_path | test("package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|bun\\.lockb") | not' > /dev/null || { echo "Blocked: Cannot edit lock files directly" >&2; exit 2; }`,
    timeout: 5,
  },

  "protect-git": {
    name: "Protect Git Directory",
    description: "Block edits to .git directory",
    event: "PreToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -e '.tool_input.file_path | test("^\\.git/|\\/\\.git\\/") | not' > /dev/null || { echo "Blocked: Cannot edit .git directory" >&2; exit 2; }`,
    timeout: 5,
  },

  "scan-secrets": {
    name: "Secret Scanner",
    description: "Scan files for leaked secrets after edits",
    event: "PostToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -r '.tool_input.file_path' | { read file_path; if grep -qE "(sk-[a-zA-Z0-9]{48}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16})" "$file_path" 2>/dev/null; then echo "Warning: Possible secret detected in $file_path" >&2; fi; }`,
    timeout: 10,
  },

  // Logging
  "log-bash": {
    name: "Bash Command Logger",
    description: "Log all bash commands to file",
    event: "PostToolUse",
    matcher: "Bash",
    type: "command",
    command: `jq -r '"\(.tool_input.command) -- \(.tool_input.description // "No description")"' >> ~/.claude/bash-commands.log`,
    timeout: 5,
  },

  "log-edits": {
    name: "File Edit Logger",
    description: "Log all file edits to file",
    event: "PostToolUse",
    matcher: "Edit|Write",
    type: "command",
    command: `jq -r '"[\(now | strftime("%Y-%m-%d %H:%M:%S"))] \(.tool_name): \(.tool_input.file_path)"' >> ~/.claude/file-edits.log`,
    timeout: 5,
  },

  "log-session": {
    name: "Session Logger",
    description: "Log session start and end events",
    event: "SessionStart",
    matcher: "",
    type: "command",
    command: `jq -r '"[\(now | strftime("%Y-%m-%d %H:%M:%S"))] Session \(.source // "started"): \(.session_id)"' >> ~/.claude/sessions.log`,
    timeout: 5,
  },

  // Notifications
  "notify-macos": {
    name: "macOS Notifications",
    description: "Show macOS notification when Claude needs attention",
    event: "Notification",
    matcher: "",
    type: "command",
    command: `osascript -e 'display notification "Claude Code needs your attention" with title "Claude Code"'`,
    timeout: 5,
  },

  "notify-terminal": {
    name: "Terminal Bell",
    description: "Ring terminal bell on notifications",
    event: "Notification",
    matcher: "",
    type: "command",
    command: `echo -e '\\a'`,
    timeout: 1,
  },

  // Smart hooks (prompt-based)
  "smart-stop": {
    name: "Smart Stop",
    description: "Use LLM to evaluate if tasks are complete before stopping",
    event: "Stop",
    matcher: "",
    type: "prompt",
    prompt: `Evaluate if Claude should stop. Check if all requested tasks are complete and no follow-up work is needed. Respond with JSON: {"decision": "approve" or "block", "reason": "brief explanation"}`,
    timeout: 30,
  },

  "validate-prompt": {
    name: "Prompt Validator",
    description: "Validate user prompts before processing",
    event: "UserPromptSubmit",
    matcher: "",
    type: "command",
    command: `jq -e '.prompt | length < 10000' > /dev/null || { echo "Prompt too long (max 10000 chars)" >&2; exit 2; }`,
    timeout: 5,
  },
};

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["slug", "event", "matcher", "command", "prompt", "data", "timeout"],
  boolean: ["install", "global", "skip-index", "list-templates", "list-events", "help"],
  default: {
    timeout: "60",
    install: false,
    global: false,
    "skip-index": false,
  },
  alias: {
    s: "slug",
    e: "event",
    m: "matcher",
    c: "command",
    p: "prompt",
    t: "template",
    d: "data",
    i: "install",
    g: "global",
    h: "help",
    "no-index": "skip-index",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Hook - Create Claude Code hook configurations

Usage:
  skills run implementation-hook -- "<name>" [options]
  skills run implementation-hook -- --template <template> --slug <slug>

Options:
  -s, --slug <name>         Slug identifier for the hook (required)
  -e, --event <event>       Hook event type (required without template)
  -m, --matcher <pattern>   Tool pattern to match (e.g., "Edit|Write")
  -c, --command <cmd>       Shell command to run
  -p, --prompt <text>       LLM prompt (for prompt-type hooks)
  -t, --template <name>     Use a built-in template
  -d, --data <json>         Full JSON configuration
  --timeout <seconds>       Command timeout (default: 60)
  -i, --install             Add to Claude Code settings
  -g, --global              Install to ~/.claude/settings.json (with -i)
  --no-index, --skip-index  Skip updating HOOKS.md index
  --list-templates          List all available templates
  --list-events             List all hook events
  -h, --help                Show this help

Events:
  PreToolUse, PostToolUse, UserPromptSubmit, Notification,
  Stop, SubagentStop, SessionStart, SessionEnd

Templates:
  format-prettier, format-biome, lint-eslint, lint-typescript,
  test-on-change, protect-env, protect-secrets, protect-lockfiles,
  protect-git, scan-secrets, log-bash, log-edits, log-session,
  notify-macos, notify-terminal, smart-stop, validate-prompt

Examples:
  skills run implementation-hook -- "Format Code" --slug format --template format-prettier
  skills run implementation-hook -- "Block .env" --slug protect-env -e PreToolUse -m "Edit|Write" -c 'jq -e ".file_path | test(\".env\") | not"'
  skills run implementation-hook -- --template format-prettier --slug prettier --install
`);
  process.exit(0);
}

// List events
if (args["list-events"]) {
  console.log(`\nAvailable Hook Events`);
  console.log(`=====================\n`);

  const events = [
    { name: "PreToolUse", desc: "Before tool execution - can block/modify actions" },
    { name: "PostToolUse", desc: "After tool completes - format, validate, log" },
    { name: "UserPromptSubmit", desc: "When user submits prompt - add context, validate" },
    { name: "Notification", desc: "When Claude sends notification - custom handling" },
    { name: "Stop", desc: "When Claude finishes responding - intelligent stopping" },
    { name: "SubagentStop", desc: "When subagent completes - evaluate completion" },
    { name: "SessionStart", desc: "At session start/resume - load context, setup" },
    { name: "SessionEnd", desc: "At session end - cleanup, logging" },
    { name: "PermissionRequest", desc: "When permission dialog is shown" },
    { name: "PreCompact", desc: "Before context compaction" },
  ];

  for (const event of events) {
    console.log(`  ${event.name}`);
    console.log(`    ${event.desc}`);
    console.log();
  }

  process.exit(0);
}

// List templates
if (args["list-templates"]) {
  console.log(`\nAvailable Hook Templates`);
  console.log(`========================\n`);

  const categories: Record<string, string[]> = {
    "Code Quality": ["format-prettier", "format-biome", "lint-eslint", "lint-typescript", "test-on-change"],
    Security: ["protect-env", "protect-secrets", "protect-lockfiles", "protect-git", "scan-secrets"],
    Logging: ["log-bash", "log-edits", "log-session"],
    Notifications: ["notify-macos", "notify-terminal"],
    "Smart Hooks": ["smart-stop", "validate-prompt"],
  };

  for (const [category, templates] of Object.entries(categories)) {
    console.log(`${category}:`);
    for (const key of templates) {
      const template = TEMPLATES[key];
      console.log(`  ${key}`);
      console.log(`    ${template.description}`);
    }
    console.log();
  }

  console.log(`Usage: skills run implementation-hook -- --template <name> --slug <slug>`);
  process.exit(0);
}

// Get name (first positional argument)
const name = args._[0] as string;

// Check for template
const templateName = args.template as string;
let baseTemplate: HookTemplate | null = null;

if (templateName) {
  if (!TEMPLATES[templateName]) {
    console.error(`Error: Unknown template "${templateName}"`);
    console.error(`Use --list-templates to see available templates`);
    process.exit(1);
  }
  baseTemplate = TEMPLATES[templateName];
}

// Get slug
const rawSlug = args.slug as string;

if (!rawSlug) {
  console.error("Error: --slug is required");
  process.exit(1);
}

// Normalize slug
const slug = rawSlug.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");

// Parse JSON data if provided
let jsonData: HookJsonData | undefined;
if (args.data) {
  try {
    jsonData = JSON.parse(args.data as string);
  } catch (e) {
    console.error("Error: Invalid JSON data provided");
    process.exit(1);
  }
}

// Get event
const eventArg = args.event || jsonData?.event || baseTemplate?.event;
if (!eventArg) {
  console.error("Error: --event is required (or use --template)");
  console.error("Use --list-events to see available events");
  process.exit(1);
}

const validEvents: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PermissionRequest",
  "PreCompact",
];

if (!validEvents.includes(eventArg as HookEvent)) {
  console.error(`Error: Invalid event "${eventArg}"`);
  console.error(`Valid events: ${validEvents.join(", ")}`);
  process.exit(1);
}

const event = eventArg as HookEvent;

// Get matcher
const matcher = args.matcher || jsonData?.matcher || baseTemplate?.matcher || "";

// Get type
const hookType = jsonData?.type || baseTemplate?.type || (args.prompt ? "prompt" : "command");

// Get command/prompt
const command = args.command || jsonData?.command || baseTemplate?.command;
const prompt = args.prompt || jsonData?.prompt || baseTemplate?.prompt;

if (hookType === "command" && !command) {
  console.error("Error: --command is required for command-type hooks");
  process.exit(1);
}

if (hookType === "prompt" && !prompt) {
  console.error("Error: --prompt is required for prompt-type hooks");
  process.exit(1);
}

// Get timeout
const timeout = parseInt(args.timeout) || jsonData?.timeout || baseTemplate?.timeout || 60;

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

// Get project root
function getProjectRoot(): string {
  const implDir = findImplementationDir();
  if (implDir) {
    return path.dirname(implDir);
  }
  return process.env.SKILLS_CWD || process.cwd();
}

const implDir = findImplementationDir();
const isGlobal = args.global as boolean;
const shouldInstall = args.install as boolean;

// For hooks, we always need .implementation directory to store the archive
if (!implDir) {
  console.error("Error: .implementation directory not found");
  console.error("Run 'skills run implementation-init' first to create the folder structure");
  process.exit(1);
}

// Output directory
const outputDir = path.join(implDir, "data", "hooks");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Get next sequence number
function getNextSequence(): number {
  if (!fs.existsSync(outputDir)) return 1;

  const files = fs.readdirSync(outputDir);
  let maxSeq = 0;

  for (const file of files) {
    const match = file.match(/^hook_(\d{5})_/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }

  return maxSeq + 1;
}

const sequence = getNextSequence();
const hookId = `hook_${String(sequence).padStart(5, "0")}`;
const timestamp = new Date().toISOString().split("T")[0];

// Build hook data
const hookName = name || baseTemplate?.name || slug;
const description = jsonData?.description || baseTemplate?.description || `Hook for ${hookName}`;

const hookData: HookData = {
  id: hookId,
  slug,
  name: hookName,
  description,
  event,
  matcher,
  type: hookType as "command" | "prompt",
  command,
  prompt,
  timeout,
  created: timestamp,
  updated: timestamp,
  jsonData,
};

// Generate hook markdown
function generateHookMarkdown(data: HookData): string {
  let content = `# Hook: ${data.name}\n\n`;

  content += `- **ID**: ${data.id}\n`;
  content += `- **Slug**: ${data.slug}\n`;
  content += `- **Description**: ${data.description}\n`;
  content += `- **Event**: ${data.event}\n`;
  content += `- **Matcher**: ${data.matcher || "(all)"}\n`;
  content += `- **Type**: ${data.type}\n`;
  content += `- **Timeout**: ${data.timeout}s\n`;
  content += `- **Created**: ${data.created}\n`;
  content += `- **Updated**: ${data.updated}\n`;

  if (data.type === "command" && data.command) {
    content += `\n## Command\n\n`;
    content += "```bash\n";
    content += data.command;
    content += "\n```\n";
  }

  if (data.type === "prompt" && data.prompt) {
    content += `\n## Prompt\n\n`;
    content += "```\n";
    content += data.prompt;
    content += "\n```\n";
  }

  // Generate Claude Code settings format
  content += `\n## Claude Code Settings Format\n\n`;
  content += "```json\n";
  content += JSON.stringify(generateClaudeSettings(data), null, 2);
  content += "\n```\n";

  return content;
}

// Generate Claude Code settings object
function generateClaudeSettings(data: HookData): ClaudeHooksSettings {
  const hookConfig: HookConfig = {
    type: data.type,
    timeout: data.timeout,
  };

  if (data.type === "command" && data.command) {
    hookConfig.command = data.command;
  }

  if (data.type === "prompt" && data.prompt) {
    hookConfig.prompt = data.prompt;
  }

  const settings: ClaudeHooksSettings = {
    hooks: {
      [data.event]: [
        {
          matcher: data.matcher,
          hooks: [hookConfig],
        },
      ],
    },
  };

  return settings;
}

// Install hook to Claude Code settings
function installHook(data: HookData, global: boolean): void {
  const settingsDir = global ? path.join(os.homedir(), ".claude") : path.join(getProjectRoot(), ".claude");

  const settingsPath = path.join(settingsDir, "settings.json");

  // Ensure directory exists
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  // Load existing settings or create new
  let settings: any = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch (e) {
      console.error(`Warning: Could not parse existing settings, creating new file`);
    }
  }

  // Initialize hooks object if needed
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Initialize event array if needed
  if (!settings.hooks[data.event]) {
    settings.hooks[data.event] = [];
  }

  // Create hook config
  const hookConfig: HookConfig = {
    type: data.type,
  };

  if (data.type === "command" && data.command) {
    hookConfig.command = data.command;
  }

  if (data.type === "prompt" && data.prompt) {
    hookConfig.prompt = data.prompt;
  }

  if (data.timeout !== 60) {
    hookConfig.timeout = data.timeout;
  }

  // Check if matcher already exists
  const existingMatcher = settings.hooks[data.event].find((m: HookMatcher) => m.matcher === data.matcher);

  if (existingMatcher) {
    // Add to existing matcher
    existingMatcher.hooks.push(hookConfig);
  } else {
    // Create new matcher
    settings.hooks[data.event].push({
      matcher: data.matcher,
      hooks: [hookConfig],
    });
  }

  // Write settings
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  console.log(`Installed hook to: ${settingsPath}`);
}

// Update index file
function updateIndex(data: HookData, filename: string): void {
  const indexPath = path.join(implDir!, "data", "indexes", "HOOKS.md");

  if (!fs.existsSync(indexPath)) {
    // Create the index file if it doesn't exist
    const indexContent = `# Hooks Index

Project: ${path.basename(getProjectRoot())}
Created: ${timestamp}

## Overview

This file indexes all hook configurations in this implementation.

## Hooks

| ID | File | Name | Event | Matcher | Type | Created |
|----|------|------|-------|---------|------|---------|
| - | - | No hooks yet | - | - | - | - |

---

*Updated automatically by implementation-hook skill*
`;
    fs.writeFileSync(indexPath, indexContent);
  }

  let content = fs.readFileSync(indexPath, "utf-8");

  const matcherDisplay = data.matcher || "(all)";
  const newRow = `| ${data.id} | ${filename} | ${data.name} | ${data.event} | ${matcherDisplay} | ${data.type} | ${data.created} |`;

  if (content.includes("| - | - | No hooks yet | - | - | - | - |")) {
    content = content.replace("| - | - | No hooks yet | - | - | - | - |", newRow);
  } else {
    const tableMatch = content.match(/(## Hooks[\s\S]*?\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|)/);
    if (tableMatch) {
      const insertPoint = tableMatch.index! + tableMatch[0].length;
      content = content.slice(0, insertPoint) + "\n" + newRow + content.slice(insertPoint);
    }
  }

  content = content.replace(/\*Updated.*\*/, `*Updated: ${timestamp}*`);
  fs.writeFileSync(indexPath, content);
}

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Hook`);
  console.log(`===================\n`);

  // Generate filename
  const filename = `${hookId}_${slug.replace(/-/g, "_")}.md`;
  const outputPath = path.join(outputDir, filename);

  // Generate content
  const content = generateHookMarkdown(hookData);

  // Write archive file
  fs.writeFileSync(outputPath, content);
  console.log(`Created: ${outputPath}`);

  console.log(`\nHook Details:`);
  console.log(`  ID: ${hookData.id}`);
  console.log(`  Name: ${hookData.name}`);
  console.log(`  Slug: ${hookData.slug}`);
  console.log(`  Event: ${hookData.event}`);
  console.log(`  Matcher: ${hookData.matcher || "(all)"}`);
  console.log(`  Type: ${hookData.type}`);
  console.log(`  Timeout: ${hookData.timeout}s`);

  if (baseTemplate) {
    console.log(`  Template: ${templateName}`);
  }

  // Install if requested
  if (shouldInstall) {
    console.log(`\nInstalling hook to Claude Code settings...`);
    installHook(hookData, isGlobal);
  }

  // Update index
  if (!args["skip-index"]) {
    console.log(`\nUpdating HOOKS.md index...`);
    updateIndex(hookData, filename);
    console.log(`Index updated.`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nHook created successfully!`);

  if (!shouldInstall) {
    console.log(`\nTo install this hook, run again with --install`);
    console.log(`Or copy the settings JSON from the generated file.`);
  }

  console.log(`\nManage hooks in Claude Code with: /hooks`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
