/**
 * config / create / sync — configuration and scaffolding commands
 */

import chalk from "chalk";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { loadConfig, saveConfig, unsetConfig, getConfigPath } from "../../lib/config.js";
import { getPortableSkillsRoot } from "../../lib/portable-skills.js";
import { clearRegistryCache } from "../../lib/registry.js";
import {
  resolveSyncAgents,
  SYNC_AGENTS,
  syncSkillsToAgents,
  type AgentSyncAction,
} from "../../lib/agent-sync.js";

export function registerCreateSync(parent: Command) {
  // Config
  const configCmd = parent
    .command("config")
    .description("Manage skills configuration");

  configCmd
    .command("show", { isDefault: true })
    .option("--json", "Output as JSON", false)
    .description("Show current merged configuration")
    .action((options: { json: boolean }) => {
      const config = loadConfig();
      const keys = Object.keys(config);
      if (options.json) { console.log(JSON.stringify(config, null, 2)); return; }
      if (!keys.length) { console.log(chalk.dim("No configuration set")); return; }
      for (const [key, value] of Object.entries(config)) console.log(`${chalk.cyan(key)} = ${chalk.bold(value as string)}`);
    });

  configCmd
    .command("set <key> <value>")
    .option("--global", "Save to global config (~/.skillsrc)", false)
    .option("--json", "Output as JSON", false)
    .description("Set a configuration value")
    .action((key: string, value: string, options) => {
      const scope = options.global ? "global" : "project";
      try {
        saveConfig(key, value, scope);
        const savedValue = (loadConfig() as Record<string, string | undefined>)[key];
        if (options.json) console.log(JSON.stringify({ key, value: savedValue, scope, path: getConfigPath(scope) }));
        else console.log(chalk.green(`Set ${key} = ${savedValue ?? value} (${scope})`));
      }
      catch (err) {
        if (options.json) console.log(JSON.stringify({ key, value, scope, error: (err as Error).message }));
        else console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
      }
    });

  configCmd
    .command("unset <key>")
    .option("--global", "Remove from the global config instead of the project config", false)
    .option("--json", "Output as JSON", false)
    .description("Remove a configuration value")
    .action((key: string, options: { global: boolean; json: boolean }) => {
      const scope = options.global ? "global" : "project";
      try {
        const removed = unsetConfig(key, scope);
        if (options.json) console.log(JSON.stringify({ key, removed, scope, path: getConfigPath(scope) }));
        else if (removed) console.log(chalk.green(`Unset ${key} (${scope})`));
        else console.log(chalk.dim(`${key} was not set (${scope})`));
      }
      catch (err) {
        if (options.json) console.log(JSON.stringify({ key, scope, error: (err as Error).message }));
        else console.error(chalk.red((err as Error).message));
        process.exitCode = 1;
      }
    });

  configCmd
    .command("get <key>")
    .option("--json", "Output as JSON", false)
    .description("Get a specific configuration value")
    .action((key: string, options: { json: boolean }) => {
      const config = loadConfig();
      const value = (config as any)[key];
      if (options.json) { console.log(JSON.stringify({ key, value: value ?? null, set: value !== undefined })); return; }
      console.log(value === undefined ? chalk.dim(`${key} is not set`) : value);
    });

  configCmd
    .command("path")
    .option("--json", "Output as JSON", false)
    .description("Show configuration file paths")
    .action((options: { json: boolean }) => {
      const gp = getConfigPath("global");
      const pp = getConfigPath("project");
      if (options.json) {
        console.log(JSON.stringify({
          global: { path: gp, exists: existsSync(gp) },
          project: { path: pp, exists: existsSync(pp) },
        }, null, 2));
        return;
      }
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
    .option("--global", "Deprecated; custom skills are always global", false)
    .option("--json", "Output result as JSON", false)
    .description("Scaffold a new custom skill directory")
    .action((name: string, options: any) => handleCreate(name, options));

  // Sync — the last mile: corpus -> each agent's global skills folder.
  parent
    .command("sync")
    .argument("[names...]", "Skills to sync (default: every skill in this machine's corpus)")
    .option("--for <agent>", `Target one agent (${SYNC_AGENTS.join(", ")}, or all)`, "all")
    .option("--all", "Sync every corpus skill (the default)", false)
    .option("--dry-run", "Show what would be written without touching any agent folder", false)
    .option("--force", "Overwrite even a hand-authored (unmanaged) agent skill", false)
    .option("--json", "Output as JSON", false)
    .description("Write corpus skills into each coding agent's global skills folder, per-tool adapted")
    .action((names: string[], options) => handleSync(names, options));
}

function handleCreate(name: string, options: { category: string; description?: string; tags?: string; global: boolean; json: boolean }) {
  const bare = name.trim();
  const dirName = bare;
  // The corpus, not the legacy custom/ folder, and resolved rather than rebuilt
  // from homedir() so this honours $HASNA_SKILLS_DIR like every other write path.
  const baseDir = getPortableSkillsRoot();
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
  writeFileSync(join(skillDir, "package.json"), JSON.stringify({ name: bare, version: "0.1.0", description, bin: { [bare]: "./src/index.ts" }, scripts: { dev: `bun src/index.ts` }, dependencies: {} }, null, 2) + "\n");
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

function handleSync(
  names: string[],
  options: { for: string; all: boolean; dryRun: boolean; force: boolean; json: boolean },
) {
  let agents;
  try {
    agents = resolveSyncAgents(options.for);
  } catch (error) {
    if (options.json) console.log(JSON.stringify({ error: (error as Error).message }));
    else console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
    return;
  }

  const { actions } = syncSkillsToAgents({
    ...(names.length ? { names } : {}),
    all: options.all,
    agents,
    dryRun: options.dryRun,
    force: options.force,
  });

  if (options.json) {
    console.log(JSON.stringify({ dryRun: options.dryRun, actions }, null, 2));
  } else {
    printSyncHuman(actions, options.dryRun);
  }
  // A skip because a NAMED skill is missing from the corpus is a failure; a skip because a
  // folder is hand-authored is a deliberate, successful no-op and must not fail the run.
  if (actions.some((action) => action.action === "skip" && action.reason?.includes("not found"))) {
    process.exitCode = 1;
  }
}

function printSyncHuman(actions: AgentSyncAction[], dryRun?: boolean): void {
  if (!actions.length) {
    console.log(chalk.dim("No skills in this machine's corpus to sync. Pull some first: skills pull --all"));
    return;
  }
  const prefix = dryRun ? chalk.dim("[dry-run] ") : "";
  console.log(chalk.bold(`\n${dryRun ? "Would sync" : "Syncing"} skills into agent folders...\n`));
  for (const action of actions) {
    const label = `${action.skill} → ${action.agent}`;
    if (action.action === "skip") {
      console.log(`${prefix}${chalk.yellow(`• skip ${label}`)}${action.reason ? chalk.dim(`  (${action.reason})`) : ""}`);
    } else {
      const verb = action.action === "create" ? "add" : "update";
      console.log(`${prefix}${chalk.green(`✓ ${verb} ${label}`)}${chalk.dim(`  → ${action.path}`)}`);
    }
  }
  const written = actions.filter((a) => a.action !== "skip").length;
  console.log(chalk.dim(`\n${written}/${actions.length} ${dryRun ? "would be written" : "written"}`));
}
