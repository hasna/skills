/**
 * One set of server tests, run once per storage backend.
 *
 * The alternative was a second copy of app.test.ts with `MemorySkillsStore` swapped for
 * `SqliteSkillsStore`, which would have made "SQLite behaves like Postgres" a claim
 * maintained by hand. Parameterising instead means every existing assertion about auth,
 * run lifecycle, log ordering, artifact download, and cross-org isolation is re-asserted
 * against each backend, and a new assertion covers all of them automatically.
 *
 * Backends:
 *   - memory   always. Non-durable, so the fixture flips allowEphemeralStore.
 *   - sqlite   always, on a real file in a temp directory (not :memory:) so the tests
 *              exercise the WAL/locking path an operator actually runs.
 *   - postgres only when HASNA_SKILLS_TEST_DATABASE_URL names a reachable instance.
 *              Never defaulted to a hostname: a suite that silently tests nothing is
 *              worse than one that says it skipped. When it is skipped, the reason is
 *              printed, so "passed against both backends" is never claimed on the
 *              strength of a connection that was never attempted.
 *
 * Postgres isolation is a freshly created database per fixture, dropped afterwards.
 * Truncating a shared database would be enough for org-scoped reads but not for the
 * worker queue: claimNextRun() is deliberately not org-scoped, so a run left queued by
 * a concurrently running test file would be claimed by this one's worker.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runMigrations } from "./migrate.js";
import { MemorySkillsStore, PostgresSkillsStore } from "./store.js";
import { SqliteSkillsStore } from "./sqlite-store.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";

export const TEST_DATABASE_URL_ENV = "HASNA_SKILLS_TEST_DATABASE_URL";

export interface SeedApiKey {
  token: string;
  principal: Partial<ApiPrincipal>;
}

export interface StoreFixture {
  store: SkillsProductStore;
  /** True when the server must be told it is allowed to run on this store. */
  allowEphemeralStore: boolean;
  close(): Promise<void>;
}

export interface StoreBackendFixture {
  name: string;
  create(seed?: SeedApiKey[]): Promise<StoreFixture>;
}

const skipNotices: string[] = [];

/** Human-readable reasons a backend is absent from the current run. */
export function storeBackendNotices(): string[] {
  return [...skipNotices];
}

/**
 * Every backend testable in this environment.
 *
 * Async because Postgres availability can only be established by connecting; a
 * top-level await in the test file keeps that out of the describe bodies.
 */
export async function resolveStoreBackends(): Promise<StoreBackendFixture[]> {
  const backends: StoreBackendFixture[] = [memoryBackend(), sqliteBackend()];
  const postgres = await postgresBackendIfReachable();
  if (postgres) backends.push(postgres);
  return backends;
}

function memoryBackend(): StoreBackendFixture {
  return {
    name: "memory",
    async create(seed = []) {
      const store = new MemorySkillsStore();
      await seedStore(store, seed);
      return { store, allowEphemeralStore: true, close: async () => {} };
    },
  };
}

function sqliteBackend(): StoreBackendFixture {
  return {
    name: "sqlite",
    async create(seed = []) {
      const dir = mkdtempSync(join(tmpdir(), "skills-sqlite-store-"));
      const store = new SqliteSkillsStore(join(dir, "server.db"));
      await seedStore(store, seed);
      return {
        store,
        allowEphemeralStore: false,
        close: async () => {
          await store.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  };
}

async function postgresBackendIfReachable(): Promise<StoreBackendFixture | null> {
  const adminUrl = process.env[TEST_DATABASE_URL_ENV]?.trim();
  if (!adminUrl) {
    skipNotices.push(`postgres: skipped, ${TEST_DATABASE_URL_ENV} is not set`);
    return null;
  }
  try {
    await withAdminSql(adminUrl, async (sql) => {
      await sql`SELECT 1`;
    });
  } catch (error) {
    skipNotices.push(`postgres: skipped, ${TEST_DATABASE_URL_ENV} is set but unreachable (${shortError(error)})`);
    return null;
  }

  return {
    name: "postgres",
    async create(seed = []) {
      const database = `skills_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      await withAdminSql(adminUrl, async (sql) => {
        await sql.unsafe(`CREATE DATABASE "${database}"`);
      });
      const url = withDatabaseName(adminUrl, database);
      await runMigrations(url);
      const store = new PostgresSkillsStore(url);
      await seedStore(store, seed);
      return {
        store,
        allowEphemeralStore: false,
        close: async () => {
          await store.close();
          await withAdminSql(adminUrl, async (sql) => {
            await sql.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
          });
        },
      };
    },
  };
}

async function seedStore(store: SkillsProductStore, seed: SeedApiKey[]): Promise<void> {
  for (const entry of seed) {
    await store.ensureBootstrapApiKey?.(entry.token, entry.principal);
  }
}

type AdminSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  unsafe(query: string): Promise<unknown>;
  close?: () => Promise<void>;
};

async function withAdminSql<T>(url: string, fn: (sql: AdminSql) => Promise<T>): Promise<T> {
  const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => AdminSql };
  const sql = new bunWithSql.SQL(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.close?.();
  }
}

function withDatabaseName(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "<redacted-url>").split("\n")[0]!.slice(0, 120);
}
