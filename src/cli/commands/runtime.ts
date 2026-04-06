/**
 * run / mcp / serve / self-update — runtime commands
 */

import chalk from "chalk";
import { join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { getSkill, findSimilarSkills, SKILLS } from "../../lib/registry.js";
import { runSkill } from "../../lib/skillinfo.js";
import { AGENT_TARGETS } from "../../lib/installer.js";

export function registerRuntime(parent: Command) {
  // Run
  parent
    .command("run")
    .argument("<skill>", "Skill name")
    .argument("[args...]", "Arguments to pass to the skill")
    .allowUnknownOption(true)
    .passThroughOptions(true)
    .description("Run a skill directly")
    .action(async (name: string, args: string[]) => handleRun(name, args));

  // MCP
  parent
    .command("mcp")
    .option("--register <agent>", "Register MCP server with agent")
    .description("Start MCP server (stdio) or register with an agent")
    .action(async (options: { register?: string }) => handleMcp(options));

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
    .action(async () => {
    const name = "@hasna/skills";
    console.log(chalk.bold(`\nUpdating ${name}...\n`));
    const proc = Bun.spawn(["bun", "add", "-g", `${name}@latest`], { stdout: "inherit", stderr: "inherit" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log(chalk.green("\n\u2713 Updated to latest version"));
      const vProc = Bun.spawn(["skills", "--version"], { stdout: "pipe" });
      console.log(chalk.dim(`  Version: ${(await new Response(vProc.stdout).text()).trim()}`));
    } else { console.error(chalk.red("\n\u2717 Update failed")); process.exitCode = 1; }
  });
}

async function handleRun(name: string, args: string[]) {
  const skill = getSkill(name);
  if (!skill) {
    console.error(`Skill '${name}' not found`);
    const similar = findSimilarSkills(name);
    if (similar.length) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
    process.exitCode = 1; return;
  }
  const result = await runSkill(name, args);
  if (result.error) console.error(result.error);
  process.exitCode = result.exitCode;
}

async function handleMcp(options: { register?: string }) {
  if (options.register) {
    const agents = options.register === "all" ? [...AGENT_TARGETS] : [options.register];
    const binPath = join(import.meta.dir, "..", "mcp", "index.ts");
    for (const agent of agents) {
      if (agent === "claude") {
        try {
          const proc = Bun.spawn(["claude", "mcp", "add", "skills", "--", "bun", "run", binPath], { stdout: "pipe", stderr: "pipe" });
          await proc.exited;
          console.log(chalk.green(`\u2713 Registered MCP server with Claude Code`));
        } catch { console.log(chalk.yellow(`Manual registration: claude mcp add skills -- bun run ${binPath}`)); }
      } else {
        const dirs: Record<string, string> = {
          codex: join(homedir(), ".codex", "config.toml"),
          gemini: join(homedir(), ".gemini", "settings.json"),
          pi: join(homedir(), ".pi", "agent", "mcp.json"),
          opencode: join(homedir(), ".opencode", "config.json"),
        };
        const cfg: Record<string, string> = {
          codex: `[mcp_servers.skills]\ncommand = "bun"\nargs = ["run", "${binPath}"]`,
          gemini: JSON.stringify({ skills: { command: "bun", args: ["run", binPath] } }, null, 2),
          pi: JSON.stringify({ skills: { command: "bun", args: ["run", binPath] } }, null, 2),
          opencode: JSON.stringify({ skills: { command: "bun", args: ["run", binPath] } }, null, 2),
        };
        const agentLabels: Record<string, string> = {
          codex: "Codex MCP config shown above",
          gemini: "Gemini MCP config shown above",
          pi: "pi.dev MCP config shown above",
          opencode: "OpenCode MCP config shown above",
        };
        const dir = dirs[agent];
        if (dir) {
          console.log(chalk.bold(`\nAdd to ${dir}:`));
          console.log(chalk.dim(cfg[agent]));
          console.log(chalk.green(`\u2713 ${agentLabels[agent]}`));
        } else { console.error(chalk.red(`Unknown agent: ${agent}. Available: ${AGENT_TARGETS.join(", ")}, all`)); process.exitCode = 1; }
      }
    }
    return;
  }
  await import("../../mcp/index.js");
}
