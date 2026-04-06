/**
 * test / doctor / auth / whoami / outdated — diagnostic commands
 */

import chalk from "chalk";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { Command } from "commander";
import { execSync } from "child_process";
import pkg from "../../../package.json" with { type: "json" };
import { getSkill } from "../../lib/registry.js";
import { getSkillRequirements } from "../../lib/skillinfo.js";
import { getInstalledSkills, getSkillPath, getAgentSkillsDir, AGENT_TARGETS, AGENT_LABELS } from "../../lib/installer.js";
import { normalizeSkillName } from "../../lib/utils.js";

export function registerDiagnostic(parent: Command) {
  // Doctor
  parent
    .command("doctor")
    .option("--json", "Output as JSON", false)
    .description("Check env vars, system deps, and install health for installed skills")
    .action((options: { json: boolean }) => handleDoctor(options));

  // Test
  parent
    .command("test")
    .argument("[skill]", "Skill name to test (omit to test all installed)")
    .option("--json", "Output results as JSON", false)
    .description("Test skill readiness: env vars, system deps, and npm deps")
    .action(async (skillArg: string | undefined, options) => handleTest(skillArg, options));

  // Auth
  parent
    .command("auth")
    .argument("[skill]", "Skill name (omit to check all installed skills)")
    .option("--set <assignment>", "Set an env var in .env file (format: KEY=VALUE)")
    .option("--json", "Output as JSON", false)
    .description("Show auth/env var status for a skill or all installed skills")
    .action((name: string | undefined, options) => handleAuth(name, options));

  // Whoami
  parent
    .command("whoami")
    .option("--json", "Output as JSON", false)
    .description("Show setup summary: version, installed skills, agent configs, and paths")
    .action((options: { json: boolean }) => handleWhoami(options));

  // Outdated
  parent
    .command("outdated")
    .option("--json", "Output as JSON", false)
    .description("Check for outdated installed skills")
    .action((options: { json: boolean }) => handleOutdated(options));
}

function handleDoctor(options: { json: boolean }) {
  const installed = getInstalledSkills();
  if (!installed.length) { console.log(options.json ? JSON.stringify({ skills: [], message: "No skills installed" }) : "No skills installed"); return; }

  function cmdAvailable(cmd: string): boolean { try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } }

  const report = [];
  for (const name of installed) {
    const reqs = getSkillRequirements(name);
    const envVars = (reqs?.envVars ?? []).map((v) => ({ name: v, set: !!process.env[v] }));
    const systemDeps = (reqs?.systemDeps ?? []).map((d) => ({ name: d, available: cmdAvailable(d) }));
    report.push({ skill: name, envVars, systemDeps, healthy: envVars.every((v) => v.set) && systemDeps.every((d) => d.available) });
  }

  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
  const issues = report.filter((r) => !r.healthy);
  console.log(chalk.bold(`\nSkills Doctor — ${installed.length} installed, ${issues.length} with issues:\n`));
  for (const entry of report) {
    console.log(`  ${entry.healthy ? chalk.green("✓") : chalk.red("✗")} ${chalk.bold(entry.skill)}`);
    for (const v of entry.envVars) console.log(`      ${v.name} [${v.set ? chalk.green("set") : chalk.red("missing")}]`);
    for (const d of entry.systemDeps) console.log(`      ${d.name} [${d.available ? chalk.green("available") : chalk.red("not found")}]`);
    if (!entry.envVars.length && !entry.systemDeps.length) console.log(chalk.dim("      No requirements"));
  }
  if (!issues.length) console.log(chalk.green("\n  All skills healthy! ✓"));
}

async function handleTest(skillArg: string | undefined, options: { json: boolean }) {
  let skillNames: string[];
  if (skillArg) {
    const registryName = skillArg.startsWith("skill-") ? skillArg.replace("skill-", "") : skillArg;
    if (!getSkill(registryName)) {
      if (options.json) { console.log(JSON.stringify({ error: `Skill '${skillArg}' not found` })); }
      else console.error(chalk.red(`Skill '${skillArg}' not found`));
      process.exitCode = 1; return;
    }
    skillNames = [registryName];
  } else {
    skillNames = getInstalledSkills();
    if (!skillNames.length) { console.log(options.json ? JSON.stringify([]) : chalk.dim("No skills installed. Run: skills install <name>")); return; }
  }

  const results = [];
  for (const name of skillNames) {
    const reqs = getSkillRequirements(name);
    const envVars = (reqs?.envVars ?? []).map((v) => ({ name: v, set: !!process.env[v] }));
    const systemDeps = (reqs?.systemDeps ?? []).map((dep) => {
      const proc = Bun.spawnSync(["which", dep]);
      return { name: dep, available: proc.exitCode === 0 };
    });
    const npmDeps = Object.entries(reqs?.dependencies ?? {}).map(([pkgName, version]) => ({ name: pkgName, version: version as string }));
    results.push({ skill: name, envVars, systemDeps, npmDeps, ready: envVars.every((v) => v.set) && systemDeps.every((d) => d.available) });
  }

  if (options.json) { console.log(JSON.stringify(results, null, 2)); return; }
  const allReady = results.every((r) => r.ready);
  console.log(chalk.bold(`\nSkills Test (${results.length} skill${results.length === 1 ? "" : "s"}):\n`));
  for (const result of results) {
    console.log(chalk.bold(`  ${result.skill}`) + chalk.dim(` [${result.ready ? chalk.green("ready") : chalk.red("not ready")}]`));
    if (!result.envVars.length && !result.systemDeps.length) console.log(chalk.dim("    No requirements"));
    for (const v of result.envVars) console.log(v.set ? `    ${chalk.green("\u2713")} ${v.name}` : `    ${chalk.red("\u2717")} ${v.name} ${chalk.dim("(missing)")}`);
    for (const dep of result.systemDeps) console.log(dep.available ? `    ${chalk.green("\u2713")} ${dep.name} ${chalk.dim("(system)")}` : `    ${chalk.red("\u2717")} ${dep.name} ${chalk.dim("(not installed)")}`);
    if (result.npmDeps.length > 0) console.log(chalk.dim(`    npm: ${result.npmDeps.map((d) => d.name).join(", ")}`));
  }
  console.log();
  if (allReady) console.log(chalk.green(`All ${results.length} skill(s) ready`));
  else { const notReady = results.filter((r) => !r.ready).length; console.log(chalk.yellow(`${notReady} skill(s) not ready`)); }
  if (!allReady) process.exitCode = 1;
}

function handleAuth(name: string | undefined, options: { set?: string; json: boolean }) {
  const cwd = process.cwd();
  const envFilePath = join(cwd, ".env");

  if (options.set) {
    const eqIdx = options.set.indexOf("=");
    if (eqIdx === -1) { console.error(chalk.red(`Invalid format for --set. Expected KEY=VALUE, got: ${options.set}`)); process.exitCode = 1; return; }
    const key = options.set.slice(0, eqIdx).trim();
    const value = options.set.slice(eqIdx + 1);
    if (!key) { console.error(chalk.red("Key cannot be empty")); process.exitCode = 1; return; }
    let existing = existsSync(envFilePath) ? readFileSync(envFilePath, "utf-8") : "";
    const keyPattern = new RegExp(`^${key}=.*$`, "m");
    const updated = keyPattern.test(existing) ? existing.replace(keyPattern, `${key}=${value}`) : existing.endsWith("\n") || existing === "" ? existing + `${key}=${value}\n` : existing + `\n${key}=${value}\n`;
    writeFileSync(envFilePath, updated, "utf-8");
    console.log(chalk.green(`Set ${key} in ${envFilePath}`));
    return;
  }

  if (name) {
    const reqs = getSkillRequirements(name);
    if (!reqs) { console.error(`Skill '${name}' not found`); process.exitCode = 1; return; }
    const envVars = reqs.envVars.map((v) => ({ name: v, set: !!process.env[v] }));
    if (options.json) { console.log(JSON.stringify({ skill: name, envVars }, null, 2)); return; }
    console.log(chalk.bold(`\nAuth status for ${name}:\n`));
    if (!envVars.length) console.log(chalk.dim("  No environment variables required"));
    else for (const v of envVars) console.log(`  ${v.set ? chalk.green("✓") : chalk.red("✗")} ${v.name} (${v.set ? chalk.green("set") : chalk.red("missing")})`);
    return;
  }

  const installed = getInstalledSkills();
  if (!installed.length) { console.log(options.json ? JSON.stringify([]) : "No skills installed"); return; }
  const report = installed.map(skillName => ({ skill: skillName, envVars: (getSkillRequirements(skillName)?.envVars ?? []).map((v) => ({ name: v, set: !!process.env[v] })) }));
  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(chalk.bold(`\nAuth status (${installed.length} installed skills):\n`));
  for (const entry of report) {
    console.log(chalk.bold(`  ${entry.skill}`));
    if (!entry.envVars.length) console.log(chalk.dim("    No environment variables required"));
    else for (const v of entry.envVars) console.log(`    ${v.set ? chalk.green("✓") : chalk.red("✗")} ${v.name} (${v.set ? chalk.green("set") : chalk.red("missing")})`);
  }
}

function handleWhoami(options: { json: boolean }) {

  const installed = getInstalledSkills();
  const agentConfigs: any[] = [];
  for (const agent of AGENT_TARGETS) {
    const agentSkillsPath = getAgentSkillsDir(agent, "global");
    const exists = existsSync(agentSkillsPath);
    let skillCount = 0;
    if (exists) try { skillCount = readdirSync(agentSkillsPath).filter((f) => f.startsWith("skill-") && statSync(join(agentSkillsPath, f)).isDirectory()).length; } catch {}
    agentConfigs.push({ agent, label: AGENT_LABELS[agent], path: agentSkillsPath, exists, skillCount });
  }
  const skillsDir = getSkillPath("image").replace(/[/\\][^/\\]*$/, "");
  if (options.json) {
    console.log(JSON.stringify({ version: pkg.version, installedCount: installed.length, installed, agents: agentConfigs, skillsDir, cwd: process.cwd() }, null, 2));
    return;
  }
  console.log(chalk.bold(`\nskills v${pkg.version}\n`));
  console.log(`${chalk.dim("Working directory:")} ${process.cwd()}`);
  console.log(`${chalk.dim("Skills directory:")}  ${skillsDir}`);
  console.log();
  if (!installed.length) console.log(chalk.dim("No skills installed in current project"));
  else { console.log(chalk.bold(`Installed skills (${installed.length}):`)); for (const name of installed) console.log(`  ${chalk.cyan(name)}`); }
  console.log();
  console.log(chalk.bold("Agent configurations:"));
  for (const cfg of agentConfigs) console.log(cfg.exists ? `  ${chalk.green("\u2713")} ${cfg.agent} \u2014 ${cfg.skillCount} skill(s) at ${cfg.path}` : `  ${chalk.dim("\u2717")} ${cfg.agent} \u2014 not configured`);
}

function handleOutdated(options: { json: boolean }) {
  const installed = getInstalledSkills();
  if (!installed.length) { console.log(options.json ? JSON.stringify([]) : chalk.dim("No skills installed. Run: skills install <name>")); return; }
  const outdated: Array<{ skill: string; installedVersion: string; registryVersion: string }> = [];
  const upToDate: string[] = [];
  for (const name of installed) {
    const installedPkgPath = join(process.cwd(), ".skills", normalizeSkillName(name), "package.json");
    let installedVersion = "unknown";
    if (existsSync(installedPkgPath)) try { installedVersion = JSON.parse(readFileSync(installedPkgPath, "utf-8")).version || "unknown"; } catch {}
    const registryPath = getSkillPath(name);
    const registryPkgPath = join(registryPath, "package.json");
    let registryVersion = "unknown";
    if (existsSync(registryPkgPath)) try { registryVersion = JSON.parse(readFileSync(registryPkgPath, "utf-8")).version || "unknown"; } catch {}
    if (installedVersion !== registryVersion) outdated.push({ skill: name, installedVersion, registryVersion });
    else upToDate.push(name);
  }
  if (options.json) { console.log(JSON.stringify(outdated, null, 2)); return; }
  if (!outdated.length) { console.log(chalk.green(`\nAll ${installed.length} installed skill(s) are up to date`)); return; }
  console.log(chalk.bold(`\nOutdated skills (${outdated.length}):\n`));
  for (const entry of outdated) console.log(`  ${chalk.cyan(entry.skill)}  ${chalk.red(entry.installedVersion)} → ${chalk.green(entry.registryVersion)}`);
  if (upToDate.length > 0) console.log(chalk.dim(`\n${upToDate.length} skill(s) up to date`));
  console.log(chalk.dim(`\nRun ${chalk.bold("skills update")} to update all outdated skills`));
}
