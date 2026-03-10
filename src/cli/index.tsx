#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, writeFileSync, appendFileSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { normalizeSkillName } from "../lib/utils.js";
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
  getSkillPath,
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
      const total = skills.length;
      for (let i = 0; i < total; i++) {
        const name = skills[i];
        if (total > 1 && !options.json) {
          process.stdout.write(`[${i + 1}/${total}] Installing ${name}...`);
        }
        const result = installSkill(name, { overwrite: options.overwrite });
        results.push(result);
        if (total > 1 && !options.json) {
          console.log(result.success ? " done" : " failed");
        }
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (total <= 1) {
          console.log(chalk.bold("\nInstalling skills...\n"));
          for (const result of results) {
            if (result.success) {
              console.log(chalk.green(`\u2713 ${result.skill}`));
            } else {
              console.log(chalk.red(`\u2717 ${result.skill}: ${result.error}`));
            }
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
  .option("-c, --category <category>", "Filter results by category")
  .description("Search for skills")
  .action((query: string, options: { json: boolean; category?: string }) => {
    let results = searchSkills(query);

    if (options.category) {
      const category = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category!.toLowerCase()
      );
      if (!category) {
        console.error(`Unknown category: ${options.category}`);
        console.error(`Available: ${CATEGORIES.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      results = results.filter((s) => s.category === category);
    }

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
  .option("--json", "Output as JSON", false)
  .description("Initialize project for installed skills (.env.example, .gitignore)")
  .action((options: { json: boolean }) => {
    const cwd = process.cwd();
    const installed = getInstalledSkills();

    if (installed.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ skills: [], envVars: 0, gitignoreUpdated: false }));
      } else {
        console.log(chalk.dim("No skills installed. Run: skills install <name>"));
      }
      return;
    }

    // Collect env vars per skill for detailed .env.example
    const envMap = new Map<string, string[]>();
    for (const name of installed) {
      const reqs = getSkillRequirements(name);
      if (reqs?.envVars.length) {
        for (const v of reqs.envVars) {
          if (!envMap.has(v)) envMap.set(v, []);
          if (!envMap.get(v)!.includes(name)) envMap.get(v)!.push(name);
        }
      }
    }

    // Generate .env.example with per-skill comments
    let envVarCount = 0;
    if (envMap.size > 0) {
      const lines = [
        "# Environment variables for installed skills",
        "# Auto-generated by: skills init",
        "",
      ];

      const sorted = Array.from(envMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      let lastPrefix = "";
      for (const [envVar, skills] of sorted) {
        const prefix = envVar.split("_")[0];
        if (prefix !== lastPrefix) {
          if (lastPrefix) lines.push("");
          lines.push(`# ${prefix}`);
          lastPrefix = prefix;
        }
        lines.push(`# Used by: ${skills.join(", ")}`);
        lines.push(`${envVar}=`);
      }

      const envContent = lines.join("\n") + "\n";
      const envPath = join(cwd, ".env.example");
      writeFileSync(envPath, envContent);
      envVarCount = envMap.size;
      if (!options.json) {
        console.log(chalk.green(`\u2713 Generated .env.example (${envVarCount} variables from ${installed.length} skills)`));
      }
    } else {
      if (!options.json) {
        console.log(chalk.dim("  No environment variables detected across installed skills"));
      }
    }

    // Update .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    const gitignoreEntry = ".skills/";
    let gitignoreContent = "";
    if (existsSync(gitignorePath)) {
      gitignoreContent = readFileSync(gitignorePath, "utf-8");
    }
    let gitignoreUpdated = false;
    if (!gitignoreContent.includes(gitignoreEntry)) {
      const addition = gitignoreContent.endsWith("\n") || gitignoreContent === ""
        ? `\n# Installed skills\n${gitignoreEntry}\n`
        : `\n\n# Installed skills\n${gitignoreEntry}\n`;
      appendFileSync(gitignorePath, addition);
      gitignoreUpdated = true;
      if (!options.json) {
        console.log(chalk.green(`\u2713 Added .skills/ to .gitignore`));
      }
    } else {
      if (!options.json) {
        console.log(chalk.dim("  .skills/ already in .gitignore"));
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        skills: installed,
        envVars: envVarCount,
        gitignoreUpdated,
      }, null, 2));
    } else {
      // Print summary of skills and their env vars
      if (envMap.size > 0) {
        console.log(chalk.bold("\nSkill environment requirements:"));
        for (const name of installed) {
          const reqs = getSkillRequirements(name);
          if (reqs?.envVars.length) {
            console.log(`  ${chalk.cyan(name)}: ${reqs.envVars.join(", ")}`);
          }
        }
      }
      console.log(chalk.bold(`\nInitialized for ${installed.length} installed skill(s)`));
    }
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

    // Helper to collect all file paths recursively (relative to root)
    function collectFiles(dir: string, base: string = ""): Set<string> {
      const files = new Set<string>();
      if (!existsSync(dir)) return files;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const rel = base ? `${base}/${entry}` : entry;
        if (statSync(full).isDirectory()) {
          for (const f of collectFiles(full, rel)) files.add(f);
        } else {
          files.add(rel);
        }
      }
      return files;
    }

    const updateResults: Array<{
      skill: string;
      success: boolean;
      error?: string;
      newFiles: string[];
      removedFiles: string[];
      unchangedCount: number;
    }> = [];

    for (const name of toUpdate) {
      const skillName = normalizeSkillName(name);
      const destPath = join(process.cwd(), ".skills", skillName);

      // Snapshot existing files before update
      const beforeFiles = collectFiles(destPath);

      const result = installSkill(name, { overwrite: true });

      // Snapshot files after update
      const afterFiles = collectFiles(destPath);

      const newFiles = [...afterFiles].filter((f) => !beforeFiles.has(f));
      const removedFiles = [...beforeFiles].filter((f) => !afterFiles.has(f));
      const unchangedCount = [...afterFiles].filter((f) => beforeFiles.has(f)).length;

      updateResults.push({
        skill: result.skill,
        success: result.success,
        error: result.error,
        newFiles,
        removedFiles,
        unchangedCount,
      });
    }

    if (options.json) {
      console.log(JSON.stringify(updateResults, null, 2));
    } else {
      console.log(chalk.bold("\nUpdating skills...\n"));
      for (const result of updateResults) {
        if (result.success) {
          console.log(chalk.green(`\u2713 ${result.skill}`));
          if (result.newFiles.length > 0) {
            console.log(chalk.green(`    + ${result.newFiles.length} new file(s): ${result.newFiles.join(", ")}`));
          }
          if (result.removedFiles.length > 0) {
            console.log(chalk.red(`    - ${result.removedFiles.length} removed file(s): ${result.removedFiles.join(", ")}`));
          }
          console.log(chalk.dim(`    ${result.unchangedCount} file(s) updated`));
        } else {
          console.log(chalk.red(`\u2717 ${result.skill}: ${result.error}`));
        }
      }
      console.log(chalk.dim("\nSkills updated in .skills/"));
    }

    if (updateResults.some((r) => !r.success)) {
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
  .option("-p, --port <port>", "Port number (0 = auto-assign free port)", "0")
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

// Completion command
program
  .command("completion")
  .argument("<shell>", "Shell type: bash, zsh, or fish")
  .description("Generate shell completions")
  .action((shell: string) => {
    const subcommands = [
      "install", "list", "search", "info", "docs", "requires", "run",
      "remove", "update", "categories", "mcp", "serve", "init",
      "self-update", "completion", "outdated",
    ];
    const skillNames = SKILLS.map((s) => s.name);
    const categoryNames = CATEGORIES.map((c) => c);
    const skillCmds = ["install", "info", "docs", "requires", "run", "remove"];

    switch (shell) {
      case "bash": {
        const script = `# Bash completion for skills CLI
_skills_completions() {
  local cur prev subcmds skill_cmds skills categories
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  subcmds="${subcommands.join(" ")}"
  skill_cmds="${skillCmds.join(" ")}"
  skills="${skillNames.join(" ")}"
  categories="${categoryNames.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${subcmds}" -- "\${cur}") )
    return 0
  fi

  case "\${prev}" in
    --category|-c)
      COMPREPLY=( $(compgen -W "\${categories}" -- "\${cur}") )
      return 0
      ;;
  esac

  for cmd in \${skill_cmds}; do
    if [[ "\${COMP_WORDS[1]}" == "\${cmd}" && \${COMP_CWORD} -eq 2 ]]; then
      COMPREPLY=( $(compgen -W "\${skills}" -- "\${cur}") )
      return 0
    fi
  done

  return 0
}
complete -F _skills_completions skills
`;
        console.log(script);
        break;
      }
      case "zsh": {
        const script = `#compdef skills
# Zsh completion for skills CLI

_skills() {
  local -a subcmds skill_cmds skills categories

  subcmds=(
${subcommands.map((c) => `    '${c}:${c} command'`).join("\n")}
  )

  skills=(${skillNames.join(" ")})
  categories=(${categoryNames.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ")})

  skill_cmds=(${skillCmds.join(" ")})

  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'skills command' subcmds
      ;;
    args)
      case \${words[1]} in
        ${skillCmds.join("|")})
          _describe 'skill' skills
          ;;
        list|search)
          _arguments '--category[Filter by category]:category:($categories)'
          ;;
        completion)
          _describe 'shell' '(bash zsh fish)'
          ;;
      esac
      ;;
  esac
}

_skills "$@"
`;
        console.log(script);
        break;
      }
      case "fish": {
        const lines = [
          "# Fish completion for skills CLI",
          "",
          "# Disable file completions by default",
          "complete -c skills -f",
          "",
          "# Subcommands",
        ];
        for (const cmd of subcommands) {
          lines.push(`complete -c skills -n '__fish_use_subcommand' -a '${cmd}' -d '${cmd} command'`);
        }
        lines.push("");
        lines.push("# Skill names for relevant subcommands");
        for (const cmd of skillCmds) {
          for (const name of skillNames) {
            lines.push(`complete -c skills -n '__fish_seen_subcommand_from ${cmd}' -a '${name}'`);
          }
        }
        lines.push("");
        lines.push("# Category completions for --category flag");
        for (const cat of categoryNames) {
          lines.push(`complete -c skills -l category -s c -a '${cat}' -d 'Category'`);
        }
        console.log(lines.join("\n"));
        break;
      }
      default:
        console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
        process.exitCode = 1;
    }
  });

// Doctor command
program
  .command("doctor")
  .option("--json", "Output as JSON", false)
  .description("Check environment variables for installed skills")
  .action((options: { json: boolean }) => {
    const installed = getInstalledSkills();

    if (installed.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ skills: [], message: "No skills installed" }));
      } else {
        console.log("No skills installed");
      }
      return;
    }

    const report: Array<{ skill: string; envVars: Array<{ name: string; set: boolean }> }> = [];

    for (const name of installed) {
      const reqs = getSkillRequirements(name);
      const envVars = (reqs?.envVars ?? []).map((v) => ({
        name: v,
        set: !!process.env[v],
      }));
      report.push({ skill: name, envVars });
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(chalk.bold(`\nSkills Doctor (${installed.length} installed):\n`));
    for (const entry of report) {
      console.log(chalk.bold(`  ${entry.skill}`));
      if (entry.envVars.length === 0) {
        console.log(chalk.dim("    No environment variables required"));
      } else {
        for (const v of entry.envVars) {
          const status = v.set ? chalk.green("set") : chalk.red("missing");
          console.log(`    ${v.name} [${status}]`);
        }
      }
    }
  });

// Outdated command
program
  .command("outdated")
  .option("--json", "Output as JSON", false)
  .description("Check for outdated installed skills")
  .action((options: { json: boolean }) => {
    const installed = getInstalledSkills();

    if (installed.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log(chalk.dim("No skills installed. Run: skills install <name>"));
      }
      return;
    }

    const cwd = process.cwd();
    const outdated: Array<{
      skill: string;
      installedVersion: string;
      registryVersion: string;
    }> = [];
    const upToDate: string[] = [];

    for (const name of installed) {
      const skillName = normalizeSkillName(name);

      // Read installed version from .skills/skill-{name}/package.json
      const installedPkgPath = join(cwd, ".skills", skillName, "package.json");
      let installedVersion = "unknown";
      if (existsSync(installedPkgPath)) {
        try {
          installedVersion = JSON.parse(readFileSync(installedPkgPath, "utf-8")).version || "unknown";
        } catch {}
      }

      // Read registry version from skills/skill-{name}/package.json
      const registryPath = getSkillPath(name);
      const registryPkgPath = join(registryPath, "package.json");
      let registryVersion = "unknown";
      if (existsSync(registryPkgPath)) {
        try {
          registryVersion = JSON.parse(readFileSync(registryPkgPath, "utf-8")).version || "unknown";
        } catch {}
      }

      if (installedVersion !== registryVersion) {
        outdated.push({ skill: name, installedVersion, registryVersion });
      } else {
        upToDate.push(name);
      }
    }

    if (options.json) {
      console.log(JSON.stringify(outdated, null, 2));
      return;
    }

    if (outdated.length === 0) {
      console.log(chalk.green(`\nAll ${installed.length} installed skill(s) are up to date`));
      return;
    }

    console.log(chalk.bold(`\nOutdated skills (${outdated.length}):\n`));
    for (const entry of outdated) {
      console.log(`  ${chalk.cyan(entry.skill)}  ${chalk.red(entry.installedVersion)} → ${chalk.green(entry.registryVersion)}`);
    }
    if (upToDate.length > 0) {
      console.log(chalk.dim(`\n${upToDate.length} skill(s) up to date`));
    }
    console.log(chalk.dim(`\nRun ${chalk.bold("skills update")} to update all outdated skills`));
  });

program.parse();
