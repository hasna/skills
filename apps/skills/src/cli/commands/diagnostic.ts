/**
 * test / doctor / auth / whoami / outdated — diagnostic commands
 */

import chalk from "chalk";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Command } from "commander";
import { execSync } from "child_process";
import pkg from "../../../package.json" with { type: "json" };
import { getSkill } from "../../lib/registry.js";
import { getSkillRequirements, getSkillDependencyStatus } from "../../lib/skillinfo.js";
import { getInstallMeta, getInstalledSkills, getSkillPath, getAgentSkillsDir, AGENT_TARGETS, AGENT_LABELS } from "../../lib/installer.js";
import { censusHomeDrift } from "../../lib/home-census.js";
import { EnvAssignmentError, setEnvAssignment } from "../env-assignment.js";
import { resolveCorpusRoot } from "../../lib/home-migration.js";
import { describeCredentialState } from "../../lib/credential-state.js";

export function registerDiagnostic(parent: Command) {
  // Doctor
  parent
    .command("doctor")
    .option("--json", "Output as JSON", false)
    .description("Check env vars, system deps, and readiness for pinned skills")
    .action((options: { json: boolean }) => handleDoctor(options));

  // Test
  parent
    .command("test")
    .argument("[skill]", "Skill name to test (omit to test all pinned)")
    .option("--json", "Output results as JSON", false)
    .description("Test skill readiness: env vars, system deps, and npm deps")
    .action(async (skillArg: string | undefined, options) => handleTest(skillArg, options));

  // Env check (was "auth" — renamed to avoid conflict with skills auth login)
  parent
    .command("env-check")
    .alias("check-env")
    .argument("[skill]", "Skill name (omit to check all pinned skills)")
    .option("--set <assignment>", "Set an env var in .env file (format: KEY=VALUE)")
    .option("--json", "Output as JSON", false)
    .description("Show env var status for a skill or all pinned skills")
    .action((name: string | undefined, options) => handleAuth(name, options));

  // Info (was "whoami" — renamed to avoid conflict with skills auth whoami)
  parent
    .command("setup-info")
    .option("--json", "Output as JSON", false)
    .description("Show setup summary: version, pinned skills, MCP/agent config paths")
    .action((options: { json: boolean }) => handleWhoami(options));

  // Outdated
  parent
    .command("outdated")
    .option("--json", "Output as JSON", false)
    .description("Report home/corpus drift (diverged, stray, missing) and pinned-skill version differences")
    .action((options: { json: boolean }) => handleOutdated(options));
}

function handleDoctor(options: { json: boolean }) {
  const installed = getInstalledSkills();
  // Keep the --json top-level shape stable across states: always an array of
  // per-skill reports (empty when nothing is pinned), matching the pinned case below.
  if (!installed.length) { console.log(options.json ? JSON.stringify([], null, 2) : "No pinned skills"); return; }

  function cmdAvailable(cmd: string): boolean { try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } }

  const report = [];
  for (const name of installed) {
    const reqs = getSkillRequirements(name);
    const envVars = (reqs?.envVars ?? []).map((v) => ({ name: v, set: !!process.env[v] }));
    const systemDeps = (reqs?.systemDeps ?? []).map((d) => ({ name: d, available: cmdAvailable(d) }));
    const npmDeps = getSkillDependencyStatus(name);
    report.push({ skill: name, envVars, systemDeps, npmDeps, healthy: envVars.every((v) => v.set) && systemDeps.every((d) => d.available) && npmDeps.every((d) => d.installed) });
  }

  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
  const issues = report.filter((r) => !r.healthy);
  console.log(chalk.bold(`\nSkills Doctor — ${installed.length} pinned, ${issues.length} with issues:\n`));
  for (const entry of report) {
    console.log(`  ${entry.healthy ? chalk.green("✓") : chalk.red("✗")} ${chalk.bold(entry.skill)}`);
    for (const v of entry.envVars) console.log(`      ${v.name} [${v.set ? chalk.green("set") : chalk.red("missing")}]`);
    for (const d of entry.systemDeps) console.log(`      ${d.name} [${d.available ? chalk.green("available") : chalk.red("not found")}]`);
    for (const d of entry.npmDeps) console.log(`      ${d.name} [${d.installed ? chalk.green("installed") : chalk.red("not installed")}]`);
    if (!entry.envVars.length && !entry.systemDeps.length && !entry.npmDeps.length) console.log(chalk.dim("      No requirements"));
  }
  if (!issues.length) console.log(chalk.green("\n  All skills healthy! ✓"));
}

async function handleTest(skillArg: string | undefined, options: { json: boolean }) {
  let skillNames: string[];
  if (skillArg) {
    const registryName = skillArg;
    if (!getSkill(registryName)) {
      if (options.json) { console.log(JSON.stringify({ error: `Skill '${skillArg}' not found` })); }
      else console.error(chalk.red(`Skill '${skillArg}' not found`));
      process.exitCode = 1; return;
    }
    skillNames = [registryName];
  } else {
    skillNames = getInstalledSkills();
    if (!skillNames.length) { console.log(options.json ? JSON.stringify([]) : chalk.dim("No pinned skills. Run: skills pin <name>")); return; }
  }

  const results = [];
  for (const name of skillNames) {
    const reqs = getSkillRequirements(name);
    const envVars = (reqs?.envVars ?? []).map((v) => ({ name: v, set: !!process.env[v] }));
    const systemDeps = (reqs?.systemDeps ?? []).map((dep) => {
      const proc = Bun.spawnSync(["which", dep]);
      return { name: dep, available: proc.exitCode === 0 };
    });
    const npmDeps = getSkillDependencyStatus(name);
    results.push({ skill: name, envVars, systemDeps, npmDeps, ready: envVars.every((v) => v.set) && systemDeps.every((d) => d.available) && npmDeps.every((d) => d.installed) });
  }

  const allReady = results.every((r) => r.ready);
  if (!allReady) process.exitCode = 1;
  if (options.json) { console.log(JSON.stringify(results, null, 2)); return; }
  console.log(chalk.bold(`\nSkills Test (${results.length} skill${results.length === 1 ? "" : "s"}):\n`));
  for (const result of results) {
    console.log(chalk.bold(`  ${result.skill}`) + chalk.dim(` [${result.ready ? chalk.green("ready") : chalk.red("not ready")}]`));
    if (!result.envVars.length && !result.systemDeps.length) console.log(chalk.dim("    No requirements"));
    for (const v of result.envVars) console.log(v.set ? `    ${chalk.green("\u2713")} ${v.name}` : `    ${chalk.red("\u2717")} ${v.name} ${chalk.dim("(missing)")}`);
    for (const dep of result.systemDeps) console.log(dep.available ? `    ${chalk.green("\u2713")} ${dep.name} ${chalk.dim("(system)")}` : `    ${chalk.red("\u2717")} ${dep.name} ${chalk.dim("(not installed)")}`);
    for (const dep of result.npmDeps) console.log(dep.installed ? `    ${chalk.green("✓")} ${dep.name} ${chalk.dim("(npm)")}` : `    ${chalk.red("✗")} ${dep.name} ${chalk.dim("(npm — not installed; run: skills run " + result.skill + ")")}`);
  }
  console.log();
  if (allReady) console.log(chalk.green(`All ${results.length} skill(s) ready`));
  else { const notReady = results.filter((r) => !r.ready).length; console.log(chalk.yellow(`${notReady} skill(s) not ready`)); }
}

function handleAuth(name: string | undefined, options: { set?: string; json: boolean }) {
  const cwd = process.cwd();
  const envFilePath = join(cwd, ".env");

  if (options.set !== undefined) {
    let key: string;
    try {
      key = setEnvAssignment(envFilePath, options.set);
    } catch (error) {
      const message = error instanceof EnvAssignmentError ? error.message : "Cannot safely update the project .env file.";
      if (options.json) console.log(JSON.stringify({ set: false, error: message }));
      else console.error(chalk.red(message));
      process.exitCode = 1; return;
    }
    if (options.json) console.log(JSON.stringify({ set: true, key, path: envFilePath }));
    else console.log(chalk.green(`Set ${key} in ${envFilePath}`));
    return;
  }

  if (name) {
    const reqs = getSkillRequirements(name);
    if (!reqs) {
      if (options.json) console.log(JSON.stringify({ skill: name, error: `Skill '${name}' not found` }));
      else console.error(`Skill '${name}' not found`);
      process.exitCode = 1; return;
    }
    const envVars = reqs.envVars.map((v) => ({ name: v, set: !!process.env[v] }));
    if (options.json) { console.log(JSON.stringify({ skill: name, envVars }, null, 2)); return; }
    console.log(chalk.bold(`\nAuth status for ${name}:\n`));
    if (!envVars.length) console.log(chalk.dim("  No environment variables required"));
    else for (const v of envVars) console.log(`  ${v.set ? chalk.green("✓") : chalk.red("✗")} ${v.name} (${v.set ? chalk.green("set") : chalk.red("missing")})`);
    return;
  }

  const installed = getInstalledSkills();
  if (!installed.length) { console.log(options.json ? JSON.stringify([]) : "No pinned skills"); return; }
  const report = installed.map(skillName => ({ skill: skillName, envVars: (getSkillRequirements(skillName)?.envVars ?? []).map((v) => ({ name: v, set: !!process.env[v] })) }));
  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(chalk.bold(`\nAuth status (${installed.length} pinned skills):\n`));
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
    if (exists) try { skillCount = readdirSync(agentSkillsPath).filter((f) => !f.startsWith(".") && statSync(join(agentSkillsPath, f)).isDirectory()).length; } catch {}
    agentConfigs.push({ agent, label: AGENT_LABELS[agent], path: agentSkillsPath, exists, skillCount });
  }
  // The machine corpus (where pull writes and push reads), not the package's own
  // node_modules folder, which is what this line reported before (hasna/apps#1632).
  const skillsDir = resolveCorpusRoot();
  const credential = describeCredentialState();
  // A misconfigured ladder is reported as data in the payload AND as exit 1, so
  // a script keyed on the exit status sees the loud refusal too — the same
  // shape every read verb takes (#1720 validation). The payload keeps its shape.
  if (credential.mode === "misconfigured") process.exitCode = 1;
  if (options.json) {
    console.log(JSON.stringify({ version: pkg.version, installedCount: installed.length, installed, agents: agentConfigs, skillsDir, cwd: process.cwd(), credential }, null, 2));
    return;
  }
  console.log(chalk.bold(`\nskills v${pkg.version}\n`));
  console.log(`${chalk.dim("Working directory:")} ${process.cwd()}`);
  console.log(`${chalk.dim("Corpus directory:")}  ${skillsDir}`);
  console.log(`${chalk.dim("Mode:")}             ${credential.mode}`);
  if (credential.apiUrl) console.log(`${chalk.dim("API:")}              ${credential.apiUrl} (${credential.apiUrlSource})`);
  if (credential.apiKeySource) console.log(`${chalk.dim("Credential:")}       ${credential.apiKeySource}`);
  if (credential.error) console.log(chalk.red(`${chalk.dim("Credential:")}       ${credential.error}`));
  console.log();
  if (!installed.length) console.log(chalk.dim("No pinned skills in current project"));
  else { console.log(chalk.bold(`Pinned skills (${installed.length}):`)); for (const name of installed) console.log(`  ${chalk.cyan(name)}`); }
  console.log();
  console.log(chalk.bold("Agent configurations:"));
  for (const cfg of agentConfigs) console.log(cfg.exists ? `  ${chalk.green("\u2713")} ${cfg.agent} \u2014 ${cfg.skillCount} skill(s) at ${cfg.path}` : `  ${chalk.dim("\u2717")} ${cfg.agent} \u2014 not configured`);
}

// describeCredentialState() lives in lib/credential-state.ts, shared with the
// MCP `whoami` tool so both surfaces report the same sources (never values).

function handleOutdated(options: { json: boolean }) {
  // The pin comparison remains, as a subset of the home/corpus comparison.
  const installed = getInstalledSkills();
  const pins: Array<{ skill: string; installedVersion: string; registryVersion: string }> = [];
  const meta = getInstallMeta();
  for (const name of installed) {
    const installedVersion = meta.skills[name]?.version ?? "unknown";
    const registryPath = getSkillPath(name);
    const registryPkgPath = join(registryPath, "package.json");
    let registryVersion = "unknown";
    if (existsSync(registryPkgPath)) try { registryVersion = JSON.parse(readFileSync(registryPkgPath, "utf-8")).version || "unknown"; } catch {}
    if (installedVersion !== registryVersion) pins.push({ skill: name, installedVersion, registryVersion });
  }

  const census = censusHomeDrift();
  const homes = {
    diverged: census.entries.filter((entry) => entry.kind === "diverged"),
    stray: census.entries.filter((entry) => entry.kind === "stray-in-home"),
    missing: census.entries.filter((entry) => entry.kind === "missing-from-home"),
  };
  const homeOutdated = census.entries.length > 0;

  if (options.json) {
    console.log(JSON.stringify({ homes, pins, unmarked: census.unmarked, managed: census.managed, homesChecked: census.homesChecked }, null, 2));
    if (homeOutdated || pins.length > 0) process.exitCode = 1;
    return;
  }

  if (!homeOutdated && pins.length === 0) {
    console.log(chalk.green(`\nNo outdated skills: ${census.homesChecked} home(s) clean, ${census.managed} managed, ${census.unmarked} unmarked${installed.length ? `, ${installed.length} pin(s) up to date` : ""}`));
    return;
  }
  console.log(chalk.bold(`\nOutdated home skills (${census.entries.length}):\n`));
  for (const entry of census.entries) {
    console.log(`  ${chalk.cyan(entry.skill)} → ${entry.agent}  ${chalk.red(entry.kind)}${entry.homeHash ? chalk.dim(` (${entry.homeHash.slice(0, 12)} ≠ ${entry.canonicalHash?.slice(0, 12)})`) : ""}`);
  }
  if (pins.length > 0) {
    console.log(chalk.bold(`\nOutdated pins (${pins.length}):`));
    for (const entry of pins) console.log(`  ${chalk.cyan(entry.skill)}  ${chalk.red(entry.installedVersion)} → ${chalk.green(entry.registryVersion)}`);
  }
  if (census.unmarked > 0) console.log(chalk.dim(`\n${census.unmarked} unmarked home dir(s) are adoption candidates; see: skills sync --adopt`));
  if (homeOutdated || pins.length > 0) process.exitCode = 1;
}
