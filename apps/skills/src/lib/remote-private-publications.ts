import { createHash } from "node:crypto";
import { normalizeSkillsApiOrigin, skillsApiRequestUrl } from "./fleet-credentials.js";
import { parseWorkspaceSession, type RemoteWorkspaceSession } from "./remote-workspace-selection.js";
import { validatePortableManifestContract } from "./skill-contract.js";
import type { PortableSkillManifest } from "./portable-skills.js";

export const PRIVATE_PUBLICATION_MAX_BYTES = 16 * 1024 * 1024;
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
async function boundedJson(url: string, init: RequestInit, token: string, mutation: boolean, budget = 15000, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  const timeout = new PrivatePublicationError("PUBLICATION_UNCONFIRMED", "No confirmed publication result. Inspect the saved intent before retrying.", mutation);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([(async () => {
      if (signal?.aborted) throw timeout;
      response = await fetch(url, { ...init, redirect: "error", credentials: "omit", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) return invalid();
      reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) return invalid(); chunks.push(part.value); }
      if (controller.signal.aborted) throw timeout;
      const bytes = Buffer.concat(chunks); let body: unknown;
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return invalid(); }
      if (!response.ok) {
        const code = record(body) && typeof body.code === "string" && Object.hasOwn(failures, body.code) ? body.code as keyof typeof failures : null;
        if (code && failures[code][0] === response.status) throw new PrivatePublicationError(code, failures[code][1], mutation && code === "PUBLICATION_UNCERTAIN", response.status);
        throw new PrivatePublicationError("PUBLICATION_REQUEST_FAILED", "The publication request was refused. Inspect its status before retrying.", mutation && response.status >= 500, response.status);
      }
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
