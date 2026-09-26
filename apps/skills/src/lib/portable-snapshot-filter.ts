/**
 * Portable-content filter shared by the per-station snapshot (`skills sync
 * --station`) and the dedup hydration (`skills hydrate`) commands.
 *
 * Ported from hasna-internal/fleet-resources scripts/sync-skills.mjs (producer
 * v3-2026-08-15) and scripts/hydrate-cache.mjs (v1-2026-08-15) under the
 * package-abstractions rule (todos FLE-00037): a repeated local script invoked
 * by a recurring workflow moves into the owning package. Both scripts carried
 * an identical copy of this filter — the snapshot writer and the hydrator must
 * answer "which files of an installed skill home may reach a shared snapshot"
 * the same way — so it lives here in one place instead of being duplicated
 * again.
 *
 * The refusals below are fleet conformance data carried into the package
 * (recorded 2026-08-14, shield secrets scan, blocking severity; re-verified
 * 2026-08-15 — see the source script's comment for the classification). They
 * stay until the placeholder scrub (todos c2769468) retires them.
 */
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import type { SyncAgent } from "./agent-sync.js";
import { skillsDataRootForHome } from "./app-home.js";

/** A snapshot source: one directory of installed skills. */
export interface SyncHomeDefinition {
  /** Directory name used in the snapshot destination and reporting. */
  name: string;
  /** Snapshot category: the standalone stores, or one of the agent homes. */
  subClass: "skills" | "custom" | "agent-homes";
  /** The coding agent whose home this is, when subClass is agent-homes. */
  agent: SyncAgent | null;
}

/** The seven installed skill homes the per-station snapshot covers. */
export const SYNC_HOMES: readonly SyncHomeDefinition[] = [
  { name: "skills", subClass: "skills", agent: null },
  { name: "custom", subClass: "custom", agent: null },
  { name: "claude", subClass: "agent-homes", agent: "claude" },
  { name: "codewith", subClass: "agent-homes", agent: "codewith" },
  { name: "codex", subClass: "agent-homes", agent: "codex" },
  { name: "opencode", subClass: "agent-homes", agent: "opencode" },
  { name: "cursor", subClass: "agent-homes", agent: "cursor" }
];

const EXCLUDE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".cache",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache"
]);

const EXCLUDE_DIR_PATTERNS = [
  /^\.merge-pr\.rollback-/
];

const EXCLUDE_FILE_NAMES = new Set([
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock"
]);

const EXCLUDE_FILE_PATTERNS = [
  /^\._/,
  /\.bak$/,
  /\.orig$/,
  /\.rej$/,
  /~$/,
  /\.pyc$/,
  /\.pyo$/,
  /\.log$/,
  /\.db$/,
  /\.sqlite(\d)?$/,
  /^bun\.lock/,
  /\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^credentials/
];

const PORTABLE_TOP_LEVEL = new Set(["SKILL.md", "skill.json"]);
const PORTABLE_SUBDIRS = new Set(["scripts", "assets", "references"]);

/**
 * Scanner-flagged portable files the fleet conformance gate refuses. They are
 * absent from the snapshots by construction; the check stays as defense in
 * depth. See the header comment for the provenance and retirement path.
 */
export const REFUSED_SCANNER_FLAGGED = new Set([
  "aws-cross-account-app-migration/SKILL.md",
  "aws-cross-account-app-migration/scripts/selftest.sh",
  "gateway-serve/SKILL.md",
  "infinity-drain/SKILL.md",
  "infinity-run/SKILL.md",
  "oss-saas-code-cleanup/SKILL.md",
  "repo-project-familiarization/scripts/repo_shape.py",
  "repo-project-familiarization/scripts/session_history.py",
  "scale-check/SKILL.md",
  "standard-align-repo/SKILL.md",
  "standard-build-iapp/SKILL.md",
  "standard-build-oss/SKILL.md",
  "skill-image/SKILL.md",
  "skill-scale-check/SKILL.md",
  "sqlite-to-rds-parity-migrate/scripts/parity-migrate.ts",
  "pdf-operations/scripts/pdf_ops.py"
]);

export function isExcludedSkillFileName(fileName: string): boolean {
  if (EXCLUDE_FILE_NAMES.has(fileName)) {
    return true;
  }
  return EXCLUDE_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * The portable filter: only files at `<ident>/SKILL.md`, `<ident>/skill.json`,
 * and `<ident>/scripts|assets|references/*` may reach a snapshot or the cache.
 */
export function isPortableWithinSkill(relativeParts: string[]): boolean {
  if (relativeParts.length < 2) {
    return false;
  }
  const [, second] = relativeParts;
  if (PORTABLE_TOP_LEVEL.has(second)) {
    return relativeParts.length === 2;
  }
  if (relativeParts.length < 3) {
    return false;
  }
  return PORTABLE_SUBDIRS.has(second);
}

/**
 * The on-disk location of one of the seven snapshot homes. `homesRoot` stages
 * a copy of the homes (e.g. an rsync'd mirror of a remote station); when
 * absent, this machine's real `$HOME` is the root. The staged layout mirrors
 * the home mapping: `<dir>/skills`, `<dir>/<agent>/skills`,
 * `<dir>/opencode/skills`.
 */
export function homePathFor(
  definition: SyncHomeDefinition,
  homesRoot?: string
): string {
  const home = homesRoot ?? homedir();
  if (definition.subClass === "skills" || definition.subClass === "custom") {
    // The skills corpus homes live under the skills app data root, resolved
    // through @hasna/paths with the same gated legacy adoption the runtime uses
    // (app-home.skillsDataRootForHome): the XDG data home once the store has
    // migrated there, else the legacy ~/.hasna/skills.
    return join(skillsDataRootForHome(home), definition.name);
  }
  if (definition.agent === "opencode") {
    return join(home, ".config", "opencode", "skills");
  }
  return join(home, `.${definition.agent}`, "skills");
}

/** Snapshot destination inside the repo, relative to the repo root. */
export function destinationFor(
  definition: SyncHomeDefinition,
  stationId: string,
  relativePath: string
): string {
  const category = definition.subClass === "agent-homes"
    ? join("agent-homes", definition.agent ?? "")
    : definition.name;
  return join(
    "resources", stationId, "skills", category, ...relativePath.split(sep)
  );
}

export interface WalkEntry {
  kind: "file" | "symlink";
  relativePath: string;
  fullPath: string;
}

/**
 * Recursive walk that records symlinks instead of following them, and skips
 * the excluded directory names/patterns. A missing root reads as empty — the
 * same contract as the source script, where an absent home is a zero-file
 * home, not an error.
 */
export function walkEntries(absoluteRoot: string): WalkEntry[] {
  let entries;
  try {
    entries = readdirSync(absoluteRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const output: WalkEntry[] = [];
  for (const entry of entries) {
    const childFull = join(absoluteRoot, entry.name);
    if (entry.isSymbolicLink()) {
      output.push({ kind: "symlink", relativePath: entry.name, fullPath: childFull });
      continue;
    }
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_NAMES.has(entry.name) ||
        EXCLUDE_DIR_PATTERNS.some((pattern) => pattern.test(entry.name))) {
        continue;
      }
      const nested = walkEntries(childFull);
      for (const item of nested) {
        output.push({ ...item, relativePath: join(entry.name, item.relativePath) });
      }
      continue;
    }
    if (entry.isFile()) {
      output.push({ kind: "file", relativePath: entry.name, fullPath: childFull });
    }
  }
  return output;
}

/** True when a path exists and is a regular file. */
export function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}
