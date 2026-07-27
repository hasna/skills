import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicPrincipal } from "./auth.js";
import { SqliteSkillsStore, applySqliteMigrations } from "./sqlite-store.js";
import { resolveMigrationsDir } from "./migrations-dir.js";
import type { ApiPrincipal } from "./types.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

let artifactSeq = 0;

const ORG_A: Partial<ApiPrincipal> = { orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" };
const ORG_B: Partial<ApiPrincipal> = { orgId: "org_b", orgSlug: "org-b", orgName: "Org B", userId: "user_b", email: "b@example.com", apiKeyId: "key_b" };

let dir: string;
let dbPath: string;
let store: SqliteSkillsStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "skills-sqlite-"));
  dbPath = join(dir, "server.db");
  store = new SqliteSkillsStore(dbPath);
  await store.ensureBootstrapApiKey("sk_a", ORG_A);
  await store.ensureBootstrapApiKey("sk_b", ORG_B);
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seedRunWithArtifact(principal: ApiPrincipal) {
  const run = await store.createRun({ principal, slug: "audio-transcript-pack", input: { text: "secret" }, args: ["--title", "Demo"] });
  await store.appendLog(run.id, principal.orgId, "info", "generated transcript.md");
  const artifact = await store.addArtifact({
    id: `art_${principal.orgId}_${(artifactSeq += 1)}`,
    runId: run.id,
    orgId: principal.orgId,
    fileName: "transcript.md",
    relativePath: "transcript.md",
    contentType: "text/markdown",
    byteSize: 6,
    sha256: "abc123",
    storageKind: "db",
    bodyText: "secret",
  });
  return { run, artifact };
}

describe("SqliteSkillsStore org scoping", () => {
  test("org B cannot read org A's run, logs, or artifacts", async () => {
    const a = publicPrincipal(ORG_A);
    const b = publicPrincipal(ORG_B);
    const { run, artifact } = await seedRunWithArtifact(a);

    // Owner can read everything.
    expect((await store.getRun(a, run.id))?.id).toBe(run.id);
    expect(await store.listLogs(a, run.id)).toHaveLength(1);
    expect((await store.getArtifact(a, run.id, artifact.id))?.bodyText).toBe("secret");

    // A different org, given the exact ids, gets nothing. Knowing the id is not
    // authorization - every read carries the org predicate, matching Postgres.
    expect(await store.getRun(b, run.id)).toBeNull();
    expect(await store.listLogs(b, run.id)).toEqual([]);
    expect(await store.listArtifacts(b, run.id)).toEqual([]);
    expect(await store.getArtifact(b, run.id, artifact.id)).toBeNull();
    expect(await store.listRuns(b, 50)).toEqual([]);
  });

  test("listRuns returns only the caller's organization", async () => {
    const a = publicPrincipal(ORG_A);
    const b = publicPrincipal(ORG_B);
    await seedRunWithArtifact(a);
    await seedRunWithArtifact(a);
    const mine = await seedRunWithArtifact(b);

    expect((await store.listRuns(a, 50)).map((run) => run.orgId)).toEqual(["org_a", "org_a"]);
    expect((await store.listRuns(b, 50)).map((run) => run.id)).toEqual([mine.run.id]);
  });

  test("idempotency keys are scoped per organization", async () => {
    const a = publicPrincipal(ORG_A);
    const b = publicPrincipal(ORG_B);
    const first = await store.createRun({ principal: a, slug: "audio-transcript-pack", input: {}, args: [], idempotencyKey: "shared-key" });
    const repeat = await store.createRun({ principal: a, slug: "audio-transcript-pack", input: {}, args: [], idempotencyKey: "shared-key" });
    expect(repeat.id).toBe(first.id);

    // The same key in a different org must produce a different run: the uniqueness
    // constraint is (org_id, idempotency_key), so one tenant's key cannot collide with
    // - or reveal - another's.
    const other = await store.createRun({ principal: b, slug: "audio-transcript-pack", input: {}, args: [], idempotencyKey: "shared-key" });
    expect(other.id).not.toBe(first.id);
    expect(other.orgId).toBe("org_b");
  });
});

describe("SqliteSkillsStore durability and schema", () => {
  test("data survives closing and reopening the database file", async () => {
    const a = publicPrincipal(ORG_A);
    const { run } = await seedRunWithArtifact(a);
    await store.close();

    // The whole point of the SQLite default: a restart is not a data-loss event.
    const reopened = new SqliteSkillsStore(dbPath);
    try {
      expect((await reopened.getRun(a, run.id))?.id).toBe(run.id);
      expect(await reopened.listLogs(a, run.id)).toHaveLength(1);
      expect(await reopened.listArtifacts(a, run.id)).toHaveLength(1);
    } finally {
      await reopened.close();
    }
    // Reassign so afterEach's close() has a live handle to close.
    store = new SqliteSkillsStore(dbPath);
  });

  test("concurrent first opens of a brand-new database all succeed", async () => {
    // The zero-config topology starts `skills-server` and `skills-worker` against a file
    // that does not exist yet. Converting a fresh database to WAL takes an exclusive
    // lock, so if busy_timeout is not installed BEFORE that pragma, the second opener
    // gets a bare "database is locked" with no path and no hint to retry.
    //
    // Separate processes, not Promise.all: bun:sqlite is synchronous, so six "parallel"
    // constructions in one process run one after another in a single tick and cannot
    // contend at all. An in-process version of this test passes against the broken
    // pragma order - verified - which would have made it worse than no test.
    const fresh = join(dir, "concurrent.db");
    const script = join(dir, "open-probe.ts");
    writeFileSync(
      script,
      `const [dbPath, startAt, storeModule] = process.argv.slice(2);
const { SqliteSkillsStore } = await import(storeModule);
while (Date.now() < Number(startAt)) await new Promise((r) => setTimeout(r, 1));
const store = new SqliteSkillsStore(dbPath);
const mode = store.database.query("PRAGMA journal_mode").get().journal_mode;
const tables = store.database.query("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().n;
await store.close();
console.log(JSON.stringify({ mode, tables }));
`,
    );

    const startAt = Date.now() + 600;
    const children = Array.from({ length: 6 }, () =>
      Bun.spawn(["bun", "run", script, fresh, String(startAt), join(import.meta.dir, "sqlite-store.ts")], { stdout: "pipe", stderr: "pipe" }),
    );
    const results = await Promise.all(
      children.map(async (child) => {
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { code, stdout: stdout.trim(), stderr: stderr.trim() };
      }),
    );

    // Every process must have opened the database, converted it to WAL, and seen the
    // full migrated schema. A single "database is locked" here is the bug.
    for (const result of results) {
      expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" });
      // 12 since migration 0002 added skills_bundles. The count is asserted rather than
      // ranged so that a migration silently failing to apply is a failure here.
      expect(JSON.parse(result.stdout.split("\n").at(-1)!)).toEqual({ mode: "wal", tables: 12 });
    }
  }, 60_000);

  test("an unopenable database path reports the path and the setting that moves it", () => {
    // Raw bun:sqlite says "unable to open database file" for a read-only mount, a
    // missing parent, and a path that is a directory alike, naming none of them.
    expect(() => new SqliteSkillsStore(dir)).toThrow(/cannot open the skills database at/);
    expect(() => new SqliteSkillsStore(dir)).toThrow(/HASNA_SKILLS_DATABASE_URL/);
  });

  test("opening a store creates the file and applies migrations exactly once", async () => {
    expect(existsSync(dbPath)).toBe(true);
    // Re-running the migrator against an up-to-date database is a no-op, which is what
    // makes migrate-on-open safe to do on every start.
    expect(applySqliteMigrations(store.database, resolveMigrationsDir("sqlite"))).toEqual([]);
  });

  test("foreign keys are enforced, so a run cannot reference a missing organization", async () => {
    const ghost = publicPrincipal({ orgId: "org_missing", userId: "user_missing" });
    // SQLite ignores REFERENCES unless PRAGMA foreign_keys is on. Without it the org
    // model would be advisory here and enforced on Postgres - the exact cross-backend
    // divergence the shared schema is meant to prevent.
    await expect(store.createRun({ principal: ghost, slug: "audio-transcript-pack", input: {}, args: [] })).rejects.toThrow();
  });

  test("the status CHECK constraint rejects values outside the run status domain", () => {
    expect(() =>
      store.database.run("INSERT INTO skills_runs (id, org_id, user_id, skill_slug, requested_slug, status, correlation_id) VALUES (?,?,?,?,?,?,?)", [
        "run_bad",
        "org_a",
        "user_a",
        "audio-transcript-pack",
        "audio-transcript-pack",
        "not_a_real_status",
        "corr",
      ]),
    ).toThrow();
  });

  test("log sequences are contiguous per run and isolated between runs", async () => {
    const a = publicPrincipal(ORG_A);
    const one = await store.createRun({ principal: a, slug: "audio-transcript-pack", input: {}, args: [] });
    const two = await store.createRun({ principal: a, slug: "audio-transcript-pack", input: {}, args: [] });
    for (const message of ["first", "second", "third"]) await store.appendLog(one.id, "org_a", "info", message);
    await store.appendLog(two.id, "org_a", "warn", "other run");

    expect((await store.listLogs(a, one.id)).map((log) => log.sequence)).toEqual([1, 2, 3]);
    expect((await store.listLogs(a, one.id)).map((log) => log.message)).toEqual(["first", "second", "third"]);
    expect((await store.listLogs(a, two.id)).map((log) => log.sequence)).toEqual([1]);
  });

  test("json columns round-trip through text storage", async () => {
    const a = publicPrincipal(ORG_A);
    const input = { nested: { list: [1, 2, 3] }, flag: true, text: "quote\"and'apostrophe" };
    const run = await store.createRun({ principal: a, slug: "audio-transcript-pack", input, args: ["--a", "--b"] });
    const read = await store.getRun(a, run.id);
    expect(read?.input).toEqual(input);
    expect(read?.args).toEqual(["--a", "--b"]);
  });

  test("timestamps are stored as UTC ISO-8601 so they sort chronologically", async () => {
    const a = publicPrincipal(ORG_A);
    const run = await store.createRun({ principal: a, slug: "audio-transcript-pack", input: {}, args: [] });
    expect(run.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The schema default must produce the same format as the store's explicit writes,
    // or raw-SQL inserts would sort inconsistently against store-written rows.
    const generated = store.database.query("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS at").get() as { at: string };
    expect(generated.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("an authenticated principal carries its scopes back out of storage", async () => {
    const principal = await store.authenticateApiKeyHash(await hash("sk_a"));
    expect(principal).toMatchObject({ orgId: "org_a", orgSlug: "org-a", userId: "user_a", role: "owner" });
    expect(principal?.scopes).toEqual(["skills:read", "runs:write"]);
  });
});

async function hash(token: string): Promise<string> {
  const { hashApiKey } = await import("./auth.js");
  return hashApiKey(token);
}
