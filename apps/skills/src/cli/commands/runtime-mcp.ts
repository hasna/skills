import chalk from "chalk";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "fs";
import { randomUUID } from "node:crypto";
import { homedir } from "os";
import { dirname, isAbsolute, join } from "path";
import { isDeepStrictEqual, stripVTControlCharacters } from "node:util";
import { AGENT_TARGETS, resolveAgents, type AgentTarget } from "../../lib/installer.js";
import { skillsShellArgument } from "../../lib/credential-profile-command.js";
import { skillsMcpRegistrationEnvironment } from "../../lib/mcp-registration-environment.js";

import { guardedAgentConfigWrite, guardedAgentConfigRefusal } from "../../lib/guarded-agent-config.js";

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
  // Claude's --env is variadic: the next option must delimit its operands.
  const args = ["claude", "mcp", "add", "-s", "user", ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]), "--transport", "stdio", MCP_SERVER_NAME, "--", command, "--stdio"];
  const cliCommand = args.map(skillsShellArgument).join(" ");
  const desired = { type: "stdio", ...server, env: environment };
  try {
    const path = claudeUserConfigPath();
    // Preserve the active original before either the native CLI or our upsert.
    const before = withClaudeConfigLock(path, () => {
      if (claudeUserConfigPath() !== path) throw new Error();
      const bytes = readClaudeConfig(path);
      if (bytes !== null) {
        const backup = `${path}.skills-mcp-${randomUUID()}.backup`;
        writeFileSync(backup, bytes, { flag: "wx", mode: 0o600 });
        if (!readFileSync(backup).equals(bytes)) throw new Error();
      }
      return bytes;
    });
    let exitCode: number | undefined, duplicateAccepted = false, cliUnavailable = false;
    const proc = (() => {
      try { return Bun.spawn(args, { stdout: "pipe", stderr: "pipe" }); }
      catch (error) {
        // Only a missing executable supports configuring before CLI installation.
        // Other spawn errors must not bypass native admission.
        if (!isPlainObject(error) || error.code !== "ENOENT") throw new Error();
        cliUnavailable = true;
        return undefined;
      }
    })();
    if (proc) {
      // Keep native output private. Claude 2.1.301 performs its enterprise
      // admission checks before this exact user-scope duplicate refusal.
      const [stdout, stderr, status] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ]);
      exitCode = status;
      const diagnostic = stripVTControlCharacters(stderr).trim();
      duplicateAccepted = exitCode === 1 && stdout.trim() === ""
        && (diagnostic === `MCP server ${MCP_SERVER_NAME} already exists in user config`
          || diagnostic === `Error: MCP server ${MCP_SERVER_NAME} already exists in user config`);
      if (exitCode !== 0 && !duplicateAccepted) throw new Error();
    }
    return withClaudeConfigLock(path, () => {
      if (claudeUserConfigPath() !== path) throw new Error();
      const current = readClaudeConfig(path);
      const previous = parseClaudeConfig(before), data = parseClaudeConfig(current);
      if (exitCode === 0) {
        const actual = isPlainObject(data.mcpServers) ? data.mcpServers[MCP_SERVER_NAME] : undefined;
        if (!claudeNativeConfigPreserved(previous, data)
          || !isPlainObject(actual) || !isDeepStrictEqual({ ...actual, env: actual.env ?? {} }, desired)) throw new Error();
      } else {
        if (!cliUnavailable && (!duplicateAccepted || !isPlainObject(previous.mcpServers) || !previous.mcpServers[MCP_SERVER_NAME])) throw new Error();
        // Do not overwrite any change made while awaiting the CLI, including
        // partial writes from a failed add or another Claude process.
        if (before === null ? current !== null : current === null || !current.equals(before)) throw new Error();
        data.mcpServers = { ...(data.mcpServers as Record<string, unknown> | undefined), [MCP_SERVER_NAME]: desired };
        const next = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
        const temporary = `${path}.skills-mcp-${randomUUID()}.tmp`;
        writeFileSync(temporary, next, { flag: "wx", mode: 0o600 });
        if (!readFileSync(temporary).equals(next)) throw new Error();
        // Recheck the exact bytes and active-file selection immediately before
        // replacing the file while holding Claude's own lock directory.
        const latest = readClaudeConfig(path);
        if (claudeUserConfigPath() !== path || (before === null ? latest !== null : latest === null || !latest.equals(before))) throw new Error();
        renameSync(temporary, path);
        if (!readFileSync(path).equals(next)) throw new Error();
      }
      return { agent: "claude", success: true, path, command: cliCommand };
    });
  } catch {
    return { agent: "claude", success: false, command: cliCommand,
      error: "Could not safely update the Claude user MCP configuration; native admission or config checks refused the update" };
  }
}

// Claude Code 2.1.301: global config selection (v_/b), including the legacy
// .config.json preference, and Ho's `${globalFile}.lock` directory contract.
function claudeUserConfigPath(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override !== undefined && (!override || !isAbsolute(override) || /[\x00-\x1f\x7f]/.test(override))) throw new Error();
  const modern = join(override || homedir(), process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? ".claude-custom-oauth.json" : ".claude.json");
  const legacy = join(override ?? join(homedir(), ".claude"), ".config.json");
  if (existsSync(legacy)) {
    const info = lstatSync(legacy);
    if (!info.isFile()) throw new Error();
    if (info.size > 0 || ((info.mode & 0o222) !== 0 && !existsSync(modern))) return legacy;
  }
  return modern;
}

function readClaudeConfig(path: string): Buffer | null {
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error();
  const bytes = readFileSync(path);
  parseClaudeConfig(bytes);
  return bytes;
}

function parseClaudeConfig(bytes: Buffer | null): Record<string, unknown> {
  const data = bytes === null ? {} : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!isPlainObject(data) || (data.mcpServers !== undefined && !isPlainObject(data.mcpServers))) throw new Error();
  return data;
}

// Claude 2.1.302 initializes this metadata during a successful native add.
// Only new fields may use this contract; every original field stays exact.
function claudeNativeConfigPreserved(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const previous = withoutClaudeSkills(before), current = withoutClaudeSkills(after);
  for (const key of Object.keys(current)) {
    if (Object.hasOwn(previous, key)) continue;
    if (!isClaudeBootstrapAddition(key, current[key])) return false;
    delete current[key];
  }
  return isDeepStrictEqual(previous, current);
}

function isClaudeBootstrapAddition(key: string, value: unknown): boolean {
  switch (key) {
    case "firstStartTime":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    case "firstStartVersion":
      return typeof value === "string" && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value);
    case "machineID":
      return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
    case "opusProMigrationComplete":
    case "sonnet1m45MigrationComplete":
    case "hasResetAutoModeOptInForDefaultOffer":
      return value === true;
    case "seenNotifications":
      return isPlainObject(value) && Object.keys(value).length === 0;
    case "migrationVersion":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    default:
      return false;
  }
}

function withoutClaudeSkills(data: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...data }, servers = { ...(data.mcpServers as Record<string, unknown> | undefined) };
  delete servers[MCP_SERVER_NAME];
  if (Object.keys(servers).length) rest.mcpServers = servers;
  else delete rest.mcpServers;
  return rest;
}

function withClaudeConfigLock<T>(path: string, action: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  // Never prune or recover a lock belonging to another native writer.
  mkdirSync(lock, { mode: 0o700 });
  const owned = statSync(lock);
  try { return action(); }
  finally {
    const current = lstatSync(lock);
    if (current.isDirectory() && current.dev === owned.dev && current.ino === owned.ino) {
      rmdirSync(lock);
    }
  }
}

function registerCodexMcp(command: string, environment: Record<string, string>): McpRegistrationResult {
  const path = join(homedir(), ".codex", "config.toml");
  const body = `command = ${JSON.stringify(command)}\nargs = ["--stdio"]${Object.keys(environment).length
    ? `\nenv = { ${Object.entries(environment).map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`).join(", ")} }` : ""}`;
  const config = `[mcp_servers.${MCP_SERVER_NAME}]\n${body}`;
  try {
    guardedAgentConfigWrite(path, bytes => {
      const current = bytes === null ? "" : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      // Validate before and after replacing our table, including an old env subtable.
      const before = Bun.TOML.parse(current);
      const next = upsertTomlSection(current, `[mcp_servers.${MCP_SERVER_NAME}]`, body);
      const after = Bun.TOML.parse(next);
      if (!isDeepStrictEqual(withoutSkillsMcp(before), withoutSkillsMcp(after))) throw new Error();
      return next;
    });
    return { agent: "codex", success: true, path, config };
  } catch (err) {
    return { agent: "codex", success: false, path, config, error: "Could not safely update the Codex MCP configuration: " + guardedAgentConfigRefusal(err) };
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
    guardedAgentConfigWrite(path, bytes => {
      const data = parseJsonObject(bytes);
      if (data.$schema === undefined) data.$schema = "https://opencode.ai/config.json";
      if (data.mcp !== undefined && !isPlainObject(data.mcp)) throw new Error();
      const mcp = isPlainObject(data.mcp) ? data.mcp : {};
      mcp[MCP_SERVER_NAME] = server;
      data.mcp = mcp;
      return `${JSON.stringify(data, null, 2)}\n`;
    });
    return { agent: "opencode", success: true, path, config };
  } catch (err) {
    return { agent: "opencode", success: false, path, config, error: "Could not safely update the OpenCode MCP configuration: " + guardedAgentConfigRefusal(err) };
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
    guardedAgentConfigWrite(path, bytes => {
      const data = parseJsonObject(bytes);
      if (data[containerKey] !== undefined && !isPlainObject(data[containerKey])) throw new Error();
      const servers = isPlainObject(data[containerKey]) ? (data[containerKey] as Record<string, unknown>) : {};
      servers[MCP_SERVER_NAME] = server;
      data[containerKey] = servers;
      return `${JSON.stringify(data, null, 2)}\n`;
    });
    return { agent, success: true, path, config };
  } catch (err) {
    return { agent, success: false, path, config, error: "Could not safely update the agent MCP configuration: " + guardedAgentConfigRefusal(err) };
  }
}

function parseJsonObject(bytes: Buffer | null): Record<string, unknown> {
  const raw = bytes === null ? "" : new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) throw new Error("Expected a JSON object");
  return parsed;
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

function withoutSkillsMcp(config: object): Record<string, unknown> {
  const preserved: Record<string, unknown> = { ...config };
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
