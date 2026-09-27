export const REMOTE_SKILL_RUN_CONTRACT_VERSION = 1 as const;

export interface RemoteSkillRunContract {
  contractVersion: typeof REMOTE_SKILL_RUN_CONTRACT_VERSION;
  id?: string;
  skill?: string;
  requestedSlug?: string;
  status?: string;
  exitCode?: number;
  correlationId?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  outputType?: string;
  outputPreview?: unknown;
  errorCode?: string;
  errorMessage?: string;
  error?: string;
  code?: string;
  details?: unknown;
}

export function normalizeRemoteSkillRunContract(
  payload: unknown,
  fallbackSkill?: string,
): RemoteSkillRunContract {
  const record = isRecord(payload) ? payload : {};
  return {
    contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
    ...pickString(record, "id"),
    skill: pickStringValue(record, "skill") ?? fallbackSkill,
    ...pickString(record, "requestedSlug"),
    ...pickString(record, "status"),
    ...pickNumber(record, "exitCode"),
    ...pickString(record, "correlationId"),
    ...pickString(record, "createdAt"),
    ...pickString(record, "startedAt"),
    ...pickString(record, "completedAt"),
    ...pickNumber(record, "durationMs"),
    ...pickString(record, "outputType"),
    ...(hasOwn(record, "outputPreview") ? { outputPreview: record.outputPreview } : {}),
    ...pickString(record, "errorCode"),
    ...pickString(record, "errorMessage"),
    ...pickString(record, "error"),
    ...pickString(record, "code"),
    ...(hasOwn(record, "details") ? { details: record.details } : {}),
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
