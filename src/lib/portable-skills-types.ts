import type { SkillKind } from "./registry-types.js";

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

