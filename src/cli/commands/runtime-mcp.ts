import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { AGENT_TARGETS, resolveAgents, type AgentTarget } from "../../lib/installer.js";

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

export async function handleMcp(options: { register?: string; json: boolean }) {
  if (options.register) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(options.register);
    } catch (err) {
      const error = (err as Error).message;
      if (options.json) {
        console.log(JSON.stringify({ registered: 0, results: [{ agent: options.register, success: false, error }] }, null, 2));
      } else {
        console.error(chalk.red(error));
      }
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
        console.log(
          result.success
            ? chalk.green(`\u2713 Registered MCP server with ${label}`)
            : chalk.red(`\u2717 ${agent}: ${result.error}`),
        );
      }
    }
    if (options.json) {
      console.log(JSON.stringify({ registered: results.filter((result) => result.success).length, results }, null, 2));
    }
    if (results.some((result) => !result.success)) process.exitCode = 1;
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
  const config = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        [MCP_SERVER_NAME]: {
          type: "local",
          command: [command],
          enabled: true,
        },
      },
    },
    null,
    2,
  );

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

function registerJsonMcpServer(
  agent: AgentTarget,
  path: string,
  containerKey: "mcpServers",
  server: Record<string, unknown>,
): McpRegistrationResult {
  const config = JSON.stringify({ [containerKey]: { [MCP_SERVER_NAME]: server } }, null, 2);
  try {
    const data = readJsonObject(path);
    const servers = isPlainObject(data[containerKey]) ? (data[containerKey] as Record<string, unknown>) : {};
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
