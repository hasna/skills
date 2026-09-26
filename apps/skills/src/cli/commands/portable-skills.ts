import chalk from "chalk";
import type { Command } from "commander";

import { clearRegistryCache } from "../../lib/registry.js";
import { prepareSkill } from "../../lib/prepare-skill.js";
import { writeCliOutput } from "../output.js";
import {
  portPortableSkill,
  portPortableSkillDirectory,
  scaffoldPortableSkill,
  validatePortableSkillDirectory,
  type SkillKind,
} from "../../lib/portable-skills.js";

export function registerPortableSkillCommands(parent: Command) {
  parent
    .command("prepare")
    .argument("<name>", "Name of a skill in the local corpus")
    .requiredOption("--version <version>", "Reviewed semantic version for this draft")
    .option("--kind <kind>", "Explicit instruction or executable kind; required for legacy kind-less manifests")
    .option("--dry-run", "Validate the candidate and report its hash without changing the draft", false)
    .option("--json", "Output result as JSON", false)
    .description("Validate a reviewed draft and update its manifest version and content hash")
    .action(async (name: string, options: { version: string; kind?: string; dryRun: boolean; json: boolean }) => {
      try {
        const result = prepareSkill(name, { ...options, kind: options.kind === undefined ? undefined : parseSkillKind(options.kind) });
        if (result.written) clearRegistryCache();
        if (options.json) await writeCliOutput(JSON.stringify(result, null, 2));
        else {
          console.log(chalk.green(`${result.written ? "Prepared" : options.dryRun ? "Previewed" : "Already prepared"} ${result.name}@${result.version} (${result.kind})`));
          console.log(chalk.dim(`  Content hash: ${result.contentHash}`));
          console.log(chalk.dim(`  Manifest: ${result.path}/skill.json`));
          if (result.written) console.log(chalk.dim(`  Publish: skills push ${result.name}`));
        }
      } catch (error) {
        if (options.json) await writeCliOutput(JSON.stringify({ error: (error as Error).message }, null, 2));
        else console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });

  parent
    .command("new")
    .alias("scaffold")
    .argument("<name>", "Portable skill name")
    .option("--description <description>", "Short description of what the skill does")
    .option("--kind <kind>", "Skill class: executable (default) or instruction (prose only)", "executable")
    .option("-o, --overwrite", "Replace an existing portable skill folder", false)
    .option("--json", "Output result as JSON", false)
    .description("Scaffold a portable skill under ~/.hasna/skills/installed/<name>")
    .action((name: string, options: { description?: string; kind: string; overwrite: boolean; json: boolean }) => {
      try {
        const kind = parseSkillKind(options.kind);
        const result = scaffoldPortableSkill(name, {
          description: options.description,
          overwrite: options.overwrite,
          kind,
        });
        clearRegistryCache();
        if (options.json) {
          console.log(JSON.stringify({ ...result, manifest: result.manifest }, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Created ${kind} skill '${result.name}'`));
        console.log(chalk.dim(`  Path: ${result.path}`));
        if (kind === "instruction") {
          console.log(chalk.dim(`  Edit the prose in: ${result.path}/SKILL.md`));
          console.log(chalk.dim(`  Instruction skills are consumed by agents, not run with 'skills run'.`));
        } else {
          console.log(chalk.dim(`  Agent instructions: ${result.path}/AGENTS.md`));
          console.log(chalk.dim(`  Validate: skills validate ${result.name}`));
          console.log(chalk.dim(`  Run: skills run ${result.name} --help`));
        }
      } catch (error) {
        writePortableError(error, options.json);
      }
    });

  parent
    .command("port")
    .alias("add")
    .argument("<path>", "Existing skill folder (or parent directory with --all) to import")
    .option("--name <name>", "Override the imported skill name")
    .option("--all", "Import every skill subfolder of <path> (bulk import)", false)
    .option("-o, --overwrite", "Replace an existing portable skill folder", false)
    .option("--allow-shadow", "Allow an imported name that shadows a bundled official skill", false)
    .option("--json", "Output result as JSON", false)
    .description("Import an existing skill folder into ~/.hasna/skills/installed/<name>")
    .action((path: string, options: { name?: string; all: boolean; overwrite: boolean; allowShadow: boolean; json: boolean }) => {
      if (options.all) {
        handleBulkPort(path, options);
        return;
      }
      try {
        const result = portPortableSkill(path, {
          name: options.name,
          overwrite: options.overwrite,
          allowShadow: options.allowShadow,
        });
        clearRegistryCache();
        const validation = validatePortableSkillDirectory(result.name, result.path);
        const payload = { ...result, valid: validation.valid, issues: validation.issues, warnings: validation.warnings };
        if (!validation.valid) process.exitCode = 1;
        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(validation.valid
          ? chalk.green(`✓ Ported portable skill '${result.name}'`)
          : chalk.yellow(`Validation failed for imported files '${result.name}'; correct the folder before using it.`));
        console.log(chalk.dim(`  Path: ${result.path}`));
        console.log(chalk.dim(`  Valid: ${validation.valid ? "yes" : "no"}`));
        if (!validation.valid) {
          for (const issue of validation.issues) console.log(chalk.red(`  • ${issue.message}`));
        }
      } catch (error) {
        writePortableError(error, options.json);
      }
    });
}

function handleBulkPort(path: string, options: { name?: string; overwrite: boolean; allowShadow: boolean; json: boolean }): void {
  if (options.name) {
    writePortableError(new Error("--name cannot be used with --all"), options.json);
    return;
  }
  try {
    const summary = portPortableSkillDirectory(path, { overwrite: options.overwrite, allowShadow: options.allowShadow });
    clearRegistryCache();
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failed > 0) process.exitCode = 1;
      return;
    }
    console.log(chalk.green(`✓ Imported ${summary.succeeded}/${summary.total} skill(s) from ${summary.root}`));
    for (const entry of summary.imported) console.log(chalk.dim(`  • ${entry.name} → ${entry.path}`));
    if (summary.skipped.length > 0) {
      console.log(chalk.yellow(`  Skipped ${summary.skipped.length}:`));
      for (const entry of summary.skipped) console.log(chalk.yellow(`  • ${entry.sourcePath}: ${entry.reason}`));
      process.exitCode = 1;
    }
  } catch (error) {
    writePortableError(error, options.json);
  }
}

function parseSkillKind(value: string | undefined): SkillKind {
  if (value === undefined || value === "executable") return "executable";
  if (value === "instruction") return "instruction";
  throw new Error(`Invalid --kind '${value}'. Use 'executable' or 'instruction'.`);
}

function writePortableError(error: unknown, json: boolean): void {
  const message = (error as Error).message;
  if (json) console.log(JSON.stringify({ error: message }, null, 2));
  else console.error(chalk.red(message));
  process.exitCode = 1;
}
