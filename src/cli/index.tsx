#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
import pkg from "../../package.json" with { type: "json" };
import { App } from "./components/App.js";
import {
  SKILLS,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
} from "../lib/registry.js";
import {
  installSkill,
  installSkillForAgent,
  removeSkillForAgent,
  getInstalledSkills,
  removeSkill,
  resolveAgents,
  type AgentTarget,
} from "../lib/installer.js";
import {
  getSkillDocs,
  getSkillBestDoc,
  getSkillRequirements,
  runSkill,
  generateEnvExample,
  generateSkillMd,
} from "../lib/skillinfo.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);
const program = new Command();

program
  .name("skills")
  .description("Install AI agent skills for your project")
  .version(pkg.version)
  .option("--verbose", "Enable verbose logging", false)
  .enablePositionalOptions();

// Interactive mode (default when no subcommand given)
program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Interactive skill browser (TUI)")
  .action(() => {
    if (!isTTY) {
      console.log("Non-interactive environment detected. Use a subcommand:\n");
      console.log("  skills list          List available skills");
      console.log("  skills search <q>    Search skills");
      console.log("  skills install <n>   Install a skill");
      console.log("  skills info <n>      Show skill details");
      console.log("  skills serve         Start web dashboard");
      console.log("  skills --help        Show all commands\n");
      process.exit(0);
    }
    render(<App />);
  });

// Install command
program
  .command("install")
  .alias("add")
  .argument("<skills...>", "Skills to install")
  .option("-o, --overwrite", "Overwrite existing skills", false)
  .option("--json", "Output results as JSON", false)
  .option("--for <agent>", "Install for agent: claude, codex, gemini, or all")
  .option("--scope <scope>", "Install scope: global or project", "global")
  .option("--dry-run", "Print what would happen without actually installing", false)
  .description("Install one or more skills")
  .action((skills: string[], options) => {
    const results = [];

    if (options.for) {
      // Agent install mode: copy SKILL.md to agent skill dir
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(options.for);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
        return;
      }

      if (options.dryRun) {
        for (const name of skills) {
          for (const agent of agents) {
            console.log(chalk.dim(`[dry-run] Would install ${name} for ${agent} (${options.scope})`));
          }
        }
        return;
      }

      for (const name of skills) {
        for (const agent of agents) {
          const result = installSkillForAgent(name, {
            agent,
            scope: options.scope as "global" | "project",
          }, generateSkillMd);
          results.push({ ...result, agent, scope: options.scope });
        }
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(chalk.bold("\nInstalling skills for agent(s)...\n"));
        for (const result of results) {
          const label = `${result.skill} → ${(result as any).agent} (${(result as any).scope})`;
          if (result.success) {
            console.log(chalk.green(`\u2713 ${label}`));
          } else {
            console.log(chalk.red(`\u2717 ${label}: ${result.error}`));
          }
        }
        console.log(chalk.dim("\nSKILL.md copied to agent skill directories"));
      }
    } else {
      if (options.dryRun) {
        for (const name of skills) {
          console.log(chalk.dim(`[dry-run] Would install ${name} to .skills/`));
        }
        return;
      }

      // Default: full source install to .skills/
      for (const name of skills) {
        const result = installSkill(name, { overwrite: options.overwrite });
        results.push(result);
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        console.log(chalk.bold("\nInstalling skills...\n"));
        for (const result of results) {
          if (result.success) {
            console.log(chalk.green(`\u2713 ${result.skill}`));
          } else {
            console.log(chalk.red(`\u2717 ${result.skill}: ${result.error}`));
          }
        }
        console.log(chalk.dim("\nSkills installed to .skills/"));
      }
    }

    if (results.some((r) => !r.success)) {
      process.exitCode = 1;
    }
  });

// List command
program
  .command("list")
  .alias("ls")
  .option("-c, --category <category>", "Filter by category")
  .option("-i, --installed", "Show only installed skills", false)
  .option("--json", "Output as JSON", false)
  .description("List available or installed skills")
  .action((options) => {
    if (options.installed) {
      const installed = getInstalledSkills();
      if (options.json) {
        console.log(JSON.stringify(installed));
        return;
      }
      if (installed.length === 0) {
        console.log(chalk.dim("No skills installed"));
        return;
      }
      console.log(chalk.bold(`\nInstalled skills (${installed.length}):\n`));
      for (const name of installed) {
        console.log(`  ${name}`);
      }
      return;
    }

    if (options.category) {
      const category = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category.toLowerCase()
      );
      if (!category) {
        console.error(`Unknown category: ${options.category}`);
        console.error(`Available: ${CATEGORIES.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      const skills = getSkillsByCategory(category);
      if (options.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      console.log(chalk.bold(`\n${category} (${skills.length}):\n`));
      for (const s of skills) {
        console.log(`  ${chalk.cyan(s.name)} - ${s.description}`);
      }
      return;
    }

    // Show all
    if (options.json) {
      console.log(JSON.stringify(SKILLS, null, 2));
      return;
    }

    console.log(chalk.bold(`\nAvailable skills (${SKILLS.length}):\n`));
    for (const category of CATEGORIES) {
      const skills = getSkillsByCategory(category);
      console.log(chalk.bold(`${category} (${skills.length}):`));
      for (const s of skills) {
        console.log(`  ${chalk.cyan(s.name)} - ${s.description}`);
      }
      console.log();
    }
  });

// Search command
program
  .command("search")
  .argument("<query>", "Search term")
  .option("--json", "Output as JSON", false)
  .description("Search for skills")
  .action((query: string, options: { json: boolean }) => {
    const results = searchSkills(query);
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    if (results.length === 0) {
      console.log(chalk.dim(`No skills found for "${query}"`));
      return;
    }
    console.log(chalk.bold(`\nFound ${results.length} skill(s):\n`));
    for (const s of results) {
      console.log(
        `  ${chalk.cyan(s.name)} ${chalk.dim(`[${s.category}]`)}`
      );
      console.log(`    ${s.description}`);
    }
  });

// Info command
program
  .command("info")
  .argument("<skill>", "Skill name")
  .option("--json", "Output as JSON", false)
  .description("Show details about a specific skill")
  .action((name: string, options: { json: boolean }) => {
    const skill = getSkill(name);
    if (!skill) {
      console.error(`Skill '${name}' not found`);
      process.exitCode = 1;
      return;
    }

    const reqs = getSkillRequirements(name);

    if (options.json) {
      console.log(JSON.stringify({ ...skill, ...reqs }, null, 2));
      return;
    }
    console.log(`\n${chalk.bold(skill.displayName)}`);
    console.log(`${skill.description}`);
    console.log(`${chalk.dim("Category:")} ${skill.category}`);
    console.log(`${chalk.dim("Tags:")} ${skill.tags.join(", ")}`);
    if (reqs?.cliCommand) {
      console.log(`${chalk.dim("CLI:")} ${reqs.cliCommand}`);
    }
    if (reqs?.envVars.length) {
      console.log(`${chalk.dim("Env vars:")} ${reqs.envVars.join(", ")}`);
    }
    if (reqs?.systemDeps.length) {
      console.log(`${chalk.dim("System deps:")} ${reqs.systemDeps.join(", ")}`);
    }
    console.log(`${chalk.dim("Install:")} skills install ${skill.name}`);
  });

// Docs command
program
  .command("docs")
  .argument("<skill>", "Skill name")
  .option("--json", "Output as JSON", false)
  .option("--file <file>", "Specific file: skill, readme, claude", "")
  .description("Show documentation for a skill")
  .action((name: string, options: { json: boolean; file: string }) => {
    const docs = getSkillDocs(name);
    if (!docs) {
      console.error(`Skill '${name}' not found`);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({
        skill: name,
        hasSkillMd: docs.skillMd !== null,
        hasReadme: docs.readme !== null,
        hasClaudeMd: docs.claudeMd !== null,
        content: options.file
          ? docs[options.file === "skill" ? "skillMd" : options.file === "readme" ? "readme" : "claudeMd"]
          : docs.skillMd || docs.readme || docs.claudeMd,
      }, null, 2));
      return;
    }

    let content: string | null = null;
    if (options.file === "skill") content = docs.skillMd;
    else if (options.file === "readme") content = docs.readme;
    else if (options.file === "claude") content = docs.claudeMd;
    else content = docs.skillMd || docs.readme || docs.claudeMd;

    if (!content) {
      const available = [];
      if (docs.skillMd) available.push("skill");
      if (docs.readme) available.push("readme");
      if (docs.claudeMd) available.push("claude");
      if (available.length === 0) {
        console.log(chalk.dim(`No documentation found for '${name}'`));
      } else {
        console.log(chalk.dim(`File '${options.file}' not found. Available: ${available.join(", ")}`));
      }
      return;
    }

    console.log(content);
  });

// Requires command
program
  .command("requires")
  .argument("<skill>", "Skill name")
  .option("--json", "Output as JSON", false)
  .description("Show what a skill needs (env vars, system deps, dependencies)")
  .action((name: string, options: { json: boolean }) => {
    const reqs = getSkillRequirements(name);
    if (!reqs) {
      console.error(`Skill '${name}' not found`);
      process.exitCode = 1;
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(reqs, null, 2));
      return;
    }

    console.log(`\n${chalk.bold(`Requirements for ${name}`)}\n`);

    if (reqs.cliCommand) {
      console.log(`${chalk.dim("CLI command:")} ${reqs.cliCommand}`);
    }

    if (reqs.envVars.length > 0) {
      console.log(`\n${chalk.bold("Environment variables:")}`);
      for (const v of reqs.envVars) {
        const isSet = process.env[v] ? chalk.green("set") : chalk.red("missing");
        console.log(`  ${v} [${isSet}]`);
      }
    } else {
      console.log(chalk.dim("\nNo environment variables detected."));
    }

    if (reqs.systemDeps.length > 0) {
      console.log(`\n${chalk.bold("System dependencies:")}`);
      for (const dep of reqs.systemDeps) {
        console.log(`  ${dep}`);
      }
    }

    const depCount = Object.keys(reqs.dependencies).length;
    if (depCount > 0) {
      console.log(`\n${chalk.bold("npm dependencies:")} ${depCount} packages`);
      for (const [pkg, ver] of Object.entries(reqs.dependencies)) {
        console.log(`  ${pkg} ${chalk.dim(ver)}`);
      }
    }
  });

// Run command
program
  .command("run")
  .argument("<skill>", "Skill name")
  .argument("[args...]", "Arguments to pass to the skill")
  .allowUnknownOption(true)
  .passThroughOptions(true)
  .description("Run a skill directly")
  .action(async (name: string, args: string[]) => {
    const skill = getSkill(name);
    if (!skill) {
      console.error(`Skill '${name}' not found in registry`);
      process.exitCode = 1;
      return;
    }

    const result = await runSkill(name, args);
    if (result.error) {
      console.error(result.error);
    }
    process.exitCode = result.exitCode;
  });

// Init command
program
  .command("init")
  .description("Initialize project for installed skills (.env.example, .gitignore)")
  .action(() => {
    const cwd = process.cwd();
    const installed = getInstalledSkills();

    if (installed.length === 0) {
      console.log(chalk.dim("No skills installed. Run: skills install <name>"));
      return;
    }

    // Generate .env.example
    const envContent = generateEnvExample(cwd);
    if (envContent) {
      const envPath = join(cwd, ".env.example");
      writeFileSync(envPath, envContent);
      console.log(chalk.green(`\u2713 Generated .env.example`));
    } else {
      console.log(chalk.dim("  No environment variables detected across installed skills"));
    }

    // Update .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    const gitignoreEntry = ".skills/";
    let gitignoreContent = "";
    if (existsSync(gitignorePath)) {
      gitignoreContent = readFileSync(gitignorePath, "utf-8");
    }
    if (!gitignoreContent.includes(gitignoreEntry)) {
      const addition = gitignoreContent.endsWith("\n") || gitignoreContent === ""
        ? `\n# Installed skills\n${gitignoreEntry}\n`
        : `\n\n# Installed skills\n${gitignoreEntry}\n`;
      appendFileSync(gitignorePath, addition);
      console.log(chalk.green(`\u2713 Added .skills/ to .gitignore`));
    } else {
      console.log(chalk.dim("  .skills/ already in .gitignore"));
    }

    console.log(chalk.bold(`\nInitialized for ${installed.length} installed skill(s)`));
  });

// Remove command
program
  .command("remove")
  .alias("rm")
  .argument("<skill>", "Skill to remove")
  .option("--json", "Output as JSON", false)
  .option("--for <agent>", "Remove from agent: claude, codex, gemini, or all")
  .option("--scope <scope>", "Remove scope: global or project", "global")
  .option("--dry-run", "Print what would happen without actually removing", false)
  .description("Remove an installed skill")
  .action((skill: string, options: { json: boolean; for?: string; scope: string; dryRun: boolean }) => {
    if (options.for) {
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(options.for);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
        return;
      }

      if (options.dryRun) {
        for (const agent of agents) {
          console.log(chalk.dim(`[dry-run] Would remove ${skill} from ${agent} (${options.scope})`));
        }
        return;
      }

      const results = [];
      for (const agent of agents) {
        const removed = removeSkillForAgent(skill, {
          agent,
          scope: options.scope as "global" | "project",
        });
        results.push({ skill, agent, scope: options.scope, removed });
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const r of results) {
          const label = `${r.skill} from ${r.agent} (${r.scope})`;
          if (r.removed) {
            console.log(chalk.green(`\u2713 Removed ${label}`));
          } else {
            console.log(chalk.red(`\u2717 ${label} not found`));
          }
        }
      }

      if (results.every((r) => !r.removed)) {
        process.exitCode = 1;
      }
    } else {
      if (options.dryRun) {
        console.log(chalk.dim(`[dry-run] Would remove ${skill} from .skills/`));
        return;
      }

      const removed = removeSkill(skill);
      if (options.json) {
        console.log(JSON.stringify({ skill, removed }));
      } else if (removed) {
        console.log(chalk.green(`\u2713 Removed ${skill}`));
      } else {
        console.log(chalk.red(`\u2717 ${skill} is not installed`));
        process.exitCode = 1;
      }
    }
  });

// Update command
program
  .command("update")
  .argument("[skills...]", "Skills to update (default: all installed)")
  .option("--json", "Output results as JSON", false)
  .description("Update installed skills (reinstall with --overwrite)")
  .action((skills: string[], options: { json: boolean }) => {
    const toUpdate =
      skills.length > 0 ? skills : getInstalledSkills();

    if (toUpdate.length === 0) {
      console.log(chalk.dim("No skills installed. Run: skills install <name>"));
      return;
    }

    const results = toUpdate.map((name) =>
      installSkill(name, { overwrite: true })
    );

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(chalk.bold("\nUpdating skills...\n"));
      for (const result of results) {
        if (result.success) {
          console.log(chalk.green(`\u2713 ${result.skill}`));
        } else {
          console.log(chalk.red(`\u2717 ${result.skill}: ${result.error}`));
        }
      }
      console.log(chalk.dim("\nSkills updated in .skills/"));
    }

    if (results.some((r) => !r.success)) {
      process.exitCode = 1;
    }
  });

// Categories command
program
  .command("categories")
  .option("--json", "Output as JSON", false)
  .description("List all categories")
  .action((options: { json: boolean }) => {
    const cats = CATEGORIES.map((category) => ({
      name: category,
      count: getSkillsByCategory(category).length,
    }));
    if (options.json) {
      console.log(JSON.stringify(cats, null, 2));
      return;
    }
    console.log(chalk.bold("\nCategories:\n"));
    for (const { name, count } of cats) {
      console.log(`  ${name} (${count})`);
    }
  });

// MCP command
program
  .command("mcp")
  .option("--register <agent>", "Register MCP server with agent: claude, codex, gemini, or all")
  .description("Start MCP server (stdio) or register with an agent")
  .action(async (options: { register?: string }) => {
    if (options.register) {
      const agents = options.register === "all"
        ? ["claude", "codex", "gemini"]
        : [options.register];

      const binPath = join(import.meta.dir, "..", "mcp", "index.ts");

      for (const agent of agents) {
        if (agent === "claude") {
          try {
            const proc = Bun.spawn(["claude", "mcp", "add", "skills", "--", "bun", "run", binPath], {
              stdout: "pipe", stderr: "pipe",
            });
            await proc.exited;
            console.log(chalk.green(`\u2713 Registered MCP server with Claude Code`));
          } catch {
            console.log(chalk.yellow(`Manual registration: claude mcp add skills -- bun run ${binPath}`));
          }
        } else if (agent === "codex") {
          const { homedir } = await import("os");
          const configPath = join(homedir(), ".codex", "config.toml");
          console.log(chalk.bold(`\nAdd to ${configPath}:`));
          console.log(chalk.dim(`[mcp_servers.skills]\ncommand = "bun"\nargs = ["run", "${binPath}"]`));
          console.log(chalk.green(`\u2713 Codex MCP config shown above`));
        } else if (agent === "gemini") {
          const { homedir } = await import("os");
          const configPath = join(homedir(), ".gemini", "settings.json");
          console.log(chalk.bold(`\nAdd to ${configPath} mcpServers:`));
          console.log(chalk.dim(JSON.stringify({
            skills: { command: "bun", args: ["run", binPath] }
          }, null, 2)));
          console.log(chalk.green(`\u2713 Gemini MCP config shown above`));
        } else {
          console.error(chalk.red(`Unknown agent: ${agent}. Available: claude, codex, gemini, all`));
          process.exitCode = 1;
        }
      }
      return;
    }

    // Start MCP server on stdio (importing the module triggers server start)
    await import("../mcp/index.js");
  });

// Serve command (web dashboard)
program
  .command("serve")
  .description("Start the Skills Dashboard web server")
  .option("-p, --port <port>", "Port number", "3579")
  .option("--no-open", "Don't open browser automatically")
  .action(async (options: { port: string; open: boolean }) => {
    const { startServer } = await import("../server/serve.js");
    const port = parseInt(options.port, 10);
    await startServer(port, { open: options.open });
  });

// Self-update command
program
  .command("self-update")
  .description("Update @hasna/skills to the latest version")
  .action(async () => {
    console.log(chalk.bold("\nUpdating @hasna/skills...\n"));
    const proc = Bun.spawn(["bun", "add", "-g", "@hasna/skills@latest"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      console.log(chalk.green("\n\u2713 Updated to latest version"));
      // Show new version
      const vProc = Bun.spawn(["skills", "--version"], { stdout: "pipe" });
      const ver = (await new Response(vProc.stdout).text()).trim();
      console.log(chalk.dim(`  Version: ${ver}`));
    } else {
      console.error(chalk.red("\n\u2717 Update failed"));
      process.exitCode = 1;
    }
  });

program.parse();
