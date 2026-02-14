#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";
import minimist from "minimist";
import Anthropic from "@anthropic-ai/sdk";

// Types
interface TokenUsage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
}

interface CostBreakdown {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
}

interface SessionCost {
  id: string;
  sessionId: string;
  project: string;
  model: string;
  startTime: string;
  endTime: string;
  duration: string;
  tokens: TokenUsage;
  cost: CostBreakdown;
  messages: number;
  toolCalls: number;
  summary?: string;
}

interface ModelPricing {
  input: number; // per 1M tokens
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

interface TableColumn {
  header: string;
  key: string;
  width: number;
  align?: "left" | "right" | "center";
}

// Model pricing (USD per 1M tokens)
const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-5-20251101": { input: 15.0, output: 75.0, cacheCreation: 18.75, cacheRead: 1.5 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0, cacheCreation: 18.75, cacheRead: 1.5 },
  "claude-sonnet-4-5-20241022": { input: 3.0, output: 15.0, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-3-5-sonnet-20240620": { input: 3.0, output: 15.0, cacheCreation: 3.75, cacheRead: 0.3 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0, cacheCreation: 1.0, cacheRead: 0.08 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25, cacheCreation: 0.3, cacheRead: 0.03 },
  // Default fallback
  default: { input: 3.0, output: 15.0, cacheCreation: 3.75, cacheRead: 0.3 },
};

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["since", "project", "limit"],
  boolean: ["summary-only", "include-zero", "help", "verbose", "summarize", "no-ai"],
  default: {
    "summary-only": false,
    "include-zero": false,
    verbose: false,
    summarize: true,
    "no-ai": false,
  },
  alias: {
    s: "since",
    p: "project",
    l: "limit",
    h: "help",
    v: "verbose",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Cost - Track Claude Code session costs

Usage:
  skills run implementation-cost [options]

Options:
  -s, --since <date>     Only include sessions after date (YYYY-MM-DD)
  -l, --limit <n>        Limit to N most recent sessions
  -p, --project <path>   Override project path detection
  --summary-only         Show summary without generating files
  --include-zero         Include sessions with zero cost
  --no-ai                Skip AI summarization
  -v, --verbose          Show detailed processing info
  -h, --help             Show this help

Examples:
  skills run implementation-cost
  skills run implementation-cost -- --since 2024-01-01
  skills run implementation-cost -- --limit 20 --summary-only
  skills run implementation-cost -- --no-ai
`);
  process.exit(0);
}

// ========================================
// Table Formatting Utilities
// ========================================

function padString(str: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const len = str.length;
  if (len >= width) return str.substring(0, width);

  const padding = width - len;
  switch (align) {
    case "right":
      return " ".repeat(padding) + str;
    case "center":
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return " ".repeat(left) + str + " ".repeat(right);
    default:
      return str + " ".repeat(padding);
  }
}

function createTable(columns: TableColumn[], rows: Record<string, string>[]): string {
  const lines: string[] = [];

  // Calculate total width
  const totalWidth = columns.reduce((sum, col) => sum + col.width + 3, 0) + 1;

  // Top border
  lines.push("┌" + columns.map((col) => "─".repeat(col.width + 2)).join("┬") + "┐");

  // Header row
  const headerCells = columns.map((col) => " " + padString(col.header, col.width, "center") + " ");
  lines.push("│" + headerCells.join("│") + "│");

  // Header separator
  lines.push("├" + columns.map((col) => "─".repeat(col.width + 2)).join("┼") + "┤");

  // Data rows
  for (const row of rows) {
    const cells = columns.map((col) => {
      const value = row[col.key] || "";
      return " " + padString(value, col.width, col.align || "left") + " ";
    });
    lines.push("│" + cells.join("│") + "│");
  }

  // Bottom border
  lines.push("└" + columns.map((col) => "─".repeat(col.width + 2)).join("┴") + "┘");

  return lines.join("\n");
}

function createSimpleTable(headers: string[], rows: string[][], colWidths?: number[]): string {
  // Calculate column widths if not provided
  const widths =
    colWidths ||
    headers.map((h, i) => {
      const maxDataWidth = Math.max(...rows.map((r) => (r[i] || "").length));
      return Math.max(h.length, maxDataWidth);
    });

  const lines: string[] = [];

  // Top border
  lines.push("┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐");

  // Header
  lines.push(
    "│" +
      headers
        .map((h, i) => " " + padString(h, widths[i], "center") + " ")
        .join("│") +
      "│"
  );

  // Separator
  lines.push("├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤");

  // Data rows
  for (const row of rows) {
    lines.push(
      "│" +
        row
          .map((cell, i) => " " + padString(cell || "", widths[i], i === 0 ? "left" : "right") + " ")
          .join("│") +
        "│"
    );
  }

  // Bottom border
  lines.push("└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘");

  return lines.join("\n");
}

// ========================================
// AI Summarization
// ========================================

async function summarizeSession(
  filePath: string,
  anthropic: Anthropic
): Promise<string> {
  // Read first few user messages and tool calls to understand what was done
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const userMessages: string[] = [];
  const toolNames: string[] = [];
  let messageCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (messageCount > 50) break; // Limit for context

    try {
      const data = JSON.parse(line);

      // Collect user messages
      if (data.type === "user" && data.message?.content) {
        const content = typeof data.message.content === "string"
          ? data.message.content
          : JSON.stringify(data.message.content);
        if (content.length < 500) {
          userMessages.push(content.substring(0, 200));
        }
        messageCount++;
      }

      // Collect tool usage
      if (data.message?.content && Array.isArray(data.message.content)) {
        for (const item of data.message.content) {
          if (item?.type === "tool_use" && item.name) {
            if (!toolNames.includes(item.name)) {
              toolNames.push(item.name);
            }
          }
        }
      }
    } catch (e) {
      // Skip invalid lines
    }
  }

  if (userMessages.length === 0) {
    return "No significant activity";
  }

  // Build prompt for summarization
  const prompt = `Summarize what was implemented in this coding session in 1-2 short sentences (max 100 chars). Focus on the main task/feature.

User requests:
${userMessages.slice(0, 5).join("\n")}

Tools used: ${toolNames.slice(0, 10).join(", ")}

Summary:`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0];
    if (text.type === "text") {
      return text.text.trim().substring(0, 100);
    }
    return "Session analyzed";
  } catch (e) {
    return "Unable to summarize";
  }
}

// ========================================
// Core Functions
// ========================================

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

// Get Claude projects directory path for current project
function getClaudeProjectPath(projectPath: string): string | null {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) {
    return null;
  }

  // Convert project path to Claude's folder naming convention
  const normalizedPath = projectPath.replace(/^\//, "").replace(/\//g, "-");
  const claudeProjectDir = path.join(claudeDir, `-${normalizedPath}`);

  if (fs.existsSync(claudeProjectDir)) {
    return claudeProjectDir;
  }

  // Try to find a matching directory
  const entries = fs.readdirSync(claudeDir);
  for (const entry of entries) {
    if (entry.includes(path.basename(projectPath))) {
      const fullPath = path.join(claudeDir, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        return fullPath;
      }
    }
  }

  return null;
}

// Parse a JSONL session file and extract usage data
async function parseSessionFile(filePath: string): Promise<{
  sessionId: string;
  model: string;
  tokens: TokenUsage;
  messages: number;
  toolCalls: number;
  startTime: string | null;
  endTime: string | null;
}> {
  const sessionId = path.basename(filePath, ".jsonl");
  let model = "unknown";
  const tokens: TokenUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 };
  let messages = 0;
  let toolCalls = 0;
  let startTime: string | null = null;
  let endTime: string | null = null;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);

      // Track timestamps
      if (data.timestamp) {
        if (!startTime || data.timestamp < startTime) {
          startTime = data.timestamp;
        }
        if (!endTime || data.timestamp > endTime) {
          endTime = data.timestamp;
        }
      }

      // Count messages
      if (data.type === "user" || data.type === "assistant") {
        messages++;
      }

      // Extract model and usage from assistant messages
      if (data.message?.model) {
        model = data.message.model;
      }

      if (data.message?.usage) {
        const usage = data.message.usage;
        tokens.input += usage.input_tokens || 0;
        tokens.output += usage.output_tokens || 0;
        tokens.cacheCreation += usage.cache_creation_input_tokens || 0;
        tokens.cacheRead += usage.cache_read_input_tokens || 0;
      }

      // Count tool calls
      if (data.message?.content) {
        const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];
        for (const item of content) {
          if (item?.type === "tool_use") {
            toolCalls++;
          }
        }
      }
    } catch (e) {
      // Skip invalid JSON lines
    }
  }

  tokens.total = tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead;

  return { sessionId, model, tokens, messages, toolCalls, startTime, endTime };
}

// Calculate cost based on token usage and model
function calculateCost(tokens: TokenUsage, model: string): CostBreakdown {
  let pricing = MODEL_PRICING.default;
  for (const [modelKey, modelPricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(modelKey) || modelKey.includes(model.split("-").slice(0, 3).join("-"))) {
      pricing = modelPricing;
      break;
    }
  }

  if (model in MODEL_PRICING) {
    pricing = MODEL_PRICING[model];
  } else if (model.includes("opus")) {
    pricing = MODEL_PRICING["claude-opus-4-5-20251101"];
  } else if (model.includes("haiku")) {
    pricing = MODEL_PRICING["claude-3-haiku-20240307"];
  }

  const cost: CostBreakdown = {
    input: (tokens.input / 1_000_000) * pricing.input,
    output: (tokens.output / 1_000_000) * pricing.output,
    cacheCreation: (tokens.cacheCreation / 1_000_000) * pricing.cacheCreation,
    cacheRead: (tokens.cacheRead / 1_000_000) * pricing.cacheRead,
    total: 0,
  };

  cost.total = cost.input + cost.output + cost.cacheCreation + cost.cacheRead;

  return cost;
}

// Format duration from timestamps
function formatDuration(startTime: string | null, endTime: string | null): string {
  if (!startTime || !endTime) return "-";

  const start = new Date(startTime);
  const end = new Date(endTime);
  const diffMs = end.getTime() - start.getTime();

  if (diffMs < 0) return "-";

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Format number with K/M suffix
function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toString();
}

// Get next cost ID
function getNextCostId(costsDir: string): number {
  if (!fs.existsSync(costsDir)) {
    return 1;
  }

  const files = fs.readdirSync(costsDir).filter((f) => f.startsWith("cost_") && f.endsWith(".json"));
  if (files.length === 0) {
    return 1;
  }

  const ids = files.map((f) => {
    const match = f.match(/cost_(\d+)_/);
    return match ? parseInt(match[1], 10) : 0;
  });

  return Math.max(...ids) + 1;
}

// ========================================
// Dashboard Generation
// ========================================

function generateCostsDashboard(sessions: SessionCost[], projectName: string): string {
  const timestamp = new Date().toISOString().split("T")[0];
  const totalCost = sessions.reduce((sum, s) => sum + s.cost.total, 0);
  const totalTokens = sessions.reduce((sum, s) => sum + s.tokens.total, 0);
  const totalMessages = sessions.reduce((sum, s) => sum + s.messages, 0);
  const totalToolCalls = sessions.reduce((sum, s) => sum + s.toolCalls, 0);

  let content = `# 💰 Costs Dashboard\n\n`;
  content += `\`\`\`\n`;
  content += `Project:  ${projectName}\n`;
  content += `Updated:  ${timestamp}\n`;
  content += `Total:    $${totalCost.toFixed(2)}\n`;
  content += `\`\`\`\n\n`;

  // Summary statistics table
  content += `## 📊 Summary\n\n`;
  content += `\`\`\`\n`;
  content += createSimpleTable(
    ["Metric", "Value"],
    [
      ["Sessions", sessions.length.toString()],
      ["Total Tokens", formatNumber(totalTokens)],
      ["Total Cost", `$${totalCost.toFixed(2)}`],
      ["Avg Cost/Session", `$${(totalCost / sessions.length || 0).toFixed(2)}`],
      ["Total Messages", totalMessages.toString()],
      ["Total Tool Calls", totalToolCalls.toString()],
    ],
    [18, 15]
  );
  content += `\n\`\`\`\n\n`;

  // Token breakdown
  const inputTokens = sessions.reduce((sum, s) => sum + s.tokens.input, 0);
  const outputTokens = sessions.reduce((sum, s) => sum + s.tokens.output, 0);
  const cacheCreationTokens = sessions.reduce((sum, s) => sum + s.tokens.cacheCreation, 0);
  const cacheReadTokens = sessions.reduce((sum, s) => sum + s.tokens.cacheRead, 0);
  const inputCost = sessions.reduce((sum, s) => sum + s.cost.input, 0);
  const outputCost = sessions.reduce((sum, s) => sum + s.cost.output, 0);
  const cacheCreationCost = sessions.reduce((sum, s) => sum + s.cost.cacheCreation, 0);
  const cacheReadCost = sessions.reduce((sum, s) => sum + s.cost.cacheRead, 0);

  content += `## 🔢 Token Breakdown\n\n`;
  content += `\`\`\`\n`;
  content += createSimpleTable(
    ["Type", "Tokens", "Cost"],
    [
      ["Input", formatNumber(inputTokens), `$${inputCost.toFixed(2)}`],
      ["Output", formatNumber(outputTokens), `$${outputCost.toFixed(2)}`],
      ["Cache Write", formatNumber(cacheCreationTokens), `$${cacheCreationCost.toFixed(2)}`],
      ["Cache Read", formatNumber(cacheReadTokens), `$${cacheReadCost.toFixed(2)}`],
      ["TOTAL", formatNumber(totalTokens), `$${totalCost.toFixed(2)}`],
    ],
    [12, 10, 10]
  );
  content += `\n\`\`\`\n\n`;

  // By model breakdown
  const byModel: Record<string, { sessions: number; tokens: number; cost: number }> = {};
  for (const session of sessions) {
    const modelKey = session.model.includes("opus")
      ? "Opus 4.5"
      : session.model.includes("haiku")
        ? "Haiku"
        : "Sonnet";

    if (!byModel[modelKey]) {
      byModel[modelKey] = { sessions: 0, tokens: 0, cost: 0 };
    }
    byModel[modelKey].sessions++;
    byModel[modelKey].tokens += session.tokens.total;
    byModel[modelKey].cost += session.cost.total;
  }

  content += `## 🤖 By Model\n\n`;
  content += `\`\`\`\n`;
  const modelRows = Object.entries(byModel)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, data]) => [
      model,
      data.sessions.toString(),
      formatNumber(data.tokens),
      `$${data.cost.toFixed(2)}`,
    ]);
  content += createSimpleTable(["Model", "Sessions", "Tokens", "Cost"], modelRows, [10, 10, 10, 10]);
  content += `\n\`\`\`\n\n`;

  // Daily breakdown (last 14 days)
  const dailyCosts: Record<string, { cost: number; sessions: number }> = {};
  for (const session of sessions) {
    if (session.startTime) {
      const date = session.startTime.split("T")[0];
      if (!dailyCosts[date]) {
        dailyCosts[date] = { cost: 0, sessions: 0 };
      }
      dailyCosts[date].cost += session.cost.total;
      dailyCosts[date].sessions++;
    }
  }

  const sortedDays = Object.keys(dailyCosts).sort().reverse().slice(0, 14);
  if (sortedDays.length > 0) {
    content += `## 📅 Daily Costs (Last 14 Days)\n\n`;
    content += `\`\`\`\n`;
    const dailyRows = sortedDays.map((day) => [
      day,
      dailyCosts[day].sessions.toString(),
      `$${dailyCosts[day].cost.toFixed(2)}`,
    ]);
    content += createSimpleTable(["Date", "Sessions", "Cost"], dailyRows, [12, 10, 10]);
    content += `\n\`\`\`\n\n`;
  }

  // Recent sessions with summaries
  content += `## 📋 Recent Sessions\n\n`;

  const recentSessions = [...sessions]
    .sort((a, b) => {
      if (!a.startTime || !b.startTime) return 0;
      return b.startTime.localeCompare(a.startTime);
    })
    .slice(0, 30);

  content += `\`\`\`\n`;
  const sessionRows = recentSessions.map((session) => {
    const date = session.startTime ? session.startTime.split("T")[0] : "-";
    const shortId = session.sessionId.substring(0, 8);
    return [
      session.id.replace("cost_", ""),
      date,
      session.duration,
      formatNumber(session.tokens.total),
      `$${session.cost.total.toFixed(2)}`,
    ];
  });
  content += createSimpleTable(
    ["ID", "Date", "Duration", "Tokens", "Cost"],
    sessionRows,
    [7, 12, 10, 10, 10]
  );
  content += `\n\`\`\`\n\n`;

  // Session summaries (if AI summaries available)
  const sessionsWithSummaries = recentSessions.filter((s) => s.summary && s.summary !== "No significant activity");
  if (sessionsWithSummaries.length > 0) {
    content += `## 🧠 What Was Implemented\n\n`;
    for (const session of sessionsWithSummaries.slice(0, 20)) {
      const date = session.startTime ? session.startTime.split("T")[0] : "-";
      content += `- **${date}** (${session.id}): ${session.summary}\n`;
    }
    content += `\n`;
  }

  content += `---\n\n`;
  content += `*Generated by implementation-cost on ${new Date().toISOString()}*\n`;

  return content;
}

// ========================================
// Main Execution
// ========================================

async function main(): Promise<void> {
  console.log(`\n💰 Implementation Cost Tracker`);
  console.log(`${"═".repeat(35)}\n`);

  // Find implementation directory
  const implDir = findImplementationDir();
  if (!implDir && !args["summary-only"]) {
    console.error("Error: .implementation directory not found");
    console.error("Run 'skills run implementation-init' first to create the folder structure");
    process.exit(1);
  }

  // Get project path
  const projectPath = args.project || process.env.SKILLS_CWD || process.cwd();
  const projectName = path.basename(projectPath);
  console.log(`Project: ${projectName}`);
  console.log(`Path: ${projectPath}\n`);

  // Find Claude project directory
  const claudeProjectDir = getClaudeProjectPath(projectPath);
  if (!claudeProjectDir) {
    console.error("Error: Could not find Claude Code sessions for this project");
    console.error(`Expected directory in: ~/.claude/projects/`);
    process.exit(1);
  }
  console.log(`Claude sessions: ${claudeProjectDir}\n`);

  // Initialize Anthropic client for summarization
  let anthropic: Anthropic | null = null;
  const useAI = !args["no-ai"] && process.env.ANTHROPIC_API_KEY;
  if (useAI) {
    anthropic = new Anthropic();
    console.log("AI summarization: enabled (using Haiku)\n");
  } else if (!args["no-ai"]) {
    console.log("AI summarization: disabled (set ANTHROPIC_API_KEY to enable)\n");
  }

  // Get all session files
  const sessionFiles = fs
    .readdirSync(claudeProjectDir)
    .filter((f) => f.endsWith(".jsonl") && !f.includes("/"))
    .map((f) => path.join(claudeProjectDir, f));

  if (sessionFiles.length === 0) {
    console.log("No sessions found.");
    process.exit(0);
  }

  console.log(`Found ${sessionFiles.length} sessions to process...\n`);

  // Process sessions
  const sessions: SessionCost[] = [];
  let nextId = implDir ? getNextCostId(path.join(implDir, "data", "costs")) : 1;

  // Track existing session IDs to avoid duplicates
  const existingSessionIds = new Set<string>();
  const existingSessions: Record<string, SessionCost> = {};
  if (implDir) {
    const costsDir = path.join(implDir, "data", "costs");
    if (fs.existsSync(costsDir)) {
      const existingFiles = fs.readdirSync(costsDir).filter((f) => f.endsWith(".json"));
      for (const file of existingFiles) {
        try {
          const content = fs.readFileSync(path.join(costsDir, file), "utf-8");
          const data = JSON.parse(content) as SessionCost;
          if (data.sessionId) {
            existingSessionIds.add(data.sessionId);
            existingSessions[data.sessionId] = data;
          }
        } catch (e) {
          // Skip invalid files
        }
      }
    }
  }

  let processedCount = 0;
  for (const filePath of sessionFiles) {
    const basename = path.basename(filePath, ".jsonl");

    if (args.verbose) {
      console.log(`Processing: ${basename}`);
    }

    try {
      const sessionData = await parseSessionFile(filePath);

      // Skip if already processed
      if (existingSessionIds.has(sessionData.sessionId)) {
        if (args.verbose) {
          console.log(`  Skipping (already processed)`);
        }
        // Load existing session for summary
        if (existingSessions[sessionData.sessionId]) {
          sessions.push(existingSessions[sessionData.sessionId]);
        }
        continue;
      }

      // Filter by date if specified
      if (args.since && sessionData.startTime) {
        const sinceDate = new Date(args.since);
        const sessionDate = new Date(sessionData.startTime);
        if (sessionDate < sinceDate) {
          continue;
        }
      }

      const cost = calculateCost(sessionData.tokens, sessionData.model);

      // Skip zero-cost sessions unless requested
      if (cost.total === 0 && !args["include-zero"]) {
        continue;
      }

      // Get AI summary if enabled
      let summary = "";
      if (anthropic && cost.total > 0) {
        process.stdout.write(`  Summarizing ${basename.substring(0, 8)}...`);
        summary = await summarizeSession(filePath, anthropic);
        console.log(` done`);
      }

      const session: SessionCost = {
        id: `cost_${String(nextId).padStart(5, "0")}`,
        sessionId: sessionData.sessionId,
        project: projectName,
        model: sessionData.model,
        startTime: sessionData.startTime || "",
        endTime: sessionData.endTime || "",
        duration: formatDuration(sessionData.startTime, sessionData.endTime),
        tokens: sessionData.tokens,
        cost,
        messages: sessionData.messages,
        toolCalls: sessionData.toolCalls,
        summary,
      };

      sessions.push(session);
      nextId++;
      processedCount++;
    } catch (e) {
      console.error(`Error processing ${path.basename(filePath)}: ${(e as Error).message}`);
    }
  }

  // Apply limit if specified
  let processedSessions = sessions;
  if (args.limit) {
    const limit = parseInt(args.limit, 10);
    processedSessions = sessions
      .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""))
      .slice(0, limit);
  }

  // Output results
  const totalCost = processedSessions.reduce((sum, s) => sum + s.cost.total, 0);
  const totalTokens = processedSessions.reduce((sum, s) => sum + s.tokens.total, 0);

  console.log(`\n${"─".repeat(35)}`);
  console.log(`Results:`);
  console.log(`  Sessions analyzed: ${processedSessions.length}`);
  console.log(`  New sessions: ${processedCount}`);
  console.log(`  Total tokens: ${formatNumber(totalTokens)}`);
  console.log(`  Total cost: $${totalCost.toFixed(2)}`);

  // Generate files if not summary-only
  if (!args["summary-only"] && implDir) {
    const costsDir = path.join(implDir, "data", "costs");
    const indexesDir = path.join(implDir, "data", "indexes");

    // Ensure directories exist
    if (!fs.existsSync(costsDir)) {
      fs.mkdirSync(costsDir, { recursive: true });
    }
    if (!fs.existsSync(indexesDir)) {
      fs.mkdirSync(indexesDir, { recursive: true });
    }

    // Write individual cost files (only new ones)
    let newFiles = 0;
    for (const session of processedSessions) {
      if (existingSessionIds.has(session.sessionId)) {
        continue;
      }

      const filename = `${session.id}_${session.sessionId.substring(0, 8)}.json`;
      const filepath = path.join(costsDir, filename);
      fs.writeFileSync(filepath, JSON.stringify(session, null, 2));
      newFiles++;
    }

    // Write COSTS.md dashboard
    const dashboard = generateCostsDashboard(processedSessions, projectName);
    fs.writeFileSync(path.join(indexesDir, "COSTS.md"), dashboard);

    console.log(`\nFiles generated:`);
    console.log(`  New cost files: ${newFiles}`);
    console.log(`  Dashboard: .implementation/data/indexes/COSTS.md`);
  }

  console.log(`\n✅ Done!\n`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
