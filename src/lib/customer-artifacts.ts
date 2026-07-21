import { sanitizeCustomerCreditText } from "./public-credits.js";

const INTERNAL_ARTIFACT_KEYS = new Set([
  "provider",
  "providerid",
  "providername",
  "providerref",
  "model",
  "modelid",
  "modelname",
  "modelref",
  "cost",
  "costcents",
  "costmicros",
  "providercost",
  "providercostcents",
  "providercostmicros",
  "price",
  "pricing",
  "currency",
  "margin",
  "margincents",
  "settlement",
]);

export function sanitizeCustomerArtifactList(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((artifact) => sanitizeArtifactRecord(artifact));
}

export async function sanitizeCustomerArtifactDownload(
  response: Response,
  artifact?: unknown,
): Promise<Response> {
  if (!isExecutionLogArtifact(artifact, response.headers)) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();
  let sanitized: string;

  if (contentType.includes("json") || looksLikeJson(text)) {
    try {
      sanitized = `${JSON.stringify(sanitizeArtifactRecord(JSON.parse(text)), null, 2)}\n`;
      headers.set("content-type", "application/json; charset=utf-8");
    } catch {
      sanitized = sanitizeExecutionLogText(text);
    }
  } else {
    sanitized = sanitizeExecutionLogText(text);
  }

  return new Response(sanitized, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sanitizeArtifactRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeArtifactRecord);
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (INTERNAL_ARTIFACT_KEYS.has(normalizeKey(key))) continue;
    output[key] = sanitizeArtifactRecord(nested);
  }
  return output;
}

function isExecutionLogArtifact(value: unknown, headers?: Headers): boolean {
  if (isRecord(value)) {
    for (const key of ["type", "kind", "artifactType", "category"]) {
      if (normalizeMarker(value[key]) === "execution-log") return true;
    }
    for (const key of ["fileName", "relativePath", "name"]) {
      if (typeof value[key] === "string" && /(?:^|[^a-z0-9])execution[._-]?log(?:[^a-z0-9]|$)/i.test(value[key])) return true;
    }
  }
  if (!headers) return false;
  return normalizeMarker(headers.get("x-skills-artifact-type")) === "execution-log"
    || /(?:^|[^a-z0-9])execution[._-]?log(?:[^a-z0-9]|$)/i.test(headers.get("content-disposition") ?? "");
}

function sanitizeExecutionLogText(value: string): string {
  return sanitizeCustomerCreditText(value)
    .replace(/\b(provider|model)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]")
    .replace(/\b(provider|model)\s+(?:is\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1 [redacted]")
    .replace(/\b(currency|margin|settlement)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[redacted]");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
