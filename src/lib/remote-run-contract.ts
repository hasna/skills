import { toPublicCreditQuote, type PublicCreditQuote } from "./public-credits.js";
import { sanitizeCustomerArtifactList, type PublicRunArtifact } from "./customer-artifacts.js";
import { containsProhibitedPublicIdentity, containsProhibitedPublicMetadata } from "./public-metadata.js";
import { isPublicServiceCode, publicRunFailureText } from "./public-endpoint-contract.js";

export const REMOTE_SKILL_RUN_CONTRACT_VERSION = 1 as const;
export const REMOTE_SKILL_RUN_STATUSES = [
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
] as const;
export type RemoteSkillRunStatus = (typeof REMOTE_SKILL_RUN_STATUSES)[number];

export interface RemoteSkillRunContract {
  contractVersion: typeof REMOTE_SKILL_RUN_CONTRACT_VERSION;
  id?: string;
  skill?: string;
  requestedSlug?: string;
  status?: RemoteSkillRunStatus;
  exitCode?: number;
  correlationId?: string;
  credits?: number;
  formattedCredits?: string;
  creditQuote?: PublicCreditQuote;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  outputType?: string;
  errorCode?: string;
  errorMessage?: string;
  creditsReserved?: number;
  creditsUsed?: number;
  creditBalance?: number;
  formattedCreditBalance?: string;
  amountCredits?: number;
  recentNetAmountCredits?: number;
  error?: string;
  code?: string;
  details?: string[];
  artifacts?: PublicRunArtifact[];
}

export function normalizeRemoteSkillRunContract(
  payload: unknown,
  fallbackSkill?: string,
): RemoteSkillRunContract {
  if (isRecord(payload) && hasOwn(payload, "contractVersion") && payload.contractVersion !== REMOTE_SKILL_RUN_CONTRACT_VERSION) {
    throw new Error(`Unsupported remote skill run contract version: ${String(payload.contractVersion)}`);
  }
  const record = isRecord(payload) ? payload : {};
  const skill = pickStringValue(record, "skill") ?? fallbackSkill;
  const status = enumValue(record.status, REMOTE_SKILL_RUN_STATUSES);
  const failureText = publicRunFailureText(
    publicCode(record.errorCode) ?? publicCode(record.code),
    status,
  );
  return {
    contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
    ...pickIdentifier(record, "id"),
    ...(safeSlug(skill) ? { skill: safeSlug(skill) } : {}),
    ...(safeSlug(record.requestedSlug) ? { requestedSlug: safeSlug(record.requestedSlug) } : {}),
    ...(status ? { status } : {}),
    ...pickInteger(record, "exitCode", true),
    ...pickIdentifier(record, "correlationId"),
    ...pickInteger(record, "credits"),
    ...pickFormattedCredits(record, "formattedCredits"),
    ...pickCreditQuote(record),
    ...pickTimestamp(record, "createdAt"),
    ...pickTimestamp(record, "startedAt"),
    ...pickTimestamp(record, "completedAt"),
    ...pickInteger(record, "durationMs"),
    ...pickEnum(record, "outputType", ["artifact_bundle", "generated_output", "execution_log"] as const),
    ...pickCode(record, "errorCode"),
    ...pickCustomerError(record, "errorMessage", failureText.message),
    ...pickInteger(record, "creditsReserved"),
    ...pickInteger(record, "creditsUsed"),
    ...pickInteger(record, "creditBalance"),
    ...pickFormattedCredits(record, "formattedCreditBalance"),
    ...pickInteger(record, "amountCredits", true),
    ...pickInteger(record, "recentNetAmountCredits", true),
    ...pickCustomerError(record, "error", failureText.message),
    ...pickCode(record, "code"),
    ...pickCustomerDetails(record, failureText.details),
    ...pickArtifacts(record),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pickStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function pickEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  allowed: T,
): Record<string, T[number]> {
  const value = record[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? { [key]: value as T[number] }
    : {};
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : undefined;
}

function pickIdentifier(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  return typeof value === "string"
    && value.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    && !containsProhibitedPublicIdentity(value)
    ? { [key]: value }
    : {};
}

function safeSlug(value: unknown): string | undefined {
  return typeof value === "string"
    && value.length <= 128
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && !containsInternalExecutionText(value)
    ? value
    : undefined;
}

function pickTimestamp(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  return typeof value === "string"
    && value.length <= 64
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value))
    ? { [key]: value }
    : {};
}

function pickInteger(record: Record<string, unknown>, key: string, allowNegative = false): Record<string, number> {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && (allowNegative || value >= 0)
    ? { [key]: value }
    : {};
}

function pickFormattedCredits(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  return typeof value === "string"
    && value.length <= 128
    && /credits?/i.test(value)
    && !containsInternalExecutionText(value)
    ? { [key]: value }
    : {};
}

function pickCreditQuote(record: Record<string, unknown>): { creditQuote?: PublicCreditQuote } {
  return isRecord(record.creditQuote) ? { creditQuote: toPublicCreditQuote(record.creditQuote) } : {};
}

function pickCode(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = publicCode(record[key]);
  return value ? { [key]: value } : {};
}

function publicCode(value: unknown): string | undefined {
  return isPublicServiceCode(value)
    ? value
    : undefined;
}

function pickCustomerError(record: Record<string, unknown>, key: string, message: string): Record<string, string> {
  const value = pickStringValue(record, key);
  if (!value) return {};
  return { [key]: message };
}

function pickCustomerDetails(record: Record<string, unknown>, details: string[]): { details?: string[] } {
  if (!Array.isArray(record.details)) return {};
  return details.length > 0 ? { details } : {};
}

function pickArtifacts(record: Record<string, unknown>): { artifacts?: PublicRunArtifact[] } {
  const artifacts = sanitizeCustomerArtifactList(record.artifacts);
  return artifacts.length > 0 ? { artifacts } : {};
}

function containsInternalExecutionText(value: string): boolean {
  return containsProhibitedPublicMetadata(value);
}
