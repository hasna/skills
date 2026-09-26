/**
 * Locating the per-dialect migration files at runtime.
 *
 * migrations/ used to be resolved as `join(process.cwd(), "migrations")`, which works
 * for `bun run migrate` from a checkout and for the Docker image (Dockerfile COPYs
 * migrations to the workdir) and nowhere else. SQLite applies its migrations on first
 * open so that an unconfigured server just works, which means the lookup now has to
 * succeed from a bundled bin/server.js and from an installed node_modules copy too.
 *
 * Same walk-up shape as findSkillsDir() in lib/installer.ts, for the same reason: the
 * caller may be running from src/server/, bin/, or dist/, and the package root is a
 * small, bounded number of levels up from all three.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const MIGRATION_DIALECTS = ["postgres", "sqlite"] as const;
export type MigrationDialect = (typeof MIGRATION_DIALECTS)[number];

const MAX_WALK_UP = 6;

/**
 * Absolute path of `migrations/`, or null when it cannot be found.
 *
 * Searches the callers' likely roots in order: the module's own directory chain (which
 * covers src/, bin/, dist/, and node_modules installs) and then the working directory
 * chain (which covers `bun run migrate` invoked from a subdirectory).
 */
export function findMigrationsRoot(startDirs: string[] = defaultStartDirs()): string | null {
  for (const start of startDirs) {
    let dir = start;
    for (let level = 0; level < MAX_WALK_UP; level += 1) {
      const candidate = join(dir, "migrations");
      // Require a dialect subdirectory, not merely a directory called "migrations".
      // A bare existsSync would happily match an unrelated migrations/ folder in a
      // parent project and then report "no migration files", which reads as a broken
      // install rather than as a wrong path.
      if (MIGRATION_DIALECTS.some((dialect) => existsSync(join(candidate, dialect)))) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * Absolute path of the migration directory for one dialect.
 *
 * @throws when the directory cannot be located, naming the dialect. Throwing beats
 * returning an empty list: "0 migrations applied" against a fresh database looks like
 * success right up until the first query fails on a missing table.
 */
export function resolveMigrationsDir(dialect: MigrationDialect, root = findMigrationsRoot()): string {
  if (!root) {
    throw new Error(
      `could not locate the migrations directory for dialect "${dialect}". ` +
        `Expected a migrations/${dialect}/ folder alongside the package root.`,
    );
  }
  const dir = join(root, dialect);
  if (!existsSync(dir)) {
    throw new Error(`migrations directory not found: ${dir}`);
  }
  return dir;
}

function defaultStartDirs(): string[] {
  const dirs = [import.meta.dir];
  const cwd = process.cwd();
  if (cwd && cwd !== import.meta.dir) dirs.push(cwd);
  return dirs;
}
