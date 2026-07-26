/**
 * The Postgres and SQLite migration sets must declare the same schema shape.
 *
 * Migrations are two hand-written files per version rather than one file translated at
 * runtime. That decision is only safe if drift is caught mechanically: the whole risk of
 * a parallel set is that someone adds a column to one dialect and forgets the other, and
 * the symptom would be a cross-backend behaviour difference discovered in production
 * rather than a red test.
 *
 * The org-scoped data model is the OSS layer's and its shape is not per-backend
 * negotiable, so this compares exactly the things that carry that model: tables, column
 * names, primary keys, effective NOT NULL, uniqueness constraints (including which ones
 * are partial), foreign keys, and the run status domain.
 *
 * The SQLite side is EXECUTED and introspected through PRAGMAs, so it is ground truth
 * rather than a second parse - which also means the file is proven to run. Only the
 * Postgres side is parsed. Column *types* are deliberately not compared: timestamptz vs
 * text and jsonb vs text are the intended, documented differences, and asserting on them
 * would only assert that the translation table was copied correctly.
 */
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MIGRATION_DIALECTS, resolveMigrationsDir } from "./migrations-dir.js";
import { SERVER_RUN_STATUSES } from "./types.js";

interface TableShape {
  columns: string[];
  notNull: string[];
  primaryKey: string[];
  unique: string[];
  /** `column->table [ON DELETE ACTION]`. The action is compared: it is org-scoping policy. */
  foreignKeys: string[];
  /**
   * `column=literal` for literal DEFAULTs only.
   *
   * Function defaults are excluded on purpose - `now()` and
   * `strftime('%Y-%m-%dT%H:%M:%fZ','now')` are the documented dialect mapping and can
   * never match textually. Literal defaults have no such excuse: `scopes_json` defaulting
   * to the full scope list on one backend and `[]` on the other would silently hand new
   * API keys different permissions depending on which database you ran.
   */
  literalDefaults: string[];
}

const EXPECTED_TABLES = [
  "api_keys",
  "organization_members",
  "organizations",
  "skills_approvals",
  "skills_artifacts",
  "skills_audit_events",
  "skills_registry",
  "skills_run_logs",
  "skills_runs",
  "users",
];

const postgresShapes = parsePostgresSchema(readDialect("postgres"));
const sqliteShapes = introspectSqliteSchema(readDialect("sqlite"));

describe("migration set parity", () => {
  test("both dialects ship the same migration versions", () => {
    const versions = MIGRATION_DIALECTS.map((dialect) => ({
      dialect,
      versions: readdirSync(resolveMigrationsDir(dialect)).filter((name) => name.endsWith(".sql")).sort(),
    }));
    // Non-emptiness first: a guard built on "enumerate the files" passes vacuously if
    // the files are ever moved or renamed away.
    for (const entry of versions) expect(entry.versions.length).toBeGreaterThan(0);
    expect(versions[1]!.versions).toEqual(versions[0]!.versions);
  });

  test("the parsers found the schema they are supposed to compare", () => {
    // Both sides must be non-empty and must be the schema this product actually has.
    // Without this, a parser that silently matched nothing would make every comparison
    // below trivially true.
    expect(Object.keys(postgresShapes).sort()).toEqual(EXPECTED_TABLES);
    expect(Object.keys(sqliteShapes).sort()).toEqual(EXPECTED_TABLES);
    expect(postgresShapes.skills_runs!.columns.length).toBeGreaterThan(15);
  });

  test("every table declares the same columns in both dialects", () => {
    for (const table of EXPECTED_TABLES) {
      expect({ table, columns: sqliteShapes[table]!.columns }).toEqual({ table, columns: postgresShapes[table]!.columns });
    }
  });

  test("primary keys and effective NOT NULL columns match", () => {
    for (const table of EXPECTED_TABLES) {
      expect({ table, pk: sqliteShapes[table]!.primaryKey }).toEqual({ table, pk: postgresShapes[table]!.primaryKey });
      expect({ table, notNull: sqliteShapes[table]!.notNull }).toEqual({ table, notNull: postgresShapes[table]!.notNull });
    }
  });

  test("uniqueness constraints match, including which ones are partial", () => {
    for (const table of EXPECTED_TABLES) {
      expect({ table, unique: sqliteShapes[table]!.unique }).toEqual({ table, unique: postgresShapes[table]!.unique });
    }
    // The org-scoped idempotency constraint is the one that keeps one tenant's key from
    // colliding with another's. Named explicitly so a refactor cannot quietly drop the
    // org column from it while both dialects stay in agreement.
    expect(sqliteShapes.skills_runs!.unique).toContain(uniqueKey(["org_id", "idempotency_key"], true));
  });

  test("foreign keys match, so org scoping is enforced identically", () => {
    for (const table of EXPECTED_TABLES) {
      expect({ table, fks: sqliteShapes[table]!.foreignKeys }).toEqual({ table, fks: postgresShapes[table]!.foreignKeys });
    }
    // Every row that belongs to a tenant references the tenant.
    for (const table of ["api_keys", "skills_runs", "skills_run_logs", "skills_artifacts", "skills_approvals"]) {
      expect(sqliteShapes[table]!.foreignKeys.some((fk) => fk.startsWith("org_id->organizations"))).toBe(true);
    }
  });

  test("every CHECK-ed status domain matches across dialects, and runs matches the TypeScript union", () => {
    const postgres = statusDomains(readDialect("postgres"));
    const sqlite = statusDomains(readDialect("sqlite"));
    // Two of them today: skills_runs and skills_approvals.
    expect(postgres.length).toBeGreaterThan(1);
    expect(sqlite).toEqual(postgres);
    expect(postgres[0]).toEqual([...SERVER_RUN_STATUSES].sort());
  });

  test("literal column defaults match, so a row means the same thing on either backend", () => {
    for (const table of EXPECTED_TABLES) {
      expect({ table, defaults: sqliteShapes[table]!.literalDefaults }).toEqual({ table, defaults: postgresShapes[table]!.literalDefaults });
    }
    // The one that would silently change what a new API key is allowed to do.
    expect(sqliteShapes.api_keys!.literalDefaults).toContain(`scopes_json=${normalizeLiteral(`'["skills:read","runs:write"]'`)}`);
  });
});

function readDialect(dialect: (typeof MIGRATION_DIALECTS)[number]): string {
  const dir = resolveMigrationsDir(dialect);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations found for dialect ${dialect}`);
  return files.map((file) => readFileSync(join(dir, file), "utf8")).join("\n");
}

/**
 * Every `CHECK (status IN (...))` domain in a dialect's DDL, keyed by position.
 *
 * Global regex, because there are two of them: skills_runs and skills_approvals. A
 * non-global match compared only the first, leaving the approvals status domain free to
 * diverge between dialects unnoticed.
 */
function statusDomains(sql: string): string[][] {
  const matches = [...sql.matchAll(/CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/gi)];
  if (matches.length === 0) throw new Error("no CHECK (status IN (...)) constraint found");
  return matches.map((match) => [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort());
}

function foreignKeyKey(column: string, table: string, onDelete: string | null | undefined): string {
  const action = (onDelete || "NO ACTION").toUpperCase().trim();
  return `${column}->${table} ON DELETE ${action}`;
}

function onDeleteAction(clause: string): string {
  return clause.match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i)?.[1]?.replace(/\s+/g, " ") ?? "NO ACTION";
}

/**
 * True only for a bare literal: a quoted string, a number, or a boolean.
 *
 * Whitelist rather than blacklist. The first attempt excluded values starting with "(",
 * which missed SQLite's `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` - PRAGMA table_info
 * strips the wrapping parens - and so compared a function default against Postgres's
 * `now()` and failed on the one difference the two files are supposed to have.
 */
function isLiteralDefault(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return /^'(?:[^']|'')*'$/.test(text) || /^-?\d+(?:\.\d+)?$/.test(text) || /^(?:true|false)$/i.test(text);
}

/** Collapse SQL literal spelling differences that carry no meaning (quoting, whitespace). */
function normalizeLiteral(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

/**
 * Execute the SQLite DDL and read its real shape back out. Ground truth, not a parse.
 */
function introspectSqliteSchema(sql: string): Record<string, TableShape> {
  const db = new Database(":memory:");
  try {
    db.exec(sql);
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .map((row) => row.name)
      .filter((name) => name !== "schema_migrations");

    const shapes: Record<string, TableShape> = {};
    for (const table of tables) {
      const info = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; pk: number; dflt_value: unknown }>;
      const primaryKey = info.filter((column) => column.pk > 0).map((column) => column.name).sort();
      // SQLite lets a non-INTEGER PRIMARY KEY column hold NULL unless NOT NULL is
      // spelled out; Postgres makes PRIMARY KEY imply NOT NULL. Unioning the two here
      // compares the constraint that is actually in force rather than how it was typed.
      const notNull = unique_([...info.filter((column) => column.notnull === 1).map((column) => column.name), ...primaryKey]);

      const indexes = db.query(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number; origin: string; partial: number }>;
      const uniques = indexes
        // origin 'pk' is the primary key's own index, already compared above.
        .filter((index) => index.unique === 1 && index.origin !== "pk")
        .map((index) => {
          const columns = (db.query(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>).map((column) => column.name);
          return uniqueKey(columns, index.partial === 1);
        })
        .sort();

      const foreignKeys = (db.query(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string; table: string; on_delete: string }>)
        .map((fk) => foreignKeyKey(fk.from, fk.table, fk.on_delete))
        .sort();

      const defaults = info
        .filter((column) => isLiteralDefault(column.dflt_value))
        .map((column) => `${column.name}=${normalizeLiteral(column.dflt_value as string)}`)
        .sort();

      shapes[table] = { columns: info.map((column) => column.name).sort(), notNull, primaryKey, unique: uniques, foreignKeys, literalDefaults: defaults };
    }
    return shapes;
  } finally {
    db.close(false);
  }
}

/**
 * Parse the Postgres DDL into the same shape.
 *
 * Hand-rolled rather than a SQL parser dependency: the input is one controlled in-repo
 * file, and the test above asserts the parse found the expected tables and a plausible
 * column count, so a parser that silently degrades fails loudly instead of making the
 * comparisons vacuous.
 */
function parsePostgresSchema(sql: string): Record<string, TableShape> {
  const shapes: Record<string, TableShape> = {};

  const tablePattern = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(sql))) {
    const table = match[1]!;
    const body = extractParenBody(sql, match.index + match[0].length - 1);
    const columns: string[] = [];
    const notNull: string[] = [];
    let primaryKey: string[] = [];
    const uniques: string[] = [];
    const foreignKeys: string[] = [];
    const defaults: string[] = [];

    for (const raw of splitTopLevel(body)) {
      // A named constraint is the same constraint. Stripping "CONSTRAINT <name>" up
      // front means `CONSTRAINT x UNIQUE (a)` is compared like `UNIQUE (a)` instead of
      // being skipped - the earlier version ignored every clause starting with
      // CONSTRAINT, so a named UNIQUE or FOREIGN KEY added to one dialect only was
      // invisible to this guard. That is the form a future migration is most likely to
      // use, since it is what most schema tools emit.
      const text = raw.trim().replace(/^CONSTRAINT\s+"?[\w]+"?\s+/i, "").trim();
      if (!text) continue;
      const upper = text.toUpperCase();

      if (upper.startsWith("FOREIGN KEY")) {
        // FOREIGN KEY (a, b) REFERENCES t (x, y) ON DELETE CASCADE
        const columns = columnList(text);
        const referenced = text.match(/REFERENCES\s+"?(\w+)"?/i);
        if (!referenced) throw new Error(`unparseable FOREIGN KEY clause: ${text}`);
        for (const column of columns) foreignKeys.push(foreignKeyKey(column, referenced[1]!, onDeleteAction(text)));
        continue;
      }
      if (upper.startsWith("PRIMARY KEY")) {
        primaryKey = columnList(text).sort();
        continue;
      }
      if (upper.startsWith("UNIQUE")) {
        uniques.push(uniqueKey(columnList(text), false));
        continue;
      }
      if (upper.startsWith("CHECK") || upper.startsWith("EXCLUDE")) continue;

      const name = text.split(/\s+/)[0]!;
      columns.push(name);
      if (/\bNOT\s+NULL\b/i.test(text)) notNull.push(name);
      if (/\bPRIMARY\s+KEY\b/i.test(text)) primaryKey.push(name);
      // Inline UNIQUE, but not the "UNIQUE (a, b)" table constraint handled above.
      if (/\bUNIQUE\b(?!\s*\()/i.test(text)) uniques.push(uniqueKey([name], false));
      const references = text.match(/\bREFERENCES\s+"?(\w+)"?/i);
      if (references) foreignKeys.push(foreignKeyKey(name, references[1]!, onDeleteAction(text)));
      const literalDefault = text.match(/\bDEFAULT\s+('(?:[^']|'')*'|-?\d+(?:\.\d+)?|true|false)/i);
      if (literalDefault && isLiteralDefault(literalDefault[1]!)) defaults.push(`${name}=${normalizeLiteral(literalDefault[1]!)}`);
    }

    shapes[table] = {
      columns: columns.sort(),
      notNull: unique_([...notNull, ...primaryKey]),
      primaryKey: unique_(primaryKey),
      unique: uniques.sort(),
      foreignKeys: foreignKeys.sort(),
      literalDefaults: defaults.sort(),
    };
  }

  const indexPattern = /CREATE\s+UNIQUE\s+INDEX(?:\s+IF NOT EXISTS)?\s+\w+\s+ON\s+(\w+)\s*\(([^)]*)\)([^;]*);/gi;
  while ((match = indexPattern.exec(sql))) {
    const table = match[1]!;
    const shape = shapes[table];
    if (!shape) throw new Error(`unique index references unknown table ${table}`);
    const columns = match[2]!.split(",").map((column) => column.trim().replace(/\s+(ASC|DESC)$/i, ""));
    shape.unique = [...shape.unique, uniqueKey(columns, /\bWHERE\b/i.test(match[3]!))].sort();
  }

  return shapes;
}

/** Stable identity for a uniqueness constraint: its column set plus whether it is partial. */
function uniqueKey(columns: string[], partial: boolean): string {
  return `${[...columns].sort().join(",")}${partial ? " [partial]" : ""}`;
}

function columnList(clause: string): string[] {
  const body = clause.slice(clause.indexOf("(") + 1, clause.lastIndexOf(")"));
  return body.split(",").map((column) => column.trim().replace(/\s+(ASC|DESC)$/i, ""));
}

/** Body of the parenthesised group whose opening paren is at `open`. */
function extractParenBody(sql: string, open: number): string {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced parentheses in CREATE TABLE body");
}

/** Split on commas at nesting depth zero, ignoring commas inside quoted literals. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of body) {
    if (char === "'") quoted = !quoted;
    if (!quoted) {
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function unique_(values: string[]): string[] {
  return [...new Set(values)].sort();
}
