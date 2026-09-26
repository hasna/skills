/**
 * Skills app-home resolution through the @hasna/paths resolver.
 *
 * Skills keeps its global config (`config.json`), auth (`auth.json`), the
 * default SQLite database (`server.db`), the corpus cache (`skills/`), and the
 * portable-skill tree (`installed/`, `custom/`) under one data root.
 * Historically that root was `~/.hasna/skills`. This module resolves the root
 * through `@hasna/paths` (XDG / macOS home layout) with a gated legacy
 * adoption: the legacy `~/.hasna/skills` stays the effective data root until
 * the store is physically migrated to the XDG data home (`server.db` or
 * `config.json` present there) or the operator sets the data-kind override
 * `HASNA_DATA_HOME`. An existing live store never becomes invisible on
 * upgrade. The exact-app overrides win unconditionally, in this order:
 * `HASNA_SKILLS_DIR` (the shipped override), then the wave-convention aliases
 * `HASNA_SKILLS_HOME` and `SKILLS_HOME`.
 *
 * Nothing moves on disk in this phase — the package just resolves the new
 * paths.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
// --- Local path resolver -------------------------------------------------
// @hasna/paths was deleted (hasna/apps#1535, 2026-09-03); this in-package
// implementation preserves the DATA-kind resolver contract (XDG / macOS home
// layout honoring HASNA_DATA_HOME, with the same env-override and
// home-override semantics the deleted package had). The config/state/cache
// kinds it also carried were unreachable — only dataDir() was ever called —
// and were the only place this package composed the retired `~/.config/hasna`
// shape (fleet home-layout ruling 2026-09-04; #1720 validation), so they are
// gone rather than dormant.
import { homedir as pathsResolverHomedir } from "node:os";
import { join as pathsResolverJoin } from "node:path";

const PATHS_RESOLVER_DATA_ENV = "HASNA_DATA_HOME";

export interface PathsResolverOptions {
  app: string;
  internal?: boolean;
  platform?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

const PATHS_RESOLVER_APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pathsResolverAssertApp(app: string): void {
  if (typeof app !== "string" || app.length === 0) {
    throw new TypeError("paths: app must be a non-empty string");
  }
  if (!PATHS_RESOLVER_APP_SLUG_RE.test(app)) {
    throw new TypeError(
      `paths: invalid app slug "${app}" — expected lowercase kebab-case ([a-z0-9]+(-[a-z0-9]+)*)`,
    );
  }
}

function pathsResolverDataBaseDir(options: PathsResolverOptions): string {
  const env: Record<string, string | undefined> = options.env ?? process.env;
  const override = env[PATHS_RESOLVER_DATA_ENV];
  if (typeof override === "string" && override.length > 0) return override;
  const home = options.home ?? pathsResolverHomedir();
  const platform = options.platform ?? process.platform;
  return platform === "darwin"
    ? pathsResolverJoin(home, "Library", "Application Support", "Hasna")
    : pathsResolverJoin(home, ".local", "share", "hasna");
}

export function dataDir(options: PathsResolverOptions): string {
  pathsResolverAssertApp(options.app);
  const appSegment = options.internal === true ? pathsResolverJoin("internal", options.app) : options.app;
  return pathsResolverJoin(pathsResolverDataBaseDir(options), appSegment);
}

/** Env var that relocates the skills data directory (the shipped override). */
export const DATA_DIR_ENV = "HASNA_SKILLS_DIR";

/** Wave-convention exact-app home aliases, honoured after HASNA_SKILLS_DIR. */
export const HASNA_SKILLS_HOME_ENV = "HASNA_SKILLS_HOME";
export const SKILLS_HOME_ENV = "SKILLS_HOME";

/** Filename of the default SQLite database inside the skills data directory. */
export const DEFAULT_SQLITE_FILENAME = "server.db";

/** Filename of the global config file inside the skills data directory. */
export const GLOBAL_CONFIG_FILENAME = "config.json";

/**
 * The effective user home, mirroring the pre-existing skills resolution
 * (`HOME` || `USERPROFILE` || `os.homedir()`). Read at call time so a runtime
 * `HOME` reassignment (e.g. a test temp home) is honoured — `os.homedir()`
 * snapshots `HOME` at process start and, under Bun, ignores later changes.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/skills`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "skills");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for skills:
 * `~/.local/share/hasna/skills` on Linux, `~/Library/Application
 * Support/Hasna/skills` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 *
 * `env` is forwarded to the resolver: an injected env (e.g. `{}` for a
 * staged home mirror) suppresses the process-level `HASNA_*_HOME` overrides,
 * which describe THIS machine's live store and must not relocate a mirror.
 * `@hasna/paths` applies env overrides before the injected home, so without
 * this the resolver would ignore the mirror home whenever `HASNA_DATA_HOME`
 * is set.
 */
export function resolverDataRoot(
  home: string = effectiveHome(),
  env?: Record<string, string | undefined>,
): string {
  return dataDir({ app: "skills", home, env });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there (`server.db`
 * — the default SQLite store — or `config.json` exists). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, DEFAULT_SQLITE_FILENAME)) ||
    existsSync(join(resolved, GLOBAL_CONFIG_FILENAME))
  );
}

/**
 * The exact-app override root, when set: the shipped `HASNA_SKILLS_DIR` wins,
 * then the wave-convention aliases `HASNA_SKILLS_HOME` and `SKILLS_HOME`.
 * First non-blank override wins; a blank or whitespace-only primary must not
 * shadow a valid secondary (nullish `??` does not fall through on `""`).
 */
export function exactDataRoot(): string | undefined {
  for (const key of [DATA_DIR_ENV, HASNA_SKILLS_HOME_ENV, SKILLS_HOME_ENV] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/** Whether an exact-app override root is set (used to skip legacy migration). */
export function hasExactOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    Boolean(env[DATA_DIR_ENV]?.trim()) ||
    Boolean(env[HASNA_SKILLS_HOME_ENV]?.trim()) ||
    Boolean(env[SKILLS_HOME_ENV]?.trim())
  );
}

/**
 * Whether the operator named a data root at all — an exact-app override or the
 * data-kind `HASNA_DATA_HOME`. Used to decide when the legacy `~/.skills` /
 * `~/.skillsrc` migration must be skipped: copying a stray legacy tree into an
 * operator-chosen directory would be a surprising write.
 */
export function hasOperatorOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasExactOverride(env) || Boolean(env.HASNA_DATA_HOME?.trim());
}

/**
 * The effective data root: an exact-app override (`HASNA_SKILLS_DIR`, then
 * `HASNA_SKILLS_HOME` / `SKILLS_HOME`) wins unconditionally; otherwise the
 * resolver (XDG) data root once adopted; otherwise the legacy `~/.hasna/skills`
 * default. Write-free: callers that need the directory to exist create it.
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}

/**
 * The skills app data root for an explicit home root, mirroring getDataRoot()
 * with the home injected. Used by the sync-home snapshot mapping to enumerate
 * the skills corpus under a staged home mirror (`homesRoot`) or the real home.
 *
 * Process-level overrides (`HASNA_SKILLS_DIR` / `HASNA_SKILLS_HOME` /
 * `SKILLS_HOME`, and the data-kind `HASNA_DATA_HOME`) describe THIS machine's
 * live store. They apply only when the requested home IS the process's own
 * effective home; a staged mirror (a different home, e.g. an rsync'd
 * remote-station `homesRoot`) must resolve its own layout — the mirror's XDG
 * data root once the mirror itself carries a migrated store there, else the
 * mirror's legacy `~/.hasna/skills` — never the local process's live data
 * root. Snapshotting a staged home with the local `HASNA_DATA_HOME` set would
 * otherwise read live local data instead of the supplied mirror.
 */
export function skillsDataRootForHome(home: string): string {
  const isOwnHome =
    resolve(home) === resolve(effectiveHome()) || resolve(home) === resolve(homedir());
  if (isOwnHome) {
    const exact = exactDataRoot();
    if (exact) return exact;
    const resolved = resolverDataRoot(home);
    return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(join(home, ".hasna", "skills"));
  }
  // A staged home mirror (e.g. an rsync'd remote-station `homesRoot`):
  // process-level overrides describe THIS machine's live store and must not
  // leak into the mirror's resolution. Resolve with a scrubbed env so the
  // mirror's own layout decides: its XDG data root once the mirror itself
  // carries a migrated store there (`server.db` / `config.json`), else the
  // mirror's legacy `~/.hasna/skills`. Snapshotting a staged home with the
  // local `HASNA_DATA_HOME` / `HASNA_SKILLS_DIR` set would otherwise read
  // live local data instead of the supplied mirror.
  const resolved = resolverDataRoot(home, {});
  return adoptResolverDataRoot(resolved, {}) ? resolve(resolved) : resolve(join(home, ".hasna", "skills"));
}
