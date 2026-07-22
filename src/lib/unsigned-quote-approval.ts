import { createHash } from "node:crypto";
import {
  toAuthoritativePublicCreditQuote,
  type PublicCreditQuote,
} from "./public-credits.js";

export const UNSIGNED_QUOTE_APPROVAL_FINGERPRINT_PREFIX = "uqaf_v1_";
export const UNSIGNED_QUOTE_APPROVAL_FINGERPRINT_PATTERN = /^uqaf_v1_[a-f0-9]{64}$/;

interface UnsignedQuoteApprovalMetadata {
  skill?: unknown;
  operation?: unknown;
  constraints?: unknown;
  expiresAt?: unknown;
}

const unsignedQuoteApprovalMetadata = new WeakMap<object, UnsignedQuoteApprovalMetadata>();

export interface UnsignedQuoteApprovalBinding {
  schemaVersion: 1;
  skill: string;
  operation: "run";
  input: Record<string, unknown>;
  args: string[];
  creditQuote: PublicCreditQuote;
  constraints: unknown;
  expiresAt: string | null;
}

export interface UnsignedQuoteApprovalFingerprintInput {
  skill: string;
  operation: "run";
  input: Record<string, unknown>;
  args: string[];
  remoteQuote: unknown;
}

/**
 * Preserve approval-only service metadata without adding it to the public quote
 * contract or any JSON/customer serialization.
 */
export function attachUnsignedQuoteApprovalMetadata<T extends object>(
  publicQuote: T,
  remoteQuote: unknown,
): T {
  if (!isRecord(remoteQuote)) return publicQuote;
  const metadata: UnsignedQuoteApprovalMetadata = {
    ...(remoteQuote.skill !== undefined ? { skill: toJsonValue(remoteQuote.skill, "skill") } : {}),
    ...(remoteQuote.operation !== undefined ? { operation: toJsonValue(remoteQuote.operation, "operation") } : {}),
    ...(remoteQuote.constraints !== undefined ? { constraints: toJsonValue(remoteQuote.constraints, "constraints") } : {}),
    ...(remoteQuote.expiresAt !== undefined ? { expiresAt: toJsonValue(remoteQuote.expiresAt, "expiresAt") } : {}),
  };
  unsignedQuoteApprovalMetadata.set(publicQuote, deepFreeze(metadata));
  return publicQuote;
}

/**
 * Builds the exact client-side approval envelope for the temporary unsigned
 * Phase-A protocol. This is not a service signature. It only lets the client
 * prove that the quote shown to a human is byte-stably equivalent to the quote
 * obtained immediately before submission.
 */
export function createUnsignedQuoteApprovalBinding(
  value: UnsignedQuoteApprovalFingerprintInput,
): UnsignedQuoteApprovalBinding {
  if (!value.skill.trim()) throw new Error("Unsigned quote approval requires a skill.");
  if (!isRecord(value.remoteQuote)) throw new Error("Unsigned quote approval requires a quote object.");

  const metadata = approvalMetadata(value.remoteQuote);

  const quotedSkill = optionalNonEmptyString(metadata.skill);
  if (quotedSkill !== undefined && quotedSkill !== value.skill) {
    throw new Error(`Unsigned quote skill '${quotedSkill}' does not match requested skill '${value.skill}'.`);
  }
  const quotedOperation = optionalNonEmptyString(metadata.operation);
  if (quotedOperation !== undefined && quotedOperation !== value.operation) {
    throw new Error(`Unsigned quote operation '${quotedOperation}' does not match requested operation '${value.operation}'.`);
  }
  if (value.remoteQuote.creditQuote === undefined) {
    throw new Error("Unsigned quote approval requires a creditQuote.");
  }

  return {
    schemaVersion: 1,
    skill: value.skill,
    operation: value.operation,
    input: toJsonValue(value.input, "input") as Record<string, unknown>,
    args: [...value.args],
    creditQuote: toAuthoritativePublicCreditQuote(value.remoteQuote.creditQuote),
    constraints: metadata.constraints === undefined
      ? null
      : toJsonValue(metadata.constraints, "constraints"),
    expiresAt: metadata.expiresAt === undefined
      ? null
      : requiredNonEmptyString(metadata.expiresAt, "expiresAt"),
  };
}

export function createUnsignedQuoteApprovalFingerprint(
  value: UnsignedQuoteApprovalFingerprintInput,
): string {
  const binding = createUnsignedQuoteApprovalBinding(value);
  const digest = createHash("sha256").update(stableJson(binding)).digest("hex");
  return `${UNSIGNED_QUOTE_APPROVAL_FINGERPRINT_PREFIX}${digest}`;
}

export function isUnsignedQuoteApprovalFingerprint(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_QUOTE_APPROVAL_FINGERPRINT_PATTERN.test(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Unsigned quote approval data must contain finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  throw new Error("Unsigned quote approval data must be JSON-compatible.");
}

function toJsonValue(value: unknown, field: string): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error(`${field} is not JSON-compatible.`);
    return JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Unsigned quote ${field} must be JSON-compatible: ${(error as Error).message}`);
  }
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredNonEmptyString(value, "binding field");
}

function requiredNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Unsigned quote ${field} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function approvalMetadata(remoteQuote: Record<string, unknown>): UnsignedQuoteApprovalMetadata {
  return unsignedQuoteApprovalMetadata.get(remoteQuote) ?? remoteQuote;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
