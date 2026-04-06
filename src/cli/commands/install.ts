/**
 * install / remove / update — skill lifecycle commands
 */

import chalk from "chalk";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Command } from "commander";
import { normalizeSkillName } from "../../lib/utils.js";
import { CATEGORIES, getSkillsByCategory } from "../../lib/registry.js";
import {
  installSkill,
  installSkillForAgent,
  removeSkillForAgent,
  getInstalledSkills,
  removeSkill,
  resolveAgents,
  type AgentTarget,
  type InstallResult,
} from "../../lib/installer.js";
import { generateSkillMd } from "../../lib/skillinfo.js";

export function registerInstall(parent: Command) {
  // Install
  parent
    .command("install")
    .alias("add")
    .argument("[skills...]", "Skills to install")
    .option("-o, --overwrite", "Overwrite existing skills", false)
    .option("--json", "Output results as JSON", false)
    .option("--for <agent>", "Install for agent: claude, codex, gemini, pi, opencode, or all")
    .option("--scope <scope>", "Install scope: global or project", "global")
    .option("--dry-run", "Print what would happen without actually installing", false)
    .option("--category <category>", "Install all skills in a category (case-insensitive)")
    .description("Install one or more skills")
    .action((skills: string[], options) => handleInstall(skills, options));

  // Remove
  parent
    .command("remove")
    .alias("rm")
    .argument("<skill>", "Skill to remove")
    .option("--json", "Output as JSON", false)
    .option("--for <agent>", "Remove from agent: claude, codex, gemini, pi, opencode, or all")
    .option("--scope <scope>", "Remove scope: global or project", "global")
    .option("--dry-run", "Print what would happen without actually removing", false)
    .option("-y, --yes", "Skip confirmation prompt", false)
    .description("Remove an installed skill")
    .action(async (skill: string, options) => handleRemove(skill, options));

  // Update
  parent
    .command("update")
    .argument("[skills...]", "Skills to update (default: all installed)")
    .option("--json", "Output results as JSON", false)
    .description("Update installed skills (reinstall with --overwrite)")
    .action((skills: string[], options) => handleUpdate(skills, options));
}

async function handleInstall(skills: string[], options: any) {
  const { loadConfig } = await import("../../lib/config.js");
  const config = loadConfig();
  if (!options.for && config.defaultAgent) options.for = config.defaultAgent;
  if (!process.argv.includes("--scope") && config.defaultScope) options.scope = config.defaultScope;

  if (skills.length === 0 && !options.category) {
    console.error("error: missing required argument 'skills' or --category option");
    process.exitCode = 1;
    return;
  }

  if (options.category) {
    const matchedCategory = CATEGORIES.find((c: string) => c.toLowerCase() === options.category.toLowerCase());
    if (!matchedCategory) {
      console.error(`Unknown category: ${options.category}`);
      console.error(`Available: ${CATEGORIES.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    const categorySkills = getSkillsByCategory(matchedCategory);
    skills = categorySkills.map((s: { name: string }) => s.name);
    if (!options.json) console.log(chalk.bold(`\nInstalling ${skills.length} skills from "${matchedCategory}"...\n`));
  }

  const agentResults: Array<{ skill: string; success: boolean; agent: string; scope: string; error?: string }> = [];

  if (options.for) {
    let agents: AgentTarget[];
    try { agents = resolveAgents(options.for); }
    catch (err) { console.error(chalk.red((err as Error).message)); process.exitCode = 1; return; }

    if (options.dryRun) {
      for (const name of skills) for (const agent of agents) console.log(chalk.dim(`[dry-run] Would install ${name} for ${agent} (${options.scope})`));
      return;
    }

    for (const name of skills) for (const agent of agents) {
      const result = installSkillForAgent(name, { agent, scope: options.scope as "global" | "project" }, generateSkillMd);
      agentResults.push({ skill: name, success: result.success, agent, scope: options.scope, error: result.error });
    }

    if (options.json) console.log(JSON.stringify(agentResults, null, 2));
    else {
      console.log(chalk.bold("\nInstalling skills for agent(s)...\n"));
      for (const r of agentResults) console.log(r.success ? chalk.green(`\u2713 ${r.skill} → ${r.agent} (${r.scope})`) : chalk.red(`\u2717 ${r.skill} → ${r.agent} (${r.scope}): ${r.error}`));
      console.log(chalk.dim("\nSKILL.md copied to agent skill directories"));
    }
    if (agentResults.some((r) => !r.success)) process.exitCode = 1;
  } else {
    const sourceResults: InstallResult[] = [];
    if (options.dryRun) { for (const name of skills) console.log(chalk.dim(`[dry-run] Would install ${name} to .skills/`)); return; }

    const total = skills.length;
    const startTime = Date.now();
    for (let i = 0; i < total; i++) {
      if (total > 1 && !options.json) process.stdout.write(`[${i + 1}/${total}] Installing ${skills[i]}...`);
      const result = installSkill(skills[i], { overwrite: options.overwrite });
      sourceResults.push(result);
      if (total > 1 && !options.json) console.log(result.success ? " done" : ` ${chalk.red("failed")}`);
    }
    if (total > 1 && !options.json) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const succeeded = sourceResults.filter(r => r.success).length;
      const failed = sourceResults.filter(r => !r.success);
      if (failed.length > 0) { console.log(chalk.yellow(`\n${succeeded}/${total} installed in ${elapsed}s, ${failed.length} failed: ${failed.map(r => r.skill).join(", ")}`)); process.exitCode = 1; }
      else console.log(chalk.green(`\n${succeeded}/${total} installed in ${elapsed}s`));
    }

    if (options.json) console.log(JSON.stringify(sourceResults, null, 2));
    else if (total <= 1) {
      console.log(chalk.bold("\nInstalling skills...\n"));
      for (const r of sourceResults) console.log(r.success ? chalk.green(`\u2713 ${r.skill}`) : chalk.red(`\u2717 ${r.skill}: ${r.error}`));
      console.log(chalk.dim("\nSkills installed to .skills/"));
    }
    if (sourceResults.some((r) => !r.success)) process.exitCode = 1;
  }
}

async function handleRemove(skill: string, options: any) {
  const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);
  if (!options.yes && !options.dryRun && isTTY) {
    const skillName = normalizeSkillName(skill);
    const target = options.for ? `from ${options.for} (${options.scope})` : "from .skills/";
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>(resolve => rl.question(`Remove ${skillName} ${target}? (y/N) `, resolve));
    rl.close();
    if (answer.toLowerCase() !== "y") { console.log("Cancelled."); return; }
  }

  if (options.for) {
    let agents: AgentTarget[];
    try { agents = resolveAgents(options.for); }
    catch (err) { console.error(chalk.red((err as Error).message)); process.exitCode = 1; return; }

    if (options.dryRun) { for (const agent of agents) console.log(chalk.dim(`[dry-run] Would remove ${skill} from ${agent} (${options.scope})`)); return; }

    const results = agents.map(agent => ({
      skill, agent, scope: options.scope,
      removed: removeSkillForAgent(skill, { agent, scope: options.scope as "global" | "project" }),
    }));
    if (options.json) console.log(JSON.stringify(results, null, 2));
    else for (const r of results) console.log(r.removed ? chalk.green(`\u2713 Removed ${r.skill} from ${r.agent} (${r.scope})`) : chalk.red(`\u2717 ${r.skill} from ${r.agent} (${r.scope}) not found`));
    if (results.every((r) => !r.removed)) process.exitCode = 1;
  } else {
    if (options.dryRun) { console.log(chalk.dim(`[dry-run] Would remove ${skill} from .skills/`)); return; }
    const removed = removeSkill(skill);
    if (options.json) console.log(JSON.stringify({ skill, removed }));
    else if (removed) console.log(chalk.green(`\u2713 Removed ${skill}`));
    else { console.log(chalk.red(`\u2717 ${skill} is not installed`)); process.exitCode = 1; }
  }
}

function handleUpdate(skills: string[], options: { json: boolean }) {
  const toUpdate = skills.length > 0 ? skills : getInstalledSkills();
  if (toUpdate.length === 0) { console.log(chalk.dim("No skills installed. Run: skills install <name>")); return; }

  function collectFiles(dir: string, base = ""): Set<string> {
    const files = new Set<string>();
    if (!existsSync(dir)) return files;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      if (statSync(full).isDirectory()) for (const f of collectFiles(full, rel)) files.add(f);
      else files.add(rel);
    }
    return files;
  }

  const results: Array<{ skill: string; success: boolean; error?: string; newFiles: string[]; removedFiles: string[]; unchangedCount: number }> = [];
  for (const name of toUpdate) {
    const skillName = normalizeSkillName(name);
    const destPath = join(process.cwd(), ".skills", skillName);
    const beforeFiles = collectFiles(destPath);
    const result = installSkill(name, { overwrite: true });
    const afterFiles = collectFiles(destPath);
    results.push({
      skill: result.skill, success: result.success, error: result.error,
      newFiles: [...afterFiles].filter((f) => !beforeFiles.has(f)),
      removedFiles: [...beforeFiles].filter((f) => !afterFiles.has(f)),
      unchangedCount: [...afterFiles].filter((f) => beforeFiles.has(f)).length,
    });
  }

  if (options.json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log(chalk.bold("\nUpdating skills...\n"));
    for (const r of results) {
      if (r.success) {
        console.log(chalk.green(`\u2713 ${r.skill}`));
        if (r.newFiles.length > 0) console.log(chalk.green(`    + ${r.newFiles.length} new: ${r.newFiles.join(", ")}`));
        if (r.removedFiles.length > 0) console.log(chalk.red(`    - ${r.removedFiles.length} removed: ${r.removedFiles.join(", ")}`));
        console.log(chalk.dim(`    ${r.unchangedCount} file(s) updated`));
      } else console.log(chalk.red(`\u2717 ${r.skill}: ${r.error}`));
    }
    console.log(chalk.dim("\nSkills updated in .skills/"));
  }
  if (results.some((r) => !r.success)) process.exitCode = 1;
}
