#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, writeFileSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
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
  AGENT_TARGETS,
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

const program = new Command();

program
  .name("skills")
  .description("Install AI agent skills for your project")
  .version("0.0.1")
  .enablePositionalOptions();

// Interactive mode
program
  .command("interactive")
  .alias("i")
  .description("Interactive skill browser (TUI)")
  .action(() => {
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
  .description("Install one or more skills")
  .action((skills: string[], options) => {
    const results = [];

    if (options.for) {
      // Agent install mode: copy SKILL.md to agent skill dir
      const agents: AgentTarget[] = options.for === "all"
        ? [...AGENT_TARGETS]
        : [options.for as AgentTarget];

      // Validate agent names
      for (const agent of agents) {
        if (!AGENT_TARGETS.includes(agent)) {
          console.error(chalk.red(`Unknown agent: ${agent}. Available: ${AGENT_TARGETS.join(", ")}, all`));
          process.exitCode = 1;
          return;
        }
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
  .description("Remove an installed skill")
  .action((skill: string, options: { json: boolean; for?: string; scope: string }) => {
    if (options.for) {
      const agents: AgentTarget[] = options.for === "all"
        ? [...AGENT_TARGETS]
        : [options.for as AgentTarget];

      for (const agent of agents) {
        if (!AGENT_TARGETS.includes(agent)) {
          console.error(chalk.red(`Unknown agent: ${agent}. Available: ${AGENT_TARGETS.join(", ")}, all`));
          process.exitCode = 1;
          return;
        }
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

// Default: show help (not interactive - agents can't use TUI)
program.action(() => {
  program.help();
});

program.parse();
