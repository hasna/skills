import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join, normalize } from "path";

import { INSTALLED_SKILLS_DIRNAME, getDataDir } from "./config.js";
import { SKILLS } from "./registry-data/index.js";
import type { SkillKind, SkillMeta } from "./registry-types.js";
import {
  parseSkillFrontmatter,
  validateSkillDirectory,
  type SkillValidationMessage,
  type SkillValidationResult,
} from "./skill-validation.js";
import {
  copySkillDirectory,
  createInstructionManifest,
  createPortableManifest,
  displayName,
  ensureInstructionSkillFiles,
  ensurePortableSkillFiles,
  hasPackageDependencies,
  normalizePortableSkillName,
  parseSkillKind,
  readPortableSkillManifest,
  renderSkillJson,
  writeInstructionSkillTemplate,
  writePortableSkillTemplate,
} from "./portable-skills-files.js";
import type {
  BulkPortImportedEntry,
  BulkPortPortableSkillOptions,
  BulkPortResult,
  BulkPortSkippedEntry,
  PortableSkillManifest,
  PortableSkillOptions,
  PortableSkillRunOptions,
  PortableSkillRunResult,
  PortableSkillSummary,
  PortableSkillWriteResult,
  PortPortableSkillOptions,
  ScaffoldPortableSkillOptions,
} from "./portable-skills-types.js";
import {
  PORTABLE_SKILL_DEFAULT_VERSION,
  PORTABLE_SKILL_SCHEMA,
  PORTABLE_SKILL_STANDARD,
} from "./portable-skills-types.js";

export {
  normalizePortableSkillName,
  readPortableSkillManifest,
};
export * from "./portable-skills-types.js";

/**
 * Pre-`installed/` location of custom skills. Read only by the migration below;
 * it is not part of the corpus.
 */
const LEGACY_CUSTOM_DIRNAME = "custom";

/**
 * Resolve the corpus: the directory holding one folder per installed skill.
 *
 * Precedence is explicit-over-ambient, most specific first:
 *   1. `options.rootDir`  - the corpus, named outright (no `installed` suffix)
 *   2. `options.homeDir`  - <home>/.hasna/skills/installed
 *   3. `getDataDir()`     - <app folder>/installed, where the app folder is
 *                           $HASNA_SKILLS_DIR, else ~/.hasna/skills
 *
 * The app folder holds app data (config.json, skills.db, auth.json); the corpus
 * is a named subfolder of it, matching every sibling Hasna app. One variable
 * relocates the app folder and the corpus moves with it.
 *
 * `options.homeDir` used to sit *below* the $HASNA_SKILLS_DIR lookup, so an
 * ambient environment variable silently overrode an argument the caller had
 * passed deliberately - the caller could not target a directory at all once the
 * variable was set anywhere in the process. Reading the environment is now left
 * entirely to getDataDir(), so there is one place that knows the variable's name
 * and one rule for which source wins.
 */
export function getPortableSkillsRoot(options: PortableSkillOptions = {}): string {
  // rootDir names the corpus directly - it is not an app folder and gets no
  // `installed` suffix. Callers that hand over a directory of skill folders mean
  // exactly that directory.
  if (options.rootDir) return options.rootDir;
  const appDir = options.homeDir ? join(options.homeDir, ".hasna", "skills") : getDataDir();
  const installed = join(appDir, INSTALLED_SKILLS_DIRNAME);
  migrateLegacySkillLayout(appDir, installed);
  return installed;
}

/** True for a directory that carries any of the files a skill is identified by. */
function looksLikeSkillDirectory(path: string): boolean {
  if (!safeIsDirectory(path)) return false;
  return existsSync(join(path, "SKILL.md"))
    || existsSync(join(path, "skill.json"))
    || existsSync(join(path, "package.json"));
}

/**
 * Fold the two pre-`installed/` layouts into the corpus: skills written straight
 * into the app root, and the older `custom/` subfolder.
 *
 * Copies, never deletes - the same contract as getDataDir()'s ~/.skills merge,
 * and for the same reason: a half-finished migration must never be able to lose
 * a skill somebody wrote. Anything already present under installed/ is left
 * alone, which also makes this cheap to call on every resolution: once migrated,
 * every candidate short-circuits on the existence check and nothing is copied.
 *
 * Entries that are not directories, or that carry none of a skill's identifying
 * files, are left where they are. That is what keeps app data (config.json,
 * skills.db, auth.json) and anything unrecognised out of the corpus without
 * needing a denylist of known non-skills.
 */
function migrateLegacySkillLayout(appDir: string, installed: string): void {
  if (!safeIsDirectory(appDir)) return;

  const candidates: Array<{ from: string; name: string }> = [];
  try {
    for (const entry of readdirSync(appDir)) {
      if (entry.startsWith(".") || entry === INSTALLED_SKILLS_DIRNAME) continue;
      const path = join(appDir, entry);
      if (entry === LEGACY_CUSTOM_DIRNAME) {
        // The other half of the same mess: ~/.hasna/skills/custom/<name>/.
        if (!safeIsDirectory(path)) continue;
        try {
          for (const nested of readdirSync(path)) {
            if (nested.startsWith(".")) continue;
            const nestedPath = join(path, nested);
            if (looksLikeSkillDirectory(nestedPath)) candidates.push({ from: nestedPath, name: nested });
          }
        } catch {
          // Unreadable legacy dir: nothing to migrate from it.
        }
        continue;
      }
      if (looksLikeSkillDirectory(path)) candidates.push({ from: path, name: entry });
    }
  } catch {
    return;
  }

  for (const { from, name } of candidates) {
    const target = join(installed, name);
    if (existsSync(target)) continue;
    // Stage then rename, rather than copying straight to the target. A copy that
    // dies half way (out of space, permissions, interrupted) would otherwise
    // leave a partial skill at the target, and the existence check above would
    // treat it as migrated and never retry. The staging name is dot-prefixed so
    // that a leftover is skipped by the corpus listing.
    const staging = join(installed, `.migrating-${name}-${process.pid}`);
    try {
      rmSync(staging, { recursive: true, force: true });
      cpSync(from, staging, { recursive: true, errorOnExist: false });
      renameSync(staging, target);
    } catch {
      // Leave the original in place and carry on; a skill that cannot be copied
      // is still readable where it is, and the next resolution will retry.
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        // Nothing further to do.
      }
    }
  }
}

export function getPortableSkillPath(name: string, options: PortableSkillOptions = {}): string {
  return join(getPortableSkillsRoot(options), normalizePortableSkillName(name));
}

export function findPortableSkill(name: string, options: PortableSkillOptions = {}): PortableSkillSummary | null {
  let normalized: string;
  try {
    normalized = normalizePortableSkillName(name);
  } catch {
    return null;
  }
  const path = getPortableSkillPath(normalized, options);
  if (!existsSync(path) || !statSync(path).isDirectory()) return null;
  try {
    return summarizePortableSkill(path, normalized);
  } catch {
    return null;
  }
}

export function listPortableSkills(options: PortableSkillOptions = {}): PortableSkillSummary[] {
  const root = getPortableSkillsRoot(options);
  // Not existsSync: a root that exists but is a *file* passed that check and then
  // threw ENOTDIR out of readdirSync below, so `skills list`/`search`/`info` all
  // exited 1 when $HASNA_SKILLS_DIR named a file. Listing no skills is the right
  // answer for anything that is not a readable directory.
  if (!safeIsDirectory(root)) return [];
  const skills: PortableSkillSummary[] = [];
  for (const entry of readdirSync(root).sort()) {
    // Every directory under the corpus is a skill by construction, so there is no
    // denylist of app-data names to consult. Dotfiles are skipped as cheap
    // defence against editor and VCS droppings.
    if (entry.startsWith(".")) continue;
    const path = join(root, entry);
    if (!safeIsDirectory(path)) continue;
    try {
      skills.push(summarizePortableSkill(path, entry));
    } catch {
      continue;
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function listPortableSkillMetas(options: PortableSkillOptions = {}): SkillMeta[] {
  return listPortableSkills(options).map((skill) => {
    const manifest = readPortableSkillManifest(skill.path);
    return {
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    category: manifest.category || "Development Tools",
    tags: manifest.tags || ["custom"],
    version: skill.version,
    ...(manifest.kind ? { kind: manifest.kind } : {}),
    source: "custom" as const,
    };
  });
}


/** Bundled official skill slugs, used to guard against silent shadow imports. */
const OFFICIAL_SKILL_NAMES: ReadonlySet<string> = new Set(SKILLS.map((skill) => skill.name));

export function isOfficialSkillName(name: string): boolean {
  return OFFICIAL_SKILL_NAMES.has(name);
}

export function scaffoldPortableSkill(name: string, options: ScaffoldPortableSkillOptions = {}): PortableSkillWriteResult {
  const skillName = normalizePortableSkillName(name);
  const root = getPortableSkillsRoot(options);
  const skillPath = join(root, skillName);
  if (existsSync(skillPath)) {
    if (!options.overwrite) throw new Error(`Skill '${skillName}' already exists at ${skillPath}`);
    rmSync(skillPath, { recursive: true, force: true });
  }

  const kind: SkillKind = options.kind ?? "executable";
  const description = options.description ?? `${displayName(skillName)} skill`;

  if (kind === "instruction") {
    const manifest = createInstructionManifest(skillName, { description });
    writeInstructionSkillTemplate(skillPath, manifest);
    return { name: skillName, path: skillPath, manifest, created: true };
  }

  const manifest = createPortableManifest(skillName, { description });
  writePortableSkillTemplate(skillPath, manifest);
  return { name: skillName, path: skillPath, manifest, created: true };
}

/**
 * Import every immediate subfolder of a directory as a portable skill.
 * Skip-on-error by default: non-skill folders and per-skill failures are recorded
 * in the summary instead of aborting the whole run.
 */
export function portPortableSkillDirectory(
  sourceDir: string,
  options: BulkPortPortableSkillOptions = {},
): BulkPortResult {
  const absoluteSource = normalize(sourceDir);
  if (!existsSync(absoluteSource) || !statSync(absoluteSource).isDirectory()) {
    throw new Error(`Import directory not found: ${sourceDir}`);
  }

  const continueOnError = options.continueOnError ?? true;
  const portOptions: PortPortableSkillOptions = {
    overwrite: options.overwrite,
    ...(options.rootDir ? { rootDir: options.rootDir } : {}),
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
  };

  const imported: BulkPortImportedEntry[] = [];
  const skipped: BulkPortSkippedEntry[] = [];

  const entries = readdirSync(absoluteSource, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((entryName) => !entryName.startsWith("."))
    .sort();

  for (const entryName of entries) {
    const childPath = join(absoluteSource, entryName);
    if (!safeIsDirectory(childPath)) continue;
    if (!isSkillCandidate(childPath)) {
      skipped.push({
        sourcePath: childPath,
        reason: "Not a skill folder (missing SKILL.md, skill.json, and package.json)",
      });
      continue;
    }
    try {
      const result = portPortableSkill(childPath, portOptions);
      imported.push({ name: result.name, path: result.path, sourcePath: childPath });
    } catch (error) {
      if (!continueOnError) throw error;
      skipped.push({ sourcePath: childPath, reason: (error as Error).message });
    }
  }

  return {
    root: absoluteSource,
    total: imported.length + skipped.length,
    succeeded: imported.length,
    failed: skipped.length,
    imported,
    skipped,
  };
}

function isSkillCandidate(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md"))
    || existsSync(join(dir, "skill.json"))
    || existsSync(join(dir, "package.json"));
}

export function portPortableSkill(sourcePath: string, options: PortPortableSkillOptions = {}): PortableSkillWriteResult {
  const absoluteSource = normalize(sourcePath);
  if (!existsSync(absoluteSource) || !statSync(absoluteSource).isDirectory()) {
    throw new Error(`Skill source directory not found: ${sourcePath}`);
  }

  const inferred = readPortableSkillManifest(absoluteSource, basename(absoluteSource));
  const explicitName = options.name != null;
  const skillName = normalizePortableSkillName(options.name ?? inferred.name);

  // Guard: refuse to silently shadow a bundled official skill. An import whose
  // (possibly inferred) name collides with the official corpus would take
  // precedence over it in the registry, so require an explicit opt-in.
  if (isOfficialSkillName(skillName) && !options.allowShadow) {
    const sourceSlug = safeNormalizeName(basename(absoluteSource));
    const via = explicitName
      ? `Name '${skillName}' matches a bundled official skill.`
      : `Inferred name '${skillName}'${sourceSlug && sourceSlug !== skillName ? ` (from source folder '${basename(absoluteSource)}')` : ""} matches a bundled official skill.`;
    throw new Error(
      `${via} Importing it would shadow the official '${skillName}'. `
        + `Pass --name to choose a different name, or --allow-shadow to override deliberately.`,
    );
  }

  const root = getPortableSkillsRoot(options);
  const destination = join(root, skillName);
  if (existsSync(destination)) {
    if (!options.overwrite) throw new Error(`Skill '${skillName}' already exists at ${destination}`);
    rmSync(destination, { recursive: true, force: true });
  }

  mkdirSync(dirname(destination), { recursive: true });
  copySkillDirectory(absoluteSource, destination);

  const base = {
    ...inferred,
    name: skillName,
    displayName: inferred.displayName ?? displayName(skillName),
  };
  const manifest = inferred.kind === "instruction"
    ? ensureInstructionSkillFiles(destination, { ...base, kind: "instruction" })
    : ensurePortableSkillFiles(destination, base);
  return { name: skillName, path: destination, manifest, created: true };
}

function safeNormalizeName(name: string): string | undefined {
  try {
    return normalizePortableSkillName(name);
  } catch {
    return undefined;
  }
}

/** Metadata a Skills instance reports for a skill, used to fill the corpus manifest. */
export interface CorpusSkillMeta {
  displayName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
  kind?: SkillKind;
}

export interface WriteCorpusSkillInput {
  name: string;
  /** The SKILL.md document as served by the instance. Written verbatim. */
  skillMd: string;
  meta?: CorpusSkillMeta | null;
}

/**
 * Write a skill fetched from a Skills instance into the local corpus
 * (~/.hasna/skills/installed/<name>/), so loadRegistry() surfaces it to both the CLI
 * (`skills list --all`) and the MCP (`list_skills`) with no further step — the whole
 * point of the pull: the corpus is already a first-class registry source.
 *
 * SKILL.md is written verbatim: it is the agent-facing artifact and the registry's
 * frontmatter source. A canonical skill.json is written beside it so
 * listPortableSkillMetas() reports the right kind/category/tags/version even when the
 * fetched SKILL.md carries thin frontmatter.
 *
 * Idempotent: re-writing the same fetched bytes yields byte-identical files. It
 * overwrites SKILL.md and skill.json — the instance is the source of truth for a pulled
 * skill — but removes nothing else, so a re-pull never destroys sibling files.
 */
export function writeCorpusSkill(
  input: WriteCorpusSkillInput,
  options: PortableSkillOptions = {},
): PortableSkillWriteResult {
  const name = normalizePortableSkillName(input.name);
  const root = getPortableSkillsRoot(options);
  const skillPath = join(root, name);
  const created = !existsSync(skillPath);
  mkdirSync(skillPath, { recursive: true });

  const skillMd = input.skillMd.endsWith("\n") ? input.skillMd : `${input.skillMd}\n`;
  writeFileSync(join(skillPath, "SKILL.md"), skillMd);

  const frontmatter = parseSkillFrontmatter(input.skillMd) ?? undefined;
  // Carry the instance's kind when it reports one; else the SKILL.md frontmatter; else
  // "instruction", because a pulled skill has no local src/ and is consumed as prose
  // (runPortableSkill refuses to spawn an instruction skill, which is the safe answer
  // for a doc-only corpus entry).
  const kind: SkillKind = input.meta?.kind ?? parseSkillKind(frontmatter?.kind) ?? "instruction";
  const manifest: PortableSkillManifest = {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name,
    description: input.meta?.description ?? frontmatter?.description ?? `${displayName(name)} skill`,
    version: input.meta?.version ?? frontmatter?.version ?? PORTABLE_SKILL_DEFAULT_VERSION,
    displayName: input.meta?.displayName ?? frontmatter?.displayName ?? displayName(name),
    category: input.meta?.category ?? frontmatter?.category ?? "Development Tools",
    tags: input.meta?.tags?.length ? input.meta.tags : frontmatter?.tags ?? ["remote", name],
    kind,
    inputs: [],
    commands: [],
  };
  writeFileSync(join(skillPath, "skill.json"), renderSkillJson(manifest));

  return { name, path: skillPath, manifest, created };
}

export function validatePortableSkillDirectory(name: string, skillPath: string): SkillValidationResult {
  const normalizedName = normalizePortableSkillName(name);
  const base = validateSkillDirectory(normalizedName, skillPath);
  const issues: SkillValidationMessage[] = [...base.issues];
  const warnings: SkillValidationMessage[] = [...base.warnings];
  let manifest: PortableSkillManifest | undefined;

  if (existsSync(skillPath)) {
    const skillJsonPath = join(skillPath, "skill.json");
    const skillMdPath = join(skillPath, "SKILL.md");
    if (!existsSync(skillJsonPath) && !existsSync(skillMdPath)) {
      add(issues, "portable.manifest_missing", "Missing portable manifest: expected SKILL.md frontmatter and/or skill.json");
    }
    try {
      manifest = readPortableSkillManifest(skillPath, normalizedName);
      const isInstruction = manifest.kind === "instruction";
      if (manifest.name !== normalizedName) {
        add(issues, "portable.name_mismatch", `Portable manifest name '${manifest.name}' does not match '${normalizedName}'`);
      }
      if (manifest.standard !== PORTABLE_SKILL_STANDARD) {
        add(issues, "portable.standard_invalid", `Portable manifest standard must be '${PORTABLE_SKILL_STANDARD}'`);
      }
      if (!manifest.description.trim()) {
        add(issues, "portable.description_missing", "Portable manifest missing description");
      }
      if (!manifest.version.trim()) {
        add(issues, "portable.version_missing", "Portable manifest missing version");
      }
      // Instruction skills are SKILL.md-primary: no inputs, commands, or AGENTS.md required.
      if (!isInstruction && (!Array.isArray(manifest.inputs) || manifest.inputs.length === 0)) {
        add(issues, "portable.inputs_missing", "Portable manifest must declare inputs");
      }
      if (!isInstruction && (!Array.isArray(manifest.commands) || manifest.commands.length === 0)) {
        add(issues, "portable.commands_missing", "Portable manifest must declare at least one command");
      } else if (Array.isArray(manifest.commands)) {
        for (const command of manifest.commands) {
          if (!/^[a-z0-9][a-z0-9._-]*$/.test(command.name)) {
            add(issues, "portable.command_name_invalid", `Command '${command.name}' must use lowercase letters, numbers, dots, underscores, or hyphens`);
          }
          if (!command.entry && !command.command) {
            add(issues, "portable.command_target_missing", `Command '${command.name}' must declare entry or command`);
            continue;
          }
          if (command.entry) {
            if (!isSafeRelativePath(command.entry)) {
              add(issues, "portable.command_entry_unsafe", `Command '${command.name}' entry '${command.entry}' must stay inside the skill directory`);
              continue;
            }
            const entryPath = join(skillPath, command.entry);
            if (!existsSync(entryPath)) add(issues, "portable.command_entry_missing", `Command '${command.name}' entry '${command.entry}' is missing`);
            else if (statSync(entryPath).isDirectory()) add(issues, "portable.command_entry_directory", `Command '${command.name}' entry '${command.entry}' must be a file`);
          }
        }
      }
    } catch (error) {
      add(issues, "portable.manifest_invalid", (error as Error).message);
    }
    // Instruction skills use SKILL.md as the agent handoff; AGENTS.md is not required.
    if (manifest?.kind !== "instruction" && !existsSync(join(skillPath, "AGENTS.md"))) {
      add(issues, "portable.agents_missing", "Missing AGENTS.md with build-out instructions for coding agents");
    }
  }

  const sortedIssues = sortMessages(issues);
  const sortedWarnings = sortMessages(warnings);
  return {
    ...base,
    valid: sortedIssues.length === 0,
    issues: sortedIssues,
    warnings: sortedWarnings,
    metadata: {
      ...base.metadata,
      portableManifest: manifest,
    },
  };
}

export async function runPortableSkill(
  name: string,
  args: string[],
  options: PortableSkillRunOptions = {},
): Promise<PortableSkillRunResult> {
  const skill = findPortableSkill(name, options);
  if (!skill) return { exitCode: 1, error: `Portable skill '${name}' not found` };
  const manifest = readPortableSkillManifest(skill.path, skill.name);
  if (manifest.kind === "instruction") {
    return {
      exitCode: 1,
      error: `Portable skill '${name}' is an instruction skill (kind: instruction) and is not runnable. Instruction skills are consumed by coding agents via SKILL.md, not executed with 'skills run'.`,
    };
  }
  const command = manifest.commands[0];
  if (!command) return { exitCode: 1, error: `Portable skill '${name}' has no commands` };
  if (!command.entry) return { exitCode: 1, error: `Portable skill '${name}' command '${command.name}' has no entry` };
  if (!isSafeRelativePath(command.entry)) {
    return { exitCode: 1, error: `Portable skill '${name}' command entry is unsafe` };
  }

  const entryPath = join(skill.path, command.entry);
  if (!existsSync(entryPath)) {
    return { exitCode: 1, error: `Entry point '${command.entry}' not found in portable skill '${name}'` };
  }

  const pkgPath = join(skill.path, "package.json");
  const nodeModules = join(skill.path, "node_modules");
  if (existsSync(pkgPath) && !existsSync(nodeModules) && hasPackageDependencies(pkgPath)) {
    const install = Bun.spawn(["bun", "install", "--no-save"], {
      cwd: skill.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await install.exited;
  }

  const proc = Bun.spawn(["bun", "run", command.entry, ...args], {
    cwd: skill.path,
    stdout: options.stdio === "pipe" ? "pipe" : "inherit",
    stderr: options.stdio === "pipe" ? "pipe" : "inherit",
    stdin: "inherit",
    env: { ...process.env, ...options.env },
  });

  if (options.stdio === "pipe") {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  return { exitCode: await proc.exited };
}

function summarizePortableSkill(skillPath: string, fallbackName: string): PortableSkillSummary {
  const manifest = readPortableSkillManifest(skillPath, fallbackName);
  return {
    name: manifest.name,
    displayName: manifest.displayName ?? displayName(manifest.name),
    description: manifest.description,
    version: manifest.version,
    path: skillPath,
    commands: manifest.commands,
    source: "custom",
    standard: manifest.standard,
  };
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isSafeRelativePath(value: string): boolean {
  if (!value.trim() || isAbsolute(value)) return false;
  const normalized = normalize(value).replace(/\\/g, "/");
  return normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}

function add(target: SkillValidationMessage[], code: string, message: string): void {
  target.push({ code, message });
}

function sortMessages(messages: SkillValidationMessage[]): SkillValidationMessage[] {
  return [...messages].sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}
