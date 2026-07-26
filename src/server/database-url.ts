/**
 * Which database a server instance talks to, resolved from one operator-supplied
 * string.
 *
 * The hazard this module exists to remove: `createStore()` used to read
 * `options.databaseUrl ? Postgres : Memory`. With no DATABASE_URL the server booted
 * onto a JavaScript `Map`, answered /health with `ok: true`, served traffic, and threw
 * every run, log, and artifact away on restart - silently, with no warning at any point.
 * A durable default is the fix; loud failure on a misconfigured explicit target is the
 * other half of it.
 *
 * The rules, in priority order:
 *   1. An explicit target always wins and is never second-guessed. A `postgres://` URL
 *      that cannot be reached is a startup failure, not a cue to quietly use something
 *      else - degrading backends is how an operator ends up with two half-populated
 *      databases and no idea which one production read.
 *   2. With nothing configured, SQLite at the app data dir. Durable, zero-config, and
 *      the reason a single operator can run the whole product on a laptop.
 *   3. The non-durable in-process store is reachable only by asking for it by name
 *      (`memory:`). It is never a fallback, never a default, and never what you get by
 *      forgetting to set something.
 *   4. An unrecognised scheme throws. `mysql://...` must not be silently reinterpreted
 *      as a relative file path called "mysql:".
 */
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDataDir } from "../lib/config.js";

/** Filename of the default SQLite database inside the skills data directory. */
export const DEFAULT_SQLITE_FILENAME = "server.db";

/** The token that selects an in-memory SQLite database (SQLite's own spelling). */
export const SQLITE_MEMORY_PATH = ":memory:";

export type DatabaseTarget =
  | { kind: "postgres"; url: string; durable: true; label: string }
  | { kind: "sqlite"; path: string; durable: boolean; label: string }
  | { kind: "memory"; durable: false; label: string };

const POSTGRES_SCHEMES = new Set(["postgres", "postgresql"]);
const SQLITE_SCHEMES = new Set(["sqlite", "sqlite3", "file"]);
const MEMORY_SCHEMES = new Set(["memory"]);
const SQLITE_EXTENSIONS = [".db", ".sqlite", ".sqlite3", ".db3"];

/**
 * Absolute path of the default SQLite database.
 *
 * PR #50 moved the *skill corpus* into ~/.hasna/skills/installed/ and left app data at
 * the app root, matching every sibling Hasna app (mementos keeps mementos.db beside
 * agents/, accounts keeps accounts.json beside profiles/). The server database is app
 * data, so it belongs at the root - ~/.hasna/skills/server.db - and explicitly NOT
 * inside installed/, which now holds exactly one thing: installed skills.
 *
 * Resolved through getDataDir() rather than composed from $HOME so that
 * $HASNA_SKILLS_DIR relocates the database along with the rest of the app's state. The
 * test preload sets that variable per test, which is also what keeps the suite from
 * writing a server.db into a developer's real home.
 */
export function defaultSqlitePath(): string {
  return join(getDataDir(), DEFAULT_SQLITE_FILENAME);
}

/**
 * Resolve an operator-supplied database string into a concrete backend choice.
 *
 * @throws if the string names a scheme this build has no backend for. Refusing beats
 * guessing: a typo'd scheme that silently became "SQLite at ./mysql:" would present as
 * an empty database rather than as a configuration error.
 */
export function resolveDatabaseTarget(raw?: string | null): DatabaseTarget {
  const value = raw?.trim();
  if (!value) {
    const path = defaultSqlitePath();
    return { kind: "sqlite", path, durable: true, label: `sqlite (${path})` };
  }

  // SQLite's own literal for an anonymous in-memory database. Checked before scheme
  // parsing because it starts with the character that would otherwise terminate a
  // scheme. This is a real SQLite database with real SQL semantics - it is simply not
  // durable, which is why the durability guard still refuses it without an opt-in.
  if (value === SQLITE_MEMORY_PATH) {
    return { kind: "sqlite", path: SQLITE_MEMORY_PATH, durable: false, label: "sqlite (in-memory)" };
  }

  // A single-letter "scheme" is a Windows drive letter, not a scheme. `C:\data\skills.db`
  // would otherwise be rejected as `unsupported database scheme "c:"`, and this package
  // publishes `skills-server` as an npm bin. No real URL scheme is one character.
  const schemeMatch = value.match(/^([a-z][a-z0-9+.-]+):/i);
  const scheme = schemeMatch?.[1]?.toLowerCase();

  if (scheme && POSTGRES_SCHEMES.has(scheme)) {
    return { kind: "postgres", url: value, durable: true, label: "postgres" };
  }

  if (scheme && MEMORY_SCHEMES.has(scheme)) {
    return { kind: "memory", durable: false, label: "memory (non-durable)" };
  }

  if (scheme && SQLITE_SCHEMES.has(scheme)) {
    const path = sqlitePathFromUrl(value, scheme);
    return path === SQLITE_MEMORY_PATH
      ? { kind: "sqlite", path, durable: false, label: "sqlite (in-memory)" }
      : { kind: "sqlite", path, durable: true, label: `sqlite (${path})` };
  }

  if (scheme) {
    throw new Error(
      `unsupported database scheme "${scheme}:". Supported: postgres://, postgresql://, sqlite:, file:, ` +
        `an absolute or relative path to a .db/.sqlite file, ":memory:", or "memory:" (non-durable, tests only). ` +
        `Leave the setting empty to use the default SQLite database at ${defaultSqlitePath()}.`,
    );
  }

  if (looksLikeSqlitePath(value)) {
    const path = isAbsolute(value) ? value : join(process.cwd(), value);
    return { kind: "sqlite", path, durable: true, label: `sqlite (${path})` };
  }

  throw new Error(
    `could not resolve a database backend from "${value}". Use postgres://…, sqlite:…, an absolute or ` +
      `relative path ending in ${SQLITE_EXTENSIONS.join("/")}, ":memory:", or leave it empty for the ` +
      `default SQLite database at ${defaultSqlitePath()}.`,
  );
}

function sqlitePathFromUrl(value: string, scheme: string): string {
  // Drop SQLite's URI query parameters and any fragment before the path is read.
  //
  // fileURLToPath does this for `file://…`, so without it here the two documented-as-
  // equivalent spellings diverged: `file:///srv/db.sqlite?x=1` resolved to /srv/db.sqlite
  // while `sqlite:/srv/db.sqlite?mode=ro` created a file literally named
  // "db.sqlite?mode=ro". The parameters themselves are not honoured - bun:sqlite is not
  // opened in URI mode - so silently keeping them in a filename is the worst option.
  const rest = value.slice(scheme.length + 1).replace(/[?#].*$/, "");

  // sqlite::memory: / file::memory: - the in-memory literal carried behind a scheme,
  // with or without SQLite's URI query parameters. Matched by prefix so that
  // "sqlite::memory:?cache=shared" cannot fall through and become a file on disk
  // literally named ":memory:?cache=shared".
  if (rest.startsWith(SQLITE_MEMORY_PATH)) return SQLITE_MEMORY_PATH;

  // An empty path is a configuration accident, not a request for an anonymous database.
  // "sqlite:" and "sqlite://" are what a templated `sqlite://${DB_PATH}` collapses to
  // when DB_PATH is unset; resolving that to an in-memory database would answer a
  // missing variable with silently non-durable storage. Say so instead.
  if (rest === "" || rest === "//") {
    throw new Error(
      `"${value}" names no database file. Give a path (${scheme}:///var/lib/skills/server.db), ` +
        `or ":memory:" if a non-durable database is genuinely what you want. ` +
        "An empty path here usually means an unset variable in a templated URL.",
    );
  }

  if (rest.startsWith("//")) {
    // scheme://authority/path. Only an empty authority (i.e. "///path") is meaningful
    // for a local file. "sqlite://srv/a.db" is the classic one-slash-short typo for an
    // absolute path, and silently resolving it relative to the working directory would
    // produce a different, empty database - the exact "empty database instead of a
    // configuration error" outcome this module exists to prevent.
    if (!rest.startsWith("///")) {
      const authority = rest.slice(2).split("/")[0];
      throw new Error(
        `"${value}" has a host ("${authority}") where a path was expected. Remote SQLite files are not a thing; ` +
          `for an absolute path use ${scheme}:///${rest.slice(2)}, and for a relative one use ${scheme}:${rest.slice(2)}.`,
      );
    }
    if (scheme === "file") {
      try {
        return fileURLToPath(new URL(value));
      } catch {
        // Fall through to textual handling rather than rejecting a path that is
        // obvious but not a strictly valid URL.
      }
    }
    return rest.slice(2).replace(/^\/\/+/, "/");
  }

  return isAbsolute(rest) ? rest : join(process.cwd(), rest);
}

function looksLikeSqlitePath(value: string): boolean {
  if (value.includes("/")) return true;
  return SQLITE_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension));
}
