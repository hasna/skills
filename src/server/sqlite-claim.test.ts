/**
 * Proof that SQLite claiming is exclusive.
 *
 * Postgres gets exclusivity from `FOR UPDATE SKIP LOCKED`. SQLite has no row locks, so
 * SqliteSkillsStore builds the same guarantee from BEGIN IMMEDIATE plus a conditional
 * UPDATE by id. A claim that is silently non-exclusive is a duplicate-execution bug -
 * the same skill run twice, the same artifacts written twice, the same side effects
 * fired twice - and it would never show up in a single-threaded test, so it is worth
 * proving properly rather than asserting in a comment.
 *
 * Why subprocesses and not Promise.all: bun:sqlite is synchronous. Two "concurrent"
 * claims inside one process run to completion one after the other in a single turn of
 * the event loop, so an in-process race test would pass against an implementation with
 * no locking at all. Real contention needs real OS processes on separate connections,
 * released together by a wall-clock barrier so process startup jitter does not
 * serialise them for us.
 *
 * The suite includes a NEGATIVE CONTROL: the identical harness run against a
 * deliberately unsafe claimer (read, yield, write, with no status predicate) must
 * produce duplicates. Without it, "no duplicates observed" is equally consistent with a
 * correct implementation and with a harness that never created any contention.
 *
 * What this proves, precisely: that the shipped combination neither duplicates a claim
 * nor drops one under real multi-process contention, and that the harness is capable of
 * detecting duplicates when they exist. What it does NOT isolate is which arm carries
 * the guarantee. Mutating BEGIN IMMEDIATE to BEGIN, or busy_timeout to 0, fails this
 * suite - but as a SQLITE_BUSY crash rather than as duplicate claims. Removing the
 * UPDATE's status predicate does not fail it at all, because inside BEGIN IMMEDIATE that
 * predicate is unreachable defence in depth. The comments on claimNextRun say the same
 * thing; neither should be read as claiming test coverage the suite does not have.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSkillsStore } from "./sqlite-store.js";
import { publicPrincipal } from "./auth.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const WORKERS = 6;
const QUEUED_RUNS = 40;
const STORE_MODULE = join(import.meta.dir, "sqlite-store.ts");

interface RaceResult {
  claimed: string[];
  duplicates: string[];
  seeded: string[];
}

describe("sqlite claim exclusivity", () => {
  test("a run cannot be claimed twice by sequential claimers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-claim-seq-"));
    const store = new SqliteSkillsStore(join(dir, "server.db"));
    try {
      await store.ensureBootstrapApiKey("sk_seed", { orgId: "org_a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" });
      const principal = publicPrincipal({ orgId: "org_a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" });
      const run = await store.createRun({ principal, slug: "audio-transcript-pack", input: {}, args: [] });

      const first = await store.claimNextRun({ workerId: "worker_1" });
      expect(first?.id).toBe(run.id);
      expect(first?.status).toBe("running");

      // Already running, so it is no longer a candidate. A claimer that re-selected it
      // would hand the same job to a second worker.
      expect(await store.claimNextRun({ workerId: "worker_2" })).toBeNull();
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("claimNextRun preserves startedAt and records the claiming worker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-claim-meta-"));
    const store = new SqliteSkillsStore(join(dir, "server.db"));
    try {
      await store.ensureBootstrapApiKey("sk_seed", { orgId: "org_a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" });
      const principal = publicPrincipal({ orgId: "org_a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" });
      const run = await store.createRun({ principal, slug: "audio-transcript-pack", input: {}, args: [] });

      const claimed = await store.claimNextRun({ workerId: "worker_alpha" });
      expect(claimed?.startedAt).toBeTruthy();

      const row = store.database.query("SELECT locked_by, locked_at, started_at FROM skills_runs WHERE id = ?").get(run.id) as Record<string, unknown>;
      expect(row.locked_by).toBe("worker_alpha");
      expect(row.locked_at).toBeTruthy();

      // A retry re-queues the run; re-claiming must not rewrite the original start time,
      // matching Postgres's COALESCE(started_at, now()).
      await store.updateRun(run.id, { status: "retrying" });
      const reclaimed = await store.claimNextRun({ workerId: "worker_beta" });
      expect(reclaimed?.startedAt).toBe(claimed!.startedAt);
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${WORKERS} concurrent worker processes never claim the same run twice`, async () => {
    const result = await raceClaimers("safe");
    console.log(`[sqlite-claim] safe: ${WORKERS} processes, ${QUEUED_RUNS} queued, ${result.claimed.length} claims, ${result.duplicates.length} duplicates`);
    expect(result.duplicates).toEqual([]);
    // Not merely "no duplicates" - every seeded run must have been claimed exactly once.
    // A claimer that returned null on contention would show zero duplicates and a short
    // claim list, which is a different bug with the same first symptom.
    expect([...result.claimed].sort()).toEqual([...result.seeded].sort());
    expect(result.claimed.length).toBe(QUEUED_RUNS);
  }, 60_000);

  test("negative control: an unsafe read-then-write claimer does produce duplicates", async () => {
    const result = await raceClaimers("unsafe");
    console.log(`[sqlite-claim] unsafe control: ${WORKERS} processes, ${QUEUED_RUNS} queued, ${result.claimed.length} claims, ${result.duplicates.length} duplicates`);
    // Proves the harness above creates genuine contention. If this ever stops finding
    // duplicates, the passing "safe" result stops being evidence of anything.
    expect(result.duplicates.length).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * Seed a queue, release `WORKERS` subprocesses onto it simultaneously, and report what
 * each claimed.
 */
async function raceClaimers(mode: "safe" | "unsafe"): Promise<RaceResult> {
  const dir = mkdtempSync(join(tmpdir(), `skills-claim-${mode}-`));
  const dbPath = join(dir, "server.db");
  const scriptPath = join(dir, "claimer.ts");
  writeFileSync(scriptPath, claimerSource());

  const store = new SqliteSkillsStore(dbPath);
  const seeded: string[] = [];
  try {
    await store.ensureBootstrapApiKey("sk_seed", { orgId: "org_a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" });
    const principal = publicPrincipal({ orgId: "org_a", userId: "user_a", email: "a@example.com", apiKeyId: "key_a" });
    for (let i = 0; i < QUEUED_RUNS; i += 1) {
      const run = await store.createRun({ principal, slug: "audio-transcript-pack", input: { index: i }, args: [] });
      seeded.push(run.id);
    }
  } finally {
    // Close before racing so the parent holds no lock and every claim observed is
    // between the subprocesses.
    await store.close();
  }

  // Wall-clock barrier. Bun.spawn returns before the child has finished importing, so
  // without this the first worker would routinely drain the whole queue before the
  // last one had started and the test would prove nothing.
  const startAt = Date.now() + 750;
  const children = Array.from({ length: WORKERS }, (_, index) =>
    Bun.spawn(["bun", "run", scriptPath, dbPath, `worker_${index}`, mode, String(startAt), STORE_MODULE], {
      stdout: "pipe",
      stderr: "pipe",
    }),
  );

  const claimed: string[] = [];
  try {
    for (const child of children) {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`claimer exited ${code}: ${stderr || stdout}`);
      const line = stdout.trim().split("\n").filter(Boolean).at(-1);
      if (!line) throw new Error(`claimer produced no output. stderr: ${stderr}`);
      claimed.push(...(JSON.parse(line) as string[]));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of claimed) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  return { claimed, duplicates, seeded };
}

/**
 * The child program, written to a temp file rather than shipped as a repo module so the
 * unsafe variant cannot be mistaken for a usable implementation or imported by accident.
 *
 * `safe` goes through SqliteSkillsStore.claimNextRun. `unsafe` is the mistake this whole
 * test exists to rule out: select the head of the queue, yield, then update by id with
 * no status predicate - the shape you get from porting a SKIP LOCKED query to SQLite
 * without thinking about what replaced the lock.
 */
function claimerSource(): string {
  return `import { Database } from "bun:sqlite";
const [dbPath, workerId, mode, startAt, storeModule] = process.argv.slice(2);

const { SqliteSkillsStore } = await import(storeModule);
const store = mode === "safe" ? new SqliteSkillsStore(dbPath, { migrate: false }) : null;

const db = mode === "unsafe" ? new Database(dbPath, { readwrite: true }) : null;
if (db) {
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
while (Date.now() < Number(startAt)) await sleep(1);

const claimed = [];
let emptyStreak = 0;
while (emptyStreak < 25) {
  let id = null;
  if (store) {
    const run = await store.claimNextRun({ workerId });
    id = run ? run.id : null;
  } else {
    const row = db.query("SELECT id FROM skills_runs WHERE status IN ('queued','retrying') ORDER BY created_at ASC, rowid ASC LIMIT 1").get();
    if (row) {
      // The gap that makes read-then-write wrong. Long enough that every barrier-released
      // worker reads the same head row before any of them writes.
      await sleep(30);
      db.run("UPDATE skills_runs SET status = 'running', locked_by = ?, locked_at = ? WHERE id = ?", [workerId, new Date().toISOString(), row.id]);
      id = row.id;
    }
  }
  if (id) {
    claimed.push(id);
    emptyStreak = 0;
  } else {
    emptyStreak += 1;
    await sleep(2);
  }
}

if (store) await store.close();
if (db) db.close(false);
console.log(JSON.stringify(claimed));
`;
}
