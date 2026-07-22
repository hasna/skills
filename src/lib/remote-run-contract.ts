import { sanitizeCustomerCreditText, toPublicCreditQuote, type PublicCreditQuote } from "./public-credits.js";

export const REMOTE_SKILL_RUN_CONTRACT_VERSION = 1 as const;

export interface RemoteSkillRunContract {
  contractVersion: typeof REMOTE_SKILL_RUN_CONTRACT_VERSION;
  id?: string;
  skill?: string;
  requestedSlug?: string;
  status?: string;
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
  artifacts?: Array<Record<string, string>>;
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
  return {
    contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
    ...pickString(record, "id"),
    ...(skill ? { skill } : {}),
    ...pickString(record, "requestedSlug"),
    ...pickString(record, "status"),
    ...pickNumber(record, "exitCode"),
    ...pickString(record, "correlationId"),
    ...pickNumber(record, "credits"),
    ...pickString(record, "formattedCredits"),
    ...pickCreditQuote(record),
    ...pickString(record, "createdAt"),
    ...pickString(record, "startedAt"),
    ...pickString(record, "completedAt"),
    ...pickNumber(record, "durationMs"),
    ...pickString(record, "outputType"),
    ...pickCode(record, "errorCode"),
    ...pickCustomerError(record, "errorMessage"),
    ...pickNumber(record, "creditsReserved"),
    ...pickNumber(record, "creditsUsed"),
    ...pickNumber(record, "creditBalance"),
    ...pickString(record, "formattedCreditBalance"),
    ...pickNumber(record, "amountCredits"),
    ...pickNumber(record, "recentNetAmountCredits"),
    ...pickCustomerError(record, "error"),
    ...pickCode(record, "code"),
    ...pickCustomerDetails(record),
    ...pickArtifacts(record),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pickString(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = pickStringValue(record, key);
  return value === undefined ? {} : { [key]: value };
}

function pickStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function pickNumber(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } : {};
}

function pickCreditQuote(record: Record<string, unknown>): { creditQuote?: PublicCreditQuote } {
  return isRecord(record.creditQuote) ? { creditQuote: toPublicCreditQuote(record.creditQuote) } : {};
}

function pickCode(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = pickStringValue(record, key);
  return value && /^[A-Z0-9_]+$/.test(value) ? { [key]: value } : {};
}

function pickCustomerError(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = pickStringValue(record, key);
  if (!value) return {};
  return { [key]: containsInternalExecutionText(value)
    ? "The Skills run could not be completed."
    : sanitizeCustomerCreditText(value) };
}

function pickCustomerDetails(record: Record<string, unknown>): { details?: string[] } {
  if (!Array.isArray(record.details)) return {};
  const details = record.details
    .filter((value): value is string => typeof value === "string")
    .filter((value) => !containsInternalExecutionText(value))
    .map(sanitizeCustomerCreditText);
  return details.length > 0 ? { details } : {};
}

function pickArtifacts(record: Record<string, unknown>): { artifacts?: Array<Record<string, string>> } {
  if (!Array.isArray(record.artifacts)) return {};
  const artifacts = record.artifacts.flatMap((value) => {
    if (!isRecord(value)) return [];
    const artifact: Record<string, string> = {};
    for (const key of ["id", "type", "fileName", "relativePath", "name", "contentType"] as const) {
      const nested = value[key];
      if (typeof nested === "string") artifact[key] = nested;
    }
    return Object.keys(artifact).length > 0 ? [artifact] : [];
  });
  return artifacts.length > 0 ? { artifacts } : {};
}

function containsInternalExecutionText(value: string): boolean {
  return /\b(?:provider|model|margin|routing|route|settlement|fiat|cost(?:s|ed|ing)?|usd|eur|gbp)\b|\$/i.test(value);
}
