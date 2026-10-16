import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { isDeepStrictEqual } from "node:util";
import { AGENT_TARGETS, resolveAgents, type AgentTarget } from "../../lib/installer.js";
import { skillsShellArgument } from "../../lib/credential-profile-command.js";
import { skillsMcpRegistrationEnvironment } from "../../lib/mcp-registration-environment.js";

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

export async function handleMcp(options: { register?: string; json: boolean; apiUrl?: string }) {
  if (options.register) {
    let agents: AgentTarget[];
    let environment: Record<string, string>;
    try {
      agents = resolveAgents(options.register);
      environment = skillsMcpRegistrationEnvironment(process.env, options.apiUrl);
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
      const result = await registerMcpForAgent(agent, command, environment);
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

  const { startMcpStdio } = await import("../../mcp/index.js");
  await startMcpStdio();
}

async function registerMcpForAgent(agent: AgentTarget, command: string, environment: Record<string, string>): Promise<McpRegistrationResult> {
  const server = { command, args: ["--stdio"], ...(Object.keys(environment).length ? { env: environment } : {}) };
  switch (agent) {
    case "claude":
      return registerClaudeMcp(command, server, environment);
    case "codex":
      return registerCodexMcp(command, environment);
    case "gemini":
      return registerJsonMcpServer(agent, join(homedir(), ".gemini", "settings.json"), "mcpServers", server);
    case "pi":
      return registerJsonMcpServer(agent, join(homedir(), ".pi", "agent", "mcp.json"), "mcpServers", server);
    case "opencode":
      return registerOpenCodeMcp(command, environment);
    case "cursor":
      return registerJsonMcpServer(agent, join(homedir(), ".cursor", "mcp.json"), "mcpServers", server);
    case "windsurf":
      return registerJsonMcpServer(agent, join(homedir(), ".windsurf", "mcp.json"), "mcpServers", server);
    default:
      return { agent, success: false, error: `Unknown agent: ${agent}. Available: ${AGENT_TARGETS.join(", ")}, all` };
  }
}

async function registerClaudeMcp(command: string, server: Record<string, unknown>, environment: Record<string, string>): Promise<McpRegistrationResult> {
  const args = ["claude", "mcp", "add", "-s", "user", ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]), MCP_SERVER_NAME, "--", command, "--stdio"];
  const cliCommand = args.map(skillsShellArgument).join(" ");
  try {
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode === 0) {
      return { agent: "claude", success: true, command: cliCommand };
    }
    const fallback = registerJsonMcpServer("claude", join(homedir(), ".claude", ".mcp.json"), "mcpServers", server);
    return {
      ...fallback,
      command: cliCommand,
      error: fallback.success ? undefined : "Claude MCP registration failed; its configuration was not updated",
    };
  } catch (err) {
    const fallback = registerJsonMcpServer("claude", join(homedir(), ".claude", ".mcp.json"), "mcpServers", server);
    return {
      ...fallback,
      command: cliCommand,
      error: fallback.success ? undefined : "Claude MCP registration failed; its configuration was not updated",
    };
  }
}

function registerCodexMcp(command: string, environment: Record<string, string>): McpRegistrationResult {
  const path = join(homedir(), ".codex", "config.toml");
  const body = `command = ${JSON.stringify(command)}\nargs = ["--stdio"]${Object.keys(environment).length
    ? `\nenv = { ${Object.entries(environment).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(", ")} }` : ""}`;
  const config = `[mcp_servers.${MCP_SERVER_NAME}]\n${body}`;
  try {
    const current = existsSync(path) ? readFileSync(path, "utf-8") : "";
    // Validate before and after replacing our table, including an old env subtable.
    const before = Bun.TOML.parse(current);
    const next = upsertTomlSection(current, `[mcp_servers.${MCP_SERVER_NAME}]`, body);
    const after = Bun.TOML.parse(next);
    if (!isDeepStrictEqual(withoutSkillsMcp(before), withoutSkillsMcp(after))) throw new Error();
    writeTextFile(path, next);
    return { agent: "codex", success: true, path, config };
  } catch (err) {
    return { agent: "codex", success: false, path, config, error: "Could not update the Codex MCP configuration" };
  }
}

function registerOpenCodeMcp(command: string, environment: Record<string, string>): McpRegistrationResult {
  const path = join(homedir(), ".config", "opencode", "opencode.json");
  const server = { type: "local", command: [command, "--stdio"], enabled: true,
    ...(Object.keys(environment).length ? { environment } : {}) };
  const config = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        [MCP_SERVER_NAME]: server,
      },
    },
    null,
    2,
  );

  try {
    const data = readJsonObject(path);
    if (!data.$schema) data.$schema = "https://opencode.ai/config.json";
    const mcp = isPlainObject(data.mcp) ? data.mcp : {};
    mcp[MCP_SERVER_NAME] = server;
    data.mcp = mcp;
    writeJsonObject(path, data);
    return { agent: "opencode", success: true, path, config };
  } catch (err) {
    return { agent: "opencode", success: false, path, config, error: "Could not update the OpenCode MCP configuration" };
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
    return { agent, success: false, path, config, error: "Could not update the agent MCP configuration" };
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
  const result: string[] = []; let owned = false, inserted = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      owned = /^\s*\[\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:skills|"skills"|'skills')\s*(?:\.|\])/.test(line);
      if (owned && !inserted) { result.push(...sectionLines, ""); inserted = true; }
    }
    if (!owned) result.push(line);
  }
  if (!inserted) result.push(...(result.length ? [""] : []), ...sectionLines);
  return `${result.join("\n")}\n`;
}

function withoutSkillsMcp(config: Record<string, unknown>): Record<string, unknown> {
  const preserved = { ...config };
  if (isPlainObject(preserved.mcp_servers)) {
    const servers = { ...preserved.mcp_servers }; delete servers[MCP_SERVER_NAME];
    if (Object.keys(servers).length) preserved.mcp_servers = servers;
    else delete preserved.mcp_servers;
  }
  return preserved;
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
