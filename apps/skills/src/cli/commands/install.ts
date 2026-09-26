/**
 * pin / unpin / update — project skill preference commands
 */

import chalk from "chalk";
import type { Command } from "commander";
import { CATEGORIES, getSkillsByCategory, type SkillMeta } from "../../lib/registry.js";
import { loadRemoteRegistry } from "../../lib/remote-registry.js";
import {
  installSkill,
  installRemoteSkill,
  getInstalledSkills,
  removeSkill,
  type InstallResult,
} from "../../lib/installer.js";
import { getProjectConfigPath, listPinnedSkills, pinProjectSkill } from "../../lib/project-state.js";
import { normalizeSkillName } from "../../lib/utils.js";
import { splitNameVersion } from "../../lib/pull.js";
import { loadSelectedSkill, pinSelectedSkillVersion } from "../../lib/selection-resolver.js";
import { SkillSelectionError } from "../../lib/selection-cache.js";
import { selectedProfileId, reportContextError } from "./context.js";
import { handleProfileSync } from "./profile-sync.js";
import { requireSkillsReadAccess } from "../../lib/read-access.js";

export function registerInstall(parent: Command) {
  parent
    .command("install")
    .argument("[skills...]", "Exact selected skill references (default: synchronize the selected profile)")
    .option("--selection-profile <id>", "Authoritative selection profile")
    .option("--project", "Also pin the selection metadata in this project", false)
    .option("--json", "Output result as JSON", false)
    .description("Install verified API-selected bundles into the Skills CLI cache")
    .action((args: string[], options: { json: boolean; selectionProfile?: string; project: boolean }) => handleSelectedInstall(args, options));

  parent
    .command("pin")
    .argument("[skills...]", "Skills to pin")
    .option("-o, --overwrite", "Refresh existing pins", false)
    .option("--json", "Output results as JSON", false)
    .option("--dry-run", "Print what would happen without actually pinning", false)
    .option("--category <category>", "Pin all skills in a category (case-insensitive)")
    .option("--remote", "Pin skills from the remote registry (the resolved Skills credential; HASNA_SKILLS_API_URL for your own instance). Implied for name@version pins", false)
    .option("--selection-profile <id>", "Authoritative selection profile for exact version pins")
    .description("Pin skills in .skills/project.json without copying source")
    .action((skills: string[], options) => {
      void handlePin(skills, options).catch(handlePinError);
    });

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

async function handleSelectedInstall(args: string[], options: { json: boolean; selectionProfile?: string; project: boolean }) {
  if (!args.length) return handleProfileSync(options);
  try {
    const results = [];
    for (const spec of args) {
      const profileId = selectedProfileId(options.selectionProfile);
      const result = options.project
        ? await pinSelectedSkillVersion(spec, profileId, { projectDir: process.cwd() })
        : await loadSelectedSkill(spec, profileId);
      results.push({ success: true, selection: result.selection });
    }
    if (options.json) console.log(JSON.stringify({ results }));
    else for (const result of results) console.log(`Installed ${result.selection.slug}@${result.selection.version} (${result.selection.bundleDigest}).`);
  } catch (error) { reportContextError(error, options.json); }
}

function handleDeprecatedRemove(skill: string | undefined, options: { json: boolean }) {
  const error = skill
    ? "skills remove no longer unpins skills. Use: skills unpin <name>"
    : "Use: skills unpin <name>";
  if (options.json) console.log(JSON.stringify({ removed: false, error }));
  else console.error(chalk.red(error));
  process.exitCode = 1;
}

function handlePinError(error: unknown) {
  console.error(chalk.red((error as Error).message));
  process.exitCode = 1;
}

async function handlePin(skills: string[], options: any) {
  if (skills.length === 0 && !options.category) {
    const error = "missing required argument 'skills' or --category option";
    if (options.json) console.log(JSON.stringify({ error }));
    else console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }

  let remoteRegistry: SkillMeta[] | null = null;
  const access = await requireSkillsReadAccess();
  const useRemote = Boolean(options.remote) || access.mode === "hosted";
  if (options.category) {
    remoteRegistry = useRemote ? await loadRemoteRegistry() : null;
    const remoteSkills = remoteRegistry ?? [];
    const categories = useRemote
      ? [...new Set(remoteSkills.map((skill) => skill.category))].sort()
      : [...CATEGORIES];
    const matchedCategory = categories.find((c: string) => c.toLowerCase() === options.category.toLowerCase());
    if (!matchedCategory) {
      const error = `Unknown category: ${options.category}`;
      if (options.json) console.log(JSON.stringify({ error, available: categories }));
      else {
        console.error(error);
        console.error(`Available: ${categories.join(", ")}`);
      }
      process.exitCode = 1;
      return;
    }
    const categorySkills = useRemote
      ? remoteSkills.filter((skill) => skill.category === matchedCategory)
      : getSkillsByCategory(matchedCategory as (typeof CATEGORIES)[number]);
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
  if (useRemote && !remoteRegistry && skills.some((spec) => !splitNameVersion(spec).version)) remoteRegistry = await loadRemoteRegistry();
  const remoteByName = new Map((remoteRegistry ?? []).map((skill) => [skill.name, skill]));
  for (let i = 0; i < total; i++) {
    // `name@version` pins an exact published version (hasna/apps#1630); the pin record keeps it.
    const { name: pinName, version: pinnedVersion } = splitNameVersion(skills[i]);
    if (total > 1 && !options.json) process.stdout.write(`[${i + 1}/${total}] Pinning ${skills[i]}...`);
    const result = pinnedVersion
      ? await pinExactVersion(pinName, pinnedVersion, {
          // An exact version only exists on an instance: name@version implies the remote
          // fetch, so --remote is not required for it (hasna/apps#1671).
          useRemote: true,
          overwrite: options.overwrite,
          selectionProfile: options.selectionProfile,
        })
      : useRemote
        ? pinRemoteSkill(pinName, remoteByName, options.overwrite)
        : installSkill(pinName, { overwrite: options.overwrite });
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

function pinRemoteSkill(name: string, remoteByName: Map<string, SkillMeta>, overwrite: boolean): InstallResult {
  const skill = remoteByName.get(name);
  if (!skill) {
    return {
      skill: name,
      success: false,
      error: `Remote skill '${name}' not found`,
      mode: "pin",
      source: "remote",
    };
  }
  return installRemoteSkill(skill, { overwrite });
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

/**
 * `skills pin name@version` (hasna/apps#1630): the exact version is FETCHED, digest-verified,
 * and written to the machine corpus before the pin is recorded, so the project pin names a
 * version this machine actually holds. Without an instance there is nothing to fetch from,
 * and a pin that claims a version it never saw is refused rather than written.
 */
export async function pinExactVersion(
  name: string,
  version: string,
  options: { useRemote: boolean; overwrite: boolean; selectionProfile?: string; pull?: (spec: string) => Promise<{ success: boolean; version?: string; error?: string }> },
): Promise<InstallResult> {
  if (!options.useRemote) {
    return {
      skill: name,
      success: false,
      error: `Pinning '${name}@${version}' needs a configured Skills instance: an exact version only exists on an instance, so the fetch is implied for name@version pins (skills auth login, or HASNA_SKILLS_API_URL for your own instance).`,
      mode: "pin",
    };
  }
  const pull = options.pull ?? (async (spec: string) => {
    try {
      const result = await pinSelectedSkillVersion(spec, selectedProfileId(options.selectionProfile), { projectDir: process.cwd() });
      return { success: true, version: result.selection.version };
    } catch (error) {
      return { success: false, error: error instanceof SkillSelectionError ? error.message : "The exact skill selection could not be verified. Check authentication and the selected profile." };
    }
  });
  const pulled = await pull(`${name}@${version}`);
  if (!pulled.success) {
    return { skill: name, success: false, error: pulled.error ?? `could not fetch '${name}@${version}'`, mode: "pin", source: "remote" };
  }
  const already = new Set(listPinnedSkills());
  const normalized = normalizeSkillName(name);
  if (already.has(normalized) && !options.overwrite) {
    return { skill: name, success: false, error: "Already pinned. Use --overwrite to refresh.", path: getProjectConfigPath(), mode: "pin", source: "remote", version: pulled.version ?? version };
  }
  const recorded = pulled.version ?? version;
  pinProjectSkill(normalized, { version: recorded, source: "remote" });
  return { skill: name, success: true, path: getProjectConfigPath(), mode: "pin", source: "remote", version: recorded };
}
