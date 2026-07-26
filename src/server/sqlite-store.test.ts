import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicPrincipal } from "./auth.js";
import { SqliteSkillsStore, applySqliteMigrations } from "./sqlite-store.js";
import { resolveMigrationsDir } from "./migrations-dir.js";
import type { ApiPrincipal } from "./types.js";

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
