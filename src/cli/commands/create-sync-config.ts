/**
 * config / create / sync — configuration and scaffolding commands
 */

import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { loadConfig, saveConfig, getConfigPath } from "../../lib/config.js";
import { clearRegistryCache, loadRegistry } from "../../lib/registry.js";
import { installSkillForAgent, resolveAgents, getAgentSkillsDir, type AgentTarget, AGENT_TARGETS } from "../../lib/installer.js";
import { generateSkillMd } from "../../lib/skillinfo.js";

export function registerCreateSync(parent: Command) {
  // Config
  const configCmd = parent
    .command("config")
    .description("Manage skills configuration");

  configCmd
    .command("show", { isDefault: true })
    .description("Show current merged configuration")
    .action(() => {
      const config = loadConfig();
      const keys = Object.keys(config);
      if (!keys.length) { console.log(chalk.dim("No configuration set")); return; }
      for (const [key, value] of Object.entries(config)) console.log(`${chalk.cyan(key)} = ${chalk.bold(value as string)}`);
    });

  configCmd
    .command("set <key> <value>")
    .option("--global", "Save to global config (~/.skillsrc)", false)
    .description("Set a configuration value")
    .action((key: string, value: string, options) => {
      try { saveConfig(key, value, options.global ? "global" : "project"); console.log(chalk.green(`Set ${key} = ${value} (${options.global ? "global" : "project"})`)); }
      catch (err) { console.error(chalk.red((err as Error).message)); process.exitCode = 1; }
    });

  configCmd
    .command("get <key>")
    .description("Get a specific configuration value")
    .action((key: string) => {
      const config = loadConfig();
      const value = (config as any)[key];
      console.log(value === undefined ? chalk.dim(`${key} is not set`) : value);
    });

  configCmd
    .command("path")
    .description("Show configuration file paths")
    .action(() => {
      const gp = getConfigPath("global");
      const pp = getConfigPath("project");
      console.log(`${chalk.cyan("global")}:  ${gp}${existsSync(gp) ? chalk.green(" (exists)") : chalk.dim(" (not found)")}`);
      console.log(`${chalk.cyan("project")}: ${pp}${existsSync(pp) ? chalk.green(" (exists)") : chalk.dim(" (not found)")}`);
    });

  // Create
  parent
    .command("create")
    .argument("<name>", "Skill name (e.g. my-tool)")
    .option("--category <category>", "Skill category", "Development Tools")
    .option("--description <description>", "Short description of what the skill does")
    .option("--tags <tags>", "Comma-separated tags (e.g. api,testing,automation)")
    .option("--global", "Create in ~/.hasna/skills/custom/ instead of .skills/custom-skills/", false)
    .option("--json", "Output result as JSON", false)
    .description("Scaffold a new custom skill directory")
    .action((name: string, options: any) => handleCreate(name, options));

  // Sync
  parent
    .command("sync")
    .option("--to <agent>", "Push custom skills to agent")
    .option("--from <agent>", "List agent skills and show which are unknown")
    .option("--register", "Copy unknown agent skills into ~/.hasna/skills/custom/", false)
    .option("--scope <scope>", "Agent install scope: global or project", "global")
    .option("--json", "Output as JSON", false)
    .description("Sync custom skills with agent directories (--to or --from)")
    .action((options) => handleSync(options));
}

function handleCreate(name: string, options: { category: string; description?: string; tags?: string; global: boolean; json: boolean }) {
  const bare = name.replace(/^skill-/, "");
  const dirName = `skill-${bare}`;
  const baseDir = options.global ? join(homedir(), ".hasna", "skills", "custom") : join(process.cwd(), ".skills", "custom-skills");
  const skillDir = join(baseDir, dirName);

  if (existsSync(skillDir)) {
    console.log(options.json ? JSON.stringify({ error: `Skill '${bare}' already exists at ${skillDir}` }) : chalk.red(`Skill '${bare}' already exists at ${skillDir}`));
    process.exitCode = 1; return;
  }

  const description = options.description || `${bare} skill`;
  const tags = options.tags ? options.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [bare];
  const displayName = bare.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  mkdirSync(join(skillDir, "src"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---", `name: ${bare}`, `description: ${description}`, `displayName: ${displayName}`, `category: ${options.category}`, `tags: [${tags.join(", ")}]`, "",
    `# ${displayName}`, "", description, "", "## Usage", "", "```bash", `${bare} --help`, "```", "",
  ].join("\n"));
  writeFileSync(join(skillDir, "src", "index.ts"), [`#!/usr/bin/env bun`, `/**`, ` * ${displayName} — ${description}`, ` */`, "", `console.log("${displayName}");`, ""].join("\n"));
  writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: `skill-${bare}`, version: "0.1.0", description, bin: { [bare]: "./src/index.ts" }, scripts: { dev: `bun src/index.ts` }, dependencies: {} }, null, 2) + "\n");
  writeFileSync(join(skillDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, outDir: "dist" }, include: ["src/**/*.ts"] }, null, 2) + "\n");

  clearRegistryCache();
  if (options.json) console.log(JSON.stringify({ created: true, name: bare, path: skillDir, category: options.category, tags }));
  else {
    console.log(chalk.green(`✓ Created custom skill '${bare}' at ${skillDir}`));
    console.log(chalk.dim(`  Category: ${options.category}`));
    console.log(chalk.dim(`  Tags: ${tags.join(", ")}`));
    console.log(`  ${chalk.cyan("Edit:")} ${join(skillDir, "src", "index.ts")}`);
    console.log(`  ${chalk.cyan("Run:")}  bun ${join(skillDir, "src", "index.ts")}`);
  }
}

function handleSync(options: { to?: string; from?: string; register: boolean; scope: string; json: boolean }) {
  if (!options.to && !options.from) { console.error(chalk.red("Specify --to <agent> or --from <agent>")); process.exitCode = 1; return; }

  if (options.from) {
    const agentName = options.from as AgentTarget;
    if (!AGENT_TARGETS.includes(agentName)) { console.error(chalk.red(`Unknown agent: ${agentName}. Available: ${AGENT_TARGETS.join(", ")}`)); process.exitCode = 1; return; }
    const agentDir = getAgentSkillsDir(agentName, options.scope as "global" | "project");
    if (!existsSync(agentDir)) {
      console.log(options.json ? JSON.stringify({ agentDir, skills: [], message: "Directory not found" }) : chalk.dim(`No skills directory found at ${agentDir}`));
      return;
    }
    const registry = loadRegistry();
    const registryNames = new Set(registry.map((s) => s.name));
    const found: Array<{ name: string; path: string; inRegistry: boolean }> = [];
    for (const entry of readdirSync(agentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const bare = entry.name.replace(/^skill-/, "");
      found.push({ name: bare, path: join(agentDir, entry.name), inRegistry: registryNames.has(bare) });
    }
    const unknown = found.filter((s) => !s.inRegistry);

    if (options.register && unknown.length > 0) {
      const globalSkillsDir = join(homedir(), ".hasna", "skills", "custom");
      const registered: string[] = [];
      for (const s of unknown) {
        const srcSkillMd = join(s.path, "SKILL.md");
        if (!existsSync(srcSkillMd)) continue;
        const destDir = join(globalSkillsDir, `skill-${s.name}`);
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        writeFileSync(join(destDir, "SKILL.md"), readFileSync(srcSkillMd, "utf-8"));
        registered.push(s.name);
      }
      clearRegistryCache();
      if (options.json) console.log(JSON.stringify({ agentDir, skills: found, registered }));
      else {
        for (const name of registered) console.log(chalk.green(`✓ Registered '${name}' into ~/.hasna/skills/custom/ (global custom)`));
        if (!registered.length) console.log(chalk.dim("No new skills to register (all SKILL.md files missing)"));
      }
      return;
    }

    if (options.json) console.log(JSON.stringify({ agentDir, skills: found }));
    else {
      console.log(chalk.bold(`\nAgent skills in ~/.${agentName}/skills/ (${found.length} found):\n`));
      for (const s of found) console.log(`  ${chalk.cyan(s.name)} — ${s.inRegistry ? chalk.green("✓ in registry") : chalk.yellow("✗ not in registry")}`);
      if (unknown.length > 0) console.log(chalk.dim(`\nTip: ${unknown.length} skill(s) not in registry. Run with --register to add them to ~/.hasna/skills/custom/.`));
    }
    return;
  }

  if (options.to) {
    let agents: AgentTarget[];
    try { agents = resolveAgents(options.to); }
    catch (err) { console.error(chalk.red((err as Error).message)); process.exitCode = 1; return; }
    const registry = loadRegistry();
    const custom = registry.filter((s) => s.source === "custom");
    if (!custom.length) { console.log(options.json ? JSON.stringify({ pushed: 0, message: "No custom skills found" }) : chalk.dim("No custom skills found. Use 'skills create <name>' to scaffold one.")); return; }
    const results = [];
    for (const skill of custom) for (const agent of agents) {
      const r = installSkillForAgent(skill.name, { agent, scope: options.scope as "global" | "project" }, generateSkillMd);
      results.push({ skill: skill.name, agent, success: r.success, error: r.error });
    }
    if (options.json) console.log(JSON.stringify({ pushed: results.filter((r) => r.success).length, results }));
    else for (const r of results) console.log(r.success ? chalk.green(`✓ ${r.skill} → ${r.agent}`) : chalk.red(`✗ ${r.skill} → ${r.agent}: ${r.error}`));
  }
}
