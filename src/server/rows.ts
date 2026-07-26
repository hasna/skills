/**
 * Row shaping and id minting shared by every SQL backend.
 *
 * Extracted from store.ts so the Postgres and SQLite stores map result rows through
 * exactly the same code rather than through two implementations that agree today. The
 * mappers were already dialect-tolerant - parseJsonObject/parseJsonArray accept either
 * a driver-parsed object (Postgres jsonb) or a JSON string (SQLite text), and
 * dateString() accepts either a Date (Postgres timestamptz) or an ISO string (SQLite
 * text) - so this is a move, not a rewrite.
 *
 * Ids are minted here, in TypeScript, for both backends. That is why the SQLite schema
 * needs no equivalent of pgcrypto.
 */
import { randomUUID } from "node:crypto";
import type { ServerArtifact, ServerRunLog, ServerRunRecord, ServerRunStatus } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

export function runId(): string {
  return `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

export function artifactId(): string {
  return `art_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function rowToRun(row: Record<string, unknown>): ServerRunRecord {
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
    costCents: Number(row.cost_cents ?? 0),
    ...(typeof row.output_type === "string" ? { outputType: row.output_type } : {}),
    ...(typeof row.output_preview === "string" ? { outputPreview: row.output_preview } : {}),
    ...(typeof row.error_code === "string" ? { errorCode: row.error_code } : {}),
    ...(typeof row.error_message === "string" ? { errorMessage: row.error_message } : {}),
    createdAt: dateString(row.created_at),
    ...(row.started_at ? { startedAt: dateString(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: dateString(row.completed_at) } : {}),
  };
}

export function rowToLog(row: Record<string, unknown>): ServerRunLog {
  return {
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    level: String(row.level) as ServerRunLog["level"],
    message: String(row.message),
    createdAt: dateString(row.created_at),
  };
}

export function rowToArtifact(row: Record<string, unknown>): ServerArtifact {
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

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {}
  }
  return {};
}

export function parseJsonArray(value: unknown): string[] {
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

export function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
