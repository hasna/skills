import { createHash } from "node:crypto";
import { normalizeSkillsApiOrigin, skillsApiRequestUrl } from "./fleet-credentials.js";
import { parseWorkspaceSession, type RemoteWorkspaceSession } from "./remote-workspace-selection.js";
import { validatePortableManifestContract } from "./skill-contract.js";
import type { PortableSkillManifest } from "./portable-skills.js";

export const PRIVATE_PUBLICATION_MAX_BYTES = 16 * 1024 * 1024;
export interface CreatePrivateSkillInput {
  slug: string; displayName: string; description?: string; visibility?: "private" | "team"; confirm: true;
}
/** Only validated identifiers and enums are returned; server free text stays private. */
export interface CreatedPrivateSkill {
  id: string; slug: string; visibility: "private" | "team"; sourceType: "private_hosted"; ownerOrganizationId: string;
}
export type PrivatePublicationState = "awaiting_upload" | "queued" | "verifying" | "needs_attention" | "committed" | "rejected" | "cancelled" | "expired";
export interface PrivatePublicationDeclaration {
  idempotencyKey: string; version: string; expectedCurrentVersionId: string | null;
  manifestText: string; archiveSha256: string; archiveByteSize: number;
}
export interface PrivatePublicationView {
  id: string; skillId: string; version: string; expectedCurrentVersionId: string | null;
  archiveSha256: string; archiveByteSize: number; state: PrivatePublicationState;
  expiresAt: string; createdAt: string; versionId: string | null;
}
export interface PrivatePublishingCapability {
  contractVersion: 1; enabled: boolean; authentication: "interactive-session";
  maxArchiveBytes: 16777216; uploadMaxTtlSeconds: 300;
  /** Server capability only; each execution still requires a separate quote and approval. */
  executionEnabled: boolean;
}
/** Contains a short-lived bearer capability. Never print or persist this object. */
export interface PrivatePublicationUpload {
  method: "PUT"; uploadUrl: string; headers: Readonly<Record<string, string>>; expiresAt: string;
}
const skillCreateFailures = {
  INVALID_SLUG: [400, "Provide a lowercase kebab-case skill slug."],
  INVALID_DISPLAY_NAME: [400, "Provide a nonempty skill display name."],
  INVALID_VISIBILITY: [400, "Use private or team visibility for source publication."],
  SESSION_EXPIRED: [401, "Sign in again before creating a private skill."],
  INTERACTIVE_SESSION_REQUIRED: [403, "An interactive account session is required to create a private skill."],
  ACCOUNT_UNAVAILABLE: [403, "The current account membership cannot create a private skill."],
  PLAN_REQUIRED: [403, "Private and team skills require the Pro plan."],
  SLUG_CONFLICT: [409, "This skill slug already exists. Inspect the existing skill before publishing."],
} as const;
const failures = {
  INVALID_REQUEST: [400, "The publication request is invalid."],
  SESSION_EXPIRED: [401, "Sign in again to manage this publication."],
  ACCOUNT_UNAVAILABLE: [403, "The account is unavailable."],
  INTERACTIVE_SESSION_REQUIRED: [403, "An interactive account session is required."],
  PUBLICATION_FORBIDDEN: [403, "This session cannot manage the publication."],
  PUBLICATION_ENTITLEMENT_REQUIRED: [403, "The workspace is not entitled to publish private skills."],
  PUBLICATION_UNAVAILABLE: [404, "The publication is unavailable to this session."],
  MANIFEST_NAME_MISMATCH: [409, "The manifest name does not match the selected skill."],
  IDEMPOTENCY_CONFLICT: [409, "This request key already identifies different publication bytes. Use the saved recovery directory."],
  CURRENT_VERSION_CHANGED: [409, "The current version changed. Inspect it before explicitly starting another publication."],
  VERSION_EXISTS: [409, "This version already exists."],
  VERSION_RESERVED: [409, "This version is reserved by another publication."],
  PUBLICATION_COMMITTED: [409, "The publication is already committed."],
  PUBLICATION_UPLOAD_UNAVAILABLE: [409, "This publication cannot receive another upload."],
  PUBLICATION_LIMIT: [429, "The workspace publication limit has been reached."],
  PUBLICATION_BUSY: [503, "The publication is busy. Reconcile the saved intent before retrying."],
  PUBLICATION_UNCERTAIN: [503, "The publication outcome is uncertain. Reconcile the saved intent."],
  PUBLICATION_CAPABILITY_UNAVAILABLE: [503, "Private publishing is not enabled on this server."],
  PUBLICATION_SIGNING_UNAVAILABLE: [503, "Upload authorization is temporarily unavailable. Keep the same intent."],
} as const;
export class PrivatePublicationError extends Error {
  constructor(readonly code: string, message: string, readonly uncertain = false, readonly status?: number) {
    super(message); this.name = "PrivatePublicationError";
  }
}
const bad = (): never => { throw new PrivatePublicationError("INVALID_PUBLICATION_INPUT", "Invalid publication input or recovery data."); };
const invalid = (): never => { throw new PrivatePublicationError("INVALID_PUBLICATION_RESPONSE", "The server returned an invalid publication result."); };
export const publicationUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).sort().join(",") === keys.sort().join(",");
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT[0-9:.]+(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v) && Number.isFinite(Date.parse(v));
export const publicationSha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** Validate and capture before verification or any await. Confirmation is local only. */
export function checkedPrivateSkillCreate(value: unknown): Omit<Required<CreatePrivateSkillInput>, "confirm"> {
  const refuse = (field: string, accepted: string): never => { throw new PrivatePublicationError("INVALID_SKILL_CREATE_INPUT", `Invalid ${field}. ${accepted}`); };
  if (!record(value) || !Object.keys(value).every(key => ["slug", "displayName", "description", "visibility", "confirm"].includes(key)))
    return refuse("create input", "Provide only slug, displayName, description, visibility and confirm.");
  if (value.confirm !== true) throw new PrivatePublicationError("SKILL_CREATE_CONFIRM_REQUIRED", "Explicit confirmation is required to create this skill.");
  if (typeof value.slug !== "string" || value.slug.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug))
    return refuse("slug", "Use lowercase kebab-case, at most 128 characters.");
  if (typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.length > 256 || /[\p{Cc}\p{Cs}\u2028\u2029]/u.test(value.displayName))
    return refuse("displayName", "Use nonempty text, at most 256 characters, without control characters.");
  if (value.description !== undefined && (typeof value.description !== "string" || Buffer.byteLength(value.description) > 8192
    || /[\p{Cc}\p{Cs}]/u.test(value.description.replace(/[\r\n\t]/g, ""))))
    return refuse("description", "Use text of at most 8192 UTF-8 bytes, without control characters other than tabs and newlines.");
  if (value.visibility !== undefined && value.visibility !== "private" && value.visibility !== "team")
    return refuse("visibility", "Use private or team.");
  return Object.freeze({ slug: value.slug, displayName: value.displayName.trim(), description: value.description ?? "", visibility: value.visibility ?? "private" }) as Omit<Required<CreatePrivateSkillInput>, "confirm">;
}

export function checkedPublicationDeclaration(value: unknown): PrivatePublicationDeclaration {
  if (!exact(value, ["idempotencyKey", "version", "expectedCurrentVersionId", "manifestText", "archiveSha256", "archiveByteSize"])
    || !publicationUuid(value.idempotencyKey) || !(value.expectedCurrentVersionId === null || publicationUuid(value.expectedCurrentVersionId))
    || typeof value.version !== "string" || !value.version || value.version.length > 128 || /[\p{Cc}\p{Cs}]/u.test(value.version)
    || typeof value.manifestText !== "string" || Buffer.byteLength(value.manifestText) > 16384
    || !hash(value.archiveSha256) || !Number.isSafeInteger(value.archiveByteSize) || Number(value.archiveByteSize) < 1 || Number(value.archiveByteSize) > PRIVATE_PUBLICATION_MAX_BYTES) return bad();
  try {
    const manifest = JSON.parse(value.manifestText) as PortableSkillManifest;
    if (!record(manifest) || manifest.version !== value.version || validatePortableManifestContract(manifest, { strict: true }).length
      || !hash(manifest.provenance?.content_hash)) return bad();
  } catch { return bad(); }
  return Object.freeze({ ...value }) as unknown as PrivatePublicationDeclaration;
}

export function checkedPublicationView(value: unknown, skillId: string, intentId?: string, declaration?: PrivatePublicationDeclaration): PrivatePublicationView {
  if (!exact(value, ["id", "skillId", "version", "expectedCurrentVersionId", "archiveSha256", "archiveByteSize", "state", "expiresAt", "createdAt", "versionId"])
    || !publicationUuid(value.id) || value.skillId !== skillId || (intentId !== undefined && value.id !== intentId)
    || typeof value.version !== "string" || !value.version || value.version.length > 128 || /[\p{Cc}\p{Cs}]/u.test(value.version)
    || !(value.expectedCurrentVersionId === null || publicationUuid(value.expectedCurrentVersionId)) || !hash(value.archiveSha256)
    || !Number.isSafeInteger(value.archiveByteSize) || Number(value.archiveByteSize) < 1 || Number(value.archiveByteSize) > PRIVATE_PUBLICATION_MAX_BYTES
    || typeof value.state !== "string" || !["awaiting_upload", "queued", "verifying", "needs_attention", "committed", "rejected", "cancelled", "expired"].includes(value.state)
    || !date(value.expiresAt) || !date(value.createdAt) || !(value.versionId === null || publicationUuid(value.versionId))
    || (value.state === "committed" && value.versionId === null)) return invalid();
  if (declaration && ["version", "expectedCurrentVersionId", "archiveSha256", "archiveByteSize"].some(k => value[k] !== declaration[k as keyof PrivatePublicationDeclaration])) return invalid();
  return Object.freeze({ ...value }) as unknown as PrivatePublicationView;
}

/** Deadline covers headers and EOF. Cancellation never awaits an untrusted cancel hook. */
async function boundedJson(url: string, init: RequestInit, token: string, mutation: boolean, budget = 15000, signal?: AbortSignal, create = false, readBinding?: { userId: string; organizationId: string; membershipId: string }): Promise<unknown> {
  const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  const timeout = new PrivatePublicationError(create ? "SKILL_CREATE_UNCONFIRMED" : "PUBLICATION_UNCONFIRMED",
    create ? "Skill creation could not be confirmed. Inspect the workspace for this slug before another create; do not retry automatically."
      : "No confirmed publication result. Inspect the saved intent before retrying.", mutation);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([(async () => {
      if (signal?.aborted) throw timeout;
      response = await fetch(url, { ...init, redirect: "error", credentials: "omit", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
          ...(readBinding ? { "x-skills-user-id": readBinding.userId, "x-skills-workspace-id": readBinding.organizationId,
            "x-skills-membership-id": readBinding.membershipId } : {}) } });
      if (readBinding && response.ok && response.status !== 200) return invalid();
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) return invalid();
      reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) return invalid(); chunks.push(part.value); }
      if (controller.signal.aborted) throw timeout;
      const bytes = Buffer.concat(chunks); let body: unknown;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return invalid(); }
      if (!response.ok) {
        const known: Readonly<Record<string, readonly [number, string]>> = create ? skillCreateFailures : failures;
        const code = record(body) && typeof body.code === "string" && Object.hasOwn(known, body.code) ? body.code : null;
        if (code && known[code]![0] === response.status) throw new PrivatePublicationError(code, known[code]![1], mutation && code === "PUBLICATION_UNCERTAIN", response.status);
        if (create) {
          if (response.status >= 500) throw timeout;
          throw new PrivatePublicationError("SKILL_CREATE_REQUEST_FAILED", "The server refused skill creation.", false, response.status);
        }
        throw new PrivatePublicationError("PUBLICATION_REQUEST_FAILED", "The publication request was refused. Inspect its status before retrying.", mutation && response.status >= 500, response.status);
      }
      if (create && response.status !== 201) return invalid();
      return body;
    })(), new Promise<never>((_, reject) => {
      abort = () => { controller.abort(); reject(timeout); };
      timer = setTimeout(abort, Math.max(1, Math.min(15000, budget)));
      signal?.addEventListener("abort", abort, { once: true });
    })]);
  } catch (error) {
    if (error instanceof PrivatePublicationError) {
      if (mutation && error.code === "INVALID_PUBLICATION_RESPONSE") throw timeout;
      throw error;
    }
    throw timeout;
  } finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); controller.abort();
    if (reader) void reader.cancel().catch(() => {}); else void response?.body?.cancel().catch(() => {}); }
}

/** Metadata-only private history uses the existing interactive UUID route,
 * distinct from the public slug/API-key version contract. */
export interface PrivateSkillVersion { id: string; version: string; releasedAt: string | null; createdAt: string }
export interface PrivateSkillVersionHistory {
  organizationId: string; skillId: string; slug: string; currentVersion: string | null; currentVersionId: string | null;
  versions: readonly PrivateSkillVersion[]; nextCursor: string | null;
}
export interface PrivateSkillVersionHistoryOptions { limit?: number; cursor?: string; timeoutMs?: number; signal?: AbortSignal }
const historyInput = (): never => { throw new PrivatePublicationError("INVALID_PRIVATE_HISTORY_INPUT", "Provide a private skill UUID, limit from 1 to 50, and an optional UUID cursor; timeoutMs must be from 1 to 15000."); };
const historyResponse = (): never => { throw new PrivatePublicationError("INVALID_PRIVATE_HISTORY_RESPONSE", "The server returned invalid private version history."); };
const historyText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\p{Cc}\p{Cs}\u2028\u2029]/u.test(value);
// Raw PostgreSQL timestamp text is metadata, not a JS Date: retain its exact
// microseconds and offset. The existing publication timestamp contract stays separate.
function historyDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})(T| )(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2})(?::(\d{2}))?)$/.exec(value);
  if (!parts) return false;
  const [, y, m, d, separator, h, minute, second, fraction, zone, offsetHour, offsetMinute] = parts;
  // PostgreSQL ISO DateStyle uses a space and an hour-only or colon offset;
  // existing JSON ISO values use T and Z or a colon offset.
  if (separator === " " ? zone === "Z" || (fraction?.length ?? 0) > 6 : zone !== "Z" && offsetMinute === undefined) return false;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!
    && Number(h) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && (zone === "Z" || (Number(offsetHour) <= 23 && Number(offsetMinute ?? 0) <= 59));
}
function privateHistory(value: unknown, organizationId: string, skillId: string, limit: number, cursor?: string): PrivateSkillVersionHistory {
  if (!record(value) || value.organizationId !== organizationId || value.skillId !== skillId
    || typeof value.slug !== "string" || !/^[a-z0-9-]+$/.test(value.slug)
    || !(value.currentVersion === null || historyText(value.currentVersion))
    || !(value.currentVersionId === null || publicationUuid(value.currentVersionId))
    || (value.currentVersion === null) !== (value.currentVersionId === null)
    || !(value.nextCursor === null || publicationUuid(value.nextCursor)) || !Array.isArray(value.versions) || value.versions.length > limit) return historyResponse();
  const seen = new Set<string>(); let previous = cursor;
  const versions = value.versions.map(row => {
    if (!record(row) || !publicationUuid(row.id) || seen.has(row.id) || (previous !== undefined && row.id >= previous)
      || !historyText(row.version) || !(row.releasedAt === null || historyDate(row.releasedAt)) || !historyDate(row.createdAt)
      || (row.id === value.currentVersionId) !== (row.version === value.currentVersion)) return historyResponse();
    seen.add(row.id); previous = row.id;
    return Object.freeze({ id: row.id, version: row.version, releasedAt: row.releasedAt, createdAt: row.createdAt }) as PrivateSkillVersion;
  });
  if (value.nextCursor !== null && (!versions.length || value.nextCursor !== versions.at(-1)!.id)) return historyResponse();
  return Object.freeze({ organizationId, skillId, slug: value.slug, currentVersion: value.currentVersion as string | null,
    currentVersionId: value.currentVersionId as string | null, versions: Object.freeze(versions), nextCursor: value.nextCursor as string | null });
}
/** Read-only session consumer; permits viewer history without granting any publication action.
 * Tokens stay in a private field and are never persisted or serialized. */
export class RemotePrivateSkillHistoryClient {
  readonly apiOrigin: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly membershipId: string;
  #token: string;
  constructor(apiUrl: string, session: RemoteWorkspaceSession) {
    const checked = parseWorkspaceSession(session, { userId: session?.user?.id, membershipId: session?.user?.membershipId });
    this.apiOrigin = normalizeSkillsApiOrigin(apiUrl); this.#token = checked.token;
    this.organizationId = checked.organization.id; this.userId = checked.user.id; this.membershipId = checked.user.membershipId;
    Object.freeze(this);
  }
  /** One page and one GET. Follow nextCursor explicitly; an error never prints partial history. */
  async listVersions(skillId: string, options: PrivateSkillVersionHistoryOptions = {}): Promise<PrivateSkillVersionHistory> {
    if (!publicationUuid(skillId) || (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 50))
      || (options.cursor !== undefined && !publicationUuid(options.cursor))
      || (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 15000))) return historyInput();
    const limit = options.limit ?? 20, cursor = options.cursor;
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(limit));
    if (cursor !== undefined) query.set("cursor", cursor);
    const path = `/api/v1/skills/${skillId}/versions${query.size ? `?${query}` : ""}`;
    let value: unknown;
    try {
      value = await boundedJson(skillsApiRequestUrl(this.apiOrigin, path), { method: "GET" }, this.#token, false,
        options.timeoutMs, options.signal, false, this);
    } catch (error) {
      if (error instanceof PrivatePublicationError && error.code === "INVALID_PUBLICATION_RESPONSE") return historyResponse();
      throw new PrivatePublicationError("PRIVATE_HISTORY_UNAVAILABLE", "Unable to read private version history. Check the selected server, current membership and fresh sign-in; no skill or credential was changed.", false,
        error instanceof PrivatePublicationError ? error.status : undefined);
    }
    return privateHistory(value, this.organizationId, skillId, limit, cursor);
  }
}

/** Explicit hosted contract, unrelated to registry publishSkill and its content revisions.
 * Session tokens stay in private fields and are never written to credentials. */
export class RemotePrivatePublicationsClient {
  readonly apiOrigin: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly membershipId: string;
  #token: string;
  constructor(apiUrl: string, session: RemoteWorkspaceSession) {
    const checked = parseWorkspaceSession(session, { userId: session?.user?.id, membershipId: session?.user?.membershipId });
    if (checked.user.role === "viewer") throw new PrivatePublicationError("PUBLICATION_FORBIDDEN", failures.PUBLICATION_FORBIDDEN[1]);
    this.apiOrigin = normalizeSkillsApiOrigin(apiUrl); this.#token = checked.token;
    this.organizationId = checked.organization.id; this.userId = checked.user.id; this.membershipId = checked.user.membershipId;
    Object.freeze(this);
  }
  /** One session-only POST. An uncertain result must be inspected, never replayed. */
  async createSkill(input: CreatePrivateSkillInput, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CreatedPrivateSkill> {
    const body = checkedPrivateSkillCreate(input);
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 15000))
      throw new PrivatePublicationError("INVALID_SKILL_CREATE_INPUT", "Invalid timeoutMs. Use an integer from 1 to 15000.");
    const value = await boundedJson(skillsApiRequestUrl(this.apiOrigin, "/api/v1/skills"), { method: "POST", body: JSON.stringify(body) },
      this.#token, true, options.timeoutMs, options.signal, true);
    if (!record(value) || !publicationUuid(value.id) || value.slug !== body.slug || value.displayName !== body.displayName || value.description !== body.description
      || value.visibility !== body.visibility || value.sourceType !== "private_hosted" || !record(value.metadata) || value.metadata.ownerOrganizationId !== this.organizationId)
      throw new PrivatePublicationError("SKILL_CREATE_UNCONFIRMED", "Skill creation returned an unbound result. Inspect the workspace for this slug before another create; do not retry automatically.", true);
    return Object.freeze({ id: value.id, slug: body.slug, visibility: body.visibility, sourceType: "private_hosted", ownerOrganizationId: this.organizationId });
  }
  async getCapability(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PrivatePublishingCapability> {
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 15000)) return bad();
    const response = await boundedJson(skillsApiRequestUrl(this.apiOrigin, "/api/v1/capabilities"), {}, this.#token, false, options.timeoutMs, options.signal);
    const p = record(response) && response.privatePublishing;
    if (!record(response) || response.contractVersion !== 1 || response.apiVersion !== 1
      || !exact(p, ["contractVersion", "enabled", "authentication", "maxArchiveBytes", "uploadMaxTtlSeconds", "executionEnabled"])
      || p.contractVersion !== 1 || typeof p.enabled !== "boolean" || p.authentication !== "interactive-session"
      || p.maxArchiveBytes !== PRIVATE_PUBLICATION_MAX_BYTES || p.uploadMaxTtlSeconds !== 300 || typeof p.executionEnabled !== "boolean")
      throw new PrivatePublicationError("PUBLICATION_CONTRACT_UNAVAILABLE", "This server does not support the hosted private publication contract.");
    return Object.freeze({ ...p }) as unknown as PrivatePublishingCapability;
  }
  async #gate(enabled: boolean, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    if (!(await this.getCapability(options)).enabled && enabled) throw new PrivatePublicationError("PUBLICATION_CAPABILITY_UNAVAILABLE", failures.PUBLICATION_CAPABILITY_UNAVAILABLE[1]);
  }
  #path(skillId: string, intentId?: string): string {
    if (!publicationUuid(skillId) || (intentId !== undefined && !publicationUuid(intentId))) return bad();
    return skillsApiRequestUrl(this.apiOrigin, `/api/v1/skills/${skillId}/publication-uploads${intentId ? `/${intentId}` : ""}`);
  }
  async #view(path: string, method: string, skillId: string, intentId?: string, declaration?: PrivatePublicationDeclaration, options: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    const value = await boundedJson(path, { method, ...(method === "GET" ? {} : { body: JSON.stringify(declaration ?? {}) }) }, this.#token, method !== "GET", options.timeoutMs, options.signal);
    try {
      if (!record(value) || !Object.keys(value).every(k => k === "upload" || k === "changed") || (value.changed !== undefined && typeof value.changed !== "boolean")) return invalid();
      return checkedPublicationView(value.upload, skillId, intentId, declaration);
    } catch (error) {
      if (method !== "GET") throw new PrivatePublicationError("PUBLICATION_UNCONFIRMED", "The publication result could not be confirmed. Reconcile the saved intent before another action.", true);
      throw error;
    }
  }
  async begin(skillId: string, input: PrivatePublicationDeclaration): Promise<PrivatePublicationView> {
    const path = this.#path(skillId), declaration = checkedPublicationDeclaration(input); await this.#gate(true);
    return this.#view(path, "POST", skillId, undefined, declaration);
  }
  async get(skillId: string, intentId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PrivatePublicationView> {
    const path = this.#path(skillId, intentId), until = Date.now() + (options.timeoutMs ?? 15000);
    await this.#gate(false, options);
    return this.#view(path, "GET", skillId, intentId, undefined, { ...options, timeoutMs: Math.max(1, until - Date.now()) });
  }
  async finalize(skillId: string, intentId: string): Promise<PrivatePublicationView> {
    const path = this.#path(skillId, intentId); await this.#gate(true); return this.#view(`${path}/finalize`, "POST", skillId, intentId);
  }
  async cancel(skillId: string, intentId: string): Promise<PrivatePublicationView> {
    const path = this.#path(skillId, intentId); await this.#gate(false); return this.#view(path, "DELETE", skillId, intentId);
  }
  async upload(skillId: string, intent: PrivatePublicationView, bytes: Uint8Array): Promise<void> {
    const captured = checkedPublicationView(intent, skillId), path = this.#path(skillId, captured.id);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== captured.archiveByteSize) return bad();
    const owned = Buffer.from(bytes);
    if (captured.state !== "awaiting_upload" || owned.byteLength !== captured.archiveByteSize || publicationSha256(owned) !== captured.archiveSha256) return bad();
    await this.#gate(true);
    const value = await boundedJson(`${path}/upload-url`, { method: "POST", body: "{}" }, this.#token, false);
    const upload = this.#upload(value, captured);
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const uncertain = () => new PrivatePublicationError("PUBLICATION_UPLOAD_UNCONFIRMED", "Upload acceptance is uncertain. Resume this saved intent to finalize and inspect it; do not upload again.", true);
    try {
      await Promise.race([(async () => {
        const response = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: owned, redirect: "error", credentials: "omit", signal: controller.signal });
        void response.body?.cancel().catch(() => {});
        if (response.status !== 200 || controller.signal.aborted) throw uncertain();
      })(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(uncertain()); }, 30000); })]);
    } catch { throw uncertain(); } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  #upload(value: unknown, intent: PrivatePublicationView): PrivatePublicationUpload {
    if (!exact(value, ["upload"]) || !exact(value.upload, ["method", "uploadUrl", "headers", "expiresAt"])) return invalid();
    const p = value.upload;
    if (p.method !== "PUT" || typeof p.uploadUrl !== "string" || p.uploadUrl.length > 8192 || /[\x00-\x20\x7f]/.test(p.uploadUrl)
      || !date(p.expiresAt) || Date.parse(p.expiresAt) - Date.now() < 1000 || Date.parse(p.expiresAt) - Date.now() > 300000 || Date.parse(p.expiresAt) > Date.parse(intent.expiresAt)
      || !exact(p.headers, ["content-type", "content-length", "x-amz-checksum-sha256", "x-amz-expected-bucket-owner"])
      || p.headers["content-type"] !== "application/gzip" || p.headers["content-length"] !== String(intent.archiveByteSize)
      || p.headers["x-amz-checksum-sha256"] !== Buffer.from(intent.archiveSha256, "hex").toString("base64")
      || typeof p.headers["x-amz-expected-bucket-owner"] !== "string" || !/^\d{12}$/.test(p.headers["x-amz-expected-bucket-owner"])) return invalid();
    let url: URL; try { url = new URL(p.uploadUrl); } catch { return invalid(); }
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash
      || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.s3\.[a-z]{2}(?:-[a-z]+)+-[1-9]\.amazonaws\.com$/.test(url.hostname)
      || url.pathname !== `/private-publication-staging/${this.organizationId}/${intent.id}/bundle.tgz` || !url.search
      || url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256"
      || url.searchParams.get("X-Amz-SignedHeaders") !== "content-length;content-type;host;x-amz-checksum-sha256;x-amz-expected-bucket-owner"
      || !/^[a-f0-9]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? "")) return invalid();
    const queryKeys = ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-Security-Token", "X-Amz-Signature", "X-Amz-SignedHeaders"];
    if ([...url.searchParams.keys()].sort().join(",") !== queryKeys.sort().join(",")) return invalid();
    const issued = url.searchParams.get("X-Amz-Date")!, ttl = url.searchParams.get("X-Amz-Expires")!, credential = url.searchParams.get("X-Amz-Credential")!;
    const timestamp = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(issued);
    const region = url.hostname.split(".s3.")[1]!.split(".amazonaws.com")[0]!;
    if (!timestamp || !/^[1-9]\d{0,2}$/.test(ttl) || Number(ttl) > 300
      || !/^[A-Z0-9]{16,128}\//.test(credential) || credential.split("/").slice(1).join("/") !== `${issued.slice(0, 8)}/${region}/s3/aws4_request`
      || !/^[\x21-\x7e]{1,4096}$/.test(url.searchParams.get("X-Amz-Security-Token")!)) return invalid();
    const issuedAt = Date.parse(`${timestamp[1]}-${timestamp[2]}-${timestamp[3]}T${timestamp[4]}:${timestamp[5]}:${timestamp[6]}Z`);
    if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 1000 || issuedAt + Number(ttl) * 1000 !== Date.parse(p.expiresAt)) return invalid();
    return { method: "PUT", uploadUrl: url.href, expiresAt: p.expiresAt, headers: Object.freeze({ ...p.headers }) as Readonly<Record<string, string>> };
  }
  async wait(skillId: string, intentId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<PrivatePublicationView> {
    const timeout = options.timeoutMs ?? 60000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 300000) return bad();
    const until = Date.now() + timeout;
    let previous: PrivatePublicationView | undefined;
    while (true) {
      if (options.signal?.aborted) throw new PrivatePublicationError("PUBLICATION_WAIT_ABORTED", "Stopped waiting. The server publication continues; inspect the saved intent.");
      let view: PrivatePublicationView;
      try { view = await this.get(skillId, intentId, { timeoutMs: timeout === 0 ? 15000 : Math.max(1, Math.min(15000, until - Date.now())), signal: options.signal }); }
      catch (error) { if (previous && Date.now() >= until && !options.signal?.aborted) return previous; throw error; }
      previous = view;
      if (!["queued", "verifying"].includes(view.state) || Date.now() >= until) return view;
      await new Promise<void>(resolve => { const timer = setTimeout(done, Math.min(1000, until - Date.now())); function done() { clearTimeout(timer); options.signal?.removeEventListener("abort", done); resolve(); } options.signal?.addEventListener("abort", done, { once: true }); });
    }
  }
}
