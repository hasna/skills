import type { SkillKind } from "./registry-types.js";

export const PORTABLE_SKILL_STANDARD = "hasna.skill.v1";
export const PORTABLE_SKILL_SCHEMA = "https://hasna.dev/schemas/skill.v1.json";
export const PORTABLE_SKILL_DEFAULT_VERSION = "0.1.0";

/** Allowed execution runtimes in the hasna.skill.v1 runtime contract. */
export const SKILL_RUNTIMES = ["bun", "node", "python3"] as const;
export type SkillRuntimeName = (typeof SKILL_RUNTIMES)[number];

/** Allowed sandbox modes in the hasna.skill.v1 runtime contract. */
export const SKILL_SANDBOX_MODES = ["readonly-fs", "workspace-write", "full"] as const;
export type SkillSandboxMode = (typeof SKILL_SANDBOX_MODES)[number];

/**
 * Allowlisted system binaries a skill may declare. The allowlist lives here
 * and in schemas/skill.schema.json; the parity test keeps them in agreement.
 */
export const SKILL_SYSTEM_DEPS_ALLOWLIST = [
  "ffmpeg",
  "ffprobe",
  "imagemagick",
  "convert",
  "curl",
  "wget",
  "git",
  "gh",
  "jq",
  "python3",
  "pip3",
  "node",
  "bun",
  "npm",
  "rsync",
  "pdftotext",
  "tesseract",
  "7z",
  "unzip",
  "zip",
] as const;
export type SkillSystemDep = (typeof SKILL_SYSTEM_DEPS_ALLOWLIST)[number];

/**
 * Runtime contract (hasna.skill.v1): how the skill executes and what it may
 * touch. `env` carries secret REFERENCE names, never values.
 */
export interface PortableSkillRuntimeContract {
  runtime: SkillRuntimeName;
  /** Optional runtime version constraint, e.g. "22" or ">=3.12". */
  version?: string;
  /** Relative entrypoint; defaults to commands[0].entry. */
  entrypoint?: string;
  /** Max execution seconds, 1..900, default 900. */
  timeout?: number;
  /** Whether execution requires network egress, default false. */
  needs_network?: boolean;
  /** Secret reference names (uppercase identifiers), never values. */
  env?: string[];
  /** Filesystem access granted to execution, default readonly-fs. */
  sandbox?: SkillSandboxMode;
  /** Allowlisted system binaries required at execution time. */
  system_deps?: SkillSystemDep[];
  /** Glob patterns of artifacts the skill may produce. */
  artifacts?: string[];
}

/** Provenance and integrity fields. content_hash is self-referencing. */
export interface PortableSkillProvenance {
  /** Git SHA of the source revision, or "unknown" for local scaffolds. */
  source_commit?: string;
  /** Canonical SHA-256 of the normalized bundle (see skill-hash.ts). */
  content_hash?: string;
  /** Pointer to changelog / release notes (relative path or URL). */
  changelog?: string;
}

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
  runtime?: PortableSkillRuntimeContract;
  provenance?: PortableSkillProvenance;
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
  category?: string;
  tags?: string[];
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
  /** Explicitly permit imported names that shadow bundled official skills. */
  allowShadow?: boolean;
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
