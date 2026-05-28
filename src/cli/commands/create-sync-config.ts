/**
 * config / create / sync — configuration and scaffolding commands
 */

import chalk from "chalk";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { loadConfig, saveConfig, getConfigPath } from "../../lib/config.js";
import { clearRegistryCache } from "../../lib/registry.js";

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

  // Sync
  parent
    .command("sync")
    .option("--to <agent>", "Deprecated; use skills mcp --register <agent|all>")
    .option("--from <agent>", "Deprecated; agent skill-folder sync is disabled")
    .option("--register", "Deprecated; agent skill-folder imports are disabled", false)
    .option("--scope <scope>", "Deprecated; ignored", "global")
    .option("--json", "Output as JSON", false)
    .description("Disabled legacy agent skill-folder sync")
    .action((options) => handleSync(options));
}

function handleCreate(name: string, options: { category: string; description?: string; tags?: string; global: boolean; json: boolean }) {
  const bare = name.trim();
  const dirName = bare;
  const baseDir = join(homedir(), ".hasna", "skills", "custom");
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

function handleSync(options: { to?: string; from?: string; register: boolean; scope: string; json: boolean }) {
  const target = options.to ?? options.from ?? "all";
  const error = "Agent skill-folder sync is disabled. Skills are discovered through the Skills MCP server.";
  const mcpRegister = `skills mcp --register ${target}`;
  if (options.json) console.log(JSON.stringify({ error, mcpRegister }));
  else {
    console.error(chalk.red(error));
    console.error(chalk.dim(`Use: ${mcpRegister}`));
  }
  process.exitCode = 1;
}
