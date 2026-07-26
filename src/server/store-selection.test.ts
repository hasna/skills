/**
 * Backend selection, and the guard against the healthy-but-amnesiac server.
 *
 * The bug being locked out: `createStore()` used to read
 * `options.databaseUrl ? Postgres : Memory`. Starting the server with nothing configured
 * - by far the most likely way anyone starts it - produced a process that answered
 * /health with `ok: true`, served real traffic, and dropped every run, log, and artifact
 * on restart, with no warning at any point. These tests assert that no input which omits
 * configuration can produce a non-durable store, and that a non-durable store which was
 * asked for by name is refused at startup rather than served from.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { getDataDir } from "../lib/config.js";
import { assertDurableStore, createSkillsFetchHandler } from "./app.js";
import { resolveServerConfig } from "./config.js";
import { DEFAULT_SQLITE_FILENAME, defaultSqlitePath, resolveDatabaseTarget } from "./database-url.js";
import { MemorySkillsStore, createStore } from "./store.js";
import { SqliteSkillsStore } from "./sqlite-store.js";

const UNREACHABLE_POSTGRES = "postgres://someuser:hunter2-not-a-real-password@127.0.0.1:1/skills";

describe("database target resolution", () => {
  test("no configuration resolves to a durable SQLite database in the skills data dir", () => {
    const target = resolveDatabaseTarget(undefined);
    expect(target).toMatchObject({ kind: "sqlite", durable: true });
    expect(target.kind === "sqlite" && target.path).toBe(join(getDataDir(), DEFAULT_SQLITE_FILENAME));
    expect(defaultSqlitePath()).toBe(join(getDataDir(), DEFAULT_SQLITE_FILENAME));
  });

  test("the default database lives at the app root, not inside the installed corpus", () => {
    // PR #50 moved installed skills into <data dir>/installed/ and left app data at the
    // app root. Server state is app data; putting it under installed/ would mix a
    // database into the one directory that now holds exactly one kind of thing.
    expect(defaultSqlitePath()).not.toContain(`${join("", "installed")}${join("", "/")}`);
    expect(defaultSqlitePath().split("/").at(-2)).not.toBe("installed");
  });

  test("blank and whitespace-only configuration is treated as unconfigured, not as an error", () => {
    for (const value of ["", "   ", "\n"]) {
      expect(resolveDatabaseTarget(value)).toMatchObject({ kind: "sqlite", durable: true });
    }
  });

  test("an explicit postgres URL wins", () => {
    for (const url of ["postgres://user:pw@db.internal:5432/skills", "postgresql://user@localhost/skills"]) {
      expect(resolveDatabaseTarget(url)).toMatchObject({ kind: "postgres", url, durable: true });
    }
  });

  test("sqlite paths and URLs resolve to that file", () => {
    expect(resolveDatabaseTarget("/srv/skills/server.db")).toMatchObject({ kind: "sqlite", path: "/srv/skills/server.db", durable: true });
    expect(resolveDatabaseTarget("sqlite:/srv/skills/server.db")).toMatchObject({ kind: "sqlite", path: "/srv/skills/server.db" });
    expect(resolveDatabaseTarget("sqlite:///srv/skills/server.db")).toMatchObject({ kind: "sqlite", path: "/srv/skills/server.db" });
    expect(resolveDatabaseTarget("file:///srv/skills/server.db")).toMatchObject({ kind: "sqlite", path: "/srv/skills/server.db" });
    expect(resolveDatabaseTarget("data/skills.sqlite")).toMatchObject({ kind: "sqlite", path: join(process.cwd(), "data/skills.sqlite") });
  });

  test("non-durable backends exist only when named explicitly", () => {
    // ":memory:" is SQLite's own literal and stays a real SQLite database with real SQL
    // semantics; "memory:" selects the in-process Map. Both are non-durable, and neither
    // is reachable without asking for it.
    expect(resolveDatabaseTarget(":memory:")).toMatchObject({ kind: "sqlite", durable: false });
    expect(resolveDatabaseTarget("sqlite::memory:")).toMatchObject({ kind: "sqlite", durable: false });
    expect(resolveDatabaseTarget("memory:")).toMatchObject({ kind: "memory", durable: false });
    // SQLite's URI query parameters must not push the value onto the file-path branch,
    // which would create a file literally named ":memory:?cache=shared".
    for (const value of ["sqlite::memory:?cache=shared", "file::memory:"]) {
      expect(resolveDatabaseTarget(value)).toMatchObject({ kind: "sqlite", path: ":memory:", durable: false });
    }
  });

  test("an unsupported scheme throws instead of being reinterpreted as a file path", () => {
    // The failure mode this prevents: "mysql://..." silently becoming a SQLite file
    // named "mysql:", i.e. an empty database that looks like data loss rather than like
    // the configuration error it is.
    for (const url of ["mysql://user@host/db", "redis://host:6379", "mongodb://host/db"]) {
      expect(() => resolveDatabaseTarget(url)).toThrow(/unsupported database scheme/);
    }
    expect(() => resolveDatabaseTarget("just-a-word")).toThrow(/could not resolve a database backend/);
  });
});

describe("createStore", () => {
  test("returns a durable SQLite store when nothing is configured", async () => {
    const store = await createStore({});
    try {
      expect(store).toBeInstanceOf(SqliteSkillsStore);
      expect(store.backend).toMatchObject({ kind: "sqlite", durable: true });
      // The regression, stated directly: unconfigured must never be the Map.
      expect(store).not.toBeInstanceOf(MemorySkillsStore);
    } finally {
      await store.close?.();
    }
  });

  test("returns the non-durable store only when it is named", async () => {
    const store = await createStore({ databaseUrl: "memory:" });
    expect(store).toBeInstanceOf(MemorySkillsStore);
    expect(store.backend).toMatchObject({ kind: "memory", durable: false });
  });

  test("an unreachable Postgres URL fails loudly instead of degrading to another backend", async () => {
    // Degrading would be worse than crashing: the server would come up on an empty
    // SQLite file, accept writes, and leave the operator with data split across two
    // stores and no signal that it happened.
    let thrown: unknown;
    try {
      await createStore({ databaseUrl: UNREACHABLE_POSTGRES });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("cannot reach the configured Postgres database");
    // The URL is a credential. It must not survive into a log line.
    expect(message).not.toContain("hunter2-not-a-real-password");
    expect(message).not.toContain("postgres://");
  }, 30_000);
});

describe("startup durability guard", () => {
  test("assertDurableStore refuses a store that declares itself non-durable", () => {
    const store = new MemorySkillsStore();
    expect(() => assertDurableStore(store, { allowEphemeralStore: false })).toThrow(/refusing to start/);
    expect(() => assertDurableStore(store, { allowEphemeralStore: false })).toThrow(/HASNA_SKILLS_ALLOW_EPHEMERAL_STORE/);
  });

  test("assertDurableStore accepts durable stores and an explicit opt-in", () => {
    const memory = new MemorySkillsStore();
    expect(() => assertDurableStore(memory, { allowEphemeralStore: true })).not.toThrow();

    const sqlite = new SqliteSkillsStore(join(getDataDir(), "guard.db"));
    try {
      expect(() => assertDurableStore(sqlite, { allowEphemeralStore: false })).not.toThrow();
    } finally {
      void sqlite.close();
    }
  });

  test("a store that declares no backend is accepted, since durability cannot be inferred", () => {
    // Third-party implementations of the store seam predate StoreBackendInfo. The guard
    // exists to make our own defaults safe, not to reject stores it knows nothing about.
    const opaque = { ...new MemorySkillsStore(), backend: undefined } as unknown as MemorySkillsStore;
    expect(() => assertDurableStore(opaque, { allowEphemeralStore: false })).not.toThrow();
  });

  test("the server will not start on an ephemeral store without the opt-in", async () => {
    await expect(
      createSkillsFetchHandler({ store: new MemorySkillsStore(), config: { allowEphemeralStore: false } }),
    ).rejects.toThrow(/refusing to start/);
  });

  test("the server starts unconfigured and is durable, with a working health endpoint", async () => {
    // The end-to-end version of the fix: no environment, no flags, and what comes up is
    // backed by a file that outlives the process.
    const handler = await createSkillsFetchHandler({ config: { inlineWorker: false } });
    const server = Bun.serve({ port: 0, fetch: handler });
    try {
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true, mode: "self-hosted" });
      // /health reporting ok now means something: the store behind it is on disk.
      expect(resolveDatabaseTarget(undefined)).toMatchObject({ durable: true });
    } finally {
      server.stop(true);
    }
  });

  test("the ephemeral opt-in is off unless explicitly set to 1", () => {
    expect(resolveServerConfig({}).allowEphemeralStore).toBe(false);
    expect(resolveServerConfig({ HASNA_SKILLS_ALLOW_EPHEMERAL_STORE: "0" }).allowEphemeralStore).toBe(false);
    expect(resolveServerConfig({ HASNA_SKILLS_ALLOW_EPHEMERAL_STORE: "true" }).allowEphemeralStore).toBe(false);
    expect(resolveServerConfig({ HASNA_SKILLS_ALLOW_EPHEMERAL_STORE: "1" }).allowEphemeralStore).toBe(true);
  });
});
