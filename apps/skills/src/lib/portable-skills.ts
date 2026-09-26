import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "path";

import {
  INSTALLED_SKILLS_DIRNAME,
  SKILLS_CACHE_DIRNAME,
  getDataDir,
  getDataDirReadOnly,
  isOwnerLayoutMigrated,
} from "./config.js";
import { SKILLS } from "./registry-data/index.js";
import type { SkillKind, SkillMeta } from "./registry-types.js";
import { isHostedMetadataSkillDir } from "./hosted-skill-set.js";
import {
  parseSkillFrontmatter,
  validateSkillDirectory,
  type SkillValidationMessage,
  type SkillValidationResult,
} from "./skill-validation.js";
import { validatePortableManifestContract } from "./skill-contract.js";
import {
  copySkillDirectory,
  createInstructionManifest,
  createPortableManifest,
  displayName,
  ensureInstructionSkillFiles,
  ensurePortableSkillFiles,
  hasPackageDependencies,
  normalizeNewPortableSkillName,
  normalizePortableSkillName,
  parseSkillKind,
  readDeclaredSkillVersion,
  readPortableSkillManifest,
  readPortableSkillManifestForImport,
  writeInstructionSkillTemplate,
  writePortableSkillTemplate,
  writeSkillJsonWithHash,
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
import { assertPortableAuthoringPath } from "./authoring-path.js";
import {
  PORTABLE_SKILL_DEFAULT_VERSION,
  PORTABLE_SKILL_SCHEMA,
  PORTABLE_SKILL_STANDARD,
} from "./portable-skills-types.js";

export {
  normalizePortableSkillName,
  readDeclaredSkillVersion,
  readPortableSkillManifest,
};
export * from "./portable-skills-types.js";

/**
 * Resolve the corpus: the directory holding one folder per installed skill.
 *
 * THIS IS THE ONE CANONICAL CORPUS RESOLUTION. Every local discovery and
 * publish path — list, search, info, push, pull, sync, registry — reads the
 * corpus through this function (directly or via resolveCorpusRoot(), which
 * delegates here), so a migrated owner layout is never bypassed by a path that
 * still resolves installed/ (bug 170b0e9b: 'skills list --all' returned 87
 * entries while the migrated corpus held 688).
 *
 * Precedence is explicit-over-ambient, most specific first:
 *   1. `options.rootDir`      - the corpus, named outright (no suffix)
 *   2. the migrated owner layout - <app folder>/skills/ when a migration record
 *      exists there (the record is the authority; a skills/ directory someone
 *      created by hand is not the corpus)
 *   3. `getDataDir()`         - <app folder>/installed (pre-migration corpus,
 *      without importing any legacy directories), where the app folder is
 *      $HASNA_SKILLS_DIR, else ~/.hasna/skills
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
  return resolvePortableSkillsRoot(options, true);
}

/** Resolve an existing authoring corpus without creating or migrating directories. */
export function getPortableSkillsRootReadOnly(options: PortableSkillOptions = {}): string {
  return resolvePortableSkillsRoot(options, false);
}

function resolvePortableSkillsRoot(options: PortableSkillOptions, migrate: boolean): string {
  // rootDir names the corpus directly - it is not an app folder and gets no
  // `installed` suffix. Callers that hand over a directory of skill folders mean
  // exactly that directory.
  if (options.rootDir) return options.rootDir;
  const appDir = options.homeDir ? join(options.homeDir, ".hasna", "skills")
    : migrate ? getDataDir() : getDataDirReadOnly();
  const cache = join(appDir, SKILLS_CACHE_DIRNAME);
  if (isOwnerLayoutMigrated(appDir) && safeIsDirectory(cache)) return cache;
  const installed = join(appDir, INSTALLED_SKILLS_DIRNAME);
  return installed;
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
    // The server-owned marker is a property of the published contract
    // (package.json skills.runtime/skills.source), so it is derived from that
    // file rather than from skill.json.
    ...(isHostedMetadataSkillDir(skill.path) ? { serverOwned: true } : {}),
    };
  });
}


/** Bundled official skill slugs, used to guard against silent shadow imports. */
const OFFICIAL_SKILL_NAMES: ReadonlySet<string> = new Set(SKILLS.map((skill) => skill.name));

export function isOfficialSkillName(name: string): boolean {
  return OFFICIAL_SKILL_NAMES.has(name);
}

export function scaffoldPortableSkill(name: string, options: ScaffoldPortableSkillOptions = {}): PortableSkillWriteResult {
  const skillName = normalizeNewPortableSkillName(name);
  // Resolve read-only first.  A rejected native target must not allow the
  // writable resolver to create or migrate an app directory as a side effect.
  const readOnlyRoot = resolvePortableSkillsRoot(options, false);
  assertPortableAuthoringPath(join(readOnlyRoot, skillName), options);
  const root = getPortableSkillsRoot(options);
  const skillPath = join(root, skillName);
  assertPortableAuthoringPath(skillPath, options);
  if (existsSync(skillPath)) {
    if (!options.overwrite) throw new Error(`Skill '${skillName}' already exists at ${skillPath}`);
    rmSync(skillPath, { recursive: true, force: true });
  }

  // Creation records the selected template's kind in skill.json. Existing imported
  // kind-less sources keep their historical reading behavior; creating a new skill
  // must not lose the author's selection when it is later published.
  const kind: SkillKind = options.kind ?? "executable";
  const description = options.description ?? `${displayName(skillName)} skill`;

  if (kind === "instruction") {
    const manifest = createInstructionManifest(skillName, { description, category: options.category, tags: options.tags });
    writeInstructionSkillTemplate(skillPath, manifest);
    return { name: skillName, path: skillPath, manifest, created: true };
  }

  const manifest = createPortableManifest(skillName, { description, category: options.category, tags: options.tags });
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
    allowShadow: options.allowShadow,
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

// Resolve an absent destination through its nearest existing ancestor without
// creating it. This also detects aliases through symlinked parent directories.
function physicalImportPath(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    suffix.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return join(realpathSync(ancestor), ...suffix);
}

function assertDisjointImportPaths(source: string, destination: string): void {
  const sourcePath = realpathSync(source);
  const destinationPath = physicalImportPath(destination);
  const contains = (parent: string, child: string): boolean => {
    const path = relative(parent, child);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
  };
  if (contains(sourcePath, destinationPath) || contains(destinationPath, sourcePath)) {
    throw new Error("Source and destination skill directories must not overlap");
  }
}

export function portPortableSkill(sourcePath: string, options: PortPortableSkillOptions = {}): PortableSkillWriteResult {
  const absoluteSource = normalize(sourcePath);
  if (!existsSync(absoluteSource) || !statSync(absoluteSource).isDirectory()) {
    throw new Error(`Skill source directory not found: ${sourcePath}`);
  }

  const inferred = readPortableSkillManifestForImport(absoluteSource);
  const explicitName = options.name != null;
  const skillName = normalizeNewPortableSkillName(options.name ?? inferred.name);

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

  // Reject before corpus resolution can copy legacy skills or create app data.
  const readOnlyDestination = join(resolvePortableSkillsRoot(options, false), skillName);
  assertPortableAuthoringPath(readOnlyDestination, options);
  assertDisjointImportPaths(absoluteSource, readOnlyDestination);
  const root = getPortableSkillsRoot(options);
  const destination = join(root, skillName);
  assertPortableAuthoringPath(destination, options);
  // Migration may have materialized a previously absent path or alias.
  assertDisjointImportPaths(absoluteSource, destination);
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
  /**
   * The hosted registry's revision id for this skill (todos d061fcda), when the
   * instance reported one. Carried onto the metadata-only pull path so the pull marker
   * records which revision was installed there too.
   */
  revisionId?: string;
  /**
   * The row's SKILL.md, served in the published metadata so a client can recompute the
   * content-addressed revision id and PROVE the declared revision identifies the content
   * it received (todos d061fcda).
   */
  skillMd?: string;
  /**
   * The row's stored source (the payload's own `source` is always the client view
   * "remote"). The canonical revision hash is computed over the stored value, so the
   * client needs it to recompute the id.
   */
  publishedSource?: string;
}

export interface WriteCorpusSkillInput {
  name: string;
  /** The SKILL.md document as served by the instance. Written verbatim. */
  skillMd: string;
  meta?: CorpusSkillMeta | null;
}

/**
 * The corpus manifest for a pulled skill: SKILL.md frontmatter plus the instance's
 * reported metadata. Carry the instance's kind when it reports one; else the SKILL.md
 * frontmatter; else "instruction", because a pulled skill has no local src/ and is
 * consumed as prose (runPortableSkill refuses to spawn an instruction skill, which is
 * the safe answer for a doc-only corpus entry).
 */
function buildCorpusManifest(input: WriteCorpusSkillInput, name: string): PortableSkillManifest {
  const frontmatter = parseSkillFrontmatter(input.skillMd) ?? undefined;
  const kind: SkillKind = input.meta?.kind ?? parseSkillKind(frontmatter?.kind) ?? "instruction";
  return {
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
}

/**
 * Write a skill fetched from a Skills instance into the local corpus (the
 * canonical root — installed/ before the layout migration, <app folder>/skills/
 * after it), so loadRegistry() surfaces it to both the CLI
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
  const readOnlyRoot = resolvePortableSkillsRoot(options, false);
  assertPortableAuthoringPath(join(readOnlyRoot, name), options);
  const root = getPortableSkillsRoot(options);
  const skillPath = join(root, name);
  assertPortableAuthoringPath(skillPath, options);
  const created = !existsSync(skillPath);
  mkdirSync(skillPath, { recursive: true });

  // Verbatim, never normalized: the fetched document is a published artifact and the
  // hosted registry's revision is computed over its exact bytes (the row stores it
  // byte-for-byte). Appending a trailing newline would install bytes the recorded
  // revision does not identify — a pull must be able to prove which revision it
  // installed, which requires the installed bytes to BE the hashed bytes.
  writeFileSync(join(skillPath, "SKILL.md"), input.skillMd);

  const manifest = buildCorpusManifest(input, name);
  writeSkillJsonWithHash(skillPath, manifest);

  return { name, path: skillPath, manifest, created };
}

/**
 * Atomically replace the corpus entry for a metadata-only pull (todos b4d956a3):
 * stage SKILL.md and skill.json in a sibling directory, then rename into place — the
 * existing entry is moved aside first and removed only after the staged tree is in
 * position. A failure at any point leaves either the old entry or nothing — never a
 * partial skill, mirroring installBundleAtomically on the bundle path.
 *
 * The manifest construction is identical to writeCorpusSkill; what differs is that no
 * write ever lands in the live target before the swap. The direct-overwrite order of
 * writeCorpusSkill (SKILL.md, then skill.json) can destroy the prior good copy when a
 * mid-write failure (ENOSPC, EISDIR, crash) hits between the two writes, leaving a
 * truncated or mismatched SKILL.md/skill.json pair that loadRegistry then serves.
 */
export function installCorpusSkillAtomically(
  input: WriteCorpusSkillInput,
  options: PortableSkillOptions = {},
): PortableSkillWriteResult {
  const name = normalizePortableSkillName(input.name);
  const readOnlyRoot = resolvePortableSkillsRoot(options, false);
  assertPortableAuthoringPath(join(readOnlyRoot, name), options);
  const root = getPortableSkillsRoot(options);
  const target = join(root, name);
  assertPortableAuthoringPath(target, options);
  const created = !existsSync(target);
  mkdirSync(root, { recursive: true });
  const staging = mkdtempSync(join(root, `.pull-${name}-`));

  let moved = false;
  let backup: string | null = null;
  try {
    // Verbatim, never normalized: same contract as writeCorpusSkill — the hosted
    // registry's revision is computed over the exact fetched bytes.
    writeFileSync(join(staging, "SKILL.md"), input.skillMd);

    const manifest = buildCorpusManifest(input, name);
    writeSkillJsonWithHash(staging, manifest);

    if (existsSync(target)) {
      backup = mkdtempSync(join(root, `.pull-backup-${name}-`));
      renameSync(target, join(backup, name));
      moved = true;
    }
    renameSync(staging, target);
    if (moved && backup) rmSync(backup, { recursive: true, force: true });
    return { name, path: target, manifest, created };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (moved && backup && existsSync(join(backup, name))) {
      try {
        renameSync(join(backup, name), target);
      } catch {
        // The original remains in the backup dir; the target is either absent or
        // partial, and the error below names the staging path that failed.
      }
    }
    throw error;
  }
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
      // hasna.skill.v1 contract: schema fields, runtime contract, provenance,
      // and the self-referencing content_hash. The contract is strict whenever
      // a skill.json exists; SKILL.md-only legacy skills stay relaxed.
      const contractIssues = validatePortableManifestContract(manifest, {
        strict: existsSync(join(skillPath, "skill.json")),
        skillPath,
      });
      for (const issue of contractIssues) add(issues, issue.code, issue.message);
      // Consumer frontmatter is minimal (name + description), so `kind` lives
      // in skill.json. When the manifest declares kind: instruction, drop the
      // executable-only checks the frontmatter-derived base pass added.
      if (manifest.kind === "instruction") {
        const executableOnlyCodes = new Set([
          "package.missing",
          "package.bin_missing",
          "skill.src_missing",
          "skill.src_index_missing",
          "skill.runtime_entrypoint_unsafe",
          "skill.runtime_entrypoint_missing",
          "skill.runtime_entrypoint_symlink",
          "skill.runtime_entrypoint_not_file",
        ]);
        for (let i = issues.length - 1; i >= 0; i--) {
          if (executableOnlyCodes.has(issues[i]!.code)) issues.splice(i, 1);
        }
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
