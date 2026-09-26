import { assertReservationCents } from "./amounts.js";
/**
 * GovernanceStore: the append-only lifecycle ledger + spend ledger behind the
 * governance services.
 *
 * Deliberately a SEPARATE seam from SkillsProductStore: the product seam is a
 * published contract third parties implement, and bolting receipt/reservation
 * methods onto it would make every implementation carry controls only the
 * hosted path needs. This seam owns four things:
 *
 *   - skills_lifecycle_receipts: append-only. There is no update or delete
 *     surface here - a receipt is a fact that happened.
 *   - skills_credit_reservations: reserve before dispatch, reconcile once at
 *     terminal state.
 *   - artifact row deletion / quarantine key rewrite, so the expiry sweep and
 *     cancellation can retire rows without growing the product seam.
 *   - ceiling reads: active run count and monthly spend per org.
 */
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDatabaseTarget, SQLITE_MEMORY_PATH } from "../server/database-url.js";
import { applySqliteMigrations } from "../server/sqlite-store.js";
import { nowIso, parseJsonObject, rowToArtifact } from "../server/rows.js";
import type { ServerArtifact } from "../server/types.js";

export type ReceiptKind = "delete" | "quarantine" | "cancel";

export interface LifecycleReceipt {
  id: string;
  kind: ReceiptKind;
  orgId: string;
  runId: string;
  artifactId?: string;
  /** Stable, non-secret identity of the requester: a principal email, an api key id, a worker id. */
  requestedBy: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type ReservationStatus = "reserved" | "charged" | "released";

export interface CreditReservation {
  id: string;
  orgId: string;
  runId: string;
  /** Per-reservation integer cents (0..2147483647) across all store backends. */
  estimatedCents: number;
  /** Settled integer cents in the same per-reservation range. */
  actualCents?: number;
  status: ReservationStatus;
  createdAt: string;
  reconciledAt?: string;
}

export interface GovernanceStore {
  readonly backend: string;
  close?(): Promise<void>;
  appendReceipt(receipt: Omit<LifecycleReceipt, "id" | "createdAt">): Promise<LifecycleReceipt>;
  listReceipts(orgId: string, runId: string): Promise<LifecycleReceipt[]>;
  createReservation(input: {
    orgId: string;
    runId: string;
    estimatedCents: number;
  }): Promise<CreditReservation>;
  reservationsForRun(orgId: string, runId: string): Promise<CreditReservation[]>;
  /** First terminal reconciliation wins; retries return that persisted state unchanged. */
  reconcileReservation(reservationId: string, actualCents: number, status: "charged" | "released"): Promise<CreditReservation | null>;
  /** Sum of cost_cents of runs created in the given calendar month (YYYY-MM), plus un-reconciled reservations. */
  monthlySpendCents(orgId: string, monthPrefix: string): Promise<number>;
  /** Runs currently admitted (queued/running/cancelling), the concurrency ceiling's subject. */
  activeRunCount(orgId: string): Promise<number>;
  /** Artifacts whose expires_at is at or before `nowIso`, the expiry sweep's subjects. */
  listExpiredArtifacts(nowIso: string): Promise<ServerArtifact[]>;
  /** Permanently remove an artifact row. The object deletion is the storage's job. */
  deleteArtifactRow(artifactId: string, orgId: string): Promise<boolean>;
  /** Rewrite an artifact's storage key (quarantine move); row and object move together. */
  updateArtifactStorageKey(artifactId: string, orgId: string, storageKey: string): Promise<boolean>;
}

export function receiptId(): string {
  return `rcpt_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function reservationId(): string {
  return `res_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

const EXPIRED_ARTIFACT_SQL = `
  SELECT a.* FROM skills_artifacts a
  JOIN skills_runs r ON r.id = a.run_id
  WHERE a.expires_at IS NOT NULL AND a.expires_at <= ?
  ORDER BY a.expires_at ASC
`;

const ACTIVE_RUN_SQL = `
  SELECT COUNT(*) AS n FROM skills_runs
  WHERE org_id = ? AND status IN ('queued','running','cancel_requested')
`;

const MONTHLY_SPEND_SQL = `
  SELECT COALESCE(SUM(cost_cents), 0) AS spent FROM skills_runs
  WHERE org_id = ? AND created_at >= ? AND created_at < ?
`;

/** In-memory governance store: parity for tests, non-durable like its product twin. */
export class MemoryGovernanceStore implements GovernanceStore {
  readonly backend = "memory";
  private receipts: LifecycleReceipt[] = [];
  private reservations: CreditReservation[] = [];
  private artifacts: ServerArtifact[] = [];
  private runs: Array<{ orgId: string; costCents: number; status: string; createdAt: string }> = [];

  constructor(seed?: { runs?: Array<{ orgId: string; costCents: number; status: string; createdAt: string }> }) {
    this.runs = seed?.runs ?? [];
  }

  async appendReceipt(receipt: Omit<LifecycleReceipt, "id" | "createdAt">): Promise<LifecycleReceipt> {
    const next = { ...receipt, id: receiptId(), createdAt: nowIso() };
    this.receipts.push(next);
    return next;
  }

  async listReceipts(orgId: string, runId: string): Promise<LifecycleReceipt[]> {
    return this.receipts.filter((receipt) => receipt.orgId === orgId && receipt.runId === runId);
  }

  async createReservation(input: { orgId: string; runId: string; estimatedCents: number }): Promise<CreditReservation> {
    const estimatedCents = input.estimatedCents;
    assertReservationCents(estimatedCents, "estimatedCents");
    const reservation: CreditReservation = { ...input, estimatedCents, id: reservationId(), status: "reserved", createdAt: nowIso() };
    this.reservations.push(reservation);
    return reservation;
  }

  async reservationsForRun(orgId: string, runId: string): Promise<CreditReservation[]> {
    return this.reservations.filter((reservation) => reservation.orgId === orgId && reservation.runId === runId);
  }

  async reconcileReservation(reservationId: string, actualCents: number, status: "charged" | "released"): Promise<CreditReservation | null> {
    assertReservationCents(actualCents, "actualCents");
    const reservation = this.reservations.find((candidate) => candidate.id === reservationId);
    if (!reservation || reservation.status !== "reserved") return reservation ?? null;
    const next: CreditReservation = { ...reservation, actualCents, status, reconciledAt: nowIso() };
    this.reservations[this.reservations.indexOf(reservation)] = next;
    return next;
  }

  async monthlySpendCents(orgId: string, monthPrefix: string): Promise<number> {
    const spend = this.runs
      .filter((run) => run.orgId === orgId && run.createdAt.startsWith(monthPrefix))
      .reduce((sum, run) => sum + run.costCents, 0);
    const pending = this.reservations
      .filter((reservation) => reservation.orgId === orgId && reservation.status === "reserved")
      .reduce((sum, reservation) => sum + reservation.estimatedCents, 0);
    return spend + pending;
  }

  async activeRunCount(orgId: string): Promise<number> {
    return this.runs.filter((run) => run.orgId === orgId && ["queued", "running", "cancel_requested"].includes(run.status)).length;
  }

  async listExpiredArtifacts(at: string): Promise<ServerArtifact[]> {
    return this.artifacts.filter((artifact) => artifact.expiresAt !== undefined && artifact.expiresAt <= at);
  }

  async deleteArtifactRow(artifactId: string, orgId: string): Promise<boolean> {
    const index = this.artifacts.findIndex((artifact) => artifact.id === artifactId && artifact.orgId === orgId);
    if (index === -1) return false;
    this.artifacts.splice(index, 1);
    return true;
  }

  async updateArtifactStorageKey(artifactId: string, orgId: string, storageKey: string): Promise<boolean> {
    const artifact = this.artifacts.find((candidate) => candidate.id === artifactId && candidate.orgId === orgId);
    if (!artifact) return false;
    artifact.storageKey = storageKey;
    return true;
  }

  /** Test hook: seed artifacts and runs directly. */
  seedArtifacts(artifacts: ServerArtifact[]): void {
    this.artifacts.push(...artifacts);
  }

  seedRuns(runs: Array<{ orgId: string; costCents: number; status: string; createdAt: string }>): void {
    this.runs.push(...runs);
  }
}

/** SQLite governance store: a second connection to the same database file, WAL-safe. */
export class SqliteGovernanceStore implements GovernanceStore {
  readonly backend = "sqlite";
  private db: Database;
  private closed = false;

  constructor(path: string = SQLITE_MEMORY_PATH, options: { migrate?: boolean } = {}) {
    if (path !== SQLITE_MEMORY_PATH) mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, readwrite: true });
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    if (options.migrate !== false) applySqliteMigrations(this.db);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close(false);
  }

  get database(): Database {
    return this.db;
  }

  async appendReceipt(receipt: Omit<LifecycleReceipt, "id" | "createdAt">): Promise<LifecycleReceipt> {
    const next = { ...receipt, id: receiptId(), createdAt: nowIso() };
    this.db.run(
      `INSERT INTO skills_lifecycle_receipts (id, kind, org_id, run_id, artifact_id, requested_by, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [next.id, next.kind, next.orgId, next.runId, next.artifactId ?? null, next.requestedBy, JSON.stringify(next.metadata), next.createdAt],
    );
    return next;
  }

  async listReceipts(orgId: string, runId: string): Promise<LifecycleReceipt[]> {
    const rows = this.db
      .query("SELECT * FROM skills_lifecycle_receipts WHERE org_id = ? AND run_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(orgId, runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as ReceiptKind,
      orgId: String(row.org_id),
      runId: String(row.run_id),
      ...(typeof row.artifact_id === "string" ? { artifactId: row.artifact_id } : {}),
      requestedBy: String(row.requested_by),
      metadata: parseJsonObject(row.metadata_json),
      createdAt: String(row.created_at),
    }));
  }

  async createReservation(input: { orgId: string; runId: string; estimatedCents: number }): Promise<CreditReservation> {
    const estimatedCents = input.estimatedCents;
    assertReservationCents(estimatedCents, "estimatedCents");
    const reservation: CreditReservation = { ...input, estimatedCents, id: reservationId(), status: "reserved", createdAt: nowIso() };
    this.db.run(
      `INSERT INTO skills_credit_reservations (id, org_id, run_id, estimated_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reservation.id, reservation.orgId, reservation.runId, reservation.estimatedCents, reservation.status, reservation.createdAt],
    );
    return reservation;
  }

  async reservationsForRun(orgId: string, runId: string): Promise<CreditReservation[]> {
    const rows = this.db
      .query("SELECT * FROM skills_credit_reservations WHERE org_id = ? AND run_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(orgId, runId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.reservationFrom(row));
  }

  async reconcileReservation(reservationId: string, actualCents: number, status: "charged" | "released"): Promise<CreditReservation | null> {
    assertReservationCents(actualCents, "actualCents");
    // The predicate and transition must be one SQLite statement: separate
    // connections can both observe reserved before either writes a result.
    const updated = this.db.query(
      `UPDATE skills_credit_reservations SET actual_cents = ?, status = ?, reconciled_at = ?
       WHERE id = ? AND status = 'reserved' RETURNING *`,
    ).get(actualCents, status, nowIso(), reservationId) as Record<string, unknown> | null;
    if (updated) return this.reservationFrom(updated);
    const existing = this.db.query("SELECT * FROM skills_credit_reservations WHERE id = ? LIMIT 1")
      .get(reservationId) as Record<string, unknown> | null;
    return existing ? this.reservationFrom(existing) : null;
  }

  async monthlySpendCents(orgId: string, monthPrefix: string): Promise<number> {
    const from = `${monthPrefix}-01T00:00:00.000Z`;
    const nextMonth = nextMonthPrefix(monthPrefix);
    const spent = this.db
      .query("SELECT COALESCE(SUM(cost_cents), 0) AS spent FROM skills_runs WHERE org_id = ? AND created_at >= ? AND created_at < ?")
      .get(orgId, from, `${nextMonth}-01T00:00:00.000Z`) as { spent: number };
    const pending = this.db
      .query("SELECT COALESCE(SUM(estimated_cents), 0) AS pending FROM skills_credit_reservations WHERE org_id = ? AND status = 'reserved'")
      .get(orgId) as { pending: number };
    return Number(spent.spent ?? 0) + Number(pending.pending ?? 0);
  }

  async activeRunCount(orgId: string): Promise<number> {
    const row = this.db.query(ACTIVE_RUN_SQL).get(orgId) as { n: number };
    return Number(row.n ?? 0);
  }

  async listExpiredArtifacts(at: string): Promise<ServerArtifact[]> {
    const rows = this.db.query(EXPIRED_ARTIFACT_SQL).all(at) as Array<Record<string, unknown>>;
    return rows.map(rowToArtifact);
  }

  async deleteArtifactRow(artifactId: string, orgId: string): Promise<boolean> {
    const result = this.db.run("DELETE FROM skills_artifacts WHERE id = ? AND org_id = ?", [artifactId, orgId]);
    return result.changes === 1;
  }

  async updateArtifactStorageKey(artifactId: string, orgId: string, storageKey: string): Promise<boolean> {
    const result = this.db.run("UPDATE skills_artifacts SET storage_key = ? WHERE id = ? AND org_id = ?", [storageKey, artifactId, orgId]);
    return result.changes === 1;
  }

  private reservationFrom(row: Record<string, unknown>): CreditReservation {
    return {
      id: String(row.id),
      orgId: String(row.org_id),
      runId: String(row.run_id),
      estimatedCents: Number(row.estimated_cents ?? 0),
      ...(row.actual_cents !== null && row.actual_cents !== undefined ? { actualCents: Number(row.actual_cents) } : {}),
      status: String(row.status) as ReservationStatus,
      createdAt: String(row.created_at),
      ...(typeof row.reconciled_at === "string" ? { reconciledAt: row.reconciled_at } : {}),
    };
  }
}

/** Postgres governance store. Same semantics as the SQLite twin; tenant context via set_config. */
export class PostgresGovernanceStore implements GovernanceStore {
  readonly backend = "postgres";
  private sql: SqlTag;

  constructor(databaseUrl: string) {
    const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => SqlTag };
    this.sql = new bunWithSql.SQL(databaseUrl, { max: 2 });
  }

  async close(): Promise<void> {
    await this.sql.close?.();
  }

  private async withContext<T>(orgId: string | null, worker: boolean, fn: (tx: SqlTag) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.skills_org_id', ${orgId ?? ""}, true)`;
      await tx`SELECT set_config('app.skills_claim_context', ${worker ? "worker" : ""}, true)`;
      return await fn(tx);
    });
  }

  async appendReceipt(receipt: Omit<LifecycleReceipt, "id" | "createdAt">): Promise<LifecycleReceipt> {
    const next = { ...receipt, id: receiptId(), createdAt: nowIso() };
    await this.sql`
      INSERT INTO skills_lifecycle_receipts (id, kind, org_id, run_id, artifact_id, requested_by, metadata_json)
      VALUES (${next.id}, ${next.kind}, ${next.orgId}, ${next.runId}, ${next.artifactId ?? null}, ${next.requestedBy}, ${JSON.stringify(next.metadata)}::jsonb)
    `;
    return next;
  }

  async listReceipts(orgId: string, runId: string): Promise<LifecycleReceipt[]> {
    const rows = await this.sql`
      SELECT * FROM skills_lifecycle_receipts WHERE org_id = ${orgId} AND run_id = ${runId} ORDER BY created_at ASC
    `;
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as ReceiptKind,
      orgId: String(row.org_id),
      runId: String(row.run_id),
      ...(typeof row.artifact_id === "string" ? { artifactId: row.artifact_id } : {}),
      requestedBy: String(row.requested_by),
      metadata: parseJsonObject(row.metadata_json),
      createdAt: String(row.created_at),
    }));
  }

  async createReservation(input: { orgId: string; runId: string; estimatedCents: number }): Promise<CreditReservation> {
    const estimatedCents = input.estimatedCents;
    assertReservationCents(estimatedCents, "estimatedCents");
    const reservation: CreditReservation = { ...input, estimatedCents, id: reservationId(), status: "reserved", createdAt: nowIso() };
    await this.sql`
      INSERT INTO skills_credit_reservations (id, org_id, run_id, estimated_cents, status)
      VALUES (${reservation.id}, ${reservation.orgId}, ${reservation.runId}, ${reservation.estimatedCents}, ${reservation.status})
    `;
    return reservation;
  }

  async reservationsForRun(orgId: string, runId: string): Promise<CreditReservation[]> {
    const rows = await this.sql`
      SELECT * FROM skills_credit_reservations WHERE org_id = ${orgId} AND run_id = ${runId} ORDER BY created_at ASC
    `;
    return rows.map((row) => this.reservationFrom(row));
  }

  async reconcileReservation(reservationId: string, actualCents: number, status: "charged" | "released"): Promise<CreditReservation | null> {
    assertReservationCents(actualCents, "actualCents");
    const rows = await this.sql`
      UPDATE skills_credit_reservations
      SET actual_cents = ${actualCents}, status = ${status}, reconciled_at = now()
      WHERE id = ${reservationId} AND status = ${"reserved"}
      RETURNING *
    `;
    if (!rows[0]) {
      const existing = await this.sql`SELECT * FROM skills_credit_reservations WHERE id = ${reservationId} LIMIT 1`;
      return existing[0] ? this.reservationFrom(existing[0]) : null;
    }
    return this.reservationFrom(rows[0]);
  }

  async monthlySpendCents(orgId: string, monthPrefix: string): Promise<number> {
    // skills_runs is RLS-armed (migration 0003): the spend read crosses every
    // org's rows, so it runs under the explicit worker context, never a tenant
    // context and never with no context (which sees zero rows under RLS).
    return this.withContext(null, true, async (tx) => {
      const rows = await tx`
        SELECT
          (SELECT COALESCE(SUM(cost_cents), 0) FROM skills_runs
           WHERE org_id = ${orgId} AND created_at >= ${`${monthPrefix}-01T00:00:00.000Z`} AND created_at < ${`${nextMonthPrefix(monthPrefix)}-01T00:00:00.000Z`}) AS spent,
          (SELECT COALESCE(SUM(estimated_cents), 0) FROM skills_credit_reservations
           WHERE org_id = ${orgId} AND status = ${"reserved"}) AS pending
      `;
      return Number(rows[0]?.spent ?? 0) + Number(rows[0]?.pending ?? 0);
    });
  }

  async activeRunCount(orgId: string): Promise<number> {
    return this.withContext(orgId, false, async (tx) => {
      const rows = await tx`SELECT COUNT(*) AS n FROM skills_runs WHERE org_id = ${orgId} AND status IN (${"queued"}, ${"running"}, ${"cancel_requested"})`;
      return Number(rows[0]?.n ?? 0);
    });
  }

  async listExpiredArtifacts(at: string): Promise<ServerArtifact[]> {
    // Both tables in the JOIN are RLS-armed; the expiry sweep is a cross-org
    // operation, so it runs under the explicit worker context. Without it the
    // sweep would see zero rows and silently expire nothing on Postgres.
    return this.withContext(null, true, async (tx) => {
      const rows = await tx`
        SELECT a.* FROM skills_artifacts a
        JOIN skills_runs r ON r.id = a.run_id
        WHERE a.expires_at IS NOT NULL AND a.expires_at <= ${at}
        ORDER BY a.expires_at ASC
      `;
      return rows.map(rowToArtifact);
    });
  }

  async deleteArtifactRow(artifactId: string, orgId: string): Promise<boolean> {
    return this.withContext(orgId, true, async (tx) => {
      const rows = await tx`DELETE FROM skills_artifacts WHERE id = ${artifactId} AND org_id = ${orgId} RETURNING id`;
      return rows.length > 0;
    });
  }

  async updateArtifactStorageKey(artifactId: string, orgId: string, storageKey: string): Promise<boolean> {
    return this.withContext(orgId, true, async (tx) => {
      const rows = await tx`
        UPDATE skills_artifacts SET storage_key = ${storageKey} WHERE id = ${artifactId} AND org_id = ${orgId} RETURNING id
      `;
      return rows.length > 0;
    });
  }

  private reservationFrom(row: Record<string, unknown>): CreditReservation {
    return {
      id: String(row.id),
      orgId: String(row.org_id),
      runId: String(row.run_id),
      estimatedCents: Number(row.estimated_cents ?? 0),
      ...(row.actual_cents !== null && row.actual_cents !== undefined ? { actualCents: Number(row.actual_cents) } : {}),
      status: String(row.status) as ReservationStatus,
      createdAt: String(row.created_at),
      ...(typeof row.reconciled_at === "string" ? { reconciledAt: row.reconciled_at } : {}),
    };
  }
}

/** Open the governance store matching a database target: sqlite (default) or postgres. */
export async function createGovernanceStore(databaseUrl?: string): Promise<GovernanceStore> {
  const target = resolveDatabaseTarget(databaseUrl);
  if (target.kind === "postgres") return new PostgresGovernanceStore(target.url);
  if (target.kind === "memory") return new SqliteGovernanceStore(SQLITE_MEMORY_PATH);
  return new SqliteGovernanceStore(target.path);
}

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  unsafe(query: string): Promise<Record<string, unknown>[]>;
  begin<T>(fn: (tx: SqlTag) => Promise<T>): Promise<T>;
  close?: () => Promise<void>;
};

function nextMonthPrefix(monthPrefix: string): string {
  const [year, month] = monthPrefix.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}
