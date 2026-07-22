import { getApiKey as getStoredApiKey, getApiUrl } from "./auth-store.js";
import {
  sanitizePublicDiscoveryText,
  publicDiscoveryTags,
} from "./discovery.js";
import { normalizeRemoteSkillRunContract, type RemoteSkillRunContract } from "./remote-run-contract.js";
import {
  sanitizeCustomerCreditText,
  toAuthoritativePublicCreditQuote,
  type PublicCreditQuote,
} from "./public-credits.js";
import { addSkillsProtocolHeaders } from "./remote-protocol.js";
import { normalizeSkillsApiOrigin } from "./service-origin.js";
import {
  sanitizeCustomerArtifactDownload,
  sanitizeCustomerArtifactList,
  sanitizeCustomerExecutionLogs,
} from "./customer-artifacts.js";

export interface RemoteRunAuthorization {
  quoteToken?: string;
  approved?: boolean;
  idempotencyKey?: string;
}

export interface PublicRemoteSkill {
  id?: string;
  slug?: string;
  name?: string;
  displayName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  visibility?: string;
  currentVersion?: string;
  billingMode?: string;
  creditsPerExecution?: number;
  sourceType?: string;
  creditQuote?: PublicCreditQuote;
  availability?: PublicRemoteAvailability;
}

export interface PublicRemoteAvailability {
  status: string;
  code?: string;
  message?: string;
  details?: string[];
}

export interface PublicSkillQuote {
  contractVersion?: number;
  skill?: string;
  quoteToken?: string;
  expiresAt?: string;
  creditQuote?: PublicCreditQuote;
  availability?: PublicRemoteAvailability;
  code?: string;
  error?: string;
  detail?: string;
}

export interface PublicBillingStatus {
  plan?: string;
  creditBalance?: number;
  formattedCreditBalance?: string;
  hasPaymentMethod?: boolean;
}

export interface PublicCreditUsage {
  id?: string;
  runId?: string;
  transactionType?: string;
  amountCredits?: number;
  balanceAfterAvailable?: number;
  balanceAfterReserved?: number;
  description?: string;
  createdAt?: string;
}

export interface PublicRunArtifact extends Record<string, unknown> {
  id: string;
  relativePath?: string;
}

export class SkillsApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super("The Skills service rejected the request.");
    this.name = "SkillsApiError";
    this.status = status;
    if (code) this.code = code;
  }
}

export class RemoteSkillsClient {
  private apiUrl: string;
  private apiKey: string;
  private artifactDescriptors = new Map<string, Readonly<Record<string, unknown>>>();
  private artifactListEpochs = new Map<string, number>();

  constructor(
    apiKey: string,
    apiUrl = getApiUrl(),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.apiKey = apiKey;
    this.apiUrl = normalizeSkillsApiOrigin(apiUrl, env);
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    const headers = new Headers(options?.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("Content-Type", "application/json");
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: addSkillsProtocolHeaders(headers),
    });
  }

  async listSkills(): Promise<PublicRemoteSkill[]> {
    const response = await this.request("/api/v1/skills");
    const payload = await readPublicJson(response);
    const skills = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.skills)
        ? payload.skills
        : isRecord(payload) && Array.isArray(payload.data)
          ? payload.data
          : [];
    return skills.flatMap((skill) => isRecord(skill) ? [parsePublicSkill(skill)] : []);
  }

  async getSkillMd(slug: string): Promise<string | null> {
    const response = await this.request(`/api/v1/skills/${encodeURIComponent(slug)}/skill.md`);
    if (response.status === 404) return null;
    if (!response.ok) throw await publicApiError(response);
    return response.text();
  }

  async getSkill(slug: string): Promise<PublicRemoteSkill | null> {
    const response = await this.request(`/api/v1/skills/${encodeURIComponent(slug)}`);
    if (response.status === 404) return null;
    const payload = await readPublicJson(response);
    const record = unwrapRecord(payload, ["skill", "data"]);
    return record ? parsePublicSkill(record) : null;
  }

  async quoteSkill(slug: string, input?: Record<string, unknown>, args?: string[]): Promise<PublicSkillQuote> {
    const response = await this.request(`/api/v1/skills/${encodeURIComponent(slug)}/quote`, {
      method: "POST",
      body: JSON.stringify({ input, args }),
    });
    return parsePublicQuote(await readPublicJson(response));
  }

  async submitRun(
    slug: string,
    input?: Record<string, unknown>,
    args?: string[],
    authorization: RemoteRunAuthorization = {},
  ): Promise<RemoteSkillRunContract> {
    const { idempotencyKey, ...bodyAuthorization } = authorization;
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: idempotencyHeaders(idempotencyKey),
      body: JSON.stringify({ input, args, ...bodyAuthorization }),
    });
    return normalizeRemoteSkillRunContract(await readPublicJson(response), slug);
  }

  async cancelRun(
    runId: string,
    options: { idempotencyKey?: string } = {},
  ): Promise<RemoteSkillRunContract> {
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: idempotencyHeaders(options.idempotencyKey),
    });
    return normalizeRemoteSkillRunContract(await readPublicJson(response));
  }

  async getRun(runId: string): Promise<RemoteSkillRunContract | null> {
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}`);
    if (response.status === 404) return null;
    return normalizeRemoteSkillRunContract(await readPublicJson(response));
  }

  async getRunLogs(runId: string): Promise<any[]> {
    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/logs`);
    if (response.status === 404) return [];
    return sanitizeCustomerExecutionLogs(await readPublicJson(response));
  }

  async listRuns(limit = 20): Promise<RemoteSkillRunContract[]> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const payload = await readPublicJson(await this.request(`/api/v1/runs?limit=${safeLimit}`));
    const runs = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.runs)
        ? payload.runs
        : isRecord(payload) && Array.isArray(payload.data)
          ? payload.data
          : [];
    return runs.flatMap((run) => isRecord(run) ? [normalizeRemoteSkillRunContract(run)] : []);
  }

  async getBillingStatus(): Promise<PublicBillingStatus> {
    const payload = await readPublicJson(await this.request("/api/v1/billing/status"));
    return parseBillingStatus(payload);
  }

  async getUsage(): Promise<PublicCreditUsage[]> {
    const payload = await readPublicJson(await this.request("/api/v1/billing/usage"));
    const usage = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.usage)
        ? payload.usage
        : isRecord(payload) && Array.isArray(payload.data)
          ? payload.data
          : [];
    return usage.flatMap((entry) => isRecord(entry) ? [parseCreditUsage(entry)] : []);
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return parsePublicStatus(await readPublicJson(await this.request("/api/v1/status")));
  }

  async getRunArtifacts(runId: string): Promise<PublicRunArtifact[]> {
    const prefix = `${runId}\u0000`;
    const epoch = (this.artifactListEpochs.get(runId) ?? 0) + 1;
    this.artifactListEpochs.set(runId, epoch);
    for (const key of this.artifactDescriptors.keys()) {
      if (key.startsWith(prefix)) this.artifactDescriptors.delete(key);
    }

    const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/artifacts`);
    if (!response.ok) return [];
    const artifacts = sanitizeCustomerArtifactList(await readPublicJson(response)) as PublicRunArtifact[];
    if (this.artifactListEpochs.get(runId) !== epoch) return [];
    for (const artifact of artifacts) {
      if (artifact && typeof artifact === "object" && typeof (artifact as Record<string, unknown>).id === "string") {
        const descriptor = immutableArtifactDescriptor(artifact as Record<string, unknown>);
        this.artifactDescriptors.set(`${prefix}${descriptor.id}`, descriptor);
      }
    }
    return structuredClone(artifacts);
  }

  async downloadRunArtifact(runId: string, artifactId: string, _artifact?: unknown): Promise<Response> {
    const descriptorKey = `${runId}\u0000${artifactId}`;
    const descriptorEpoch = this.artifactListEpochs.get(runId);
    const descriptor = this.artifactDescriptors.get(descriptorKey);
    const response = await this.request(
      `/api/v1/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/download`,
      { method: "GET" },
    );
    const descriptorIsCurrent = this.artifactListEpochs.get(runId) === descriptorEpoch
      && this.artifactDescriptors.get(descriptorKey) === descriptor;
    return sanitizeCustomerArtifactDownload(
      response,
      descriptorIsCurrent ? descriptor : undefined,
      { runId, artifactId },
    );
  }
}

async function readPublicJson(response: Response): Promise<unknown> {
  if (!response.ok) throw await publicApiError(response);
  try {
    return await response.json();
  } catch {
    throw new SkillsApiError(response.status, "INVALID_RESPONSE");
  }
}

async function publicApiError(response: Response): Promise<SkillsApiError> {
  let code: string | undefined;
  try {
    const payload = await response.json();
    if (isRecord(payload) && typeof payload.code === "string" && /^[A-Z0-9_]+$/.test(payload.code)) {
      code = payload.code;
    }
  } catch {
    // The public error intentionally omits service response prose.
  }
  return new SkillsApiError(response.status, code);
}

function idempotencyHeaders(key: string | undefined): Headers | undefined {
  if (key === undefined) return undefined;
  if (!key || key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new Error("Idempotency key must contain 1-200 visible ASCII characters.");
  }
  return new Headers({ "Idempotency-Key": key });
}

function parsePublicSkill(record: Record<string, unknown>): PublicRemoteSkill {
  return {
    ...pickStringFields(record, [
      "id", "slug", "name", "displayName", "category", "visibility", "currentVersion", "billingMode", "sourceType",
    ]),
    ...(typeof record.description === "string"
      ? { description: sanitizePublicDiscoveryText(record.description) }
      : {}),
    ...(Array.isArray(record.tags)
      ? { tags: publicDiscoveryTags(record.tags.filter((tag): tag is string => typeof tag === "string")) }
      : {}),
    ...pickFiniteNumber(record, "creditsPerExecution"),
    ...(isRecord(record.creditQuote)
      ? { creditQuote: toAuthoritativePublicCreditQuote(record.creditQuote) }
      : {}),
    ...(isRecord(record.availability)
      ? { availability: parseAvailability(record.availability) }
      : {}),
  };
}

function parsePublicQuote(payload: unknown): PublicSkillQuote {
  if (!isRecord(payload)) return {};
  return {
    ...pickFiniteNumber(payload, "contractVersion"),
    ...pickStringFields(payload, ["skill", "quoteToken", "expiresAt"]),
    ...(isRecord(payload.creditQuote)
      ? { creditQuote: toAuthoritativePublicCreditQuote(payload.creditQuote) }
      : {}),
    ...(isRecord(payload.availability)
      ? { availability: parseAvailability(payload.availability) }
      : {}),
    ...(typeof payload.code === "string" && /^[A-Z0-9_]+$/.test(payload.code)
      ? { code: payload.code }
      : {}),
    ...(typeof payload.error === "string"
      ? { error: safeExecutionText(payload.error, "The Skills service could not provide a quote.") }
      : {}),
    ...(typeof payload.detail === "string"
      ? { detail: safeExecutionText(payload.detail, "Quote detail is unavailable.") }
      : {}),
  };
}

function parseBillingStatus(payload: unknown): PublicBillingStatus {
  if (!isRecord(payload)) return {};
  const formatted = safeFormattedCredits(payload.formattedCreditBalance);
  return {
    ...pickStringFields(payload, ["plan"]),
    ...pickFiniteNumber(payload, "creditBalance"),
    ...(formatted ? { formattedCreditBalance: formatted } : {}),
    ...(typeof payload.hasPaymentMethod === "boolean" ? { hasPaymentMethod: payload.hasPaymentMethod } : {}),
  };
}

function parseCreditUsage(record: Record<string, unknown>): PublicCreditUsage {
  return {
    ...pickStringFields(record, ["id", "runId", "transactionType", "createdAt"]),
    ...pickFiniteNumber(record, "amountCredits", true),
    ...pickFiniteNumber(record, "balanceAfterAvailable", true),
    ...pickFiniteNumber(record, "balanceAfterReserved", true),
    ...(typeof record.description === "string"
      ? { description: safeExecutionText(record.description, "Skill credit activity") }
      : {}),
  };
}

function parsePublicStatus(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  const output: Record<string, unknown> = {};
  if (isRecord(payload.queue)) {
    const queue: Record<string, unknown> = {};
    if (isRecord(payload.queue.counts)) {
      queue.counts = pickFiniteNumberFields(payload.queue.counts, ["queued", "running", "pendingApproval", "failed24h"]);
    }
    Object.assign(queue, pickStringFields(payload.queue, ["oldestQueuedAt", "lastCompletedAt", "lastFailedAt"]));
    output.queue = queue;
  }
  if (isRecord(payload.usage)) {
    const usage: Record<string, unknown> = {
      ...pickFiniteNumberFields(payload.usage, ["recentCount", "recentNetAmountCredits"], true),
    };
    if (Array.isArray(payload.usage.recentTransactions)) {
      usage.recentTransactions = payload.usage.recentTransactions
        .filter(isRecord)
        .map(parseCreditUsage);
    }
    output.usage = usage;
  }
  if (isRecord(payload.deployment)) {
    output.deployment = pickStringFields(payload.deployment, ["status", "version", "commitSha", "generatedAt"]);
  }
  if (isRecord(payload.account)) {
    const account: Record<string, unknown> = pickStringFields(payload.account, ["authMethod"]);
    if (isRecord(payload.account.user)) account.user = pickStringFields(payload.account.user, ["email", "role"]);
    if (isRecord(payload.account.organization)) {
      account.organization = pickStringFields(payload.account.organization, ["slug", "name"]);
    }
    output.account = account;
  }
  if (isRecord(payload.worker)) {
    output.worker = {
      ...pickStringFields(payload.worker, ["mode"]),
      ...(typeof payload.worker.runnerEnabledInProcess === "boolean"
        ? { runnerEnabledInProcess: payload.worker.runnerEnabledInProcess }
        : {}),
      ...(typeof payload.worker.healthSource === "string"
        ? { healthSource: safeExecutionText(payload.worker.healthSource, "Service health") }
        : {}),
    };
  }
  if (isRecord(payload.connectors)) {
    output.connectors = pickStringFields(payload.connectors, ["status", "readinessEndpoint"]);
  }
  return output;
}

function parseAvailability(record: Record<string, unknown>): PublicRemoteAvailability {
  const status = typeof record.status === "string" ? record.status : "unavailable";
  const code = typeof record.code === "string" && /^[A-Z0-9_]+$/.test(record.code) ? record.code : undefined;
  const message = typeof record.message === "string"
    ? safeExecutionText(record.message, "Skill is currently unavailable.")
    : undefined;
  const details = Array.isArray(record.details)
    ? record.details
      .filter((detail): detail is string => typeof detail === "string")
      .map((detail) => safeExecutionText(detail, "Additional service detail is unavailable."))
    : undefined;
  return {
    status,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(details && details.length > 0 ? { details } : {}),
  };
}

function safeExecutionText(value: string, fallback: string): string {
  return containsInternalExecutionText(value) ? fallback : sanitizeCustomerCreditText(value);
}

function containsInternalExecutionText(value: string): boolean {
  return /\b(?:provider|model|margin|routing|route|settlement|fiat|cost(?:s|ed|ing)?|usd|eur|gbp)\b|\$/i.test(value);
}

function safeFormattedCredits(value: unknown): string | undefined {
  return typeof value === "string" && /credits?/i.test(value) && !/\$|\b(?:usd|eur|gbp|cents?)\b/i.test(value)
    ? value
    : undefined;
}

function unwrapRecord(payload: unknown, wrappers: string[]): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  for (const wrapper of wrappers) {
    if (isRecord(payload[wrapper])) return payload[wrapper] as Record<string, unknown>;
  }
  return payload;
}

function pickStringFields<T extends string>(record: Record<string, unknown>, keys: readonly T[]): Partial<Record<T, string>> {
  const output: Partial<Record<T, string>> = {};
  for (const key of keys) {
    if (typeof record[key] === "string") output[key] = record[key] as string;
  }
  return output;
}

function pickFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  allowNegative = false,
): Record<string, number> {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && (allowNegative || value >= 0) ? { [key]: value } : {};
}

function pickFiniteNumberFields(
  record: Record<string, unknown>,
  keys: readonly string[],
  allowNegative = false,
): Record<string, number> {
  return Object.assign({}, ...keys.map((key) => pickFiniteNumber(record, key, allowNegative)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function immutableArtifactDescriptor(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function createRemoteSkillsClient(): RemoteSkillsClient | null {
  const apiKey = getStoredApiKey();
  if (!apiKey) return null;
  return new RemoteSkillsClient(apiKey);
}
