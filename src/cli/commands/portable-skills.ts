import chalk from "chalk";
import type { Command } from "commander";

import { clearRegistryCache } from "../../lib/registry.js";
import {
  portPortableSkill,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
} from "../../lib/portable-skills.js";

export function registerPortableSkillCommands(parent: Command) {
  parent
    .command("new")
    .alias("scaffold")
    .argument("<name>", "Portable skill name")
    .option("--description <description>", "Short description of what the skill does")
    .option("-o, --overwrite", "Replace an existing portable skill folder", false)
    .option("--json", "Output result as JSON", false)
    .description("Scaffold a portable skill under ~/.hasna/skills/<name>")
    .action((name: string, options: { description?: string; overwrite: boolean; json: boolean }) => {
      try {
        const result = scaffoldPortableSkill(name, {
          description: options.description,
          overwrite: options.overwrite,
        });
        clearRegistryCache();
        if (options.json) {
          console.log(JSON.stringify({ ...result, manifest: result.manifest }, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Created portable skill '${result.name}'`));
        console.log(chalk.dim(`  Path: ${result.path}`));
        console.log(chalk.dim(`  Agent instructions: ${result.path}/AGENTS.md`));
        console.log(chalk.dim(`  Validate: skills validate ${result.name}`));
        console.log(chalk.dim(`  Run: skills run ${result.name} --help`));
      } catch (error) {
        writePortableError(error, options.json);
      }
    });

  parent
    .command("port")
    .alias("add")
    .argument("<path>", "Existing skill folder to import")
    .option("--name <name>", "Override the imported skill name")
    .option("-o, --overwrite", "Replace an existing portable skill folder", false)
    .option("--allow-shadow", "Allow an imported name that shadows a bundled official skill", false)
    .option("--json", "Output result as JSON", false)
    .description("Import an existing skill folder into ~/.hasna/skills/<name>")
    .action((path: string, options: { name?: string; overwrite: boolean; allowShadow: boolean; json: boolean }) => {
      try {
        const result = portPortableSkill(path, {
          name: options.name,
          overwrite: options.overwrite,
          allowShadow: options.allowShadow,
        });
        clearRegistryCache();
        const validation = validatePortableSkillDirectory(result.name, result.path);
        const payload = { ...result, valid: validation.valid, issues: validation.issues, warnings: validation.warnings };
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Ported portable skill '${result.name}'`));
        console.log(chalk.dim(`  Path: ${result.path}`));
        console.log(chalk.dim(`  Valid: ${validation.valid ? "yes" : "no"}`));
        if (!validation.valid) {
          for (const issue of validation.issues) console.log(chalk.red(`  • ${issue.message}`));
          process.exitCode = 1;
        }
      } catch (error) {
        writePortableError(error, options.json);
      }
    });
}

function writePortableError(error: unknown, json: boolean): void {
  const message = (error as Error).message;
  if (json) console.log(JSON.stringify({ error: message }, null, 2));
  else console.error(chalk.red(message));
  process.exitCode = 1;
}
