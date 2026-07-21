import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join, normalize, relative } from "path";
import { homedir } from "os";

import { getDataDir } from "./config.js";
import { SKILLS } from "./registry-data/index.js";
import type { SkillKind, SkillMeta } from "./registry-types.js";
import {
  parseSkillFrontmatter,
  validateSkillDirectory,
  type SkillValidationMessage,
  type SkillValidationResult,
} from "./skill-validation.js";

export const PORTABLE_SKILL_STANDARD = "hasna.skill.v1";
export const PORTABLE_SKILL_SCHEMA = "https://hasna.dev/schemas/skill.v1.json";
export const PORTABLE_SKILL_DEFAULT_VERSION = "0.1.0";

/**
 * Artifact class of a portable skill.
 * - `executable`: a runnable skill folder (package.json + bin + src entry).
 * - `instruction`: a prose-only agent skill (SKILL.md primary, optional skill.json).
 *
 * Re-exports the canonical SkillKind (defined in registry-types) for existing consumers.
 */
export type { SkillKind };

export interface PortableSkillInput {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface PortableSkillCommand {
  name: string;
  description?: string;
  entry?: string;
  command?: string;
  args?: string[];
}

export interface PortableSkillManifest {
  $schema?: string;
  standard: typeof PORTABLE_SKILL_STANDARD | string;
  name: string;
  description: string;
  version: string;
  displayName?: string;
  category?: string;
  tags?: string[];
  kind?: SkillKind;
  inputs: PortableSkillInput[];
  commands: PortableSkillCommand[];
}

export interface PortableSkillSummary {
  name: string;
  displayName: string;
  description: string;
  version: string;
  path: string;
  commands: PortableSkillCommand[];
  source: "custom";
  standard: string;
}

export interface PortableSkillOptions {
  rootDir?: string;
  homeDir?: string;
}

export interface ScaffoldPortableSkillOptions extends PortableSkillOptions {
  description?: string;
  overwrite?: boolean;
  kind?: SkillKind;
}

export interface PortPortableSkillOptions extends PortableSkillOptions {
  name?: string;
  overwrite?: boolean;
  /**
   * Permit an imported skill name that shadows a bundled official skill.
   * Without this, `port` refuses to silently override the official corpus.
   */
  allowShadow?: boolean;
}

export interface BulkPortPortableSkillOptions extends PortableSkillOptions {
  overwrite?: boolean;
  /** When false, the first failure is rethrown. Defaults to true (skip-on-error). */
  continueOnError?: boolean;
}

export interface BulkPortImportedEntry {
  name: string;
  path: string;
  sourcePath: string;
}

export interface BulkPortSkippedEntry {
  sourcePath: string;
  name?: string;
  reason: string;
}

export interface BulkPortResult {
  root: string;
  total: number;
  succeeded: number;
  failed: number;
  imported: BulkPortImportedEntry[];
  skipped: BulkPortSkippedEntry[];
}

export interface PortableSkillWriteResult {
  name: string;
  path: string;
  manifest: PortableSkillManifest;
  created: boolean;
}

export interface PortableSkillRunOptions extends PortableSkillOptions {
  stdio?: "inherit" | "pipe";
  env?: Record<string, string>;
}

export interface PortableSkillRunResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  type?: unknown;
  bin?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
}

const DATA_DIR_NON_SKILL_ENTRIES = new Set([
  "auth.json",
  "config.json",
  "custom",
  "skills.db",
]);

// Structural / junk entries excluded at ANY depth of the source tree: VCS metadata,
// dependency trees, and macOS/agent sidecar dirs never belong in a portable skill.
const ANY_SEGMENT_COPY_EXCLUDES = new Set([
  ".git",
  ".DS_Store",
  ".system",
  "node_modules",
]);

// Build-output directories excluded only at the FIRST path segment (the skill root).
// A nested `references/build/` or `docs/dist/` is legitimate content and must survive.
const FIRST_SEGMENT_COPY_EXCLUDES = new Set([
  "dist",
  "build",
  ".turbo",
]);

const DEFAULT_INPUTS: PortableSkillInput[] = [
  {
    name: "args",
    type: "string[]",
    required: false,
    description: "Arguments passed after `skills run <name>`.",
  },
];

export function normalizePortableSkillName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`Invalid skill name '${name}'. Use letters, numbers, dots, underscores, or hyphens.`);
  }
  return normalized;
}

export function getPortableSkillsRoot(options: PortableSkillOptions = {}): string {
  if (options.rootDir) return options.rootDir;
  if (process.env["HASNA_SKILLS_DIR"]) return process.env["HASNA_SKILLS_DIR"]!;
  if (options.homeDir) return join(options.homeDir, ".hasna", "skills");
  return getDataDir();
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
  if (!hasDiscoverablePortableSkillMarker(path, normalized)) return null;
  try {
    return summarizePortableSkill(path, normalized);
  } catch {
    return null;
  }
}

export function listPortableSkills(options: PortableSkillOptions = {}): PortableSkillSummary[] {
  const root = getPortableSkillsRoot(options);
  if (!existsSync(root)) return [];
  const skills: PortableSkillSummary[] = [];
  for (const entry of readdirSync(root).sort()) {
    if (entry.startsWith(".") || DATA_DIR_NON_SKILL_ENTRIES.has(entry)) continue;
    const path = join(root, entry);
    if (!safeIsDirectory(path)) continue;
    if (!hasDiscoverablePortableSkillMarker(path, entry)) continue;
    try {
      skills.push(summarizePortableSkill(path, entry));
    } catch {
      continue;
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discovery must not turn an arbitrary data directory into a custom skill.
 * Keep the accepted marker set intentionally smaller than the importer's
 * repairable input set: discovery is ambient and may shadow bundled skills,
 * while `port` is an explicit operation with its own collision policy.
 */
function hasDiscoverablePortableSkillMarker(skillPath: string, directoryName: string): boolean {
  const expectedName = safeNormalizeName(directoryName);
  if (!expectedName) return false;

  const skillMdPath = join(skillPath, "SKILL.md");
  if (existsSync(skillMdPath)) {
    try {
      const frontmatter = parseSkillFrontmatter(readFileSync(skillMdPath, "utf-8"));
      if (
        safeNormalizeName(frontmatter?.name ?? "") === expectedName
        && Boolean(frontmatter?.description?.trim())
      ) return true;
    } catch {
      // A different valid marker below may still make this a portable skill.
    }
  }

  const skillJsonPath = join(skillPath, "skill.json");
  if (existsSync(skillJsonPath)) {
    try {
      const manifest = readJsonObject(skillJsonPath);
      if (
        stringField(manifest, "standard") === PORTABLE_SKILL_STANDARD
        && safeNormalizeName(stringField(manifest, "name") ?? "") === expectedName
        && Boolean(stringField(manifest, "description"))
        && Boolean(stringField(manifest, "version"))
      ) return true;
    } catch {
      // A different valid marker below may still make this a portable skill.
    }
  }

  const packageJsonPath = join(skillPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = readJsonObject(packageJsonPath) as PackageJson;
      if (
        safeNormalizeName(stringValue(pkg.name) ?? "") === expectedName
        && Boolean(stringValue(pkg.description))
        && Boolean(stringValue(pkg.version))
        && Boolean(inferPackageCommands(pkg, expectedName)?.length)
      ) return true;
    } catch {
      // Malformed package metadata is not an ambient discovery marker.
    }
  }

  return false;
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
    pricing: {
      tier: "free",
      billingUnit: "run",
      costCents: 0,
      formattedCost: "free",
      estimated: false,
      quoteDependsOnInput: false,
      quoteRequired: false,
      description: "Local portable skill",
    },
    };
  });
}

export function readPortableSkillManifest(skillPath: string, fallbackName = basename(skillPath)): PortableSkillManifest {
  const skillJsonPath = join(skillPath, "skill.json");
  const skillMdPath = join(skillPath, "SKILL.md");
  const pkgPath = join(skillPath, "package.json");

  const jsonManifest = existsSync(skillJsonPath) ? readJsonObject(skillJsonPath) : undefined;
  const frontmatter = existsSync(skillMdPath) ? parseSkillFrontmatter(readFileSync(skillMdPath, "utf-8")) ?? undefined : undefined;
  const pkg = existsSync(pkgPath) ? readJsonObject(pkgPath) as PackageJson : undefined;

  const name = normalizePortableSkillName(
    stringField(jsonManifest, "name")
      ?? frontmatter?.name
      ?? stringValue(pkg?.name)
      ?? fallbackName,
  );
  const description = stringField(jsonManifest, "description")
    ?? frontmatter?.description
    ?? stringValue(pkg?.description)
    ?? `${name} skill`;
  const version = stringField(jsonManifest, "version")
    ?? frontmatter?.version
    ?? stringValue(pkg?.version)
    ?? PORTABLE_SKILL_DEFAULT_VERSION;
  const kind = parseSkillKind(stringField(jsonManifest, "kind") ?? frontmatter?.kind);
  const commands = parseManifestCommands(jsonManifest)
    ?? (kind === "instruction" ? [] : inferPackageCommands(pkg, name))
    ?? [];

  return {
    $schema: stringField(jsonManifest, "$schema") ?? PORTABLE_SKILL_SCHEMA,
    standard: stringField(jsonManifest, "standard") ?? PORTABLE_SKILL_STANDARD,
    name,
    description,
    version,
    displayName: stringField(jsonManifest, "displayName") ?? frontmatter?.displayName ?? displayName(name),
    category: stringField(jsonManifest, "category") ?? frontmatter?.category ?? "Development Tools",
    tags: stringArrayField(jsonManifest, "tags") ?? frontmatter?.tags ?? ["custom"],
    ...(kind ? { kind } : {}),
    inputs: kind === "instruction" ? (parseManifestInputs(jsonManifest) ?? []) : (parseManifestInputs(jsonManifest) ?? DEFAULT_INPUTS),
    commands,
  };
}

function parseSkillKind(value: string | undefined): SkillKind | undefined {
  if (value === "executable" || value === "instruction") return value;
  return undefined;
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

function createInstructionManifest(name: string, options: { description: string }): PortableSkillManifest {
  return {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name,
    description: options.description,
    version: PORTABLE_SKILL_DEFAULT_VERSION,
    displayName: displayName(name),
    category: "Development Tools",
    tags: ["custom", name],
    kind: "instruction",
    inputs: [],
    commands: [],
  };
}

function writeInstructionSkillTemplate(skillPath: string, manifest: PortableSkillManifest): void {
  mkdirSync(skillPath, { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), renderInstructionSkillMd(manifest));
  writeFileSync(join(skillPath, "skill.json"), renderSkillJson(manifest));
}

function renderInstructionSkillMd(manifest: PortableSkillManifest): string {
  const tags = manifest.tags?.length
    ? `tags:\n${manifest.tags.map((tag) => `  - ${tag}`).join("\n")}\n`
    : "";
  return `---\nname: ${manifest.name}\ndescription: ${manifest.description}\nkind: instruction\nversion: ${manifest.version}\nsource: custom\ncategory: ${manifest.category ?? "Development Tools"}\n${tags}---\n\n# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n\n## Instructions\n\nWrite the agent-facing prose for this skill here. Instruction skills are consumed\nby agents through skill renderers and MCP docs; they are not executed locally.\n`;
}

function createPortableManifest(name: string, options: { description: string }): PortableSkillManifest {
  return {
    $schema: PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name,
    description: options.description,
    version: PORTABLE_SKILL_DEFAULT_VERSION,
    displayName: displayName(name),
    category: "Development Tools",
    tags: ["custom", name],
    inputs: DEFAULT_INPUTS,
    commands: [{
      name,
      description: `Run ${displayName(name)}.`,
      entry: "src/index.ts",
      args: ["...args"],
    }],
  };
}

function writePortableSkillTemplate(skillPath: string, manifest: PortableSkillManifest): void {
  mkdirSync(join(skillPath, "src"), { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(manifest));
  writeFileSync(join(skillPath, "skill.json"), renderSkillJson(manifest));
  writeFileSync(join(skillPath, "AGENTS.md"), renderAgentsMd(manifest));
  writeFileSync(join(skillPath, "package.json"), renderPackageJson(manifest));
  writeFileSync(join(skillPath, "tsconfig.json"), renderTsconfig());
  writeFileSync(join(skillPath, "src", "index.ts"), renderEntrypoint(manifest));
}

function ensurePortableSkillFiles(skillPath: string, manifest: PortableSkillManifest): PortableSkillManifest {
  let next = manifest;
  if (!next.commands.length) {
    next = {
      ...next,
      commands: [{
        name: next.name,
        description: `Run ${displayName(next.name)}.`,
        entry: "src/index.ts",
        args: ["...args"],
      }],
    };
  }
  if (!next.inputs.length) next = { ...next, inputs: DEFAULT_INPUTS };
  next = {
    ...next,
    standard: PORTABLE_SKILL_STANDARD,
    $schema: next.$schema ?? PORTABLE_SKILL_SCHEMA,
    displayName: next.displayName ?? displayName(next.name),
    category: next.category ?? "Development Tools",
    tags: next.tags?.length ? next.tags : ["custom", next.name],
  };

  const entry = next.commands[0]?.entry ?? "src/index.ts";
  if (entry && !existsSync(join(skillPath, entry))) {
    mkdirSync(dirname(join(skillPath, entry)), { recursive: true });
    writeFileSync(join(skillPath, entry), renderEntrypoint(next));
  }
  if (!existsSync(join(skillPath, "SKILL.md"))) writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(next));
  else writeFileSync(join(skillPath, "SKILL.md"), ensureSkillMdFrontmatter(readFileSync(join(skillPath, "SKILL.md"), "utf-8"), next));
  if (!existsSync(join(skillPath, "skill.json"))) writeFileSync(join(skillPath, "skill.json"), renderSkillJson(next));
  if (!existsSync(join(skillPath, "AGENTS.md"))) writeFileSync(join(skillPath, "AGENTS.md"), renderAgentsMd(next));
  ensurePackageJson(skillPath, next);
  if (!existsSync(join(skillPath, "tsconfig.json"))) writeFileSync(join(skillPath, "tsconfig.json"), renderTsconfig());
  return readPortableSkillManifest(skillPath, next.name);
}

function ensurePackageJson(skillPath: string, manifest: PortableSkillManifest): void {
  const pkgPath = join(skillPath, "package.json");
  const first = manifest.commands[0] ?? { name: manifest.name, entry: "src/index.ts" };
  const commandName = normalizePortableSkillName(first.name || manifest.name);
  const entry = (first.entry ?? "src/index.ts").replace(/^\.\//, "");

  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, renderPackageJson(manifest));
    return;
  }

  const existing = readJsonObject(pkgPath) as PackageJson;
  const bin: Record<string, string> = {};
  if (isRecord(existing.bin)) {
    for (const [name, value] of Object.entries(existing.bin)) {
      if (typeof value === "string" && value.trim()) bin[normalizePortableSkillName(name)] = value.replace(/^\.\//, "");
    }
  } else {
    const binEntry = stringValue(existing.bin);
    if (binEntry) bin[manifest.name] = binEntry.replace(/^\.\//, "");
  }
  bin[commandName] = entry;

  const scripts = isRecord(existing.scripts) ? { ...existing.scripts } : {};
  if (!stringValue(scripts.dev)) scripts.dev = `bun run ${entry}`;

  writeFileSync(pkgPath, `${JSON.stringify({
    ...existing,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    type: stringValue(existing.type) ?? "module",
    bin,
    scripts,
  }, null, 2)}\n`);
}

/**
 * Instruction (prose) skills are consumed by agent renderers/MCP docs, not run
 * locally, so `port` must never fabricate executable stubs (package.json, bin,
 * src/index.ts, tsconfig.json, AGENTS.md). It keeps the copied SKILL.md verbatim
 * and writes a minimal skill.json declaring `kind: "instruction"`.
 */
function ensureInstructionSkillFiles(skillPath: string, manifest: PortableSkillManifest): PortableSkillManifest {
  const next: PortableSkillManifest = {
    ...manifest,
    kind: "instruction",
    standard: PORTABLE_SKILL_STANDARD,
    $schema: manifest.$schema ?? PORTABLE_SKILL_SCHEMA,
    displayName: manifest.displayName ?? displayName(manifest.name),
    category: manifest.category ?? "Development Tools",
    tags: manifest.tags?.length ? manifest.tags : ["custom", manifest.name],
    inputs: [],
    commands: [],
  };

  // SKILL.md is the agent handoff artifact and is kept exactly as copied. Only
  // synthesize one if the source somehow lacked it.
  if (!existsSync(join(skillPath, "SKILL.md"))) {
    writeFileSync(join(skillPath, "SKILL.md"), renderSkillMd(next));
  }
  writeFileSync(join(skillPath, "skill.json"), renderInstructionSkillJson(next));
  return readPortableSkillManifest(skillPath, next.name);
}

function copySkillDirectory(source: string, destination: string): void {
  // A source folder can itself be a symlink (e.g. agent skill dirs full of
  // `impeccable-*` symlinks). cpSync would try to recreate the symlink over the
  // freshly-created destination directory and crash, so resolve it first.
  const resolvedSource = lstatSync(source).isSymbolicLink() ? realpathSync(source) : source;
  mkdirSync(destination, { recursive: true });
  cpSync(resolvedSource, destination, {
    recursive: true,
    filter: (src) => {
      const rel = relative(resolvedSource, src);
      if (!rel) return true;
      const segments = rel.split(/[\\/]/);
      for (let i = 0; i < segments.length; i++) {
        if (isExcludedCopyEntry(segments[i]!, i === 0)) return false;
      }
      // Skip nested symlinks: agent corpora often symlink shared skills, and a
      // dangling link would break the copy.
      if (lstatSync(src).isSymbolicLink()) return false;
      return true;
    },
  });
}

function isExcludedCopyEntry(name: string, isFirstSegment: boolean): boolean {
  if (ANY_SEGMENT_COPY_EXCLUDES.has(name)) return true;
  // Build output only counts as junk at the skill root; nested copies are real content.
  if (isFirstSegment && FIRST_SEGMENT_COPY_EXCLUDES.has(name)) return true;
  // AppleDouble sidecar files (`._SKILL.md`, `._foo`) written by macOS — any depth.
  if (name.startsWith("._")) return true;
  return false;
}

function renderSkillMd(manifest: PortableSkillManifest): string {
  const tags = manifest.tags?.length
    ? `tags:\n${manifest.tags.map((tag) => `  - ${tag}`).join("\n")}\n`
    : "";
  return `---\nname: ${manifest.name}\ndescription: ${manifest.description}\nversion: ${manifest.version}\nsource: custom\ncategory: ${manifest.category ?? "Development Tools"}\n${tags}---\n\n# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n\n## Usage\n\n\`\`\`bash\nskills run ${manifest.name} --help\n\`\`\`\n`;
}

function renderSkillJson(manifest: PortableSkillManifest): string {
  return `${JSON.stringify({
    $schema: manifest.$schema ?? PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    displayName: manifest.displayName ?? displayName(manifest.name),
    category: manifest.category ?? "Development Tools",
    tags: manifest.tags ?? ["custom", manifest.name],
    ...(manifest.kind ? { kind: manifest.kind } : {}),
    inputs: manifest.inputs,
    commands: manifest.commands,
  }, null, 2)}\n`;
}

function renderInstructionSkillJson(manifest: PortableSkillManifest): string {
  return `${JSON.stringify({
    $schema: manifest.$schema ?? PORTABLE_SKILL_SCHEMA,
    standard: PORTABLE_SKILL_STANDARD,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    displayName: manifest.displayName ?? displayName(manifest.name),
    category: manifest.category ?? "Development Tools",
    tags: manifest.tags ?? ["custom", manifest.name],
    kind: "instruction",
  }, null, 2)}\n`;
}

function renderPackageJson(manifest: PortableSkillManifest): string {
  const first = manifest.commands[0] ?? { name: manifest.name, entry: "src/index.ts" };
  return `${JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    type: "module",
    bin: { [first.name]: first.entry ?? "src/index.ts" },
    scripts: { dev: `bun run ${first.entry ?? "src/index.ts"}` },
    dependencies: {},
  }, null, 2)}\n`;
}

function renderTsconfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      outDir: "dist",
    },
    include: ["src/**/*.ts"],
  }, null, 2)}\n`;
}

function renderEntrypoint(manifest: PortableSkillManifest): string {
  return `#!/usr/bin/env bun\n\nconst args = process.argv.slice(2);\n\nif (args.includes("--help") || args.includes("-h")) {\n  console.log("${manifest.name}");\n  console.log("");\n  console.log("${escapeJsString(manifest.description)}");\n  console.log("");\n  console.log("Usage: skills run ${manifest.name} [args...]");\n  process.exit(0);\n}\n\nconsole.log(JSON.stringify({\n  skill: "${manifest.name}",\n  args,\n}, null, 2));\n`;
}

function renderAgentsMd(manifest: PortableSkillManifest): string {
  const command = manifest.commands[0];
  const entry = command?.entry ?? "src/index.ts";
  return `# Agent Build Instructions: ${manifest.name}\n\nThis folder is a portable @hasna/skills skill. Build it in place and keep it valid against the portable skill standard.\n\n## Contract\n\n- Skill name: \`${manifest.name}\`\n- Description: ${manifest.description}\n- Manifest files: \`SKILL.md\` frontmatter and \`skill.json\`\n- Runtime entrypoint: \`${entry}\`\n- User command: \`skills run ${manifest.name} [args]\`\n\n## Build Rules\n\n1. Put executable logic in \`${entry}\` or files imported by it.\n2. Keep \`skill.json\` updated when inputs, commands, or version change.\n3. Keep \`SKILL.md\` concise and compatible with Codewith-style skill frontmatter: \`name\`, \`description\`, \`version\`, optional \`category\`, and optional \`tags\`.\n4. Add tests under \`tests/\` when behavior is non-trivial, then run \`bun test\` from this folder if tests exist.\n5. Verify with \`skills validate ${manifest.name}\` and smoke-test with \`skills run ${manifest.name} --help\`.\n6. Do not commit secrets, generated credentials, \`.env\`, \`node_modules\`, or build output.\n`;
}

function ensureSkillMdFrontmatter(content: string, manifest: PortableSkillManifest): string {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
  const generated = renderSkillMd(manifest);
  const frontmatter = generated.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0] ?? "";
  return `${frontmatter}\n\n${body || `# ${manifest.displayName ?? displayName(manifest.name)}\n\n${manifest.description}\n`}`;
}

function parseManifestCommands(value: Record<string, unknown> | undefined): PortableSkillCommand[] | undefined {
  const raw = value?.commands;
  if (!Array.isArray(raw)) return undefined;
  const commands = raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const name = stringValue(item.name);
      if (!name) return null;
      return {
        name: normalizePortableSkillName(name),
        ...(stringValue(item.description) ? { description: stringValue(item.description) } : {}),
        ...(stringValue(item.entry) ? { entry: stringValue(item.entry) } : {}),
        ...(stringValue(item.command) ? { command: stringValue(item.command) } : {}),
        ...(Array.isArray(item.args) ? { args: item.args.filter((arg): arg is string => typeof arg === "string") } : {}),
      } satisfies PortableSkillCommand;
    })
    .filter((item): item is PortableSkillCommand => item !== null);
  return commands.length ? commands : undefined;
}

function parseManifestInputs(value: Record<string, unknown> | undefined): PortableSkillInput[] | undefined {
  const raw = value?.inputs;
  if (!Array.isArray(raw)) return undefined;
  const inputs = raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const name = stringValue(item.name);
      const type = stringValue(item.type);
      if (!name || !type) return null;
      return {
        name,
        type,
        ...(typeof item.required === "boolean" ? { required: item.required } : {}),
        ...(stringValue(item.description) ? { description: stringValue(item.description) } : {}),
      } satisfies PortableSkillInput;
    })
    .filter((item): item is PortableSkillInput => item !== null);
  return inputs.length ? inputs : undefined;
}

function inferPackageCommands(pkg: PackageJson | undefined, fallbackName: string): PortableSkillCommand[] | undefined {
  if (!pkg) return undefined;
  if (isRecord(pkg.bin)) {
    const commands = Object.entries(pkg.bin)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
      .map(([name, entry]) => ({
        name: normalizePortableSkillName(name),
        entry: entry.replace(/^\.\//, ""),
        description: `Run ${displayName(fallbackName)}.`,
      }));
    if (commands.length) return commands;
  }
  const scripts = isRecord(pkg.scripts) ? pkg.scripts : undefined;
  const dev = stringValue(scripts?.dev);
  const match = dev?.match(/(?:bun\s+run\s+|bun\s+)([^ ]+)/);
  if (match?.[1]) {
    return [{ name: fallbackName, entry: match[1].replace(/^\.\//, ""), description: `Run ${displayName(fallbackName)}.` }];
  }
  return undefined;
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (!isRecord(parsed)) throw new Error(`${basename(path)} must contain a JSON object`);
  return parsed;
}

function hasPackageDependencies(pkgPath: string): boolean {
  try {
    const pkg = readJsonObject(pkgPath) as PackageJson;
    const deps = isRecord(pkg.dependencies) ? Object.keys(pkg.dependencies) : [];
    return deps.length > 0;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return stringValue(value?.[key]);
}

function stringArrayField(value: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const raw = value?.[key];
  if (!Array.isArray(raw)) return undefined;
  const strings = raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length ? strings : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function displayName(name: string): string {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
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

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}
