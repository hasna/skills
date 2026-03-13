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
  findSimilarSkills,
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
  detectProjectSkills,
} from "../lib/skillinfo.js";
import { loadConfig, saveConfig, getConfigPath } from "../lib/config.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

// Respect --no-color flag (chalk also respects NO_COLOR env var natively)
// Strip from argv so Commander doesn't reject it on subcommands
if (process.argv.includes("--no-color")) {
  chalk.level = 0;
  const idx = process.argv.indexOf("--no-color");
  process.argv.splice(idx, 1);
}

const program = new Command();

/** Debug logger — writes to stderr so stdout piping is unaffected.
 *  Checks both the parent program option and raw argv so --verbose works
 *  regardless of position (before or after the subcommand). */
let _verbose: boolean | undefined;
function debug(msg: string): void {
  if (_verbose === undefined) {
    _verbose = program.opts().verbose || process.argv.includes("--verbose");
  }
  if (_verbose) {
    console.error(`[debug] ${msg}`);
  }
}

/** Print "Skill not found" with fuzzy suggestions */
function skillNotFound(name: string): void {
  console.error(`Skill '${name}' not found`);
  const similar = findSimilarSkills(name);
  if (similar.length > 0) {
    console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
  }
}

program
  .name("skills")
  .description("Install AI agent skills for your project")
  .version(pkg.version)
  .option("--verbose", "Enable verbose logging", false)
  .option("--no-color", "Disable colored output (also respects NO_COLOR env var)")
  .enablePositionalOptions();

// Interactive mode (default when no subcommand given)
program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Interactive skill browser (TUI)")
  .action(() => {
    if (!isTTY) {
      // Non-interactive: output compact list for AI agents (name+category only)
      // Use `skills list --json` for full objects
      console.log(JSON.stringify(SKILLS.map(s => ({ name: s.name, category: s.category }))));
      process.exit(0);
    }
    render(<App />);
  });

// Install command
program
  .command("install")
  .alias("add")
  .argument("[skills...]", "Skills to install")
  .option("--verbose", "Enable verbose debug logging", false)
  .option("-o, --overwrite", "Overwrite existing skills", false)
  .option("--json", "Output results as JSON", false)
  .option("--for <agent>", "Install for agent: claude, codex, gemini, or all")
  .option("--scope <scope>", "Install scope: global or project", "global")
  .option("--dry-run", "Print what would happen without actually installing", false)
  .option("--category <category>", "Install all skills in a category (case-insensitive)")
  .description("Install one or more skills")
  .action((skills: string[], options) => {
    // Apply config defaults when CLI flags are not explicitly provided
    const config = loadConfig();
    if (!options.for && config.defaultAgent) {
      options.for = config.defaultAgent;
    }
    // --scope has a Commander default of "global", so we only override
    // if the user did NOT pass --scope explicitly AND config has a value.
    // Commander sets the default before action runs, so we check raw argv.
    if (!process.argv.includes("--scope") && config.defaultScope) {
      options.scope = config.defaultScope;
    }
    debug(`install: skills=[${skills.join(", ")}] overwrite=${options.overwrite} for=${options.for ?? "none"} scope=${options.scope} dryRun=${options.dryRun}`);

    // Validate that either skills or --category is provided
    if (skills.length === 0 && !options.category) {
      console.error("error: missing required argument 'skills' or --category option");
      process.exitCode = 1;
      return;
    }

    // Resolve skills list from --category if provided
    if (options.category) {
      const matchedCategory = CATEGORIES.find(
        (c) => c.toLowerCase() === options.category.toLowerCase()
      );
      if (!matchedCategory) {
        console.error(`Unknown category: ${options.category}`);
        console.error(`Available: ${CATEGORIES.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      const categorySkills = getSkillsByCategory(matchedCategory);
      skills = categorySkills.map((s) => s.name);
      if (!options.json) {
        console.log(chalk.bold(`\nInstalling ${skills.length} skills from "${matchedCategory}"...\n`));
      }
    }

    const results = [];

    if (options.for) {
      // Agent install mode: copy SKILL.md to agent skill dir
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(options.for);
        debug(`install: resolved agents=[${agents.join(", ")}]`);
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
          debug(`install: installing ${name} for agent=${agent} scope=${options.scope}`);
          const result = installSkillForAgent(name, {
            agent,
            scope: options.scope as "global" | "project",
          }, generateSkillMd);
          debug(`install: ${name} → ${result.success ? "ok" : "failed"} path=${result.path ?? "n/a"}`);
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
      const startTime = Date.now();
      for (let i = 0; i < total; i++) {
        const name = skills[i];
        debug(`install: source=${getSkillPath(name)} dest=.skills/${normalizeSkillName(name)}`);
        if (total > 1 && !options.json) {
          process.stdout.write(`[${i + 1}/${total}] Installing ${name}...`);
        }
        const result = installSkill(name, { overwrite: options.overwrite });
        debug(`install: ${name} → ${result.success ? "ok" : "failed"} path=${result.path ?? "n/a"}`);
        results.push(result);
        if (total > 1 && !options.json) {
          console.log(result.success ? " done" : ` ${chalk.red("failed")}`);
        }
      }
      if (total > 1 && !options.json) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success);
        if (failed.length > 0) {
          console.log(chalk.yellow(`\n${succeeded}/${total} installed in ${elapsed}s, ${failed.length} failed: ${failed.map(r => r.skill).join(", ")}`));
          process.exitCode = 1;
        } else {
          console.log(chalk.green(`\n${succeeded}/${total} installed in ${elapsed}s`));
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
  .option("-t, --tags <tags>", "Filter by comma-separated tags (OR logic, case-insensitive)")
  .option("--json", "Output as JSON", false)
  .option("--brief", "One line per skill: name \u2014 description [category]", false)
  .option("--format <format>", "Output format: compact (names only) or csv (name,category,description)")
  .description("List available or installed skills")
  .action((options) => {
    // --json wins over --brief/--format when given
    const brief = options.brief && !options.json;
    const fmt = !options.json ? (options.format as string | undefined) : undefined;

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
      if (brief) {
        for (const name of installed) {
          console.log(name);
        }
        return;
      }
      console.log(chalk.bold(`\nInstalled skills (${installed.length}):\n`));
      for (const name of installed) {
        console.log(`  ${name}`);
      }
      return;
    }

    // Parse tags filter
    const tagFilter = options.tags
      ? options.tags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean)
      : null;

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
      let skills = getSkillsByCategory(category);
      if (tagFilter) {
        skills = skills.filter((s) =>
          s.tags.some((tag) => tagFilter.includes(tag.toLowerCase()))
        );
      }
      if (options.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (brief) {
        for (const s of skills) {
          console.log(`${s.name} \u2014 ${s.description} [${s.category}]`);
        }
        return;
      }
      console.log(chalk.bold(`\n${category} (${skills.length}):\n`));
      for (const s of skills) {
        console.log(`  ${chalk.cyan(s.name)} - ${s.description}`);
      }
      return;
    }

    if (tagFilter) {
      const skills = SKILLS.filter((s) =>
        s.tags.some((tag) => tagFilter.includes(tag.toLowerCase()))
      );
      if (options.json) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (brief) {
        for (const s of skills) {
          console.log(`${s.name} \u2014 ${s.description} [${s.category}]`);
        }
        return;
      }
      console.log(chalk.bold(`\nSkills matching tags [${tagFilter.join(", ")}] (${skills.length}):\n`));
      for (const s of skills) {
        console.log(`  ${chalk.cyan(s.name)} ${chalk.dim(`[${s.category}]`)} - ${s.description}`);
      }
      return;
    }

    // Show all
    if (options.json) {
      console.log(JSON.stringify(SKILLS, null, 2));
      return;
    }

    if (fmt === "compact") {
      for (const s of SKILLS) console.log(s.name);
      return;
    }

    if (fmt === "csv") {
      console.log("name,category,description");
      for (const s of SKILLS) {
        const desc = s.description.replace(/"/g, '""');
        console.log(`${s.name},${s.category},"${desc}"`);
      }
      return;
    }

    if (brief) {
      // Sort by category then name
      const sorted = [...SKILLS].sort((a, b) => {
        const catCmp = a.category.localeCompare(b.category);
        return catCmp !== 0 ? catCmp : a.name.localeCompare(b.name);
      });
      for (const s of sorted) {
        console.log(`${s.name} \u2014 ${s.description} [${s.category}]`);
      }
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
  .alias("s")
  .argument("<query>", "Search term")
  .option("--verbose", "Enable verbose debug logging", false)
  .option("--json", "Output as JSON", false)
  .option("--brief", "One line per skill: name \u2014 description [category]", false)
  .option("--format <format>", "Output format: compact (names only) or csv (name,category,description)")
  .option("-c, --category <category>", "Filter results by category")
  .option("-t, --tags <tags>", "Filter results by comma-separated tags (OR logic, case-insensitive)")
  .description("Search for skills")
  .action((query: string, options: { json: boolean; brief: boolean; format?: string; category?: string; tags?: string }) => {
    let results = searchSkills(query);
    debug(`search: query="${query}" results=${results.length} category=${options.category ?? "none"} tags=${options.tags ?? "none"}`);

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

    if (options.tags) {
      const tagFilter = options.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      results = results.filter((s) =>
        s.tags.some((tag) => tagFilter.includes(tag.toLowerCase()))
      );
    }

    // --json wins over --brief/--format when given
    const brief = options.brief && !options.json;
    const fmt = !options.json ? options.format : undefined;

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    if (results.length === 0) {
      console.log(chalk.dim(`No skills found for "${query}"`));
      const similar = findSimilarSkills(query, 5);
      if (similar.length > 0) {
        console.log(chalk.dim(`Related skills: ${similar.join(", ")}`));
      }
      return;
    }
    if (fmt === "compact") {
      for (const s of results) console.log(s.name);
      return;
    }
    if (fmt === "csv") {
      console.log("name,category,description");
      for (const s of results) {
        const desc = s.description.replace(/"/g, '""');
        console.log(`${s.name},${s.category},"${desc}"`);
      }
      return;
    }
    if (brief) {
      for (const s of results) {
        console.log(`${s.name} \u2014 ${s.description} [${s.category}]`);
      }
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
  .option("--brief", "Single line: name \u2014 description [category] (tags: ...)", false)
  .description("Show details about a specific skill")
  .action((name: string, options: { json: boolean; brief: boolean }) => {
    const skill = getSkill(name);
    if (!skill) {
      skillNotFound(name);
      process.exitCode = 1;
      return;
    }

    const reqs = getSkillRequirements(name);

    if (options.json) {
      console.log(JSON.stringify({ ...skill, ...reqs }, null, 2));
      return;
    }

    // --json wins over --brief when both are given (json handled above)
    if (options.brief) {
      console.log(`${skill.name} \u2014 ${skill.description} [${skill.category}] (tags: ${skill.tags.join(", ")})`);
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
      skillNotFound(name);
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
      skillNotFound(name);
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
      skillNotFound(name);
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
  .option("--for <agent>", "Detect project type and install recommended skills for agent: claude, codex, gemini, or all")
  .option("--scope <scope>", "Install scope: global or project", "global")
  .description("Initialize project for installed skills (.env.example, .gitignore)")
  .action((options: { json: boolean; for?: string; scope: string }) => {
    const cwd = process.cwd();

    // --for mode: detect project type, recommend, and install skills for the agent
    if (options.for) {
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(options.for);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
        return;
      }

      const { detected, recommended } = detectProjectSkills(cwd);

      if (options.json) {
        const installResults = [];
        for (const skill of recommended) {
          for (const agent of agents) {
            const result = installSkillForAgent(skill.name, {
              agent,
              scope: options.scope as "global" | "project",
            }, generateSkillMd);
            installResults.push({ ...result, agent, scope: options.scope });
          }
        }
        console.log(JSON.stringify({
          detected,
          recommended: recommended.map((s) => s.name),
          installed: installResults,
        }, null, 2));
        return;
      }

      if (detected.length > 0) {
        console.log(chalk.bold("\nDetected project technologies:"));
        for (const tech of detected) {
          console.log(`  ${chalk.cyan(tech)}`);
        }
      } else {
        console.log(chalk.dim("\nNo specific project dependencies detected"));
      }

      console.log(chalk.bold(`\nRecommended skills (${recommended.length}):`));
      for (const skill of recommended) {
        console.log(`  ${chalk.cyan(skill.name)} - ${skill.description}`);
      }

      console.log(chalk.bold(`\nInstalling recommended skills for ${options.for} (${options.scope})...\n`));
      const installResults = [];
      for (const skill of recommended) {
        for (const agent of agents) {
          const result = installSkillForAgent(skill.name, {
            agent,
            scope: options.scope as "global" | "project",
          }, generateSkillMd);
          installResults.push({ ...result, agent });
          const label = `${skill.name} → ${agent} (${options.scope})`;
          if (result.success) {
            console.log(chalk.green(`\u2713 ${label}`));
          } else {
            console.log(chalk.red(`\u2717 ${label}: ${result.error}`));
          }
        }
      }

      if (installResults.some((r) => !r.success)) {
        process.exitCode = 1;
      }

      // Fall through to also do the standard .env.example / .gitignore setup
    }

    const installed = getInstalledSkills();

    if (installed.length === 0 && !options.for) {
      if (options.json) {
        console.log(JSON.stringify({ skills: [], envVars: 0, gitignoreUpdated: false }));
      } else {
        console.log(chalk.dim("No skills installed. Run: skills install <name>"));
      }
      return;
    }

    // Skip .env.example / .gitignore if no installed skills and in --for mode
    if (installed.length === 0) return;

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

    if (!options.for) {
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
    }
  });

// Remove command
program
  .command("remove")
  .alias("rm")
  .argument("<skill>", "Skill to remove")
  .option("--verbose", "Enable verbose debug logging", false)
  .option("--json", "Output as JSON", false)
  .option("--for <agent>", "Remove from agent: claude, codex, gemini, or all")
  .option("--scope <scope>", "Remove scope: global or project", "global")
  .option("--dry-run", "Print what would happen without actually removing", false)
  .option("-y, --yes", "Skip confirmation prompt", false)
  .description("Remove an installed skill")
  .action(async (skill: string, options: { json: boolean; for?: string; scope: string; dryRun: boolean; yes: boolean }) => {
    debug(`remove: skill=${skill} for=${options.for ?? "none"} scope=${options.scope} dryRun=${options.dryRun}`);

    // Confirmation prompt (skip if --yes, --dry-run, or non-TTY)
    if (!options.yes && !options.dryRun && isTTY) {
      const skillName = normalizeSkillName(skill);
      const target = options.for ? `from ${options.for} (${options.scope})` : "from .skills/";
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve => {
        rl.question(`Remove ${skillName} ${target}? (y/N) `, resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log("Cancelled.");
        return;
      }
    }

    if (options.for) {
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(options.for);
        debug(`remove: resolved agents=[${agents.join(", ")}]`);
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
        debug(`remove: removing ${skill} from agent=${agent} scope=${options.scope}`);
        const removed = removeSkillForAgent(skill, {
          agent,
          scope: options.scope as "global" | "project",
        });
        debug(`remove: ${skill} from ${agent} → ${removed ? "removed" : "not found"}`);
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

      debug(`remove: deleting .skills/${normalizeSkillName(skill)}`);
      const removed = removeSkill(skill);
      debug(`remove: ${skill} → ${removed ? "removed" : "not found"}`);
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

// Tags command
program
  .command("tags")
  .option("--json", "Output as JSON", false)
  .description("List all unique tags with counts")
  .action((options: { json: boolean }) => {
    const tagCounts = new Map<string, number>();
    for (const skill of SKILLS) {
      for (const tag of skill.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const sorted = Array.from(tagCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));

    if (options.json) {
      console.log(JSON.stringify(sorted, null, 2));
      return;
    }
    console.log(chalk.bold("\nTags:\n"));
    for (const { name, count } of sorted) {
      console.log(`  ${chalk.cyan(name)} (${count})`);
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
  .description(`Update ${pkg.name} to the latest version`)
  .action(async () => {
    console.log(chalk.bold(`\nUpdating ${pkg.name}...\n`));
    const proc = Bun.spawn(["bun", "add", "-g", `${pkg.name}@latest`], {
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
      "remove", "update", "categories", "tags", "mcp", "serve", "init",
      "self-update", "completion", "outdated", "doctor", "auth",
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

// Export command
program
  .command("export")
  .option("--json", "Output as JSON (default behavior)", false)
  .description("Export installed skills to JSON for sharing or backup")
  .action((_options: { json: boolean }) => {
    const skills = getInstalledSkills();
    const payload = {
      version: 1,
      skills,
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
  });

// Import command
program
  .command("import")
  .argument("<file>", "JSON file to import (use - for stdin)")
  .option("--json", "Output results as JSON", false)
  .option("--for <agent>", "Install for agent: claude, codex, gemini, or all")
  .option("--scope <scope>", "Install scope: global or project", "global")
  .option("--dry-run", "Show what would be installed without actually installing", false)
  .description("Import and install skills from a JSON export file")
  .action(async (file: string, options: { json: boolean; for?: string; scope: string; dryRun: boolean }) => {
    // Read input
    let raw: string;
    try {
      if (file === "-") {
        raw = await new Response(process.stdin as unknown as ReadableStream).text();
      } else {
        if (!existsSync(file)) {
          console.error(chalk.red(`File not found: ${file}`));
          process.exitCode = 1;
          return;
        }
        raw = readFileSync(file, "utf-8");
      }
    } catch (err) {
      console.error(chalk.red(`Failed to read file: ${(err as Error).message}`));
      process.exitCode = 1;
      return;
    }

    // Parse and validate
    let payload: { version: number; skills: string[]; timestamp?: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      console.error(chalk.red("Invalid JSON in import file"));
      process.exitCode = 1;
      return;
    }

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.skills)) {
      console.error(chalk.red('Invalid format: expected { "version": 1, "skills": [...] }'));
      process.exitCode = 1;
      return;
    }

    const skillList: string[] = payload.skills;
    const total = skillList.length;

    if (total === 0) {
      if (options.json) {
        console.log(JSON.stringify({ imported: 0, results: [] }));
      } else {
        console.log(chalk.dim("No skills to import"));
      }
      return;
    }

    // Dry-run mode
    if (options.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({ dryRun: true, skills: skillList }));
      } else {
        console.log(chalk.bold(`\n[dry-run] Would install ${total} skill(s):\n`));
        for (let i = 0; i < total; i++) {
          const target = options.for ? ` for ${options.for} (${options.scope})` : " to .skills/";
          console.log(chalk.dim(`  [${i + 1}/${total}] ${skillList[i]}${target}`));
        }
      }
      return;
    }

    const results = [];

    if (options.for) {
      // Agent install mode
      let agents: AgentTarget[];
      try {
        agents = resolveAgents(options.for);
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
        return;
      }

      for (let i = 0; i < total; i++) {
        const name = skillList[i];
        if (!options.json) {
          process.stdout.write(`[${i + 1}/${total}] Installing ${name}...`);
        }
        const agentResults = agents.map((agent) =>
          installSkillForAgent(name, { agent, scope: options.scope as "global" | "project" }, generateSkillMd)
        );
        const success = agentResults.every((r) => r.success);
        results.push({ skill: name, success, agentResults });
        if (!options.json) {
          console.log(success ? " done" : " failed");
        }
      }
    } else {
      // Full source install
      for (let i = 0; i < total; i++) {
        const name = skillList[i];
        if (!options.json) {
          process.stdout.write(`[${i + 1}/${total}] Installing ${name}...`);
        }
        const result = installSkill(name);
        results.push(result);
        if (!options.json) {
          console.log(result.success ? " done" : " failed");
        }
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ imported: results.filter((r) => r.success).length, total, results }));
    } else {
      const succeeded = results.filter((r) => r.success).length;
      const failed = total - succeeded;
      console.log(chalk.bold(`\nImported ${succeeded}/${total} skill(s)${failed > 0 ? ` (${failed} failed)` : ""}`));
    }

    if (results.some((r) => !r.success)) {
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

// Auth command
program
  .command("auth")
  .argument("[skill]", "Skill name (omit to check all installed skills)")
  .option("--set <assignment>", "Set an env var in .env file (format: KEY=VALUE)")
  .option("--json", "Output as JSON", false)
  .description("Show auth/env var status for a skill or all installed skills")
  .action((name: string | undefined, options: { set?: string; json: boolean }) => {
    const cwd = process.cwd();
    const envFilePath = join(cwd, ".env");

    // --set mode: write KEY=VALUE to .env file
    if (options.set) {
      const eqIdx = options.set.indexOf("=");
      if (eqIdx === -1) {
        console.error(chalk.red(`Invalid format for --set. Expected KEY=VALUE, got: ${options.set}`));
        process.exitCode = 1;
        return;
      }
      const key = options.set.slice(0, eqIdx).trim();
      const value = options.set.slice(eqIdx + 1);

      if (!key) {
        console.error(chalk.red("Key cannot be empty"));
        process.exitCode = 1;
        return;
      }

      let existing = "";
      if (existsSync(envFilePath)) {
        existing = readFileSync(envFilePath, "utf-8");
      }

      const keyPattern = new RegExp(`^${key}=.*$`, "m");
      let updated: string;
      if (keyPattern.test(existing)) {
        // Replace existing line
        updated = existing.replace(keyPattern, `${key}=${value}`);
      } else {
        // Append new line
        updated = existing.endsWith("\n") || existing === ""
          ? existing + `${key}=${value}\n`
          : existing + `\n${key}=${value}\n`;
      }

      writeFileSync(envFilePath, updated, "utf-8");
      console.log(chalk.green(`Set ${key} in ${envFilePath}`));
      return;
    }

    // Single skill mode
    if (name) {
      const reqs = getSkillRequirements(name);
      if (!reqs) {
        console.error(`Skill '${name}' not found`);
        process.exitCode = 1;
        return;
      }

      const envVars = reqs.envVars.map((v) => ({ name: v, set: !!process.env[v] }));

      if (options.json) {
        console.log(JSON.stringify({ skill: name, envVars }, null, 2));
        return;
      }

      console.log(chalk.bold(`\nAuth status for ${name}:\n`));
      if (envVars.length === 0) {
        console.log(chalk.dim("  No environment variables required"));
      } else {
        for (const v of envVars) {
          const icon = v.set ? chalk.green("✓") : chalk.red("✗");
          const status = v.set ? chalk.green("set") : chalk.red("missing");
          console.log(`  ${icon} ${v.name} (${status})`);
        }
      }
      return;
    }

    // All installed skills mode
    const installed = getInstalledSkills();

    if (installed.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log("No skills installed");
      }
      return;
    }

    const report: Array<{ skill: string; envVars: Array<{ name: string; set: boolean }> }> = [];
    for (const skillName of installed) {
      const reqs = getSkillRequirements(skillName);
      const envVars = (reqs?.envVars ?? []).map((v) => ({ name: v, set: !!process.env[v] }));
      report.push({ skill: skillName, envVars });
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(chalk.bold(`\nAuth status (${installed.length} installed skills):\n`));
    for (const entry of report) {
      console.log(chalk.bold(`  ${entry.skill}`));
      if (entry.envVars.length === 0) {
        console.log(chalk.dim("    No environment variables required"));
      } else {
        for (const v of entry.envVars) {
          const icon = v.set ? chalk.green("✓") : chalk.red("✗");
          const status = v.set ? chalk.green("set") : chalk.red("missing");
          console.log(`    ${icon} ${v.name} (${status})`);
        }
      }
    }
  });

// Whoami command
program
  .command("whoami")
  .option("--json", "Output as JSON", false)
  .description("Show setup summary: version, installed skills, agent configs, and paths")
  .action((options: { json: boolean }) => {
    const { homedir } = require("os") as typeof import("os");
    const version = pkg.version;
    const cwd = process.cwd();

    // Installed skills in cwd
    const installed = getInstalledSkills();

    // Agent configs: check ~/.claude/skills/, ~/.codex/skills/, ~/.gemini/skills/
    const agentNames = ["claude", "codex", "gemini"] as const;
    const agentConfigs: Array<{ agent: string; path: string; exists: boolean; skillCount: number }> = [];
    for (const agent of agentNames) {
      const agentSkillsPath = join(homedir(), `.${agent}`, "skills");
      const exists = existsSync(agentSkillsPath);
      let skillCount = 0;
      if (exists) {
        try {
          skillCount = readdirSync(agentSkillsPath).filter((f) => {
            const full = join(agentSkillsPath, f);
            return f.startsWith("skill-") && statSync(full).isDirectory();
          }).length;
        } catch {}
      }
      agentConfigs.push({ agent, path: agentSkillsPath, exists, skillCount });
    }

    // Skills directory location (the package's skills/ dir)
    const skillsDir = getSkillPath("image").replace(/[/\\][^/\\]*$/, "");

    if (options.json) {
      console.log(JSON.stringify({
        version,
        installedCount: installed.length,
        installed,
        agents: agentConfigs,
        skillsDir,
        cwd,
      }, null, 2));
      return;
    }

    console.log(chalk.bold(`\nskills v${version}\n`));
    console.log(`${chalk.dim("Working directory:")} ${cwd}`);
    console.log(`${chalk.dim("Skills directory:")}  ${skillsDir}`);
    console.log();

    if (installed.length === 0) {
      console.log(chalk.dim("No skills installed in current project"));
    } else {
      console.log(chalk.bold(`Installed skills (${installed.length}):`));
      for (const name of installed) {
        console.log(`  ${chalk.cyan(name)}`);
      }
    }
    console.log();

    console.log(chalk.bold("Agent configurations:"));
    for (const cfg of agentConfigs) {
      if (cfg.exists) {
        console.log(`  ${chalk.green("\u2713")} ${cfg.agent} \u2014 ${cfg.skillCount} skill(s) at ${cfg.path}`);
      } else {
        console.log(`  ${chalk.dim("\u2717")} ${cfg.agent} \u2014 not configured`);
      }
    }
  });

// Test command
program
  .command("test")
  .argument("[skill]", "Skill name to test (omit to test all installed skills)")
  .option("--json", "Output results as JSON", false)
  .description("Test skill readiness: env vars, system deps, and npm deps")
  .action(async (skillArg: string | undefined, options: { json: boolean }) => {
    // Determine which skills to test
    let skillNames: string[];
    if (skillArg) {
      const registryName = skillArg.startsWith("skill-") ? skillArg.replace("skill-", "") : skillArg;
      const skill = getSkill(registryName);
      if (!skill) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Skill '${skillArg}' not found` }));
        } else {
          console.error(chalk.red(`Skill '${skillArg}' not found`));
        }
        process.exitCode = 1;
        return;
      }
      skillNames = [registryName];
    } else {
      skillNames = getInstalledSkills();
      if (skillNames.length === 0) {
        if (options.json) {
          console.log(JSON.stringify([]));
        } else {
          console.log(chalk.dim("No skills installed. Run: skills install <name>"));
        }
        return;
      }
    }

    // Run tests for each skill
    const results: Array<{
      skill: string;
      envVars: Array<{ name: string; set: boolean }>;
      systemDeps: Array<{ name: string; available: boolean }>;
      npmDeps: Array<{ name: string; version: string }>;
      ready: boolean;
    }> = [];

    for (const name of skillNames) {
      const reqs = getSkillRequirements(name);

      // Check env vars
      const envVars = (reqs?.envVars ?? []).map((v) => ({
        name: v,
        set: !!process.env[v],
      }));

      // Check system deps via `which`
      const systemDeps = (reqs?.systemDeps ?? []).map((dep) => {
        const proc = Bun.spawnSync(["which", dep]);
        return { name: dep, available: proc.exitCode === 0 };
      });

      // npm deps from package.json
      const npmDeps = Object.entries(reqs?.dependencies ?? {}).map(([pkgName, version]) => ({
        name: pkgName,
        version: version as string,
      }));

      const ready =
        envVars.every((v) => v.set) &&
        systemDeps.every((d) => d.available);

      results.push({ skill: name, envVars, systemDeps, npmDeps, ready });
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    const allReady = results.every((r) => r.ready);
    console.log(chalk.bold(`\nSkills Test (${results.length} skill${results.length === 1 ? "" : "s"}):\n`));

    for (const result of results) {
      const readyLabel = result.ready ? chalk.green("ready") : chalk.red("not ready");
      console.log(chalk.bold(`  ${result.skill}`) + chalk.dim(` [${readyLabel}]`));

      if (result.envVars.length === 0 && result.systemDeps.length === 0) {
        console.log(chalk.dim("    No requirements"));
      }

      for (const v of result.envVars) {
        if (v.set) {
          console.log(`    ${chalk.green("\u2713")} ${v.name}`);
        } else {
          console.log(`    ${chalk.red("\u2717")} ${v.name} ${chalk.dim("(missing)")}`);
        }
      }

      for (const dep of result.systemDeps) {
        if (dep.available) {
          console.log(`    ${chalk.green("\u2713")} ${dep.name} ${chalk.dim("(system)")}`);
        } else {
          console.log(`    ${chalk.red("\u2717")} ${dep.name} ${chalk.dim("(not installed)")}`);
        }
      }

      if (result.npmDeps.length > 0) {
        console.log(chalk.dim(`    npm: ${result.npmDeps.map((d) => d.name).join(", ")}`));
      }
    }

    console.log();
    if (allReady) {
      console.log(chalk.green(`All ${results.length} skill(s) ready`));
    } else {
      const notReady = results.filter((r) => !r.ready).length;
      console.log(chalk.yellow(`${notReady} skill(s) not ready`));
    }

    if (!allReady) {
      process.exitCode = 1;
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

// Config command
const configCmd = program
  .command("config")
  .description("Manage skills configuration");

configCmd
  .command("show", { isDefault: true })
  .description("Show current merged configuration")
  .action(() => {
    const config = loadConfig();
    const keys = Object.keys(config);
    if (keys.length === 0) {
      console.log(chalk.dim("No configuration set"));
      return;
    }
    for (const [key, value] of Object.entries(config)) {
      console.log(`${chalk.cyan(key)} = ${chalk.bold(value as string)}`);
    }
  });

configCmd
  .command("set <key> <value>")
  .option("--global", "Save to global config (~/.skillsrc)", false)
  .description("Set a configuration value")
  .action((key: string, value: string, options) => {
    const scope = options.global ? "global" : "project";
    try {
      saveConfig(key, value, scope);
      console.log(chalk.green(`Set ${key} = ${value} (${scope})`));
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exitCode = 1;
    }
  });

configCmd
  .command("get <key>")
  .description("Get a specific configuration value")
  .action((key: string) => {
    const config = loadConfig();
    const value = (config as any)[key];
    if (value === undefined) {
      console.log(chalk.dim(`${key} is not set`));
    } else {
      console.log(value);
    }
  });

configCmd
  .command("path")
  .description("Show configuration file paths")
  .action(() => {
    const globalPath = getConfigPath("global");
    const projectPath = getConfigPath("project");
    console.log(`${chalk.cyan("global")}:  ${globalPath}${existsSync(globalPath) ? chalk.green(" (exists)") : chalk.dim(" (not found)")}`);
    console.log(`${chalk.cyan("project")}: ${projectPath}${existsSync(projectPath) ? chalk.green(" (exists)") : chalk.dim(" (not found)")}`);
  });

program.parse();
