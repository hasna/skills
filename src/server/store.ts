import { randomUUID } from "node:crypto";
import type {
  ApiPrincipal,
  ClaimRunInput,
  CreateRunInput,
  CreateRunResult,
  RunExecutionClaim,
  RunStartResult,
  ServerArtifact,
  ServerRunLog,
  ServerRunRecord,
  ServerRunStatus,
  RunOutcomePatch,
  SkillsProductStore,
} from "./types.js";
import { hashApiKey, selfHostedPrincipal } from "./auth.js";

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  unsafe(query: string): Promise<Record<string, unknown>[]>;
  close?: () => Promise<void>;
};

function resolvePoolMax(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.HASNA_SKILLS_DATABASE_POOL_MAX || env.SKILLS_DATABASE_POOL_MAX || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

function nowIso(): string {
  return new Date().toISOString();
}

function runId(): string {
  return `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function artifactId(): string {
  return `art_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function createArtifactId(): string {
  return artifactId();
}

export interface StoreOptions {
  databaseUrl?: string;
  bootstrapApiKey?: string;
}

export async function createStore(options: StoreOptions = {}): Promise<SkillsProductStore> {
  const store: SkillsProductStore = options.databaseUrl
    ? new PostgresSkillsStore(options.databaseUrl)
    : new MemorySkillsStore();
  if (options.bootstrapApiKey && store.ensureBootstrapApiKey) {
    await store.ensureBootstrapApiKey(options.bootstrapApiKey);
  }
  return store;
}

export class MemorySkillsStore implements SkillsProductStore {
  private apiKeys = new Map<string, ApiPrincipal>();
  private runs = new Map<string, ServerRunRecord>();
  private logs = new Map<string, ServerRunLog[]>();
  private artifacts = new Map<string, ServerArtifact[]>();
  private idempotency = new Map<string, string>();

  constructor(apiKeys: Array<{ token: string; principal?: Partial<ApiPrincipal> }> = []) {
    for (const key of apiKeys) this.addApiKey(key.token, key.principal);
  }

  addApiKey(token: string, principal?: Partial<ApiPrincipal>): ApiPrincipal {
    const resolved = selfHostedPrincipal(token, principal);
    this.apiKeys.set(hashApiKey(token), resolved);
    return resolved;
  }

  async ensureBootstrapApiKey(token: string, principal?: Partial<ApiPrincipal>): Promise<void> {
    this.addApiKey(token, principal);
  }

  async authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null> {
    return this.apiKeys.get(hash) ?? null;
  }

  async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    const idemKey = input.idempotencyKey?.trim();
    const idemMapKey = idemKey ? `${input.principal.orgId}:${idemKey}` : undefined;
    if (idemMapKey) {
      const existing = this.idempotency.get(idemMapKey);
      if (existing) return { run: this.runs.get(existing)!, created: false };
    }
    const now = nowIso();
    const run: ServerRunRecord = {
      id: runId(),
      orgId: input.principal.orgId,
      userId: input.principal.userId,
      skill: input.slug,
      requestedSlug: input.slug,
      status: "queued",
      input: input.input,
      args: input.args,
      ...(idemKey ? { idempotencyKey: idemKey } : {}),
      correlationId: randomUUID(),
      createdAt: now,
    };
    this.runs.set(run.id, run);
    this.logs.set(run.id, []);
    this.artifacts.set(run.id, []);
    if (idemMapKey) this.idempotency.set(idemMapKey, run.id);
    return { run, created: true };
  }

  async listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]> {
    return Array.from(this.runs.values())
      .filter((run) => run.orgId === principal.orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null> {
    const run = this.runs.get(runId);
    return run && run.orgId === principal.orgId ? run : null;
  }

  async claimNextRun(input: ClaimRunInput): Promise<RunExecutionClaim | null> {
    const run = Array.from(this.runs.values())
      .filter((candidate) => candidate.status === "queued" || candidate.status === "retrying")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!run) return null;
    const claimed = this.patchRun(run.id, { status: "running", startedAt: nowIso() });
    return claimed ? { run: claimed, claimed: true } : null;
  }

  async startRun(runId: string): Promise<RunStartResult | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    if (run.status === "queued" || run.status === "retrying") {
      const claimed = this.patchRun(runId, { status: "running", startedAt: run.startedAt ?? nowIso() });
      return claimed ? { run: claimed, claimed: true } : null;
    }
    return { run, claimed: false };
  }

  async requestCancellation(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run || run.orgId !== principal.orgId) return null;
    if (run.status === "queued" || run.status === "retrying") {
      return this.patchRun(runId, { status: "cancelled", completedAt: nowIso() });
    }
    if (run.status === "running") {
      return this.patchRun(runId, { status: "cancel_requested" });
    }
    return run;
  }

  async finishRun(runId: string, patch: RunOutcomePatch): Promise<ServerRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    if (run.status === "cancel_requested") {
      return this.patchRun(runId, { status: "cancelled", completedAt: patch.completedAt ?? nowIso() });
    }
    if (run.status !== "running") return run;
    return this.patchRun(runId, patch);
  }

  async appendLog(runId: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog> {
    const entries = this.logs.get(runId) ?? [];
    const log = { runId, sequence: entries.length + 1, level, message, createdAt: nowIso() };
    entries.push(log);
    this.logs.set(runId, entries);
    return log;
  }

  async listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]> {
    const run = await this.getRun(principal, runId);
    return run ? [...(this.logs.get(runId) ?? [])] : [];
  }

  async addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact> {
    const next = { ...artifact, createdAt: nowIso() };
    const artifacts = this.artifacts.get(artifact.runId) ?? [];
    artifacts.push(next);
    this.artifacts.set(artifact.runId, artifacts);
    return next;
  }

  async listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]> {
    const run = await this.getRun(principal, runId);
    return run ? [...(this.artifacts.get(runId) ?? [])] : [];
  }

  async getArtifact(principal: ApiPrincipal, runId: string, id: string): Promise<ServerArtifact | null> {
    const artifacts = await this.listArtifacts(principal, runId);
    return artifacts.find((artifact) => artifact.id === id) ?? null;
  }

  private patchRun(runId: string, patch: Partial<ServerRunRecord>): ServerRunRecord | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    const next = { ...run, ...patch };
    this.runs.set(runId, next);
    return next;
  }
}

export class PostgresSkillsStore implements SkillsProductStore {
  private sql: SqlTag;

  constructor(databaseUrl: string) {
    const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => SqlTag };
    this.sql = new bunWithSql.SQL(databaseUrl, { max: resolvePoolMax() });
  }

  async ensureBootstrapApiKey(token: string, principal?: Partial<ApiPrincipal>): Promise<void> {
    const resolved = selfHostedPrincipal(token, principal);
    await this.sql`
      INSERT INTO organizations (id, slug, name)
      VALUES (${resolved.orgId}, ${resolved.orgSlug}, ${resolved.orgName})
      ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name
    `;
    await this.sql`
      INSERT INTO users (id, email, name)
      VALUES (${resolved.userId}, ${resolved.email}, ${resolved.email})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
    `;
    await this.sql`
      INSERT INTO organization_members (org_id, user_id, role)
      VALUES (${resolved.orgId}, ${resolved.userId}, ${resolved.role})
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    await this.sql`
      INSERT INTO api_keys (id, org_id, user_id, name, key_hash, scopes_json)
      VALUES (${resolved.apiKeyId}, ${resolved.orgId}, ${resolved.userId}, ${"bootstrap"}, ${hashApiKey(token)}, ${JSON.stringify(resolved.scopes)}::jsonb)
      ON CONFLICT (key_hash) DO NOTHING
    `;
  }

  async authenticateApiKeyHash(hash: string): Promise<ApiPrincipal | null> {
    const rows = await this.sql`
      SELECT k.id AS api_key_id, k.scopes_json, o.id AS org_id, o.slug AS org_slug, o.name AS org_name,
             u.id AS user_id, u.email, m.role
      FROM api_keys k
      JOIN organizations o ON o.id = k.org_id
      JOIN users u ON u.id = k.user_id
      LEFT JOIN organization_members m ON m.org_id = k.org_id AND m.user_id = k.user_id
      WHERE k.key_hash = ${hash} AND k.revoked_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    await this.sql`UPDATE api_keys SET last_used_at = now() WHERE id = ${String(row.api_key_id)}`;
    return {
      apiKeyId: String(row.api_key_id),
      orgId: String(row.org_id),
      orgSlug: String(row.org_slug),
      orgName: String(row.org_name),
      userId: String(row.user_id),
      email: String(row.email),
      role: typeof row.role === "string" ? row.role : "member",
      scopes: parseJsonArray(row.scopes_json),
    };
  }

  async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    const id = runId();
    const rows = await this.sql`
      INSERT INTO skills_runs (id, org_id, user_id, skill_slug, requested_slug, status, input_json, args_json, idempotency_key, correlation_id)
      VALUES (${id}, ${input.principal.orgId}, ${input.principal.userId}, ${input.slug}, ${input.slug}, ${"queued"}, ${JSON.stringify(input.input)}::jsonb, ${JSON.stringify(input.args)}::jsonb, ${idempotencyKey}, ${randomUUID()})
      ON CONFLICT (org_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
      DO NOTHING
      RETURNING *
    `;
    if (rows[0]) return { run: rowToRun(rows[0]), created: true };
    if (!idempotencyKey) throw new Error("run insert returned no row");

    const existing = await this.sql`
      SELECT * FROM skills_runs
      WHERE org_id = ${input.principal.orgId} AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    if (!existing[0]) throw new Error("idempotent run insert conflicted without an existing run");
    return { run: rowToRun(existing[0]), created: false };
  }

  async listRuns(principal: ApiPrincipal, limit: number): Promise<ServerRunRecord[]> {
    const rows = await this.sql`
      SELECT * FROM skills_runs WHERE org_id = ${principal.orgId}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
    return rows.map(rowToRun);
  }

  async getRun(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null> {
    const rows = await this.sql`
      SELECT * FROM skills_runs WHERE id = ${runId} AND org_id = ${principal.orgId} LIMIT 1
    `;
    return rows[0] ? rowToRun(rows[0]) : null;
  }

  async claimNextRun(input: ClaimRunInput): Promise<RunExecutionClaim | null> {
    const rows = await this.sql`
      UPDATE skills_runs
      SET status = ${"running"}, started_at = COALESCE(started_at, now()), locked_by = ${input.workerId}, locked_at = now()
      WHERE id = (
        SELECT id FROM skills_runs
        WHERE status IN (${"queued"}, ${"retrying"})
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `;
    return rows[0] ? { run: rowToRun(rows[0]), claimed: true } : null;
  }

  async startRun(runId: string): Promise<RunStartResult | null> {
    const rows = await this.sql`
      UPDATE skills_runs
      SET status = ${"running"},
          started_at = COALESCE(started_at, now())
      WHERE id = ${runId} AND status IN (${"queued"}, ${"retrying"})
      RETURNING *
    `;
    if (rows[0]) return { run: rowToRun(rows[0]), claimed: true };
    const current = await this.sql`SELECT * FROM skills_runs WHERE id = ${runId} LIMIT 1`;
    return current[0] ? { run: rowToRun(current[0]), claimed: false } : null;
  }

  async requestCancellation(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null> {
    const rows = await this.sql`
      UPDATE skills_runs
      SET status = CASE
            WHEN status IN (${"queued"}, ${"retrying"}) THEN ${"cancelled"}
            WHEN status = ${"running"} THEN ${"cancel_requested"}
            ELSE status
          END,
          completed_at = CASE WHEN status IN (${"queued"}, ${"retrying"}) THEN now() ELSE completed_at END
      WHERE id = ${runId} AND org_id = ${principal.orgId}
      RETURNING *
    `;
    return rows[0] ? rowToRun(rows[0]) : null;
  }

  async finishRun(runId: string, patch: RunOutcomePatch): Promise<ServerRunRecord | null> {
    const rows = await this.sql`
      UPDATE skills_runs
      SET status = CASE WHEN status = ${"cancel_requested"} THEN ${"cancelled"} ELSE ${patch.status} END,
          output_type = CASE WHEN status = ${"running"} THEN ${patch.outputType ?? null} ELSE output_type END,
          output_preview = CASE WHEN status = ${"running"} THEN ${patch.outputPreview ?? null} ELSE output_preview END,
          error_code = CASE WHEN status = ${"running"} THEN ${patch.errorCode ?? null} ELSE error_code END,
          error_message = CASE WHEN status = ${"running"} THEN ${patch.errorMessage ?? null} ELSE error_message END,
          completed_at = ${patch.completedAt ?? nowIso()}
      WHERE id = ${runId} AND status IN (${"running"}, ${"cancel_requested"})
      RETURNING *
    `;
    if (rows[0]) return rowToRun(rows[0]);
    const current = await this.sql`SELECT * FROM skills_runs WHERE id = ${runId} LIMIT 1`;
    return current[0] ? rowToRun(current[0]) : null;
  }

  async appendLog(runId: string, orgId: string, level: ServerRunLog["level"], message: string): Promise<ServerRunLog> {
    const seqRows = await this.sql`SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM skills_run_logs WHERE run_id = ${runId}`;
    const sequence = Number(seqRows[0]?.next_sequence ?? 1);
    const rows = await this.sql`
      INSERT INTO skills_run_logs (run_id, org_id, sequence, level, message)
      VALUES (${runId}, ${orgId}, ${sequence}, ${level}, ${message})
      RETURNING *
    `;
    return rowToLog(rows[0]);
  }

  async listLogs(principal: ApiPrincipal, runId: string): Promise<ServerRunLog[]> {
    const rows = await this.sql`
      SELECT l.* FROM skills_run_logs l
      JOIN skills_runs r ON r.id = l.run_id AND r.org_id = ${principal.orgId}
      WHERE l.run_id = ${runId}
      ORDER BY l.sequence ASC
    `;
    return rows.map(rowToLog);
  }

  async addArtifact(artifact: Omit<ServerArtifact, "createdAt">): Promise<ServerArtifact> {
    const rows = await this.sql`
      INSERT INTO skills_artifacts (id, run_id, org_id, file_name, relative_path, content_type, byte_size, sha256, storage_kind, storage_key, body_text)
      VALUES (${artifact.id}, ${artifact.runId}, ${artifact.orgId}, ${artifact.fileName}, ${artifact.relativePath}, ${artifact.contentType}, ${artifact.byteSize}, ${artifact.sha256}, ${artifact.storageKind}, ${artifact.storageKey ?? null}, ${artifact.bodyText ?? null})
      RETURNING *
    `;
    return rowToArtifact(rows[0]);
  }

  async listArtifacts(principal: ApiPrincipal, runId: string): Promise<ServerArtifact[]> {
    const rows = await this.sql`
      SELECT a.* FROM skills_artifacts a
      JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ${principal.orgId}
      WHERE a.run_id = ${runId}
      ORDER BY a.created_at ASC
    `;
    return rows.map(rowToArtifact);
  }

  async getArtifact(principal: ApiPrincipal, runId: string, artifactId: string): Promise<ServerArtifact | null> {
    const rows = await this.sql`
      SELECT a.* FROM skills_artifacts a
      JOIN skills_runs r ON r.id = a.run_id AND r.org_id = ${principal.orgId}
      WHERE a.run_id = ${runId} AND a.id = ${artifactId}
      LIMIT 1
    `;
    return rows[0] ? rowToArtifact(rows[0]) : null;
  }
}

function rowToRun(row: Record<string, unknown>): ServerRunRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    userId: String(row.user_id),
    skill: String(row.skill_slug),
    requestedSlug: String(row.requested_slug),
    status: String(row.status) as ServerRunStatus,
    input: parseJsonObject(row.input_json),
    args: parseJsonArray(row.args_json),
    ...(typeof row.idempotency_key === "string" ? { idempotencyKey: row.idempotency_key } : {}),
    correlationId: String(row.correlation_id),
    ...(typeof row.output_type === "string" ? { outputType: row.output_type } : {}),
    ...(typeof row.output_preview === "string" ? { outputPreview: row.output_preview } : {}),
    ...(typeof row.error_code === "string" ? { errorCode: row.error_code } : {}),
    ...(typeof row.error_message === "string" ? { errorMessage: row.error_message } : {}),
    createdAt: dateString(row.created_at),
    ...(row.started_at ? { startedAt: dateString(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: dateString(row.completed_at) } : {}),
  };
}

function rowToLog(row: Record<string, unknown>): ServerRunLog {
  return {
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    level: String(row.level) as ServerRunLog["level"],
    message: String(row.message),
    createdAt: dateString(row.created_at),
  };
}

function rowToArtifact(row: Record<string, unknown>): ServerArtifact {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    orgId: String(row.org_id),
    fileName: String(row.file_name),
    relativePath: String(row.relative_path),
    contentType: String(row.content_type),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    storageKind: String(row.storage_kind) as ServerArtifact["storageKind"],
    ...(typeof row.storage_key === "string" ? { storageKey: row.storage_key } : {}),
    ...(typeof row.body_text === "string" ? { bodyText: row.body_text } : {}),
    createdAt: dateString(row.created_at),
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {}
  }
  return {};
}

function parseJsonArray(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
