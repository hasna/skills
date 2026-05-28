/**
 * run / mcp / serve / self-update — runtime commands
 */

import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { getSkill, findSimilarSkills } from "../../lib/registry.js";
import { runSkill } from "../../lib/skillinfo.js";
import { AGENT_TARGETS, resolveAgents, type AgentTarget } from "../../lib/installer.js";
import {
  completeSkillRun,
  createSkillRun,
  findSkillRun,
  listSkillRuns,
  writeRunLogs,
} from "../../lib/run-state.js";

const MCP_SERVER_NAME = "skills";
const MCP_COMMAND_NAME = "skills-mcp";

interface McpRegistrationResult {
  agent: string;
  success: boolean;
  path?: string;
  config?: string;
  command?: string;
  error?: string;
}

export function registerRuntime(parent: Command) {
  // Run
  parent
    .command("run")
    .argument("<skill>", "Skill name")
    .argument("[args...]", "Arguments to pass to the skill")
    .allowUnknownOption(true)
    .passThroughOptions(true)
    .option("--json", "Output result as JSON", false)
    .description("Run a skill directly")
    .action(async (name: string, args: string[], options: { json: boolean }) => handleRun(name, args, options));

  const runs = parent
    .command("runs")
    .description("Inspect local skill run records");

  runs
    .command("list")
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Maximum number of runs", "20")
    .description("List recent skill runs")
    .action((options: { json: boolean; limit: string }) => handleRunsList(options));

  runs
    .command("show")
    .argument("<run-id>", "Run id")
    .option("--json", "Output as JSON", false)
    .description("Show a skill run record")
    .action((runId: string, options: { json: boolean }) => handleRunsShow(runId, options));

  const exportsCommand = parent
    .command("exports")
    .description("Inspect or open skill run exports");

  exportsCommand
    .command("open")
    .argument("<run-id>", "Run id")
    .option("--json", "Output as JSON", false)
    .description("Open the export directory for a run")
    .action((runId: string, options: { json: boolean }) => handleExportsOpen(runId, options));

  // MCP
  parent
    .command("mcp")
    .option("--register <agent>", "Register MCP server with agent")
    .option("--json", "Output registration result as JSON", false)
    .description("Start MCP server (stdio) or register with an agent")
    .action(async (options: { register?: string; json: boolean }) => handleMcp(options));

  const setup = parent
    .command("setup")
    .description("Set up Skills integrations");

  setup
    .command("agents")
    .option("--json", "Output registration result as JSON", false)
    .description("Register the Skills MCP server with all supported agents")
    .action(async (options: { json: boolean }) => handleMcp({ register: "all", json: options.json }));

  // Serve
  parent
    .command("serve")
    .description("Start the Skills Dashboard web server")
    .option("-p, --port <port>", "Port number (0 = auto-assign free port)", "0")
    .option("--no-open", "Don't open browser automatically")
    .action(async (options: { port: string; open: boolean }) => {
      const { startServer } = await import("../../server/serve.js");
      await startServer(parseInt(options.port, 10), { open: options.open });
    });

  // Self-update
  parent
    .command("self-update")
    .description("Update @hasna/skills to the latest version")
    .option("--json", "Output result as JSON", false)
    .action(async (options: { json: boolean }) => {
      if (process.env.SKILLS_TEST_MODE === "1") {
        if (options.json) console.log(JSON.stringify({ updated: false, error: "Self-update disabled in test mode" }));
        else console.error(chalk.yellow("Self-update disabled in test mode"));
        process.exitCode = 1;
        return;
      }
      const name = "@hasna/skills";
      if (!options.json) console.log(chalk.bold(`\nUpdating ${name}...\n`));
      const proc = Bun.spawn(["bun", "add", "-g", `${name}@latest`], {
        stdout: options.json ? "pipe" : "inherit",
        stderr: options.json ? "pipe" : "inherit",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        options.json ? new Response(proc.stdout).text() : Promise.resolve(""),
        options.json ? new Response(proc.stderr).text() : Promise.resolve(""),
        proc.exited,
      ]);
      if (exitCode === 0) {
        const vProc = Bun.spawn(["skills", "--version"], { stdout: "pipe" });
        const version = (await new Response(vProc.stdout).text()).trim();
        if (options.json) console.log(JSON.stringify({ updated: true, version, stdout, stderr }));
        else {
          console.log(chalk.green("\n\u2713 Updated to latest version"));
          console.log(chalk.dim(`  Version: ${version}`));
        }
      } else {
        if (options.json) console.log(JSON.stringify({ updated: false, exitCode, stdout, stderr }));
        else console.error(chalk.red("\n\u2717 Update failed"));
        process.exitCode = 1;
      }
    });
}

async function handleRun(name: string, args: string[], options: { json: boolean }) {
  const skill = getSkill(name);
  if (!skill) {
    const similar = findSimilarSkills(name);
    if (options.json) {
      console.log(JSON.stringify({ skill: name, args, exitCode: 1, error: `Skill '${name}' not found`, similar }));
    } else {
      console.error(`Skill '${name}' not found`);
      if (similar.length) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
    }
    process.exitCode = 1; return;
  }

  const prompt = extractPrompt(args);
  const runContext = createSkillRun({
    skill: skill.name,
    args,
    prompt,
    remote: false,
  });

  const result = await runSkill(name, args, {
    stdio: "pipe",
    env: {
      SKILLS_RUN_ID: runContext.record.id,
      SKILLS_RUN_DIR: runContext.runDir,
      SKILLS_EXPORT_DIR: runContext.exportDir,
    },
  });
  writeRunLogs(runContext, result.stdout ?? "", result.stderr ?? result.error ?? "");
  const completed = completeSkillRun(runContext, {
    status: result.exitCode === 0 ? "completed" : "failed",
    error: result.error,
  });
  if (options.json) console.log(JSON.stringify({ skill: skill.name, args, ...result, run: completed }, null, 2));
  else {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error);
    console.log(chalk.dim(`Run metadata: ${completed.paths.runDir}/run.json`));
    console.log(chalk.dim(`Exports: ${completed.paths.exportDir}`));
  }
  process.exitCode = result.exitCode;
}

function handleRunsList(options: { json: boolean; limit: string }) {
  const limit = Number.parseInt(options.limit, 10);
  const runs = listSkillRuns(process.cwd(), Number.isFinite(limit) ? limit : 20);
  if (options.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }
  if (!runs.length) {
    console.log(chalk.dim("No skill runs found"));
    return;
  }
  console.log(chalk.bold(`\nRecent skill runs (${runs.length}):\n`));
  for (const run of runs) {
    console.log(`  ${chalk.cyan(run.id)}  ${run.skill}  ${statusColor(run.status)}  ${chalk.dim(run.startedAt)}`);
  }
}

function handleRunsShow(runId: string, options: { json: boolean }) {
  const run = findSkillRun(runId);
  if (!run) {
    const error = `Run '${runId}' not found`;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }
  if (options.json) console.log(JSON.stringify(run, null, 2));
  else {
    console.log(chalk.bold(`\n${run.id}\n`));
    console.log(`${chalk.dim("Skill:")} ${run.skill}`);
    console.log(`${chalk.dim("Status:")} ${statusColor(run.status)}`);
    console.log(`${chalk.dim("Started:")} ${run.startedAt}`);
    if (run.completedAt) console.log(`${chalk.dim("Completed:")} ${run.completedAt}`);
    if (run.remoteRunId) console.log(`${chalk.dim("Remote run:")} ${run.remoteRunId}`);
    if (run.error) console.log(`${chalk.dim("Error:")} ${chalk.red(run.error)}`);
    console.log(`${chalk.dim("Run dir:")} ${run.paths.runDir}`);
    console.log(`${chalk.dim("Exports:")} ${run.paths.exportDir}`);
  }
}

async function handleExportsOpen(runId: string, options: { json: boolean }) {
  const run = findSkillRun(runId);
  if (!run) {
    const error = `Run '${runId}' not found`;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }
  const exportDir = run.paths.exportDir;
  if (options.json) {
    console.log(JSON.stringify({ runId, exportDir }, null, 2));
    return;
  }
  console.log(exportDir);
  try {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", exportDir] : [exportDir];
    Bun.spawn([opener, ...args], { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

async function handleMcp(options: { register?: string; json: boolean }) {
  if (options.register) {
    let agents: AgentTarget[];
    try { agents = resolveAgents(options.register); }
    catch (err) {
      const error = (err as Error).message;
      if (options.json) console.log(JSON.stringify({ registered: 0, results: [{ agent: options.register, success: false, error }] }, null, 2));
      else console.error(chalk.red(error));
      process.exitCode = 1;
      return;
    }

    const command = findCommandOnPath(MCP_COMMAND_NAME);
    const results: McpRegistrationResult[] = [];
    for (const agent of agents) {
      const result = await registerMcpForAgent(agent, command);
      results.push(result);
      if (!options.json) {
        const label = result.path ? `${agent} (${result.path})` : agent;
        console.log(result.success ? chalk.green(`\u2713 Registered MCP server with ${label}`) : chalk.red(`\u2717 ${agent}: ${result.error}`));
      }
    }
    if (options.json) console.log(JSON.stringify({ registered: results.filter((r) => r.success).length, results }, null, 2));
    if (results.some((r) => !r.success)) process.exitCode = 1;
    return;
  }
  await import("../../mcp/index.js");
}

async function registerMcpForAgent(agent: AgentTarget, command: string): Promise<McpRegistrationResult> {
  switch (agent) {
    case "claude":
      return registerClaudeMcp(command);
    case "codex":
      return registerCodexMcp(command);
    case "gemini":
      return registerJsonMcpServer(agent, join(homedir(), ".gemini", "settings.json"), "mcpServers", {
        command,
        args: [],
      });
    case "pi":
      return registerJsonMcpServer(agent, join(homedir(), ".pi", "agent", "mcp.json"), "mcpServers", {
        command,
        args: [],
      });
    case "opencode":
      return registerOpenCodeMcp(command);
    case "cursor":
      return registerJsonMcpServer(agent, join(homedir(), ".cursor", "mcp.json"), "mcpServers", {
        command,
        args: [],
      });
    case "windsurf":
      return registerJsonMcpServer(agent, join(homedir(), ".windsurf", "mcp.json"), "mcpServers", {
        command,
        args: [],
      });
    default:
      return { agent, success: false, error: `Unknown agent: ${agent}. Available: ${AGENT_TARGETS.join(", ")}, all` };
  }
}

async function registerClaudeMcp(command: string): Promise<McpRegistrationResult> {
  const cliCommand = `claude mcp add -s user ${MCP_SERVER_NAME} -- ${command}`;
  try {
    const proc = Bun.spawn(["claude", "mcp", "add", "-s", "user", MCP_SERVER_NAME, "--", command], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode === 0) {
      return { agent: "claude", success: true, command: cliCommand };
    }
    const fallback = registerJsonMcpServer("claude", join(homedir(), ".claude", ".mcp.json"), "mcpServers", {
      command,
      args: [],
    });
    return {
      ...fallback,
      command: cliCommand,
      error: fallback.success ? undefined : `claude exited with ${exitCode}: ${(stderr || stdout).trim()}`,
    };
  } catch (err) {
    const fallback = registerJsonMcpServer("claude", join(homedir(), ".claude", ".mcp.json"), "mcpServers", {
      command,
      args: [],
    });
    return {
      ...fallback,
      command: cliCommand,
      error: fallback.success ? undefined : (err as Error).message,
    };
  }
}

function registerCodexMcp(command: string): McpRegistrationResult {
  const path = join(homedir(), ".codex", "config.toml");
  const config = `[mcp_servers.${MCP_SERVER_NAME}]\ncommand = ${JSON.stringify(command)}`;
  try {
    const current = existsSync(path) ? readFileSync(path, "utf-8") : "";
    writeTextFile(path, upsertTomlSection(current, `[mcp_servers.${MCP_SERVER_NAME}]`, `command = ${JSON.stringify(command)}`));
    return { agent: "codex", success: true, path, config };
  } catch (err) {
    return { agent: "codex", success: false, path, config, error: (err as Error).message };
  }
}

function registerOpenCodeMcp(command: string): McpRegistrationResult {
  const path = join(homedir(), ".config", "opencode", "opencode.json");
  const config = JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    mcp: {
      [MCP_SERVER_NAME]: {
        type: "local",
        command: [command],
        enabled: true,
      },
    },
  }, null, 2);

  try {
    const data = readJsonObject(path);
    if (!data.$schema) data.$schema = "https://opencode.ai/config.json";
    const mcp = isPlainObject(data.mcp) ? data.mcp : {};
    mcp[MCP_SERVER_NAME] = {
      type: "local",
      command: [command],
      enabled: true,
    };
    data.mcp = mcp;
    writeJsonObject(path, data);
    return { agent: "opencode", success: true, path, config };
  } catch (err) {
    return { agent: "opencode", success: false, path, config, error: (err as Error).message };
  }
}

function registerJsonMcpServer(agent: AgentTarget, path: string, containerKey: "mcpServers", server: Record<string, unknown>): McpRegistrationResult {
  const config = JSON.stringify({ [containerKey]: { [MCP_SERVER_NAME]: server } }, null, 2);
  try {
    const data = readJsonObject(path);
    const servers = isPlainObject(data[containerKey]) ? data[containerKey] as Record<string, unknown> : {};
    servers[MCP_SERVER_NAME] = server;
    data[containerKey] = servers;
    writeJsonObject(path, data);
    return { agent, success: true, path, config };
  } catch (err) {
    return { agent, success: false, path, config, error: (err as Error).message };
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) throw new Error(`${path} must contain a JSON object`);
  return parsed;
}

function writeJsonObject(path: string, data: Record<string, unknown>) {
  writeTextFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

function writeTextFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`);
}

function upsertTomlSection(content: string, header: string, body: string): string {
  const sectionLines = [header, ...body.trim().split(/\r?\n/)];
  const lines = content.trimEnd() ? content.trimEnd().split(/\r?\n/) : [];
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    const prefix = lines.length ? [...lines, ""] : [];
    return [...prefix, ...sectionLines, ""].join("\n");
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start, ...sectionLines);
  return `${lines.join("\n")}\n`;
}

function findCommandOnPath(command: string): string {
  const pathValue = process.env.PATH || "";
  for (const dir of pathValue.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return command;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPrompt(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--prompt" || arg === "-p") && args[i + 1]) return args[i + 1];
    if (arg.startsWith("--prompt=")) return arg.slice("--prompt=".length);
  }
  return undefined;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return chalk.green(status);
    case "failed": return chalk.red(status);
    case "running": return chalk.yellow(status);
    default: return chalk.dim(status);
  }
}
