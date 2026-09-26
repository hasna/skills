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
import { isSkillsFleetCredentialError } from "../../lib/fleet-credentials.js";
import { requireSkillsReadAccess } from "../../lib/read-access.js";
import { getSkillDocs, getSkillRequirements } from "../../lib/skillinfo.js";
import { resolveSkillDocFile, selectSkillDoc, SkillDocFileError } from "../../lib/skill-doc-file.js";
import { getInstallMeta, getInstalledSkills, getSkillPath } from "../../lib/installer.js";
import { validateSkillDirectory } from "../../lib/skill-validation.js";
import { findPortableSkill, normalizePortableSkillName, validatePortableSkillDirectory } from "../../lib/portable-skills.js";
import { SYNC_AGENTS, SYNC_MARKER_FILE, agentGlobalSkillsDir, isPointerSkillMd } from "../../lib/agent-sync.js";
import { resolveCorpusRoot } from "../../lib/home-migration.js";
import { hashSkillMarkdownFile } from "../../lib/skill-hash.js";
import { loadSelectedSkill, selectedSkillRequirements } from "../../lib/selection-resolver.js";
import { selectedProfileId } from "./context.js";
import {
  getPublicSkillDiscovery,
  publicDiscoveryDependencies,
  publicDiscoveryEnvVars,
} from "../../lib/discovery.js";

export function registerIntrospect(parent: Command) {
  // Info
  parent
    .command("info")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .option("--brief", "Single line: name \u2014 description [category] (tags: ...)", false)
    .option("--remote", "Use the remote registry (the resolved Skills credential; HASNA_SKILLS_API_URL for your own instance)", false)
    .description("Show details about a specific skill")
    .action((name: string, options: { json: boolean; brief: boolean; remote: boolean }) => {
      return handleInfo(name, options).catch((error) => handleInfoError(name, options, error));
    });

  parent
    .command("show")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .option("--brief", "Single line: name — description [category] (tags: ...)", false)
    .option("--remote", "Use the remote registry (the resolved Skills credential; HASNA_SKILLS_API_URL for your own instance)", false)
    .description("Show details about a specific skill")
    .action((name: string, options: { json: boolean; brief: boolean; remote: boolean }) => {
      return handleInfo(name, options).catch((error) => handleInfoError(name, options, error));
    });

  // Docs
  parent
    .command("docs")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .option("--file <file>", "Specific file: skill, readme, claude", "")
    .option("--selection-profile <id>", "Authoritative selection profile")
    .description("Show documentation for a skill")
    .action((name: string, options: { json: boolean; file: string; selectionProfile?: string }) => handleDocs(name, options).catch(handleReadRefusal));

  // Requires
  parent
    .command("requires")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .option("--selection-profile <id>", "Authoritative selection profile")
    .description("Show what a skill needs (env vars, system deps, dependencies)")
    .action((name: string, options: { json: boolean; selectionProfile?: string }) => handleRequires(name, options).catch(handleReadRefusal));

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
    .description("Compare a skill across agent homes against the canonical corpus; pin metadata is included as a subset")
    .action((name: string, options: { json: boolean }) => handleDiff(name, options));
}

function skillNotFound(name: string, similar: string[] = findSimilarSkills(name)) {
  console.error(`Skill '${name}' not found`);
  if (similar.length > 0) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
}

/**
 * The ladder's refusal on a read verb: one line on stderr, exit 1, nothing on
 * stdout — the same exit `skills list` has taken since the fail-closed ruling
 * (handleBrowseError in list.ts). Anything else propagates as before.
 */
function handleReadRefusal(error: unknown): void {
  if (!isSkillsFleetCredentialError(error) && !(error instanceof SkillDocFileError)) throw error;
  console.error(chalk.red(error.message));
  process.exitCode = 1;
}

async function handleInfoError(name: string, options: { json: boolean; remote?: boolean }, error: unknown): Promise<void> {
  // A credential refusal is not "skill not found": printing the not-found
  // shape for it would send the operator looking for a typo in the name.
  if (isSkillsFleetCredentialError(error)) return handleReadRefusal(error);
  const notFound = await resolveRemoteNotFound(name, options.remote, (error as Error).message);
  if (options.json) console.log(JSON.stringify(notFound));
  else skillNotFound(name, notFound.similar);
  process.exitCode = 1;
}

async function handleInfo(name: string, options: { json: boolean; brief: boolean; remote?: boolean }) {
  // Fail closed BEFORE the bundled catalog or the on-machine corpus is read:
  // without a credential and without the local opt-in this is a refusal, as
  // `skills list` already was (#1720 validation). `--remote` resolves through
  // the same ladder inside loadRemoteSkill().
  const access = await requireSkillsReadAccess();
  const remote = options.remote || access.mode === "hosted";
  const skill = remote ? await loadRemoteSkill(name) : getSkill(name);
  if (!skill) {
    if (options.json) console.log(JSON.stringify({ error: `Skill '${name}' not found`, similar: findSimilarSkills(name) }));
    else skillNotFound(name);
    process.exitCode = 1; return;
  }
  const reqs = remote ? null : getSkillRequirements(name);
  const discovery = getPublicSkillDiscovery(skill);
  const publicReqs = reqs ? {
    ...reqs,
    envVars: publicDiscoveryEnvVars(skill.name, reqs.envVars),
    dependencies: publicDiscoveryDependencies(skill.name, reqs.dependencies),
  } : reqs;
  if (options.json) { console.log(JSON.stringify({ ...discovery, ...publicReqs }, null, 2)); return; }
  if (options.brief) {
    const tags = discovery.tags.length ? discovery.tags.join(", ") : "none";
    console.log(`${discovery.name} \u2014 ${discovery.description} [${discovery.category}] (tags: ${tags})`);
    return;
  }

  function cmdAvailable(cmd: string): boolean { try { execSync(`which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } }

  console.log(`\n${chalk.bold(discovery.displayName)}${discovery.source === "custom" ? chalk.yellow(" [custom]") : ""}`);
  console.log(discovery.description);
  console.log(`${chalk.dim("Category:")} ${discovery.category}`);
  if (discovery.tags.length) console.log(`${chalk.dim("Tags:")} ${discovery.tags.join(", ")}`);
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

async function handleDocs(name: string, options: { json: boolean; file: string; selectionProfile?: string }) {
  const file = resolveSkillDocFile(options.file);
  const access = await requireSkillsReadAccess();
  if (access.mode === "hosted") {
    const result = await loadSelectedSkill(name, selectedProfileId(options.selectionProfile), { projectDir: process.cwd(), file });
    console.log(options.json ? JSON.stringify({ skill: name, ...result }) : result.content);
    return;
  }
  const docs = getSkillDocs(name);
  if (!docs) {
    if (options.json) console.log(JSON.stringify({ skill: name, error: `Skill '${name}' not found`, similar: findSimilarSkills(name) }));
    else skillNotFound(name);
    process.exitCode = 1; return;
  }
  const content = selectSkillDoc(docs, options.file);
  if (options.json) {
    console.log(JSON.stringify({
      skill: name, hasSkillMd: docs.skillMd !== null, hasReadme: docs.readme !== null, hasClaudeMd: docs.claudeMd !== null,
      content,
    }, null, 2));
    return;
  }
  if (content === null) {
    console.log(chalk.dim(`No documentation found for '${name}'`));
    return;
  }
  console.log(content);
}

async function handleRequires(name: string, options: { json: boolean; selectionProfile?: string }) {
  const access = await requireSkillsReadAccess();
  const reqs = access.mode === "hosted"
    ? await selectedSkillRequirements(name, selectedProfileId(options.selectionProfile), { projectDir: process.cwd() })
    : getSkillRequirements(name);
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
  const portable = findPortableSkill(name);
  const sp = portable?.path ?? getSkillPath(name);
  const result = portable
    ? validatePortableSkillDirectory(portable.name, portable.path)
    : validateSkillDirectory(name, sp, getSkill(name));

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
  const normalized = normalizePortableSkillName(bare);
  const sourcePath = getSkillPath(bare);

  const canonicalDir = join(resolveCorpusRoot(), normalized);
  const canonicalSkillMd = join(canonicalDir, "SKILL.md");
  const canonical = {
    present: existsSync(canonicalSkillMd),
    path: canonicalDir,
    ...(existsSync(canonicalSkillMd) ? { hash: hashSkillMarkdownFile(canonicalSkillMd) } : {}),
    // A stub canonical is an executable skill whose managed form is a pointer
    // (bug 60f2ab27): content homes under it are adopted content, not sync output.
    ...(existsSync(canonicalSkillMd) ? { stub: isPointerSkillMd(readFileSync(canonicalSkillMd, "utf-8")) } : {}),
  };

  // Pin comparison remains, as a subset of the home-vs-canonical comparison:
  // a skill can be pinned and simultaneously diverged in an agent home.
  const pinned = getInstalledSkills().includes(bare);
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

  const homes = [];
  for (const agent of SYNC_AGENTS) {
    const dir = join(agentGlobalSkillsDir(agent), normalized);
    const present = existsSync(dir);
    const managed = existsSync(join(dir, SYNC_MARKER_FILE));
    const skillMdPath = join(dir, "SKILL.md");
    const hash = present && existsSync(skillMdPath) ? hashSkillMarkdownFile(skillMdPath) : undefined;
    let stub: boolean | undefined;
    if (present && existsSync(skillMdPath)) {
      try {
        stub = isPointerSkillMd(readFileSync(skillMdPath, "utf-8"));
      } catch {
        stub = undefined;
      }
    }
    const diverged = present && canonical.present && managed && hash !== canonical.hash;
    homes.push({
      agent,
      path: dir,
      present,
      managed,
      ...(hash ? { hash } : {}),
      ...(stub !== undefined ? { stub } : {}),
      ...(diverged !== undefined ? { diverged } : {}),
    });
  }
  const divergedHomes = homes.filter((home) => home.diverged === true);

  if (options.json) {
    console.log(JSON.stringify({
      name: bare,
      canonical,
      pinned,
      installedVersion,
      registryVersion,
      upToDate,
      homes,
    }, null, 2));
  } else {
    if (!canonical.present) {
      console.log(chalk.yellow(`${bare}: no canonical corpus entry`));
    } else {
      console.log(chalk.dim(`${bare} canonical: ${canonical.hash?.slice(0, 12)}…`));
    }
    if (pinned) {
      console.log(upToDate
        ? chalk.green(`✓ pin is up to date (${installedVersion})`)
        : chalk.yellow(`pin metadata differs: ${installedVersion} → ${registryVersion}`));
    }
    for (const home of homes) {
      if (!home.present) {
        console.log(`${chalk.dim("•")} ${home.agent}: ${chalk.dim("not present")}`);
      } else if (!home.managed) {
        console.log(`${chalk.dim("•")} ${home.agent}: ${chalk.yellow("unmarked (adoption candidate)")}`);
      } else if (home.diverged) {
        const stubNote = home.stub === true ? " (home is a pointer stub; canonical holds content)" : canonical.stub === true ? " (home holds content; canonical renders a pointer stub — sync refuses to replace it)" : "";
        console.log(`${chalk.red("✗")} ${home.agent}: ${chalk.red("diverged")} ${chalk.dim(home.hash?.slice(0, 12))} ≠ ${chalk.dim(canonical.hash?.slice(0, 12))}${stubNote}`);
      } else {
        console.log(`${chalk.green("✓")} ${home.agent}: ${chalk.green("matches canonical")}`);
      }
    }
  }
  if (divergedHomes.length > 0 || (homes.length > 0 && !canonical.present)) process.exitCode = 1;
}
