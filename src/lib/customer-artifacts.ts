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
  "route",
  "routeid",
  "routing",
]);

const SYSTEM_ENVELOPE_KEYS = new Set([
  "metadata",
  "executionmetadata",
  "routemetadata",
  "providermetadata",
  "billingmetadata",
  "accountingmetadata",
]);

const SYSTEM_MESSAGE_KEYS = new Set(["message", "error", "detail", "details", "reason"]);

export function sanitizeCustomerArtifactList(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((artifact) => sanitizeSystemOwnedRecord(artifact));
}

export function sanitizeCustomerExecutionLogs(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => sanitizeSystemOwnedRecord(entry));
}

export async function sanitizeCustomerArtifactDownload(
  response: Response,
  artifact?: unknown,
): Promise<Response> {
  if (!response.ok) return response;
  if (!hasTrustedArtifactMetadata(artifact, response.headers)) {
    return Response.json({
      error: "Artifact type could not be verified for a direct download.",
      code: "ARTIFACT_TYPE_UNVERIFIED",
    }, { status: 422 });
  }
  if (!isExecutionLogArtifact(artifact, response.headers)) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();
  let sanitized: string;

  if (contentType.includes("json") || looksLikeJson(text)) {
    try {
      sanitized = `${JSON.stringify(sanitizeSystemOwnedRecord(JSON.parse(text)), null, 2)}\n`;
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

function sanitizeSystemOwnedRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSystemOwnedRecord);
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (INTERNAL_ARTIFACT_KEYS.has(normalizeKey(key))) continue;
    if (SYSTEM_MESSAGE_KEYS.has(key)) {
      output[key] = sanitizeSystemMessage(nested);
      continue;
    }
    output[key] = SYSTEM_ENVELOPE_KEYS.has(normalizeKey(key))
      ? sanitizeSystemOwnedRecord(nested)
      : nested;
  }
  return output;
}

function sanitizeSystemMessage(value: unknown): unknown {
  if (typeof value === "string") return sanitizeCustomerCreditText(value);
  if (Array.isArray(value)) return value.map(sanitizeSystemMessage);
  if (isRecord(value)) return sanitizeSystemOwnedRecord(value);
  return value;
}

function hasTrustedArtifactMetadata(value: unknown, headers: Headers): boolean {
  if (isRecord(value)) {
    const id = typeof value.id === "string" && value.id.trim();
    const marker = ["type", "kind", "artifactType", "category", "fileName", "relativePath", "contentType"]
      .some((key) => typeof value[key] === "string" && String(value[key]).trim());
    if (id && marker) return true;
  }
  return Boolean(
    headers.get("x-skills-artifact-type")?.trim()
    || headers.get("content-disposition")?.trim(),
  );
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
  return value.split(/(\r?\n)/).map((line) => {
    const match = line.match(/^(\s*)(provider|providerId|model|modelId|route|routeId|cost|costCents|costMicros|providerCost|providerCostCents|providerCostMicros|price|currency|margin|marginCents|settlement)\s*[:=]/i);
    return match ? `${match[1]}${match[2]}=[redacted]` : line;
  }).join("");
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
