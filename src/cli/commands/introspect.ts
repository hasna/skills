/**
 * info / docs / requires / validate / diff — skill introspection commands
 */

import chalk from "chalk";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { Command } from "commander";
import { execSync } from "child_process";
import { getSkill, findSimilarSkills, loadRegistry, clearRegistryCache } from "../../lib/registry.js";
import { getSkillDocs, getSkillRequirements } from "../../lib/skillinfo.js";
import { getSkillPath } from "../../lib/installer.js";
import { normalizeSkillName } from "../../lib/utils.js";
import { getInstalledSkills } from "../../lib/installer.js";

export function registerIntrospect(parent: Command) {
  // Info
  parent
    .command("info")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .option("--brief", "Single line: name \u2014 description [category] (tags: ...)", false)
    .description("Show details about a specific skill")
    .action((name: string, options: { json: boolean; brief: boolean }) => handleInfo(name, options));

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
    .description("Show files that differ between installed version and source")
    .action((name: string, options: { json: boolean }) => handleDiff(name, options));
}

function skillNotFound(name: string) {
  console.error(`Skill '${name}' not found`);
  const similar = findSimilarSkills(name);
  if (similar.length > 0) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
}

function handleInfo(name: string, options: { json: boolean; brief: boolean }) {
  const skill = getSkill(name);
  if (!skill) { skillNotFound(name); process.exitCode = 1; return; }
  const reqs = getSkillRequirements(name);
  if (options.json) { console.log(JSON.stringify({ ...skill, ...reqs }, null, 2)); return; }
  if (options.brief) { console.log(`${skill.name} \u2014 ${skill.description} [${skill.category}] (tags: ${skill.tags.join(", ")})`); return; }

  function cmdAvailable(cmd: string): boolean { try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } }

  console.log(`\n${chalk.bold(skill.displayName)}${skill.source === "custom" ? chalk.yellow(" [custom]") : ""}`);
  console.log(skill.description);
  console.log(`${chalk.dim("Category:")} ${skill.category}`);
  console.log(`${chalk.dim("Tags:")} ${skill.tags.join(", ")}`);
  if (reqs?.cliCommand) console.log(`${chalk.dim("CLI:")} ${reqs.cliCommand}`);
  if (reqs?.envVars.length) {
    console.log(chalk.dim("Env vars:"));
    for (const v of reqs.envVars) { const set = !!process.env[v]; console.log(`  ${set ? chalk.green("✓") : chalk.red("✗")} ${v}${set ? "" : chalk.dim(" (not set)")}`); }
  }
  if (reqs?.systemDeps.length) {
    console.log(chalk.dim("System deps:"));
    for (const d of reqs.systemDeps) { const avail = cmdAvailable(d); console.log(`  ${avail ? chalk.green("✓") : chalk.red("✗")} ${d}${avail ? "" : chalk.dim(" (not found)")}`); }
  }
  console.log(`${chalk.dim("Install:")} skills install ${skill.name}`);
}

function handleDocs(name: string, options: { json: boolean; file: string }) {
  const docs = getSkillDocs(name);
  if (!docs) { skillNotFound(name); process.exitCode = 1; return; }
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
  if (!reqs) { skillNotFound(name); process.exitCode = 1; return; }
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
  const issues: string[] = [];
  if (!existsSync(sp)) {
    if (options.json) console.log(JSON.stringify({ name, valid: false, issues: [`Skill directory not found: ${sp}`] }));
    else console.error(chalk.red(`Skill '${name}' not found at ${sp}`));
    process.exitCode = 1; return;
  }
  if (!existsSync(join(sp, "SKILL.md"))) issues.push("Missing SKILL.md");
  if (!existsSync(join(sp, "tsconfig.json"))) issues.push("Missing tsconfig.json");
  const pkgPath = join(sp, "package.json");
  if (!existsSync(pkgPath)) issues.push("Missing package.json");
  else {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (!pkg.bin || Object.keys(pkg.bin).length === 0) issues.push("package.json missing 'bin' entry");
    } catch { issues.push("package.json is invalid JSON"); }
  }
  if (!existsSync(join(sp, "src"))) issues.push("Missing src/ directory");
  else if (!existsSync(join(sp, "src", "index.ts"))) issues.push("Missing src/index.ts");

  if (options.json) console.log(JSON.stringify({ name, valid: !issues.length, path: sp, issues }));
  else if (!issues.length) console.log(chalk.green(`✓ ${name} — all checks passed`));
  else { console.log(chalk.red(`✗ ${name} — ${issues.length} issue(s):`)); for (const i of issues) console.log(chalk.red(`  • ${i}`)); process.exitCode = 1; }
}

function handleDiff(name: string, options: { json: boolean }) {
  const bare = name.replace(/^skill-/, "");
  const destPath = join(process.cwd(), ".skills", `skill-${bare}`);
  const sourcePath = getSkillPath(bare);

  if (!existsSync(sourcePath)) {
    if (options.json) console.log(JSON.stringify({ error: `Skill '${bare}' not found in registry` }));
    else skillNotFound(bare);
    process.exitCode = 1; return;
  }
  if (!existsSync(destPath)) {
    if (options.json) console.log(JSON.stringify({ installed: false, message: `'${bare}' is not installed locally` }));
    else console.log(chalk.dim(`'${bare}' is not installed. Run: skills install ${bare}`));
    return;
  }

  function collectFiles(dir: string, base = ""): Map<string, string> {
    const files = new Map<string, string>();
    if (!existsSync(dir)) return files;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      if (statSync(full).isDirectory()) for (const [k, v] of collectFiles(full, rel)) files.set(k, v);
      else { try { files.set(rel, readFileSync(full, "utf-8")); } catch { files.set(rel, ""); } }
    }
    return files;
  }

  const installed = collectFiles(destPath);
  const source = collectFiles(sourcePath);
  const changed: string[] = []; const added: string[] = []; const removed: string[] = [];
  for (const [file, content] of source) { if (!installed.has(file)) added.push(file); else if (installed.get(file) !== content) changed.push(file); }
  for (const file of installed.keys()) if (!source.has(file)) removed.push(file);

  if (options.json) { console.log(JSON.stringify({ name: bare, changed, added, removed, upToDate: !changed.length && !added.length && !removed.length })); return; }
  if (!changed.length && !added.length && !removed.length) { console.log(chalk.green(`✓ ${bare} — up to date`)); return; }
  console.log(chalk.bold(`\nDiff for '${bare}':\n`));
  for (const f of changed) console.log(chalk.yellow(`  ~ ${f}`));
  for (const f of added) console.log(chalk.green(`  + ${f}`));
  for (const f of removed) console.log(chalk.red(`  - ${f}`));
  console.log(chalk.dim(`\nRun 'skills update ${bare}' to apply changes`));
}
