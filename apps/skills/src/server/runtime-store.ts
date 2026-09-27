import { Database } from "bun:sqlite";
import { resolveDatabaseTarget } from "./database-url.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  RunExecutionStore,
  CreateAttemptInput,
  ClaimAttemptInput,
  LaunchIntentResult,
} from "../sdk/execution/storage.js";
import type {
  FrozenAdmission,
  ExecutionRunRow,
  AttemptRecord,
  AttemptReceipt,
  RunTransitionRecord,
  ExecutionRunStatus,
  TerminalRunStatus,
  ClaimResult,
} from "../sdk/execution/types.js";
import { isTerminalStatus } from "../sdk/execution/types.js";

export interface RuntimeArtifact {
  name: string;
  contentType: string;
  base64: string;
  sha256: string;
  byteSize: number;
}
export interface RuntimeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  artifacts: RuntimeArtifact[];
  error?: string;
}
export interface RuntimeJob {
  execution: ExecutionRunRow;
  attempts: AttemptRecord[];
  receipts: AttemptReceipt[];
  transitions: RunTransitionRecord[];
  input?: { content: string; title?: string } | { pattern: string; text: string; flags: string };
  bundleBase64?: string;
  result?: RuntimeResult;
}
const SCHEMA = `CREATE TABLE IF NOT EXISTS skills_runtime_jobs (run_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, skill_id TEXT NOT NULL, skill_version TEXT NOT NULL, bundle_digest TEXT NOT NULL, input_digest TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key));`;
type Sql = {
  (
    strings: TemplateStringsArray,
    ...args: unknown[]
  ): Promise<Record<string, unknown>[]>;
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
const clone = <T>(v: T): T => structuredClone(v);
const stamp = () => new Date().toISOString();

/** Each mutation locks the complete execution aggregate. Cross-process claims,
 * cancellation and receipts cannot interleave within one run. No process-local queue. */
export class RuntimeExecutionStore implements RunExecutionStore {
  readonly durable: boolean;
  private constructor(
    private sqlite?: Database,
    private postgres?: Sql,
    durable = true,
  ) {
    this.durable = durable;
  }
  static async open(databaseUrl?: string): Promise<RuntimeExecutionStore> {
    const target = resolveDatabaseTarget(databaseUrl);
    if (target.kind === "postgres") {
      const bun = await import("bun");
      const sql = new bun.SQL(target.url, { max: 3 }) as unknown as Sql;
      // PostgreSQL schema is managed by skills-migrate, never by competing replicas.
      try {
        await sql`SELECT run_id FROM skills_runtime_jobs LIMIT 0`;
      } catch {
        await sql.close().catch(() => {});
        throw Error(
          "Runtime database or schema unavailable; verify connectivity and run skills-migrate",
        );
      }
      return new RuntimeExecutionStore(undefined, sql);
    }
    const path = target.kind === "sqlite" ? target.path : ":memory:";
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.run("PRAGMA busy_timeout=5000");
    db.run("PRAGMA journal_mode=WAL");
    db.run(SCHEMA);
    return new RuntimeExecutionStore(db, undefined, target.durable);
  }
  async close() {
    this.sqlite?.close();
    await this.postgres?.close();
  }
  async job(runId: string): Promise<RuntimeJob | null> {
    const row = this.sqlite
      ? this.sqlite
          .query<
            { payload: string },
            [string]
          >("SELECT payload FROM skills_runtime_jobs WHERE run_id=?")
          .get(runId)
      : (
          await this
            .postgres!`SELECT payload FROM skills_runtime_jobs WHERE run_id=${runId}`
        )[0];
    return row ? JSON.parse(String(row.payload)) : null;
  }
  async mutate<T>(id: string, fn: (job: RuntimeJob) => T): Promise<T | null> {
    if (this.sqlite)
      return this.sqlite
        .transaction(() => {
          const row = this.sqlite!.query<{ payload: string }, [string]>(
            "SELECT payload FROM skills_runtime_jobs WHERE run_id=?",
          ).get(id);
          if (!row) return null;
          const job: RuntimeJob = JSON.parse(row.payload);
          const result = fn(job);
          this.sqlite!.query(
            "UPDATE skills_runtime_jobs SET payload=?,status=? WHERE run_id=?",
          ).run(JSON.stringify(job), job.execution.status, id);
          return clone(result);
        })
        .immediate();
    return this.postgres!.begin(async (tx) => {
      const row = (
        await tx`SELECT payload FROM skills_runtime_jobs WHERE run_id=${id} FOR UPDATE`
      )[0];
      if (!row) return null;
      const job: RuntimeJob = JSON.parse(String(row.payload));
      const result = fn(job);
      await tx`UPDATE skills_runtime_jobs SET payload=${JSON.stringify(job)},status=${job.execution.status} WHERE run_id=${id}`;
      return clone(result);
    });
  }
  async admit(admission: FrozenAdmission): Promise<ExecutionRunRow> {
    const job: RuntimeJob = {
      execution: {
        admission,
        status: "admitted",
        currentAttemptId: null,
        terminalReceiptId: null,
        updatedAt: admission.createdAt,
      },
      attempts: [],
      receipts: [],
      transitions: [],
    };
    if (this.sqlite)
      this.sqlite
        .transaction(() => {
          const old = this.sqlite!.query(
            "SELECT run_id FROM skills_runtime_jobs WHERE tenant_id=? AND idempotency_key=?",
          ).get(admission.tenantId, admission.idempotencyKey);
          if (old) return;
          const active = this.sqlite!.query<{ n: number }, [string]>(
            "SELECT COUNT(*) n FROM skills_runtime_jobs WHERE tenant_id=? AND status IN ('admitted','leased','running')",
          ).get(admission.tenantId);
          if ((active?.n ?? 0) >= 1)
            throw Error("Runtime concurrency limit reached");
          this.sqlite!.query(
            "INSERT INTO skills_runtime_jobs(run_id,tenant_id,idempotency_key,skill_id,skill_version,bundle_digest,input_digest,status,payload) VALUES(?,?,?,?,?,?,?,?,?)",
          ).run(
            admission.runId,
            admission.tenantId,
            admission.idempotencyKey,
            admission.skillId,
            admission.skillVersion,
            admission.bundleDigest,
            admission.inputDigest,
            "admitted",
            JSON.stringify(job),
          );
        })
        .immediate();
    else
      await this.postgres!.begin(async (tx) => {
        // A tenant advisory lock also serializes the empty-queue case: locking only
        // existing rows cannot prevent two first submissions from both seeing zero.
        await tx`SELECT pg_advisory_xact_lock(hashtext(${"skills-runtime:" + admission.tenantId}))`;
        const old =
          await tx`SELECT run_id FROM skills_runtime_jobs WHERE tenant_id=${admission.tenantId} AND idempotency_key=${admission.idempotencyKey}`;
        if (old.length) return;
        const active =
          await tx`SELECT COUNT(*) n FROM skills_runtime_jobs WHERE tenant_id=${admission.tenantId} AND status IN ('admitted','leased','running')`;
        if (Number(active[0]?.n ?? 0) >= 1)
          throw Error("Runtime concurrency limit reached");
        await tx`INSERT INTO skills_runtime_jobs(run_id,tenant_id,idempotency_key,skill_id,skill_version,bundle_digest,input_digest,status,payload) VALUES(${admission.runId},${admission.tenantId},${admission.idempotencyKey},${admission.skillId},${admission.skillVersion},${admission.bundleDigest},${admission.inputDigest},${"admitted"},${JSON.stringify(job)})`;
      });
    const existing = await this.getRunByKey(
      admission.tenantId,
      admission.idempotencyKey,
    );
    if (!existing) throw Error("Runtime admission did not persist");
    return existing;
  }
  async activeJobs(limit = 20): Promise<RuntimeJob[]> {
    const rows = this.sqlite
      ? this.sqlite
          .query<
            { payload: string },
            [number]
          >("SELECT payload FROM skills_runtime_jobs WHERE status IN ('admitted','leased','running') ORDER BY run_id LIMIT ?")
          .all(limit)
      : await this
          .postgres!`SELECT payload FROM skills_runtime_jobs WHERE status IN ('admitted','leased','running') ORDER BY run_id LIMIT ${limit}`;
    return rows.map((row) => JSON.parse(String(row.payload)) as RuntimeJob);
  }
  async getRun(id: string) {
    return (await this.job(id))?.execution ?? null;
  }
  async getRunByKey(
    tenant: string,
    key: string,
  ): Promise<ExecutionRunRow | null> {
    const row = this.sqlite
      ? this.sqlite
          .query<
            { payload: string },
            [string, string]
          >("SELECT payload FROM skills_runtime_jobs WHERE tenant_id=? AND idempotency_key=?")
          .get(tenant, key)
      : (
          await this
            .postgres!`SELECT payload FROM skills_runtime_jobs WHERE tenant_id=${tenant} AND idempotency_key=${key}`
        )[0];
    return row
      ? (JSON.parse(String(row.payload)) as RuntimeJob).execution
      : null;
  }
  async getRunByDigests(input: {
    tenantId: string;
    skillId: string;
    skillVersion: string;
    bundleDigest: string;
    inputDigest: string;
  }): Promise<ExecutionRunRow | null> {
    const { tenantId, skillId, skillVersion, bundleDigest, inputDigest } =
      input;
    const row = this.sqlite
      ? this.sqlite
          .query<
            { payload: string },
            [string, string, string, string, string]
          >("SELECT payload FROM skills_runtime_jobs WHERE tenant_id=? AND skill_id=? AND skill_version=? AND bundle_digest=? AND input_digest=? LIMIT 1")
          .get(tenantId, skillId, skillVersion, bundleDigest, inputDigest)
      : (
          await this
            .postgres!`SELECT payload FROM skills_runtime_jobs WHERE tenant_id=${tenantId} AND skill_id=${skillId} AND skill_version=${skillVersion} AND bundle_digest=${bundleDigest} AND input_digest=${inputDigest} LIMIT 1`
        )[0];
    return row
      ? (JSON.parse(String(row.payload)) as RuntimeJob).execution
      : null;
  }
  async listAttempts(id: string) {
    return (await this.job(id))?.attempts ?? [];
  }
  async createAttempt(input: CreateAttemptInput): Promise<AttemptRecord> {
    const result = await this.mutate(input.runId, (job) => {
      if (isTerminalStatus(job.execution.status))
        throw Error("Runtime run is terminal");
      const found = job.attempts.find(
        (a) => a.attemptNumber === input.attemptNumber,
      );
      if (found) return found;
      const attempt: AttemptRecord = {
        runId: input.runId,
        attemptId: `${input.runId}/attempt/${input.attemptNumber}`,
        attemptNumber: input.attemptNumber,
        leaseGeneration: 0,
        workerId: null,
        claimedAt: null,
        status: "pending",
        clientToken: null,
        requestDigest: null,
        taskId: null,
        launchState: "unlaunched",
        startedBy: null,
      };
      job.attempts.push(attempt);
      return attempt;
    });
    if (!result) throw Error("Runtime run not found");
    return result;
  }
  async claimAttempt(input: ClaimAttemptInput): Promise<ClaimResult> {
    return (
      (await this.mutate(input.runId, (job) => {
        if (job.execution.status === "cancelled")
          return { ok: false, reason: "RUN_CANCELLED" } as const;
        if (isTerminalStatus(job.execution.status))
          return { ok: false, reason: "RUN_TERMINAL" } as const;
        const a = job.attempts.find((a) => a.attemptId === input.attemptId);
        if (!a) return { ok: false, reason: "NO_SUCH_ATTEMPT" } as const;
        if (a.status === "terminal")
          return { ok: false, reason: "ATTEMPT_TERMINAL" } as const;
        if (a.leaseGeneration !== input.expectedLeaseGeneration)
          return { ok: false, reason: "STALE_GENERATION" } as const;
        a.leaseGeneration++;
        a.workerId = input.workerId;
        a.claimedAt = stamp();
        a.status = "leased";
        job.execution.status = "leased";
        job.execution.currentAttemptId = a.attemptId;
        return {
          ok: true,
          attempt: a,
          leaseGeneration: a.leaseGeneration,
        } as const;
      })) ?? { ok: false, reason: "NO_SUCH_ATTEMPT" }
    );
  }
  async recordLaunchIntent(input: {
    runId: string;
    attemptId: string;
    clientToken: string;
    requestDigest: string;
    startedBy: string;
  }): Promise<LaunchIntentResult> {
    return (
      (await this.mutate(input.runId, (job) => {
        if (job.execution.status === "cancelled")
          return { ok: false, reason: "RUN_CANCELLED" } as const;
        if (isTerminalStatus(job.execution.status))
          return { ok: false, reason: "RUN_TERMINAL" } as const;
        const a = job.attempts.find((a) => a.attemptId === input.attemptId);
        if (!a) return { ok: false, reason: "NO_SUCH_ATTEMPT" } as const;
        if (a.status === "terminal")
          return { ok: false, reason: "ATTEMPT_TERMINAL" } as const;
        if (
          a.clientToken &&
          (a.clientToken !== input.clientToken ||
            a.requestDigest !== input.requestDigest)
        )
          throw Error("Conflicting launch intent");
        Object.assign(a, {
          clientToken: input.clientToken,
          requestDigest: input.requestDigest,
          startedBy: input.startedBy,
          launchState: "launching",
        });
        job.execution.currentAttemptId = a.attemptId;
        return { ok: true, attempt: a } as const;
      })) ?? { ok: false, reason: "NO_SUCH_ATTEMPT" }
    );
  }
  async recordLaunchState(input: {
    runId: string;
    attemptId: string;
    launchState: AttemptRecord["launchState"];
    taskId?: string | null;
  }) {
    return await this.mutate(input.runId, (job) => {
      const a = job.attempts.find((a) => a.attemptId === input.attemptId);
      if (!a) return null;
      if (a.taskId && input.taskId && a.taskId !== input.taskId)
        throw Error("Task identity changed");
      a.launchState = input.launchState;
      if (input.taskId !== undefined) a.taskId = input.taskId;
      return a;
    });
  }
  async recordTransition(t: RunTransitionRecord) {
    await this.mutate(t.runId, (j) => {
      j.transitions.push(t);
    });
  }
  async markAttemptTerminal(id: string, attemptId: string) {
    return await this.mutate(id, (j) => {
      const a = j.attempts.find((a) => a.attemptId === attemptId);
      if (a) a.status = "terminal";
      return a ?? null;
    });
  }
  async writeReceipt(receipt: AttemptReceipt) {
    return (
      (await this.mutate(receipt.runId, (j) => {
        const old = j.receipts.find((r) => r.attemptId === receipt.attemptId);
        if (old?.completedAt && JSON.stringify(old) !== JSON.stringify(receipt))
          throw Error("Terminal receipt is immutable");
        if (old) Object.assign(old, receipt);
        else j.receipts.push(receipt);
        return receipt;
      })) ?? Promise.reject(Error("Runtime run not found"))
    );
  }
  async getReceipt(id: string, attempt: string) {
    return (
      (await this.job(id))?.receipts.find((r) => r.attemptId === attempt) ??
      null
    );
  }
  async finalizeRun(id: string, status: TerminalRunStatus, receiptId: string) {
    return await this.mutate(id, (j) => {
      if (j.execution.status === "cancelled" && status !== "cancelled")
        throw Error("Cancelled execution is fenced");
      if (isTerminalStatus(j.execution.status) && j.execution.status !== status)
        throw Error("Terminal execution is immutable");
      Object.assign(j.execution, {
        status,
        terminalReceiptId: receiptId,
        updatedAt: stamp(),
      });
      for (const a of j.attempts) a.status = "terminal";
      return j.execution;
    });
  }
  async setRunStatus(id: string, status: ExecutionRunStatus) {
    return await this.mutate(id, (j) => {
      if (isTerminalStatus(j.execution.status) && j.execution.status !== status)
        throw Error("Terminal execution is immutable");
      j.execution.status = status;
      j.execution.updatedAt = stamp();
      return j.execution;
    });
  }
}
