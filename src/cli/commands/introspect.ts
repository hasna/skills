/**
 * info / docs / requires / validate / diff — skill introspection commands
 */

import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Command } from "commander";
import { execSync } from "child_process";
import { getSkill, findSimilarSkills, loadRegistry, clearRegistryCache } from "../../lib/registry.js";
import { loadRemoteRegistry, loadRemoteSkill } from "../../lib/remote-registry.js";
import { getSkillDocs, getSkillRequirements } from "../../lib/skillinfo.js";
import { getInstallMeta, getInstalledSkills, getSkillPath } from "../../lib/installer.js";
import { validateSkillDirectory } from "../../lib/skill-validation.js";
import {
  getPublicSkillDiscovery,
  publicDiscoveryDependencies,
  publicDiscoveryEnvVars,
  publicDiscoveryPriceLabel,
} from "../../lib/discovery.js";

export function registerIntrospect(parent: Command) {
  // Info
  parent
    .command("info")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .option("--brief", "Single line: name \u2014 description [category] (tags: ...)", false)
    .option("--remote", "Use remote registry from SKILLS_API_URL or config apiUrl", false)
    .description("Show details about a specific skill")
    .action((name: string, options: { json: boolean; brief: boolean; remote: boolean }) => {
      void handleInfo(name, options).catch(async (error) => {
        const notFound = await resolveRemoteNotFound(name, options.remote, (error as Error).message);
        if (options.json) console.log(JSON.stringify(notFound));
        else skillNotFound(name, notFound.similar);
        process.exitCode = 1;
      });
    });

  // Docs
  parent
    .command("docs")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .option("--file <file>", "Specific file: skill, readme, claude", "")
    .description("Show documentation for a skill")
    .action((name: string, options: { json: boolean; file: string }) => handleDocs(name, options));

  // Requires
  parent
    .command("requires")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .description("Show what a skill needs (env vars, system deps, dependencies)")
    .action((name: string, options: { json: boolean }) => handleRequires(name, options));

  // Validate
  parent
    .command("validate")
    .argument("<name>", "Skill name to validate")
    .option("--json", "Output as JSON", false)
    .description("Validate a skill's directory structure")
    .action((name: string, options: { json: boolean }) => handleValidate(name, options));

  // Diff
  parent
    .command("diff")
    .argument("<name>", "Skill name to diff")
    .option("--json", "Output as JSON", false)
    .description("Show pinned version metadata against bundled registry")
    .action((name: string, options: { json: boolean }) => handleDiff(name, options));
}

function skillNotFound(name: string, similar: string[] = findSimilarSkills(name)) {
  console.error(`Skill '${name}' not found`);
  if (similar.length > 0) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
}

async function handleInfo(name: string, options: { json: boolean; brief: boolean; remote?: boolean }) {
  const skill = options.remote ? await loadRemoteSkill(name) : getSkill(name);
  if (!skill) {
    if (options.json) console.log(JSON.stringify({ error: `Skill '${name}' not found`, similar: findSimilarSkills(name) }));
    else skillNotFound(name);
    process.exitCode = 1; return;
  }
  const reqs = options.remote ? null : getSkillRequirements(name);
  const discovery = getPublicSkillDiscovery(skill);
  const pricing = discovery.pricing;
  const publicReqs = reqs ? {
    ...reqs,
    envVars: publicDiscoveryEnvVars(skill.name, reqs.envVars),
    dependencies: publicDiscoveryDependencies(skill.name, reqs.dependencies),
  } : reqs;
  if (options.json) { console.log(JSON.stringify({ ...discovery, ...publicReqs, pricing }, null, 2)); return; }
  if (options.brief) {
    const tags = discovery.tags.length ? discovery.tags.join(", ") : "none";
    console.log(`${discovery.name} \u2014 ${discovery.description} (${publicDiscoveryPriceLabel(discovery)}) [${discovery.category}] (tags: ${tags})`);
    return;
  }

  function cmdAvailable(cmd: string): boolean { try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } }

  console.log(`\n${chalk.bold(discovery.displayName)}${discovery.source === "custom" ? chalk.yellow(" [custom]") : ""}`);
  console.log(discovery.description);
  console.log(`${chalk.dim("Category:")} ${discovery.category}`);
  if (discovery.tags.length) console.log(`${chalk.dim("Tags:")} ${discovery.tags.join(", ")}`);
  console.log(`${chalk.dim("Pricing:")} ${pricing.formattedCost}`);
  if (publicReqs?.cliCommand) console.log(`${chalk.dim("CLI:")} ${publicReqs.cliCommand}`);
  if (publicReqs?.envVars.length) {
    console.log(chalk.dim("Env vars:"));
    for (const v of publicReqs.envVars) { const set = !!process.env[v]; console.log(`  ${set ? chalk.green("✓") : chalk.red("✗")} ${v}${set ? "" : chalk.dim(" (not set)")}`); }
  }
  if (publicReqs?.systemDeps.length) {
    console.log(chalk.dim("System deps:"));
    for (const d of publicReqs.systemDeps) { const avail = cmdAvailable(d); console.log(`  ${avail ? chalk.green("✓") : chalk.red("✗")} ${d}${avail ? "" : chalk.dim(" (not found)")}`); }
  }
  console.log(`${chalk.dim("Pin:")} skills pin ${discovery.name}${options.remote ? " --remote" : ""}`);
}

async function resolveRemoteNotFound(name: string, remote: boolean | undefined, message: string) {
  if (!remote) {
    return { error: message, similar: findSimilarSkills(name) };
  }

  if (!message.includes("404")) {
    return { error: message, similar: [] };
  }

  try {
    const registry = await loadRemoteRegistry();
    return { error: `Skill '${name}' not found`, similar: findSimilarSkills(name, 3, registry) };
  } catch {
    return { error: `Skill '${name}' not found`, similar: [] };
  }
}

function handleDocs(name: string, options: { json: boolean; file: string }) {
  const docs = getSkillDocs(name);
  if (!docs) {
    if (options.json) console.log(JSON.stringify({ skill: name, error: `Skill '${name}' not found`, similar: findSimilarSkills(name) }));
    else skillNotFound(name);
    process.exitCode = 1; return;
  }
  if (options.json) {
    console.log(JSON.stringify({
      skill: name, hasSkillMd: docs.skillMd !== null, hasReadme: docs.readme !== null, hasClaudeMd: docs.claudeMd !== null,
      content: options.file ? docs[options.file === "skill" ? "skillMd" : options.file === "readme" ? "readme" : "claudeMd"] : docs.skillMd || docs.readme || docs.claudeMd,
    }, null, 2));
    return;
  }
  let content: string | null = null;
  if (options.file === "skill") content = docs.skillMd;
  else if (options.file === "readme") content = docs.readme;
  else if (options.file === "claude") content = docs.claudeMd;
  else content = docs.skillMd || docs.readme || docs.claudeMd;
  if (!content) {
    const available: string[] = [];
    if (docs.skillMd) available.push("skill");
    if (docs.readme) available.push("readme");
    if (docs.claudeMd) available.push("claude");
    if (!available.length) console.log(chalk.dim(`No documentation found for '${name}'`));
    else console.log(chalk.dim(`File '${options.file}' not found. Available: ${available.join(", ")}`));
    return;
  }
  console.log(content);
}

function handleRequires(name: string, options: { json: boolean }) {
  const reqs = getSkillRequirements(name);
  if (!reqs) {
    if (options.json) console.log(JSON.stringify({ skill: name, error: `Skill '${name}' not found`, similar: findSimilarSkills(name) }));
    else skillNotFound(name);
    process.exitCode = 1; return;
  }
  if (options.json) { console.log(JSON.stringify(reqs, null, 2)); return; }
  console.log(`\n${chalk.bold(`Requirements for ${name}`)}\n`);
  if (reqs.cliCommand) console.log(`${chalk.dim("CLI command:")} ${reqs.cliCommand}`);
  if (reqs.envVars.length > 0) {
    console.log(`\n${chalk.bold("Environment variables:")}`);
    for (const v of reqs.envVars) console.log(`  ${v} [${process.env[v] ? chalk.green("set") : chalk.red("missing")}]`);
  } else console.log(chalk.dim("\nNo environment variables detected."));
  if (reqs.systemDeps.length > 0) {
    console.log(`\n${chalk.bold("System dependencies:")}`);
    for (const dep of reqs.systemDeps) console.log(`  ${dep}`);
  }
  const depCount = Object.keys(reqs.dependencies).length;
  if (depCount > 0) {
    console.log(`\n${chalk.bold("npm dependencies:")} ${depCount} packages`);
    for (const [pkg, ver] of Object.entries(reqs.dependencies)) console.log(`  ${pkg} ${chalk.dim(ver)}`);
  }
}

function handleValidate(name: string, options: { json: boolean }) {
  const sp = getSkillPath(name);
  const result = validateSkillDirectory(name, sp, getSkill(name));

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.valid) {
    console.log(chalk.green(`✓ ${name} — all required checks passed`));
    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`  ${result.warnings.length} warning(s):`));
      for (const warning of result.warnings) console.log(chalk.yellow(`  • ${warning.message}`));
    }
  } else {
    console.log(chalk.red(`✗ ${name} — ${result.issues.length} issue(s):`));
    for (const issue of result.issues) console.log(chalk.red(`  • ${issue.message}`));
    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`  ${result.warnings.length} warning(s):`));
      for (const warning of result.warnings) console.log(chalk.yellow(`  • ${warning.message}`));
    }
  }
  if (!result.valid) process.exitCode = 1;
}

function handleDiff(name: string, options: { json: boolean }) {
  const bare = name;
  const sourcePath = getSkillPath(bare);

  if (!existsSync(sourcePath)) {
    if (options.json) console.log(JSON.stringify({ error: `Skill '${bare}' not found in registry` }));
    else skillNotFound(bare);
    process.exitCode = 1; return;
  }
  if (!getInstalledSkills().includes(bare)) {
    if (options.json) console.log(JSON.stringify({ pinned: false, message: `'${bare}' is not pinned locally` }));
    else console.log(chalk.dim(`'${bare}' is not pinned. Run: skills pin ${bare}`));
    return;
  }

  const installMeta = getInstallMeta();
  const installedVersion = installMeta.skills[bare]?.version ?? "unknown";
  const registryPkgPath = join(sourcePath, "package.json");
  let registryVersion = "unknown";
  if (existsSync(registryPkgPath)) {
    try {
      registryVersion = JSON.parse(readFileSync(registryPkgPath, "utf-8")).version || "unknown";
    } catch {}
  }
  const upToDate = installedVersion === registryVersion;
  if (options.json) {
    console.log(JSON.stringify({ name: bare, pinned: true, installedVersion, registryVersion, upToDate }));
    return;
  }
  if (upToDate) {
    console.log(chalk.green(`✓ ${bare} pin is up to date (${installedVersion})`));
    return;
  }
  console.log(chalk.yellow(`${bare} pin metadata differs: ${installedVersion} → ${registryVersion}`));
  console.log(chalk.dim(`\nRun 'skills update ${bare}' to refresh the pin`));
}
