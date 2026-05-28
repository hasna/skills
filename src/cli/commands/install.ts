/**
 * pin / unpin / update — project skill preference commands
 */

import chalk from "chalk";
import type { Command } from "commander";
import { CATEGORIES, getSkillsByCategory } from "../../lib/registry.js";
import {
  installSkill,
  getInstalledSkills,
  removeSkill,
  type InstallResult,
} from "../../lib/installer.js";

export function registerInstall(parent: Command) {
  parent
    .command("install")
    .argument("[args...]", "Deprecated. Use 'skills pin <name>' for project skill pins.")
    .option("--json", "Output result as JSON", false)
    .description("Install the Skills CLI/MCP integration. Use 'skills setup agents' for agent setup.")
    .action((args: string[], options: { json: boolean }) => handleDeprecatedInstall(args, options));

  parent
    .command("pin")
    .argument("[skills...]", "Skills to pin")
    .option("-o, --overwrite", "Refresh existing pins", false)
    .option("--json", "Output results as JSON", false)
    .option("--dry-run", "Print what would happen without actually pinning", false)
    .option("--category <category>", "Pin all skills in a category (case-insensitive)")
    .description("Pin skills in .skills/project.json without copying source")
    .action((skills: string[], options) => handlePin(skills, options));

  parent
    .command("unpin")
    .argument("<skill>", "Skill to unpin")
    .option("--json", "Output as JSON", false)
    .option("--dry-run", "Print what would happen without actually unpinning", false)
    .description("Remove a skill from project pins")
    .action((skill: string, options) => handleUnpin(skill, options));

  const pins = parent
    .command("pins")
    .description("Manage project skill pins");

  pins
    .command("list")
    .option("--json", "Output as JSON", false)
    .description("List project-pinned skills")
    .action((options: { json: boolean }) => handlePinsList(options));

  parent
    .command("remove")
    .argument("[skill]", "Deprecated. Use 'skills unpin <name>' for project skill pins.")
    .option("--json", "Output as JSON", false)
    .description("Deprecated. Use 'skills unpin <name>'.")
    .action((skill: string | undefined, options: { json: boolean }) => handleDeprecatedRemove(skill, options));

  parent
    .command("update")
    .argument("[skills...]", "Pins to refresh (default: all pinned)")
    .option("--json", "Output results as JSON", false)
    .description("Refresh project skill pins")
    .action((skills: string[], options) => handleUpdate(skills, options));
}

function handleDeprecatedInstall(args: string[], options: { json: boolean }) {
  const error = args.length > 0
    ? "skills install no longer pins or copies skills. Use: skills pin <name>"
    : "Use: skills setup agents  (or: skills mcp --register all)";
  if (options.json) console.log(JSON.stringify({ success: false, error }));
  else console.error(chalk.red(error));
  process.exitCode = 1;
}

function handleDeprecatedRemove(skill: string | undefined, options: { json: boolean }) {
  const error = skill
    ? "skills remove no longer unpins skills. Use: skills unpin <name>"
    : "Use: skills unpin <name>";
  if (options.json) console.log(JSON.stringify({ removed: false, error }));
  else console.error(chalk.red(error));
  process.exitCode = 1;
}

function handlePin(skills: string[], options: any) {
  if (skills.length === 0 && !options.category) {
    const error = "missing required argument 'skills' or --category option";
    if (options.json) console.log(JSON.stringify({ error }));
    else console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }

  if (options.category) {
    const matchedCategory = CATEGORIES.find((c: string) => c.toLowerCase() === options.category.toLowerCase());
    if (!matchedCategory) {
      const error = `Unknown category: ${options.category}`;
      if (options.json) console.log(JSON.stringify({ error, available: CATEGORIES }));
      else {
        console.error(error);
        console.error(`Available: ${CATEGORIES.join(", ")}`);
      }
      process.exitCode = 1;
      return;
    }
    const categorySkills = getSkillsByCategory(matchedCategory);
    skills = categorySkills.map((s: { name: string }) => s.name);
    if (!options.json) console.log(chalk.bold(`\nPinning ${skills.length} skills from "${matchedCategory}"...\n`));
  }

  if (options.dryRun) {
    const actions = skills.map((name) => ({ skill: name, target: ".skills/project.json", action: "pin" as const }));
    if (options.json) console.log(JSON.stringify({ dryRun: true, actions }, null, 2));
    else for (const action of actions) console.log(chalk.dim(`[dry-run] Would pin ${action.skill} in ${action.target}`));
    return;
  }

  const results: InstallResult[] = [];
  const total = skills.length;
  const startTime = Date.now();
  for (let i = 0; i < total; i++) {
    if (total > 1 && !options.json) process.stdout.write(`[${i + 1}/${total}] Pinning ${skills[i]}...`);
    const result = installSkill(skills[i], { overwrite: options.overwrite });
    results.push(result);
    if (total > 1 && !options.json) console.log(result.success ? " done" : ` ${chalk.red("failed")}`);
  }

  if (total > 1 && !options.json) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      console.log(chalk.yellow(`\n${succeeded}/${total} pinned in ${elapsed}s, ${failed.length} failed: ${failed.map((r) => r.skill).join(", ")}`));
      process.exitCode = 1;
    } else console.log(chalk.green(`\n${succeeded}/${total} pinned in ${elapsed}s`));
  }

  if (options.json) console.log(JSON.stringify(results, null, 2));
  else if (total <= 1) {
    console.log(chalk.bold("\nPinning skills...\n"));
    for (const r of results) console.log(r.success ? chalk.green(`✓ ${r.skill}`) : chalk.red(`✗ ${r.skill}: ${r.error}`));
    console.log(chalk.dim("\nPins saved to .skills/project.json; no skill source was copied"));
  }
  if (results.some((r) => !r.success)) process.exitCode = 1;
}

function handleUnpin(skill: string, options: { json: boolean; dryRun?: boolean }) {
  if (options.dryRun) {
    if (options.json) console.log(JSON.stringify({ dryRun: true, actions: [{ skill, target: ".skills/project.json", action: "unpin" }] }, null, 2));
    else console.log(chalk.dim(`[dry-run] Would unpin ${skill} from .skills/project.json`));
    return;
  }

  const removed = removeSkill(skill);
  if (options.json) console.log(JSON.stringify({ skill, removed }));
  else if (removed) console.log(chalk.green(`✓ Unpinned ${skill}`));
  else {
    console.log(chalk.red(`✗ ${skill} is not pinned`));
    process.exitCode = 1;
  }
}

function handleUpdate(skills: string[], options: { json: boolean }) {
  const toUpdate = skills.length > 0 ? skills : getInstalledSkills();
  if (toUpdate.length === 0) {
    console.log(options.json ? JSON.stringify([]) : chalk.dim("No pinned skills. Run: skills pin <name>"));
    return;
  }

  const results: InstallResult[] = [];
  for (const name of toUpdate) {
    const result = installSkill(name, { overwrite: true });
    results.push(result);
  }

  if (options.json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(chalk.bold("\nRefreshing skill pins...\n"));
    for (const r of results) {
      if (r.success) console.log(chalk.green(`✓ ${r.skill}`));
      else console.log(chalk.red(`✗ ${r.skill}: ${r.error}`));
    }
    console.log(chalk.dim("\nPins refreshed in .skills/project.json; no skill source was copied"));
  }
  if (results.some((r) => !r.success)) process.exitCode = 1;
}

function handlePinsList(options: { json: boolean }) {
  const pins = getInstalledSkills();
  if (options.json) {
    console.log(JSON.stringify(pins, null, 2));
    return;
  }
  if (!pins.length) {
    console.log(chalk.dim("No pinned skills"));
    return;
  }
  console.log(chalk.bold(`\nPinned skills (${pins.length}):\n`));
  for (const name of pins) console.log(`  ${chalk.cyan(name)}`);
}
