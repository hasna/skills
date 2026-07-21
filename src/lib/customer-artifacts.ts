const REDACTED_SYSTEM_TEXT = "[redacted]";
const REDACTED_NDJSON_LINE = JSON.stringify({ redacted: true });
const ARTIFACTS_GENERATED_TEXT = "[artifacts-generated]";
const EXECUTION_LOG_FILE_NAME = "execution_log.json";

const USER_OWNED_ENVELOPE_KEYS = new Set([
  "userPayload",
  "userInput",
  "userMessage",
  "userContent",
]);

const SYSTEM_MESSAGE_KEYS = new Set([
  "message",
  "error",
  "detail",
  "details",
  "reason",
  "context",
]);

const SYSTEM_CONTAINER_KEYS = new Set([
  "logs",
  "entries",
  "events",
  "diagnostics",
  "attempts",
  "items",
  "metadata",
  "data",
  "result",
  "output",
  "raw",
]);

const SAFE_SYSTEM_SCALAR_KEYS = new Set([
  "id",
  "runid",
  "artifactid",
  "sequence",
  "level",
  "status",
  "state",
  "event",
  "eventtype",
  "createdat",
  "startedat",
  "completedat",
  "timestamp",
  "time",
  "durationms",
  "progress",
  "success",
]);

const SAFE_LEVELS = new Set(["debug", "info", "warn", "error"]);
const SAFE_STATUSES = new Set([
  "queued",
  "waiting_for_approval",
  "running",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "retrying",
  "expired",
  "refunded",
  "completed",
]);

const SAFE_EVENTS = new Set([
  "queued",
  "started",
  "running",
  "completed",
  "succeeded",
  "failed",
  "cancelled",
  "retrying",
  "refunded",
]);

const GENERATED_TEXT_MEDIA_TYPES = new Set([
  "application/json",
  "application/xml",
  "image/svg+xml",
  "text/csv",
  "text/css",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

const GENERATED_BINARY_MEDIA_TYPES = new Set([
  "application/gzip",
  "application/octet-stream",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/mpeg",
  "video/ogg",
  "video/quicktime",
  "video/webm",
]);

type ArtifactClassification = "execution-log" | "generated-artifact" | "untrusted";
type CanonicalArtifactType = "execution_log" | "generated_output";

interface SanitizedArtifactDescriptor extends Record<string, unknown> {
  id: string;
  type: CanonicalArtifactType;
}

interface ExpectedArtifactIdentity {
  artifactId?: string;
  runId?: string;
}

const INVALID = Symbol("invalid-artifact-field");

export function sanitizeCustomerArtifactList(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const idCounts = new Map<string, number>();
  for (const artifact of value) {
    if (!isRecord(artifact)) continue;
    const id = validArtifactId(artifact.id);
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const output: SanitizedArtifactDescriptor[] = [];
  for (const artifact of value) {
    if (!isRecord(artifact)) continue;
    const sanitized = sanitizeArtifactDescriptor(artifact);
    if (sanitized && idCounts.get(sanitized.id) === 1) output.push(sanitized);
  }
  return output;
}

export function sanitizeCustomerExecutionLogs(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => sanitizeSystemOwnedValue(entry));
}

export async function sanitizeCustomerArtifactDownload(
  response: Response,
  artifact?: unknown,
  expected: ExpectedArtifactIdentity = {},
): Promise<Response> {
  if (!response.ok) return failedArtifactDownloadResponse(response.status);

  const classified = classifyArtifact(artifact, response.headers, expected);
  if (classified.classification === "untrusted") return unverifiedArtifactResponse();
  if (classified.classification === "generated-artifact") {
    return generatedArtifactResponse(response, classified.descriptor);
  }

  const headers = safeExecutionLogHeaders(response.headers, classified.descriptor);
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();

  if (isNdjsonContentType(contentType)) {
    return new Response(sanitizeNdjsonExecutionLogText(text), responseInit(response, headers));
  }

  if (contentType.includes("json") || looksLikeJson(text)) {
    try {
      const sanitized = sanitizeSystemOwnedValue(JSON.parse(text));
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(`${JSON.stringify(sanitized, null, 2)}\n`, responseInit(response, headers));
    } catch {
      return unsafeArtifactContentResponse();
    }
  }

  return new Response(sanitizeExecutionLogText(text), responseInit(response, headers));
}

function sanitizeArtifactDescriptor(value: Record<string, unknown>): SanitizedArtifactDescriptor | undefined {
  const id = validArtifactId(value.id);
  if (!id) return undefined;

  const explicitType = explicitArtifactType(value);
  if (explicitType === undefined || explicitType === "invalid") return undefined;

  const runId = optionalValidated(value, "runId", validRunId);
  const byteSize = optionalValidated(value, "byteSize", validByteSize);
  const sha256 = optionalValidated(value, "sha256", validSha256);
  const createdAt = optionalValidated(value, "createdAt", validIsoTimestamp);
  if ([runId, byteSize, sha256, createdAt].includes(INVALID)) {
    return undefined;
  }

  const output: SanitizedArtifactDescriptor = { id, type: explicitType };
  if (runId !== undefined) output.runId = runId;
  if (byteSize !== undefined) output.byteSize = byteSize;
  if (sha256 !== undefined) output.sha256 = sha256;
  if (createdAt !== undefined) output.createdAt = createdAt;

  if (explicitType === "execution_log") {
    output.fileName = EXECUTION_LOG_FILE_NAME;
    output.relativePath = EXECUTION_LOG_FILE_NAME;
    output.name = EXECUTION_LOG_FILE_NAME;
    output.contentType = canonicalExecutionLogContentType(value.contentType);
  } else {
    const fileName = optionalValidated(value, "fileName", validFileName);
    const relativePath = optionalValidated(value, "relativePath", validRelativePath);
    const name = optionalValidated(value, "name", validFileName);
    const contentType = optionalValidated(value, "contentType", canonicalGeneratedContentType);
    if ([fileName, relativePath, name, contentType].includes(INVALID)) return undefined;
    if (!contentType || (!fileName && !relativePath && !name)) return undefined;
    if (fileName !== undefined) output.fileName = fileName;
    if (relativePath !== undefined) output.relativePath = relativePath;
    if (name !== undefined) output.name = name;
    output.contentType = contentType;
  }

  for (const key of USER_OWNED_ENVELOPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) output[key] = value[key];
  }
  return output;
}

function sanitizeSystemOwnedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeSystemOwnedValue(entry))
      .filter((entry) => !isEmptyRecord(entry));
  }
  if (typeof value === "string") return sanitizeSystemMessage(value);
  if (!isRecord(value)) return REDACTED_SYSTEM_TEXT;

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (USER_OWNED_ENVELOPE_KEYS.has(key)) {
      output[key] = nested;
      continue;
    }
    if (SYSTEM_MESSAGE_KEYS.has(normalized)) {
      output[key] = sanitizeSystemMessageValue(nested);
      continue;
    }
    if (SYSTEM_CONTAINER_KEYS.has(normalized)) {
      const sanitized = sanitizeSystemOwnedValue(nested);
      if (!isEmptyRecord(sanitized) && !isEmptyArray(sanitized)) output[key] = sanitized;
      continue;
    }
    if (SAFE_SYSTEM_SCALAR_KEYS.has(normalized)) {
      const sanitized = sanitizeSafeSystemScalar(normalized, nested);
      if (sanitized !== undefined) output[key] = sanitized;
    }
  }
  return output;
}

function sanitizeSystemMessageValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeSystemMessage(value);
  if (Array.isArray(value) || isRecord(value)) return sanitizeSystemOwnedValue(value);
  return REDACTED_SYSTEM_TEXT;
}

function sanitizeSystemMessage(value: string): string {
  if (/^generated [1-9]\d* artifacts?$/i.test(value.trim())) return ARTIFACTS_GENERATED_TEXT;
  return REDACTED_SYSTEM_TEXT;
}

function sanitizeSafeSystemScalar(key: string, value: unknown): unknown {
  if (key === "sequence") {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (key === "durationms") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (key === "progress") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
      ? value
      : undefined;
  }
  if (key === "success") return typeof value === "boolean" ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalizedValue = value.trim().toLowerCase().replace(/-/g, "_");
  if (key === "level") return SAFE_LEVELS.has(normalizedValue) ? normalizedValue : REDACTED_SYSTEM_TEXT;
  if (key === "status" || key === "state") {
    return SAFE_STATUSES.has(normalizedValue) ? normalizedValue : REDACTED_SYSTEM_TEXT;
  }
  if (key === "event" || key === "eventtype") {
    return SAFE_EVENTS.has(normalizedValue) ? normalizedValue : REDACTED_SYSTEM_TEXT;
  }
  if (["createdat", "startedat", "completedat", "timestamp", "time"].includes(key)) {
    return validIsoTimestamp(value) ?? REDACTED_SYSTEM_TEXT;
  }
  if (["id", "runid", "artifactid"].includes(key)) {
    const valid = key === "runid"
      ? validRunId(value)
      : key === "artifactid"
        ? validArtifactId(value)
        : validSystemId(value);
    return valid ?? REDACTED_SYSTEM_TEXT;
  }
  return undefined;
}

function classifyArtifact(
  value: unknown,
  headers: Headers,
  expected: ExpectedArtifactIdentity,
): { classification: ArtifactClassification; descriptor?: SanitizedArtifactDescriptor } {
  if (isRecord(value)) {
    const descriptor = sanitizeArtifactDescriptor(value);
    if (!descriptor || !matchesExpectedArtifact(descriptor, expected)) {
      return { classification: "untrusted" };
    }
    const responseMarker = headerArtifactType(headers);
    if (responseMarker === "invalid" || (responseMarker && responseMarker !== descriptor.type)) {
      return { classification: "untrusted" };
    }
    return {
      classification: descriptor.type === "execution_log" ? "execution-log" : "generated-artifact",
      descriptor,
    };
  }

  const type = headerArtifactType(headers);
  return type === "execution_log"
    ? { classification: "execution-log" }
    : { classification: "untrusted" };
}

function generatedArtifactResponse(
  response: Response,
  descriptor?: SanitizedArtifactDescriptor,
): Response {
  if (!descriptor) return unverifiedArtifactResponse();
  const headers = new Headers();
  const contentType = canonicalGeneratedContentType(descriptor.contentType);
  if (!contentType) return unverifiedArtifactResponse();
  headers.set("content-type", contentType);
  const fileName = descriptorFileName(descriptor);
  if (fileName) headers.set("content-disposition", `attachment; filename="${fileName}"`);
  return new Response(response.body, { status: response.status, headers });
}

function safeExecutionLogHeaders(
  headers: Headers,
  descriptor?: SanitizedArtifactDescriptor,
): Headers {
  const output = new Headers();
  output.set(
    "content-type",
    canonicalExecutionLogContentType(headers.get("content-type") ?? descriptor?.contentType),
  );
  output.set("content-disposition", `attachment; filename="${EXECUTION_LOG_FILE_NAME}"`);
  return output;
}

function descriptorFileName(descriptor?: SanitizedArtifactDescriptor): string | undefined {
  if (!descriptor) return undefined;
  const fileName = validFileName(descriptor.fileName);
  if (fileName) return fileName;
  const relativePath = validRelativePath(descriptor.relativePath);
  if (relativePath) return relativePath.split("/").at(-1);
  return validFileName(descriptor.name);
}

function explicitArtifactType(
  value: Record<string, unknown>,
): CanonicalArtifactType | "invalid" | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, "type")) return undefined;
  if (value.type === "execution_log" || value.type === "generated_output") return value.type;
  return "invalid";
}

function headerArtifactType(headers: Headers): CanonicalArtifactType | "invalid" | undefined {
  const value = headers.get("x-skills-artifact-type");
  if (value === null) return undefined;
  return canonicalArtifactType(value) ?? "invalid";
}

function canonicalArtifactType(value: unknown): CanonicalArtifactType | undefined {
  const marker = normalizeMarker(value);
  if (marker === "execution-log") return "execution_log";
  if (marker === "generated-output") return "generated_output";
  return undefined;
}

function matchesExpectedArtifact(
  descriptor: SanitizedArtifactDescriptor,
  expected: ExpectedArtifactIdentity,
): boolean {
  if (expected.artifactId !== undefined && descriptor.id !== expected.artifactId) return false;
  if (descriptor.runId !== undefined && expected.runId !== undefined && descriptor.runId !== expected.runId) {
    return false;
  }
  return true;
}

function optionalValidated<T>(
  value: Record<string, unknown>,
  key: string,
  validator: (candidate: unknown) => T | undefined,
): T | typeof INVALID | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
  return validator(value[key]) ?? INVALID;
}

function validArtifactId(value: unknown): string | undefined {
  return validOpaqueId(value, [PLATFORM_UUID, SELF_HOSTED_ARTIFACT_ID]);
}

function validRunId(value: unknown): string | undefined {
  return validOpaqueId(value, [PLATFORM_UUID, SELF_HOSTED_RUN_ID]);
}

function validSystemId(value: unknown): string | undefined {
  return validOpaqueId(value, [PLATFORM_UUID, SELF_HOSTED_RUN_ID, SELF_HOSTED_ARTIFACT_ID]);
}

const PLATFORM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SELF_HOSTED_RUN_ID = /^run_[0-9a-z]+_[0-9a-f]{8}$/;
const SELF_HOSTED_ARTIFACT_ID = /^art_[0-9a-f]{20}$/;

function validOpaqueId(value: unknown, formats: readonly RegExp[]): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return formats.some((format) => format.test(trimmed)) ? trimmed : undefined;
}

function validFileName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return undefined;
  if (value === "." || value === ".." || /[\\/\u0000-\u001f\u007f]/.test(value)) return undefined;
  if (!/^[a-z0-9][a-z0-9._ ()+@-]*$/i.test(value)) return undefined;
  return value;
}

function validRelativePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return undefined;
  if (value.startsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const segments = value.split("/");
  if (segments.some((segment) => !validFileName(segment))) return undefined;
  return value;
}

function validContentType(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return undefined;
  const trimmed = value.trim();
  const token = "[a-z0-9!#$&^_.+-]+";
  const parameter = `(?:\\s*;\\s*${token}=(?:${token}|\"[^\"\\r\\n]{0,128}\"))*`;
  return new RegExp(`^${token}/${token}${parameter}$`, "i").test(trimmed) ? trimmed : undefined;
}

function canonicalGeneratedContentType(value: unknown): string | undefined {
  const validated = validContentType(value);
  if (!validated) return undefined;

  const [rawMediaType, ...rawParameters] = validated.split(";");
  const mediaType = rawMediaType?.trim().toLowerCase();
  if (!mediaType) return undefined;

  let charset: string | undefined;
  for (const rawParameter of rawParameters) {
    const separator = rawParameter.indexOf("=");
    if (separator === -1) return undefined;
    const name = rawParameter.slice(0, separator).trim().toLowerCase();
    if (name !== "charset") continue;
    if (charset !== undefined) return undefined;
    charset = rawParameter.slice(separator + 1).trim().replace(/^"|"$/g, "").toLowerCase();
  }

  if (GENERATED_TEXT_MEDIA_TYPES.has(mediaType)) {
    if (charset !== undefined && charset !== "utf-8" && charset !== "utf8") return undefined;
    return `${mediaType}; charset=utf-8`;
  }
  if (GENERATED_BINARY_MEDIA_TYPES.has(mediaType)) {
    if (charset !== undefined) return undefined;
    return mediaType;
  }
  return undefined;
}

function canonicalExecutionLogContentType(value: unknown): string {
  const validated = validContentType(value);
  const mediaType = validated?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json" || mediaType === "text/json") {
    return "application/json; charset=utf-8";
  }
  if (["application/x-ndjson", "application/ndjson", "application/jsonl"].includes(mediaType ?? "")) {
    return "application/x-ndjson; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function validByteSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function validSha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function validIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  const canonical = parsed.toISOString();
  const normalizedInput = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_match, fraction: string) => `.${fraction.padEnd(3, "0")}Z`)
    : value.replace(/Z$/, ".000Z");
  return canonical === normalizedInput ? value : undefined;
}

function sanitizeExecutionLogText(value: string): string {
  return value.split(/(\r?\n)/).map((line) => {
    if (/^\r?\n$/.test(line) || line.trim().length === 0) return line;
    const jsonLine = sanitizeJsonExecutionLogLine(line);
    return jsonLine ?? preserveLineWhitespace(line, REDACTED_SYSTEM_TEXT);
  }).join("");
}

function sanitizeNdjsonExecutionLogText(value: string): string {
  return value.split(/(\r?\n)/).map((line) => {
    if (/^\r?\n$/.test(line) || line.trim().length === 0) return line;
    return sanitizeJsonExecutionLogLine(line) ?? preserveLineWhitespace(line, REDACTED_NDJSON_LINE);
  }).join("");
}

function sanitizeJsonExecutionLogLine(line: string): string | undefined {
  const start = line.search(/\S/);
  if (start === -1) return undefined;
  let end = line.length;
  while (end > start && /\s/.test(line[end - 1]!)) end--;
  const candidate = line.slice(start, end);
  try {
    return `${line.slice(0, start)}${JSON.stringify(sanitizeSystemOwnedValue(JSON.parse(candidate)))}${line.slice(end)}`;
  } catch {
    return undefined;
  }
}

function preserveLineWhitespace(line: string, replacement: string): string {
  const leading = line.match(/^\s*/)?.[0] ?? "";
  const trailing = line.match(/\s*$/)?.[0] ?? "";
  return `${leading}${replacement}${trailing}`;
}

function responseInit(response: Response, headers: Headers): ResponseInit {
  return { status: response.status, headers };
}

function unverifiedArtifactResponse(): Response {
  return Response.json({
    error: "Artifact type could not be verified for a direct download.",
    code: "ARTIFACT_TYPE_UNVERIFIED",
  }, { status: 422 });
}

function unsafeArtifactContentResponse(): Response {
  return Response.json({
    error: "Artifact content could not be safely sanitized.",
    code: "ARTIFACT_CONTENT_UNSAFE",
  }, { status: 422 });
}

function failedArtifactDownloadResponse(status: number): Response {
  const safeStatus = Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : 502;
  return Response.json({
    error: "Artifact download failed.",
    code: "ARTIFACT_DOWNLOAD_FAILED",
  }, { status: safeStatus });
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeMarker(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/_/g, "-") : "";
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isNdjsonContentType(value: string): boolean {
  return value.includes("ndjson") || value.includes("jsonl");
}

function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
