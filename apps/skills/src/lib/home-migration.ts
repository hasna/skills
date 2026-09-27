/**
 * Owner layout migration — ~/.hasna/skills/{skills,logs,outputs}.
 *
 * The skills app folder gains three named subfolders, matching every sibling
 * Hasna app:
 *
 *   ~/.hasna/skills/
 *   ├── skills/    canonical corpus cache; becomes the sync source
 *   ├── logs/      run/sync logs, created lazily
 *   ├── outputs/   run outputs, created lazily
 *   ├── custom/    retained as-is (experiments)
 *   ├── installed/ the previous corpus home; migrated INTO skills/
 *   └── <name>/    legacy flat skill dirs (the layout before installed/);
 *                  migrated into skills/<name>
 *
 * Migration is opt-in (`skills storage migrate`), idempotent, and refuses to
 * run against a non-empty conflicting destination. It MOVES directories (never
 * copies-then-leaves): after a successful migration nothing remains at the old
 * path, and the migration record file (skills/.layout-migration.json) is the
 * marker that makes a re-run a no-op and makes `skills sync` read the corpus
 * from the new cache.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  INSTALLED_SKILLS_DIRNAME,
  LAYOUT_MIGRATION_RECORD,
  SKILLS_CACHE_DIRNAME,
  getDataDir,
  isOwnerLayoutMigrated,
} from "./config.js";
import { getPortableSkillsRoot, type PortableSkillOptions } from "./portable-skills.js";

// The corpus-layout constants and the migration-marker check live in config.ts
// — the module below both this one and portable-skills.ts — so the canonical
// corpus resolver can consult the marker without an import cycle. They are
// re-exported here for callers that have always imported them from this module.
export { LAYOUT_MIGRATION_RECORD, SKILLS_CACHE_DIRNAME, isOwnerLayoutMigrated } from "./config.js";

export const LOGS_DIRNAME = "logs";
export const OUTPUTS_DIRNAME = "outputs";
export const LEGACY_CUSTOM_DIRNAME = "custom";

export interface LayoutMigrationRecord {
  version: 1;
  /** ISO timestamp of the migration. */
  migratedAt: string;
  /** The entries moved: "installed" for the old corpus dir, then each legacy flat dir name. */
  moved: string[];
  note: string;
}

export function layoutMigrationRecordPath(appDir: string): string {
  return join(appDir, SKILLS_CACHE_DIRNAME, LAYOUT_MIGRATION_RECORD);
}

/**
 * Resolve the corpus the sync/fan-out reads from.
 *
 * The precedence lives in ONE place, getPortableSkillsRoot():
 *   1. options.rootDir — named outright, no suffix (unchanged contract)
 *   2. migrated owner layout — <app folder>/skills when a migration record exists
 *   3. the pre-migration corpus — installed/, with the legacy auto-copy migration
 *
 * The migration record is required: a skills/ directory someone created by hand
 * is not the corpus and never will be treated as one.
 *
 * This wrapper exists so pull/agent-sync and any future caller can name the
 * canonical resolver explicitly; delegating keeps a single implementation for
 * list/search/info/push/sync alike (bug 170b0e9b was exactly the opposite — a
 * second resolution that read installed/ while this one read skills/).
 */
export function resolveCorpusRoot(options: PortableSkillOptions = {}): string {
  return getPortableSkillsRoot(options);
}

/** The app folder for a migration invocation (honours $HASNA_SKILLS_DIR via getDataDir). */
function migrationAppDir(homeDir: string | undefined): string {
  return homeDir ? join(homeDir, ".hasna", "skills") : getDataDir();
}

/** True for a directory that carries any of the files a skill is identified by. */
function looksLikeSkillDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
  } catch {
    return false;
  }
  return existsSync(join(path, "SKILL.md"))
    || existsSync(join(path, "skill.json"))
    || existsSync(join(path, "package.json"));
}

/**
 * Legacy flat skill dirs at the app root — the layout that predates installed/.
 * custom/ and the new owner-layout subfolders are never candidates.
 */
function listLegacyFlatSkillDirs(appDir: string): string[] {
  const legacy: string[] = [];
  if (!existsSync(appDir)) return legacy;
  let entries: string[] = [];
  try {
    entries = readdirSync(appDir);
  } catch {
    return legacy;
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    if (
      entry === SKILLS_CACHE_DIRNAME
      || entry === INSTALLED_SKILLS_DIRNAME
      || entry === LEGACY_CUSTOM_DIRNAME
      || entry === LOGS_DIRNAME
      || entry === OUTPUTS_DIRNAME
    ) {
      continue;
    }
    if (looksLikeSkillDirectory(join(appDir, entry))) legacy.push(entry);
  }
  return legacy;
}

function createLazyDirs(appDir: string, created: string[]): void {
  for (const name of [LOGS_DIRNAME, OUTPUTS_DIRNAME]) {
    const dir = join(appDir, name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
}

export type LayoutMigrationStatus = "already-migrated" | "refused" | "migrated" | "nothing-to-do";

export interface LayoutMigrationResult {
  status: LayoutMigrationStatus;
  /** Why a run refused; absent otherwise. */
  reason?: string;
  /** The source entries moved (or that a dry-run would move). */
  moved: string[];
  /** Directories created by the run. */
  created: string[];
  /** The record written, when a run actually migrated. */
  record?: LayoutMigrationRecord;
}

export interface LayoutMigrationOptions {
  dryRun?: boolean;
  /** App-folder override for tests. */
  homeDir?: string;
}

/**
 * Migrate the owner layout, idempotently.
 *
 * - already-migrated: the record exists; nothing happens.
 * - refused: skills/ exists with content and no record, or a legacy dir would
 *   collide with an existing skills/<name>; nothing happens.
 * - migrated: installed/ (when present) and every legacy flat dir moved into
 *   skills/; logs/ and outputs/ created; the record written.
 * - nothing-to-do: no installed/ and no legacy dirs; logs/ and outputs/ are
 *   still created (lazily) unless the run is a dry-run.
 */
export function migrateOwnerLayout(options: LayoutMigrationOptions = {}): LayoutMigrationResult {
  const appDir = migrationAppDir(options.homeDir);
  const cache = join(appDir, SKILLS_CACHE_DIRNAME);
  const installed = join(appDir, INSTALLED_SKILLS_DIRNAME);
  const moved: string[] = [];
  const created: string[] = [];

  if (isOwnerLayoutMigrated(appDir)) {
    return { status: "already-migrated", moved, created };
  }

  if (existsSync(cache)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(cache);
    } catch {
      // Unreadable cache: treat as conflicting; migrating into it is unsafe.
    }
    if (entries.length > 0) {
      return {
        status: "refused",
        reason: `${SKILLS_CACHE_DIRNAME}/ already exists with content and no migration record; refusing to migrate into a non-empty destination`,
        moved,
        created,
      };
    }
  }

  const installedPresent = existsSync(installed);
  const legacy = listLegacyFlatSkillDirs(appDir);
  const planned = [...(installedPresent ? [INSTALLED_SKILLS_DIRNAME] : []), ...legacy];

  if (!installedPresent && legacy.length === 0) {
    if (!options.dryRun) createLazyDirs(appDir, created);
    return { status: "nothing-to-do", moved, created };
  }

  if (options.dryRun) {
    return { status: "migrated", reason: "dry-run; nothing was moved", moved: planned, created };
  }

  // Refuse before mutating anything: a legacy dir may not collide with
  // existing cache content OR with content that will land there from installed/.
  const collisionNames = new Set<string>();
  for (const dir of [cache, ...(installedPresent ? [installed] : [])]) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) collisionNames.add(entry);
    } catch {
      // Unreadable source dir: the rename below will surface it.
    }
  }
  for (const name of legacy) {
    if (collisionNames.has(name)) {
      return {
        status: "refused",
        reason: `legacy skill '${name}' collides with an existing ${SKILLS_CACHE_DIRNAME}/${name}; refusing to overwrite it`,
        moved,
        created,
      };
    }
  }

  // Remove the empty cache dir so the installed/ rename lands cleanly.
  if (existsSync(cache)) {
    rmSync(cache, { recursive: true, force: true });
  }
  if (installedPresent) {
    renameSync(installed, cache);
    moved.push(INSTALLED_SKILLS_DIRNAME);
  } else {
    mkdirSync(cache, { recursive: true });
  }
  for (const name of legacy) {
    renameSync(join(appDir, name), join(cache, name));
    moved.push(name);
  }
  createLazyDirs(appDir, created);

  const record: LayoutMigrationRecord = {
    version: 1,
    migratedAt: new Date().toISOString(),
    moved,
    note: "installed/ and legacy flat skill dirs moved into skills/; custom/ retained",
  };
  writeFileSync(layoutMigrationRecordPath(appDir), `${JSON.stringify(record, null, 2)}\n`);
  return { status: "migrated", moved, created, record };
}
