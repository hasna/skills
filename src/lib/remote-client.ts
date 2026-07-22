import { getApiKey as getStoredApiKey, getApiUrl } from "./auth-store.js";
import { sanitizePublicDiscoveryText } from "./discovery.js";
import {
  normalizeRemoteSkillRunContract,
  normalizeRemoteSkillRunMutationContract,
  type RemoteSkillRunContract,
} from "./remote-run-contract.js";
import {
  sanitizeCustomerCreditText,
} from "./public-credits.js";
import { addSkillsProtocolHeaders } from "./remote-protocol.js";
import { normalizeSkillsApiOrigin } from "./service-origin.js";
import {
  sanitizeCustomerArtifactDownload,
  sanitizeCustomerArtifactList,
  sanitizeCustomerExecutionLogs,
  type PublicRunArtifact,
} from "./customer-artifacts.js";
import { containsProhibitedPublicIdentity, containsProhibitedPublicMetadata } from "./public-metadata.js";
import { attachUnsignedQuoteApprovalMetadata } from "./unsigned-quote-approval.js";
import {
  parsePublicQuoteEndpoint,
  parsePublicCreditUsageEndpoint,
  parsePublicSkillEndpoint,
  isPublicServiceCode,
  type PublicRemoteAvailability,
  type PublicRemoteAvailabilityStatus,
  type PublicRemoteBillingMode,
  type PublicRemoteSkill,
  type PublicRemoteSourceType,
  type PublicRemoteVisibility,
  type PublicSkillQuote,
  type PublicCreditUsage,
} from "./public-endpoint-contract.js";

export type {
  PublicConnectorPreflight,
  PublicConnectorRequirement,
  PublicRemoteAvailability,
  PublicRemoteAvailabilityStatus,
  PublicRemoteBillingMode,
  PublicRemoteSkill,
  PublicRemoteSourceType,
  PublicRemoteVisibility,
  PublicSkillQuote,
  PublicSkillQuoteAuthRequired,
  PublicSkillQuoteError,
  PublicSkillQuoteSuccess,
  PublicSkillQuoteUnavailable,
  PublicServiceCode,
  PublicCreditTransactionType,
  PublicCreditUsage,
} from "./public-endpoint-contract.js";

export interface RemoteRunAuthorization {
  idempotencyKey: string;
  quoteToken?: string;
  approved?: boolean;
}

export type PublicBillingPlan = "free" | "credits" | "pro";
export interface PublicBillingStatus {
  plan?: PublicBillingPlan;
  creditBalance?: number;
  formattedCreditBalance?: string;
  hasPaymentMethod?: boolean;
}

export type { PublicRunArtifact } from "./customer-artifacts.js";

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

export class SkillsMutationOutcomeUnknownError extends Error {
  readonly code = "REMOTE_MUTATION_OUTCOME_UNKNOWN";

  constructor() {
    super("The remote mutation outcome is unknown. Retry the same logical attempt with the same idempotency key.");
    this.name = "SkillsMutationOutcomeUnknownError";
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
    return skills.flatMap((skill) => {
      if (!isRecord(skill)) return [];
      const parsed = parsePublicSkill(skill);
      return parsed ? [parsed] : [];
    });
  }

  async getSkillMd(slug: string): Promise<string | null> {
    const skill = await this.getSkill(slug);
    if (!skill) return null;
    const title = skill.displayName || skill.name || skill.slug || "Skill";
    const lines = [`# ${title}`];
    if (skill.description) lines.push(skill.description);
    if (skill.creditQuote) lines.push(`Credits: ${skill.creditQuote.formattedCredits}.`);
    if (skill.availability) lines.push(`Availability: ${skill.availability.status}.`);
    lines.push("Choose `cloud` or `self-hosted`, authenticate, then request execution from the selected service.");
    return lines.join("\n\n");
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
    input: Record<string, unknown> | undefined,
    args: string[] | undefined,
    authorization: RemoteRunAuthorization,
  ): Promise<RemoteSkillRunContract> {
    const { idempotencyKey, ...bodyAuthorization } = authorization;
    const headers = idempotencyHeaders(idempotencyKey);
    try {
      const response = await this.request(`/api/v1/runs/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input, args, ...bodyAuthorization }),
      });
      return normalizeRemoteSkillRunMutationContract(await readPublicJson(response), slug);
    } catch (error) {
      throw mutationError(error);
    }
  }

  async cancelRun(
    runId: string,
    options: { idempotencyKey: string },
  ): Promise<RemoteSkillRunContract> {
    const headers = idempotencyHeaders(options.idempotencyKey);
    try {
      const response = await this.request(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers,
      });
      return normalizeRemoteSkillRunMutationContract(await readPublicJson(response));
    } catch (error) {
      throw mutationError(error);
    }
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
    return usage.flatMap((entry) => isRecord(entry) ? [parsePublicCreditUsageEndpoint(entry)] : []);
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
    const artifacts = sanitizeCustomerArtifactList(await readPublicJson(response));
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
    if (isRecord(payload)) code = safePublicCode(payload.code);
  } catch {
    // The public error intentionally omits service response prose.
  }
  return new SkillsApiError(response.status, code);
}

function idempotencyHeaders(key: string): Headers {
  if (!key || key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) {
    throw new Error("Idempotency key must contain 1-200 visible ASCII characters.");
  }
  return new Headers({ "Idempotency-Key": key });
}

function mutationError(error: unknown): Error {
  if (
    error instanceof SkillsApiError
    && error.status >= 400
    && error.status < 500
    && ![408, 425, 429].includes(error.status)
  ) {
    return error;
  }
  return new SkillsMutationOutcomeUnknownError();
}

function parsePublicSkill(record: Record<string, unknown>): PublicRemoteSkill | null {
  return parsePublicSkillEndpoint(record);
}

function parsePublicQuote(payload: unknown): PublicSkillQuote {
  return attachUnsignedQuoteApprovalMetadata(parsePublicQuoteEndpoint(payload), payload);
}

function parseBillingStatus(payload: unknown): PublicBillingStatus {
  if (!isRecord(payload)) return {};
  const formatted = safeFormattedCredits(payload.formattedCreditBalance);
  return {
    ...(enumValue(payload.plan, ["free", "credits", "pro"] as const)
      ? { plan: enumValue(payload.plan, ["free", "credits", "pro"] as const) }
      : {}),
    ...pickSafeCreditNumber(payload, "creditBalance"),
    ...(formatted ? { formattedCreditBalance: formatted } : {}),
    ...(typeof payload.hasPaymentMethod === "boolean" ? { hasPaymentMethod: payload.hasPaymentMethod } : {}),
  };
}

function parsePublicStatus(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  const output: Record<string, unknown> = {};
  if (isRecord(payload.queue)) {
    const queue: Record<string, unknown> = {};
    if (isRecord(payload.queue.counts)) {
      queue.counts = pickSafeIntegerFields(payload.queue.counts, ["queued", "running", "pendingApproval", "failed24h"]);
    }
    for (const key of ["oldestQueuedAt", "lastCompletedAt", "lastFailedAt"] as const) {
      const timestamp = safeTimestamp(payload.queue[key]);
      if (timestamp) queue[key] = timestamp;
    }
    output.queue = queue;
  }
  if (isRecord(payload.usage)) {
    const usage: Record<string, unknown> = {
      ...pickSafeInteger(payload.usage, "recentCount"),
      ...pickSafeCreditNumber(payload.usage, "recentNetAmountCredits", true),
    };
    if (Array.isArray(payload.usage.recentTransactions)) {
      usage.recentTransactions = payload.usage.recentTransactions
        .filter(isRecord)
        .map((entry) => parsePublicCreditUsageEndpoint(entry));
    }
    output.usage = usage;
  }
  if (isRecord(payload.deployment)) {
    output.deployment = {
      ...(enumValue(payload.deployment.status, ["ok", "degraded", "unavailable"] as const)
        ? { status: enumValue(payload.deployment.status, ["ok", "degraded", "unavailable"] as const) }
        : {}),
      ...(safeVersion(payload.deployment.version) ? { version: safeVersion(payload.deployment.version) } : {}),
      ...(safeCommitSha(payload.deployment.commitSha) ? { commitSha: safeCommitSha(payload.deployment.commitSha) } : {}),
      ...(safeTimestamp(payload.deployment.generatedAt) ? { generatedAt: safeTimestamp(payload.deployment.generatedAt) } : {}),
    };
  }
  if (isRecord(payload.account)) {
    const account: Record<string, unknown> = {};
    const authMethod = enumValue(payload.account.authMethod, ["api_key", "jwt"] as const);
    if (authMethod) account.authMethod = authMethod;
    if (isRecord(payload.account.user)) {
      const user: Record<string, unknown> = {};
      const email = safeEmail(payload.account.user.email);
      const role = enumValue(payload.account.user.role, ["owner", "admin", "member", "viewer"] as const);
      if (email) user.email = email;
      if (role) user.role = role;
      account.user = user;
    }
    if (isRecord(payload.account.organization)) {
      const organization: Record<string, unknown> = {};
      const slug = safeSkillSlug(payload.account.organization.slug);
      const name = safeCustomerLabel(payload.account.organization.name);
      if (slug) organization.slug = slug;
      if (name) organization.name = name;
      account.organization = organization;
    }
    output.account = account;
  }
  if (isRecord(payload.worker)) {
    output.worker = {
      ...(enumValue(payload.worker.mode, ["in-process", "separate-service"] as const)
        ? { mode: enumValue(payload.worker.mode, ["in-process", "separate-service"] as const) }
        : {}),
      ...(typeof payload.worker.runnerEnabledInProcess === "boolean"
        ? { runnerEnabledInProcess: payload.worker.runnerEnabledInProcess }
        : {}),
      ...(safeOptionalExecutionText(payload.worker.healthSource)
        ? { healthSource: safeOptionalExecutionText(payload.worker.healthSource) }
        : {}),
    };
  }
  if (isRecord(payload.connectors)) {
    output.connectors = {
      ...(enumValue(payload.connectors.status, ["configured", "unconfigured", "degraded", "unavailable"] as const)
        ? { status: enumValue(payload.connectors.status, ["configured", "unconfigured", "degraded", "unavailable"] as const) }
        : {}),
      ...(safeApiPath(payload.connectors.readinessEndpoint)
        ? { readinessEndpoint: safeApiPath(payload.connectors.readinessEndpoint) }
        : {}),
    };
  }
  return output;
}

function safeExecutionText(value: string, fallback: string): string {
  if (value.length > 2_000 || containsInternalExecutionText(value)) return fallback;
  const sanitized = sanitizePublicDiscoveryText(value);
  return containsInternalExecutionText(sanitized) ? fallback : sanitizeCustomerCreditText(sanitized);
}

function safeOptionalExecutionText(value: unknown): string | undefined {
  if (typeof value !== "string" || containsInternalExecutionText(value)) return undefined;
  const sanitized = sanitizeCustomerCreditText(value).trim();
  return sanitized || undefined;
}

function containsInternalExecutionText(value: string): boolean {
  return containsProhibitedPublicMetadata(value);
}

function safePublicCode(value: unknown): string | undefined {
  return isPublicServiceCode(value) ? value : undefined;
}

function safeFormattedCredits(value: unknown): string | undefined {
  return typeof value === "string"
    && /credits?/i.test(value)
    && !containsInternalExecutionText(value)
    ? value
    : undefined;
}

const SKILL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : undefined;
}

function safeSkillSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const slug = value.trim();
  return slug.length <= 128
    && SKILL_SLUG_PATTERN.test(slug)
    && !containsProhibitedPublicIdentity(slug)
    ? slug
    : undefined;
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const identifier = value.trim();
  return identifier.length <= 200 && IDENTIFIER_PATTERN.test(identifier) && !containsProhibitedPublicIdentity(identifier)
    ? identifier
    : undefined;
}

function safeVersion(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 128 && SEMVER_PATTERN.test(value)
    ? value
    : undefined;
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function safeCommitSha(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{7,40}$/i.test(value) ? value : undefined;
}

function safeApiPath(value: unknown): string | undefined {
  return typeof value === "string" && /^\/api\/v1\/[A-Za-z0-9/_-]+$/.test(value) ? value : undefined;
}

function safeEmail(value: unknown): string | undefined {
  return typeof value === "string"
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? value
    : undefined;
}

function safeCustomerLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim();
  return label.length > 0 && label.length <= 200 && !/[\u0000-\u001F\u007F]/.test(label)
    ? label
    : undefined;
}

function pickSafeInteger(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? { [key]: value } : {};
}

function pickSafeIntegerFields(record: Record<string, unknown>, keys: readonly string[]): Record<string, number> {
  return Object.assign({}, ...keys.map((key) => pickSafeInteger(record, key)));
}

function pickSafeCreditNumber(
  record: Record<string, unknown>,
  key: string,
  allowNegative = false,
): Record<string, number> {
  const value = record[key];
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && (allowNegative || value >= 0)
    ? { [key]: value }
    : {};
}

function unwrapRecord(payload: unknown, wrappers: string[]): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  for (const wrapper of wrappers) {
    if (isRecord(payload[wrapper])) return payload[wrapper] as Record<string, unknown>;
  }
  return payload;
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
