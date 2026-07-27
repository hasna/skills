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
import { ownBytes, type OwnedBytes } from "../lib/skill-bundle.js";
import type {
  BlobStorageKind,
  ServerArtifact,
  ServerRunLog,
  ServerRunRecord,
  ServerRunStatus,
  ServerSkillBundle,
  ServerSkillRecord,
} from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Coerce a caller-supplied row limit to a non-negative integer.
 *
 * The two engines disagree loudly about what a bad limit means. SQLite reads `LIMIT -1`
 * as *unlimited* and rejects `LIMIT 1.5` as a datatype mismatch; Postgres rejects -1 and
 * rounds 1.5 up. Left alone, `listRuns(principal, -1)` returned one org's entire history
 * on SQLite and an error on Postgres - and the SQLite answer is the dangerous direction,
 * since the argument exists to bound the response. HTTP callers are already clamped in
 * app.ts; this covers the store used as a library, which is a published seam.
 */
export function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
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

export function rowToSkill(row: Record<string, unknown>): ServerSkillRecord {
  return {
    orgId: String(row.org_id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    description: String(row.description ?? ""),
    category: String(row.category),
    tags: parseJsonArray(row.tags_json),
    source: String(row.source),
    kind: String(row.kind) === "instruction" ? "instruction" : "executable",
    ...(typeof row.version === "string" ? { version: row.version } : {}),
    ...(typeof row.skill_md === "string" ? { skillMd: row.skill_md } : {}),
    ...(typeof row.bundle_sha256 === "string" ? { bundleSha256: row.bundle_sha256 } : {}),
    ...(row.bundle_byte_size === null || row.bundle_byte_size === undefined ? {} : { bundleByteSize: Number(row.bundle_byte_size) }),
    ...(typeof row.published_by_user_id === "string" ? { publishedByUserId: row.published_by_user_id } : {}),
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
  };
}

export function rowToSkillBundle(row: Record<string, unknown>): ServerSkillBundle {
  return {
    orgId: String(row.org_id),
    sha256: String(row.sha256),
    byteSize: Number(row.byte_size),
    contentType: String(row.content_type),
    storageKind: String(row.storage_kind) as BlobStorageKind,
    ...(typeof row.storage_key === "string" ? { storageKey: row.storage_key } : {}),
    ...(toBytes(row.body_blob) ? { bytes: toBytes(row.body_blob)! } : {}),
    createdAt: dateString(row.created_at),
  };
}

/**
 * Normalise whatever a driver hands back for a blob column into bytes we own.
 *
 * bun:sqlite returns a Uint8Array for a BLOB; Bun's Postgres client returns a Buffer for
 * bytea, which *is* a Uint8Array but whose `.buffer` is frequently a larger pooled
 * ArrayBuffer - so `new Uint8Array(value.buffer)` would silently include neighbouring
 * rows' bytes, and even a correct byteOffset/byteLength window would stay alive only as
 * long as the driver leaves that pool alone. Copying is a few hundred kilobytes per read
 * and removes both hazards.
 */
function toBytes(value: unknown): OwnedBytes | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return ownBytes(value);
  if (value instanceof ArrayBuffer) return ownBytes(value);
  return null;
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
