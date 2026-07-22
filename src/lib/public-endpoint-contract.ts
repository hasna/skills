import { publicDiscoveryTags, sanitizePublicDiscoveryText } from "./discovery.js";
import { containsProhibitedPublicIdentity, isProhibitedPublicKey } from "./public-metadata.js";
import {
  toAuthoritativePublicCreditQuote,
  type PublicCreditQuote,
} from "./public-credits.js";
import { CATEGORIES, getSkill } from "./registry.js";
import {
  getSkillToolDependencies,
  getToolPrimitive,
  type SkillToolDependencies,
} from "./tool-primitives.js";

export type PublicRemoteSourceType = "upstream" | "hosted";
export type PublicRemoteVisibility = "public" | "unlisted";
export type PublicRemoteBillingMode = "free" | "credits" | "subscription" | "metered";
export type PublicRemoteAvailabilityStatus = "available" | "unavailable";

export interface PublicConnectorRequirement {
  connector: string;
  scopes: string[];
  operations: string[];
  authType: "oauth" | "api_key" | "none";
  required: boolean;
  destructive: boolean;
  setupLabel: string;
}

export type PublicConnectorPreflightStatus =
  | "ready"
  | "missing"
  | "expired"
  | "insufficient_scope"
  | "unavailable";

export interface PublicConnectorPreflight {
  connector: string;
  required: boolean;
  status: PublicConnectorPreflightStatus;
  connected: boolean;
  scopes: string[];
  missingScopes: string[];
  operations: string[];
  authType: "oauth" | "api_key" | "none";
  setupLabel: string;
  requiresAuth: boolean;
  accountId: string | null;
  profileName: string | null;
  reason: string | null;
}

export interface PublicRemoteAvailability {
  status: PublicRemoteAvailabilityStatus;
  code?: PublicServiceCode;
  message?: string;
  details?: string[];
}

export interface PublicRemoteSkill {
  id?: string;
  slug?: string;
  name?: string;
  displayName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  visibility?: PublicRemoteVisibility;
  currentVersion?: string;
  billingMode?: PublicRemoteBillingMode;
  creditsPerExecution?: number;
  sourceType?: PublicRemoteSourceType;
  creditQuote?: PublicCreditQuote;
  availability?: PublicRemoteAvailability;
  toolDependencies?: SkillToolDependencies;
  connectorRequirements?: PublicConnectorRequirement[];
  connectorPreflight?: PublicConnectorPreflight[];
}

interface PublicSkillQuoteBase {
  contractVersion?: number;
  skill?: string;
  toolDependencies?: SkillToolDependencies;
  connectorRequirements?: PublicConnectorRequirement[];
  connectorPreflight?: PublicConnectorPreflight[];
}

export interface PublicSkillQuoteSuccess extends PublicSkillQuoteBase {
  creditQuote: PublicCreditQuote;
  quoteToken?: string;
  expiresAt?: string;
  availability?: PublicRemoteAvailability & { status: "available"; code?: never };
  code?: never;
  error?: never;
  detail?: never;
}

export type PublicServiceCode = (typeof PUBLIC_SERVICE_CODE_VALUES)[number];
type PublicNonAuthServiceCode = Exclude<PublicServiceCode, "AUTH_REQUIRED">;

interface PublicSkillQuoteFailureBase<TCode extends PublicServiceCode> extends PublicSkillQuoteBase {
  creditQuote?: never;
  quoteToken?: never;
  expiresAt?: never;
  code: TCode;
  error: string;
  detail: string;
}

type PublicUnavailableAvailability<TCode extends PublicServiceCode> =
  Omit<PublicRemoteAvailability, "status" | "code"> & {
    status: "unavailable";
    code: TCode;
  };

export interface PublicSkillQuoteAuthRequired extends PublicSkillQuoteFailureBase<"AUTH_REQUIRED"> {
  availability?: PublicUnavailableAvailability<"AUTH_REQUIRED">;
}

export type PublicSkillQuoteUnavailable = {
  [TCode in PublicNonAuthServiceCode]: PublicSkillQuoteFailureBase<TCode> & {
    availability: PublicUnavailableAvailability<TCode>;
  };
}[PublicNonAuthServiceCode];

export interface PublicSkillQuoteError extends PublicSkillQuoteFailureBase<PublicNonAuthServiceCode> {
  availability?: never;
}

export type PublicSkillQuote =
  | PublicSkillQuoteSuccess
  | PublicSkillQuoteAuthRequired
  | PublicSkillQuoteUnavailable
  | PublicSkillQuoteError;

export type PublicCreditTransactionType =
  | "purchase"
  | "debit"
  | "refund"
  | "adjustment"
  | "grant"
  | "expiration"
  | "reservation"
  | "release";

export interface PublicCreditUsage {
  id?: string;
  runId?: string;
  transactionType?: PublicCreditTransactionType;
  amountCredits?: number;
  balanceAfterAvailable?: number;
  balanceAfterReserved?: number;
  description?: string;
  createdAt?: string;
}

export interface PublicEndpointParseOptions {
  strict?: boolean;
  label?: string;
}

export const PUBLIC_SKILL_KEYS = new Set([
  "id",
  "slug",
  "name",
  "displayName",
  "description",
  "category",
  "tags",
  "visibility",
  "currentVersion",
  "billingMode",
  "creditsPerExecution",
  "sourceType",
  "creditQuote",
  "availability",
  "toolDependencies",
  "connectorRequirements",
  "connectorPreflight",
]);

export const PUBLIC_QUOTE_KEYS = new Set([
  "contractVersion",
  "skill",
  "quoteToken",
  "expiresAt",
  "creditQuote",
  "availability",
  "toolDependencies",
  "connectorRequirements",
  "connectorPreflight",
  "code",
  "error",
  "detail",
]);

export const PUBLIC_CREDIT_QUOTE_KEYS = new Set([
  "tier",
  "creditUnit",
  "credits",
  "formattedCredits",
  "formattedUnitCredits",
  "unitCount",
  "estimated",
  "quoteDependsOnInput",
  "quoteRequired",
  "description",
]);

export const PUBLIC_CREDIT_USAGE_KEYS = new Set([
  "id",
  "runId",
  "transactionType",
  "amountCredits",
  "balanceAfterAvailable",
  "balanceAfterReserved",
  "description",
  "createdAt",
]);

export const PUBLIC_AVAILABILITY_KEYS = new Set(["status", "code", "message", "details"]);

export const PUBLIC_SERVICE_CODE_VALUES = [
  "APPROVAL_REQUIRED",
  "ARTIFACT_BACKEND_UNAVAILABLE",
  "ARTIFACT_CONTENT_UNSAFE",
  "ARTIFACT_DOWNLOAD_FAILED",
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_TYPE_UNVERIFIED",
  "AUTH_REQUIRED",
  "BILLING_NOT_CONFIGURED",
  "CAPACITY_UNAVAILABLE",
  "CLOUD_CAPABILITY_CHECK_FAILED",
  "CLOUD_QUOTE_INVALID",
  "CLOUD_QUOTE_TOKEN_REQUIRED",
  "CLOUD_QUOTE_UNAVAILABLE",
  "CONNECTOR_REQUIREMENTS_NOT_READY",
  "CREDIT_METADATA_UNAVAILABLE",
  "HANDLER_UNAVAILABLE",
  "HOSTED_SERVICE_UNAVAILABLE",
  "IDEMPOTENCY_KEY_INVALID",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_SCOPE",
  "INVALID_BLOG_ARTICLE_OPTIONS",
  "NOT_FOUND",
  "QUOTE_APPROVAL_REQUIRED",
  "QUOTE_INVALID",
  "QUOTE_REPLAY_CONFLICT",
  "RATE_LIMITED",
  "REMOTE_AVAILABILITY_MISSING",
  "REMOTE_CREDIT_QUOTE_MISSING",
  "REMOTE_MODE_REQUIRED",
  "REMOTE_MUTATION_OUTCOME_UNKNOWN",
  "REMOTE_STATUS_INVALID",
  "REMOTE_UNAVAILABLE",
  "RESPONSE_LOST",
  "RETRY_ATTEMPT_INVALID",
  "RETRY_ATTEMPT_MISMATCH",
  "RUN_NOT_CANCELLABLE",
  "RUN_NOT_FOUND",
  "RUN_REJECTED",
  "SELF_HOSTED_QUOTE_FAILED",
  "SELF_HOSTED_QUOTE_INVALID",
  "SELF_HOSTED_QUOTE_TOKEN_REQUIRED",
  "SELF_HOSTED_QUOTE_UNAVAILABLE",
  "SELF_HOSTED_SIGNED_QUOTE_REQUIRES_TOKEN",
  "SKILL_NOT_FOUND",
  "UPSTREAM_RESPONSE_LOST",
] as const;

export const PUBLIC_SERVICE_CODES: ReadonlySet<string> = new Set(PUBLIC_SERVICE_CODE_VALUES);

const SKILL_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CONNECTOR_VALUE_PATTERN = /^[a-z0-9]+(?:[-._:/][a-z0-9]+)*$/i;

export function parsePublicSkillEndpoint(
  record: Record<string, unknown>,
  options: PublicEndpointParseOptions = {},
): PublicRemoteSkill | null {
  const label = options.label ?? "skill";
  if (options.strict) assertOnlyKeys(record, PUBLIC_SKILL_KEYS, label);

  const requestedSlug = safeSkillSlug(record.slug) ?? safeSkillSlug(record.name);
  if (!requestedSlug) {
    if (options.strict) throw new Error(`${label} requires a safe slug`);
    return null;
  }

  const canonical = getSkill(requestedSlug);
  const slug = canonical?.name ?? requestedSlug;
  const displayName = canonical?.displayName ?? titleize(slug);
  const description = canonical
    ? sanitizePublicDiscoveryText(canonical.description)
    : `${displayName} is available through the selected service.`;
  const category = canonical?.category ?? enumValue(record.category, CATEGORIES) ?? "Remote";
  const tags = canonical ? publicDiscoveryTags(canonical.tags) : ["remote"];

  if (options.strict) {
    assertOptionalExact(record, "slug", slug, label);
    assertOptionalExact(record, "name", slug, label);
    assertOptionalValid(record, "id", safeIdentifier, label);
    assertOptionalValid(record, "visibility", (value) => enumValue(value, ["public", "unlisted"] as const), label);
    assertOptionalValid(record, "currentVersion", safeVersion, label);
    assertOptionalValid(record, "billingMode", (value) => enumValue(value, ["free", "credits", "subscription", "metered"] as const), label);
    assertOptionalValid(record, "creditsPerExecution", safeNonNegativeInteger, label);
    assertOptionalValid(record, "sourceType", (value) => enumValue(value, ["upstream", "hosted"] as const), label);
    assertOptionalRecord(record, "creditQuote", label);
    assertOptionalRecord(record, "availability", label);
    assertOptionalRecord(record, "toolDependencies", label);
    assertOptionalArray(record, "connectorRequirements", label);
    assertOptionalArray(record, "connectorPreflight", label);
    assertPresentation(record, { displayName, description, category, tags }, label);
  }

  const visibility = enumValue(record.visibility, ["public", "unlisted"] as const);
  const billingMode = enumValue(record.billingMode, ["free", "credits", "subscription", "metered"] as const);
  const sourceType = publicSourceType(record.sourceType);
  const availability = isRecord(record.availability)
    ? parsePublicAvailability(record.availability, { ...options, label: `${label}.availability` })
    : undefined;
  const toolDependencies = isRecord(record.toolDependencies)
    ? parsePublicToolDependencies(record.toolDependencies, slug, { ...options, label: `${label}.toolDependencies` })
    : undefined;
  const connectorRequirements = Array.isArray(record.connectorRequirements)
    ? parsePublicConnectorRequirements(record.connectorRequirements, { ...options, label: `${label}.connectorRequirements` })
    : undefined;
  const connectorPreflight = Array.isArray(record.connectorPreflight)
    ? parsePublicConnectorPreflight(record.connectorPreflight, { ...options, label: `${label}.connectorPreflight` })
    : undefined;
  const creditQuote = isRecord(record.creditQuote)
    ? parseStrictCreditQuote(record.creditQuote, options.strict === true, `${label}.creditQuote`)
    : undefined;
  const nestedContractInvalid = options.strict !== true && (
    (record.toolDependencies !== undefined && (!isRecord(record.toolDependencies) || !toolDependencies))
    || (record.connectorRequirements !== undefined && (
      !Array.isArray(record.connectorRequirements)
      || connectorRequirements?.length !== record.connectorRequirements.length
    ))
    || (record.connectorPreflight !== undefined && (
      !Array.isArray(record.connectorPreflight)
      || connectorPreflight?.length !== record.connectorPreflight.length
    ))
  );
  const connectorContractInvalid = !connectorContractsMatch(connectorRequirements, connectorPreflight);
  if (nestedContractInvalid || connectorContractInvalid) {
    if (options.strict && connectorContractInvalid) {
      throw new Error(`${label} connector requirements and preflight do not match`);
    }
    return null;
  }

  return {
    ...(safeIdentifier(record.id) ? { id: safeIdentifier(record.id) } : {}),
    slug,
    name: slug,
    displayName,
    description,
    category,
    tags,
    ...(visibility ? { visibility } : {}),
    ...(safeVersion(record.currentVersion) ? { currentVersion: safeVersion(record.currentVersion) } : {}),
    ...(billingMode ? { billingMode } : {}),
    ...pickSafeInteger(record, "creditsPerExecution"),
    ...(sourceType ? { sourceType } : {}),
    ...(creditQuote ? { creditQuote } : {}),
    ...(availability ? { availability } : {}),
    ...(toolDependencies ? { toolDependencies } : {}),
    ...(connectorRequirements ? { connectorRequirements } : {}),
    ...(connectorPreflight ? { connectorPreflight } : {}),
  };
}

export function parsePublicQuoteEndpoint(
  payload: unknown,
  options: PublicEndpointParseOptions = {},
): PublicSkillQuote {
  if (!isRecord(payload)) {
    throw new Error(`${options.label ?? "quote"} must be an object`);
  }
  const label = options.label ?? "quote";
  if (options.strict) assertOnlyKeys(payload, PUBLIC_QUOTE_KEYS, label);
  const skill = safeSkillSlug(payload.skill);
  const code = safePublicCode(payload.code);
  if (options.strict) {
    assertOptionalValid(payload, "contractVersion", safeNonNegativeInteger, label);
    assertOptionalValid(payload, "skill", safeSkillSlug, label);
    assertOptionalValid(payload, "quoteToken", safeOpaqueToken, label);
    assertOptionalValid(payload, "expiresAt", safeTimestamp, label);
    assertOptionalRecord(payload, "creditQuote", label);
    assertOptionalRecord(payload, "availability", label);
    assertOptionalRecord(payload, "toolDependencies", label);
    assertOptionalArray(payload, "connectorRequirements", label);
    assertOptionalArray(payload, "connectorPreflight", label);
    assertOptionalValid(payload, "code", safePublicCode, label);
  }
  if (
    isRecord(payload.availability)
    && payload.availability.status === "available"
    && (payload.availability.code !== undefined
      || payload.availability.message !== undefined
      || payload.availability.details !== undefined)
  ) {
    throw new Error(`${label}.availability.code is inconsistent with available status`);
  }
  const availability = isRecord(payload.availability)
    ? parsePublicAvailability(payload.availability, { ...options, label: `${label}.availability` })
    : undefined;
  const toolDependencies = isRecord(payload.toolDependencies) && skill
    ? parsePublicToolDependencies(payload.toolDependencies, skill, { ...options, label: `${label}.toolDependencies` })
    : undefined;
  const connectorRequirements = Array.isArray(payload.connectorRequirements)
    ? parsePublicConnectorRequirements(payload.connectorRequirements, { ...options, label: `${label}.connectorRequirements` })
    : undefined;
  const connectorPreflight = Array.isArray(payload.connectorPreflight)
    ? parsePublicConnectorPreflight(payload.connectorPreflight, { ...options, label: `${label}.connectorPreflight` })
    : undefined;
  const creditQuote = isRecord(payload.creditQuote)
    ? parseStrictCreditQuote(payload.creditQuote, options.strict === true, `${label}.creditQuote`)
    : undefined;
  const nestedContractInvalid = options.strict !== true && (
    (payload.toolDependencies !== undefined && (!isRecord(payload.toolDependencies) || !toolDependencies))
    || (payload.connectorRequirements !== undefined && (
      !Array.isArray(payload.connectorRequirements)
      || connectorRequirements?.length !== payload.connectorRequirements.length
    ))
    || (payload.connectorPreflight !== undefined && (
      !Array.isArray(payload.connectorPreflight)
      || connectorPreflight?.length !== payload.connectorPreflight.length
    ))
  );
  if (nestedContractInvalid) {
    throw new Error(`${label} contains malformed nested public contract metadata`);
  }
  if (!connectorContractsMatch(connectorRequirements, connectorPreflight)) {
    throw new Error(`${label} connector requirements and preflight do not match`);
  }

  const common = {
    ...pickSafeInteger(payload, "contractVersion"),
    ...(skill ? { skill } : {}),
    ...(toolDependencies ? { toolDependencies } : {}),
    ...(connectorRequirements ? { connectorRequirements } : {}),
    ...(connectorPreflight ? { connectorPreflight } : {}),
  };

  if (creditQuote) {
    if (payload.code !== undefined || payload.error !== undefined || payload.detail !== undefined) {
      throw new Error(`${label} success must not include error, detail, or code`);
    }
    if (availability?.status === "unavailable") {
      throw new Error(`${label} success must not include unavailable status`);
    }
    if (payload.expiresAt !== undefined && payload.quoteToken === undefined) {
      throw new Error(`${label}.expiresAt requires quoteToken`);
    }
    return {
      ...common,
      creditQuote,
      ...(safeOpaqueToken(payload.quoteToken) ? { quoteToken: safeOpaqueToken(payload.quoteToken) } : {}),
      ...(safeTimestamp(payload.expiresAt) ? { expiresAt: safeTimestamp(payload.expiresAt) } : {}),
      ...(availability ? { availability: availability as PublicSkillQuoteSuccess["availability"] } : {}),
    };
  }

  if (payload.quoteToken !== undefined || payload.expiresAt !== undefined) {
    throw new Error(`${label} failure must not include quoteToken or expiresAt`);
  }
  if (availability?.status === "available") {
    if (code) throw new Error(`${label}.code is inconsistent with available status`);
    throw new Error(`${label} success requires creditQuote`);
  }
  const hasFailureSignal = payload.code !== undefined
    || payload.error !== undefined
    || payload.detail !== undefined
    || availability?.status === "unavailable";
  if (!hasFailureSignal) throw new Error(`${label} success requires creditQuote`);

  const failureCode = code ?? availability?.code ?? "REMOTE_UNAVAILABLE";
  const rawAvailabilityCode = isRecord(payload.availability) && typeof payload.availability.code === "string"
    ? payload.availability.code
    : undefined;
  if (
    (typeof payload.code === "string" && rawAvailabilityCode && payload.code !== rawAvailabilityCode)
    || (code && availability?.code && code !== availability.code)
  ) {
    throw new Error(`${label}.code is inconsistent with availability.code`);
  }
  const failureText = quoteFailureText(failureCode, availability?.status);
  if (payload.error !== undefined && payload.error !== failureText.error) {
    throw new Error(`${label}.error must use the public status taxonomy`);
  }
  if (payload.detail !== undefined && payload.detail !== failureText.detail) {
    throw new Error(`${label}.detail must use the public status taxonomy`);
  }
  const expectedAvailabilityText = availabilityText("unavailable", failureCode);
  if (isRecord(payload.availability)) {
    if (payload.availability.message !== undefined && payload.availability.message !== expectedAvailabilityText.message) {
      throw new Error(`${label}.availability.message must use the public status taxonomy`);
    }
    if (
      payload.availability.details !== undefined
      && !sameStringArray(payload.availability.details, expectedAvailabilityText.details ?? [])
    ) {
      throw new Error(`${label}.availability.details must use the public status taxonomy`);
    }
  }
  const failureAvailability = availability
    ? {
      status: "unavailable" as const,
      code: failureCode,
      ...expectedAvailabilityText,
    }
    : undefined;
  if (failureCode === "AUTH_REQUIRED") {
    return {
      ...common,
      code: failureCode,
      error: failureText.error,
      detail: failureText.detail,
      ...(failureAvailability
        ? { availability: { ...failureAvailability, code: failureCode } }
        : {}),
    };
  }
  return failureAvailability
    ? ({
      ...common,
      code: failureCode,
      error: failureText.error,
      detail: failureText.detail,
      availability: failureAvailability,
    } as PublicSkillQuoteUnavailable)
    : {
      ...common,
      code: failureCode,
      error: failureText.error,
      detail: failureText.detail,
    };
}

export function parsePublicCreditUsageEndpoint(
  record: Record<string, unknown>,
  options: PublicEndpointParseOptions = {},
): PublicCreditUsage {
  const label = options.label ?? "usage";
  if (options.strict) {
    assertOnlyKeys(record, PUBLIC_CREDIT_USAGE_KEYS, label);
    assertOptionalValid(record, "id", safeIdentifier, label);
    assertOptionalValid(record, "runId", safeIdentifier, label);
    assertOptionalValid(record, "transactionType", creditTransactionType, label);
    assertOptionalValid(record, "amountCredits", safeSignedInteger, label);
    assertOptionalValid(record, "balanceAfterAvailable", safeSignedInteger, label);
    assertOptionalValid(record, "balanceAfterReserved", safeSignedInteger, label);
    assertOptionalValid(record, "createdAt", safeTimestamp, label);
    if (record.description !== undefined && typeof record.description !== "string") {
      throw new Error(`${label}.description must be a string`);
    }
  }
  const transactionType = creditTransactionType(record.transactionType);
  const description = transactionType ? creditActivityDescription(transactionType) : undefined;
  if (options.strict && record.description !== undefined && record.description !== description) {
    throw new Error(`${label}.description must use the public credit activity taxonomy`);
  }
  return {
    ...(safeIdentifier(record.id) ? { id: safeIdentifier(record.id) } : {}),
    ...(safeIdentifier(record.runId) ? { runId: safeIdentifier(record.runId) } : {}),
    ...(transactionType ? { transactionType } : {}),
    ...(safeTimestamp(record.createdAt) ? { createdAt: safeTimestamp(record.createdAt) } : {}),
    ...pickSafeSignedInteger(record, "amountCredits"),
    ...pickSafeSignedInteger(record, "balanceAfterAvailable"),
    ...pickSafeSignedInteger(record, "balanceAfterReserved"),
    ...(description ? { description } : {}),
  };
}

export function parsePublicAvailability(
  record: Record<string, unknown>,
  options: PublicEndpointParseOptions = {},
): PublicRemoteAvailability {
  const label = options.label ?? "availability";
  if (options.strict) assertOnlyKeys(record, PUBLIC_AVAILABILITY_KEYS, label);
  const parsedStatus = enumValue(record.status, ["available", "unavailable"] as const);
  const code = safePublicCode(record.code) ?? (!parsedStatus ? "REMOTE_STATUS_INVALID" : undefined);
  const status: PublicRemoteAvailabilityStatus = parsedStatus === "available" && code
    ? "unavailable"
    : parsedStatus ?? "unavailable";
  const synthesized = availabilityText(status, code);
  if (options.strict) {
    if (!parsedStatus) throw new Error(`${label}.status is invalid`);
    if (record.code !== undefined && !safePublicCode(record.code)) throw new Error(`${label}.code is invalid`);
    if (parsedStatus === "available" && record.code !== undefined) {
      throw new Error(`${label}.code is inconsistent with available status`);
    }
    if (parsedStatus === "available" && (record.message !== undefined || record.details !== undefined)) {
      throw new Error(`${label} available status must not include failure text`);
    }
    if (record.message !== undefined && record.message !== synthesized.message) {
      throw new Error(`${label}.message must use the public status taxonomy`);
    }
    if (record.details !== undefined && !sameStringArray(record.details, synthesized.details ?? [])) {
      throw new Error(`${label}.details must use the public status taxonomy`);
    }
  }
  return {
    status,
    ...(code ? { code } : {}),
    ...(synthesized.message ? { message: synthesized.message } : {}),
    ...(synthesized.details ? { details: synthesized.details } : {}),
  };
}

export function parsePublicConnectorRequirements(
  value: unknown[],
  options: PublicEndpointParseOptions = {},
): PublicConnectorRequirement[] {
  if (options.strict && value.length > 20) {
    throw new Error(`${options.label ?? "connectorRequirements"} exceeds the supported item limit`);
  }
  return value.slice(0, 20).flatMap((candidate, index) => {
    const label = `${options.label ?? "connectorRequirements"}[${index}]`;
    if (!isRecord(candidate)) {
      if (options.strict) throw new Error(`${label} must be an object`);
      return [];
    }
    if (options.strict) {
      assertOnlyKeys(candidate, new Set([
        "connector", "scopes", "operations", "authType", "required", "destructive", "setupLabel",
      ]), label);
      assertRequiredKeys(candidate, [
        "connector", "scopes", "operations", "authType", "required", "destructive", "setupLabel",
      ], label);
    }
    if (!isCompleteConnectorRequirement(candidate)) {
      if (options.strict) throw new Error(`${label} is incomplete or invalid`);
      return [];
    }
    const connector = safeConnectorSlug(candidate.connector);
    const authType = enumValue(candidate.authType, ["oauth", "api_key", "none"] as const) ?? "oauth";
    if (!connector) {
      if (options.strict) throw new Error(`${label}.connector is invalid`);
      return [];
    }
    if (options.strict) {
      assertOptionalValid(candidate, "authType", (value) => enumValue(value, ["oauth", "api_key", "none"] as const), label);
      assertOptionalBoolean(candidate, "required", label);
      assertOptionalBoolean(candidate, "destructive", label);
      assertStrictConnectorValues(candidate, "scopes", label);
      assertStrictConnectorValues(candidate, "operations", label);
    }
    const requirement: PublicConnectorRequirement = {
      connector,
      scopes: safeConnectorValues(candidate.scopes),
      operations: safeConnectorValues(candidate.operations),
      authType,
      required: candidate.required !== false,
      destructive: candidate.destructive === true,
      setupLabel: `Connect ${titleize(connector)}`,
    };
    if (options.strict && candidate.setupLabel !== requirement.setupLabel) {
      throw new Error(`${label}.setupLabel must be synthesized from connector`);
    }
    return [requirement];
  });
}

export function parsePublicConnectorPreflight(
  value: unknown[],
  options: PublicEndpointParseOptions = {},
): PublicConnectorPreflight[] {
  if (options.strict && value.length > 20) {
    throw new Error(`${options.label ?? "connectorPreflight"} exceeds the supported item limit`);
  }
  return value.slice(0, 20).flatMap((candidate, index) => {
    const label = `${options.label ?? "connectorPreflight"}[${index}]`;
    if (!isRecord(candidate)) {
      if (options.strict) throw new Error(`${label} must be an object`);
      return [];
    }
    if (options.strict) {
      assertOnlyKeys(candidate, new Set([
        "connector", "required", "status", "connected", "scopes", "missingScopes", "operations",
        "authType", "setupLabel", "requiresAuth", "accountId", "profileName", "reason",
      ]), label);
      assertRequiredKeys(candidate, [
        "connector", "required", "status", "connected", "scopes", "missingScopes", "operations",
        "authType", "setupLabel", "requiresAuth", "accountId", "profileName", "reason",
      ], label);
      if (candidate.status === "ready" && Array.isArray(candidate.missingScopes) && candidate.missingScopes.length !== 0) {
        throw new Error(`${label}.missingScopes must be empty when status is ready`);
      }
      if (candidate.status === "insufficient_scope" && Array.isArray(candidate.missingScopes) && candidate.missingScopes.length === 0) {
        throw new Error(`${label}.missingScopes must identify at least one required scope`);
      }
    }
    if (!isCompleteConnectorPreflight(candidate)) {
      if (options.strict) throw new Error(`${label} is incomplete or invalid`);
      return [];
    }
    const connector = safeConnectorSlug(candidate.connector);
    const status = enumValue(candidate.status, [
      "ready", "missing", "expired", "insufficient_scope", "unavailable",
    ] as const);
    const authType = enumValue(candidate.authType, ["oauth", "api_key", "none"] as const) ?? "oauth";
    if (!connector || !status) {
      if (options.strict) throw new Error(`${label} has invalid connector/status`);
      return [];
    }
    if (options.strict) {
      assertOptionalValid(candidate, "authType", (value) => enumValue(value, ["oauth", "api_key", "none"] as const), label);
      assertOptionalBoolean(candidate, "required", label);
      assertOptionalBoolean(candidate, "connected", label);
      assertOptionalBoolean(candidate, "requiresAuth", label);
      assertOptionalValidOrNull(candidate, "accountId", safeIdentifier, label);
      assertOptionalValidOrNull(candidate, "profileName", safeProfileName, label);
      assertStrictConnectorValues(candidate, "scopes", label);
      assertStrictConnectorValues(candidate, "missingScopes", label);
      assertStrictConnectorValues(candidate, "operations", label);
    }
    const preflight: PublicConnectorPreflight = {
      connector,
      required: candidate.required !== false,
      status,
      connected: status === "ready",
      scopes: safeConnectorValues(candidate.scopes),
      missingScopes: safeConnectorValues(candidate.missingScopes),
      operations: safeConnectorValues(candidate.operations),
      authType,
      setupLabel: `Connect ${titleize(connector)}`,
      requiresAuth: status !== "ready" && status !== "unavailable",
      accountId: safeIdentifier(candidate.accountId) ?? null,
      profileName: safeProfileName(candidate.profileName) ?? null,
      reason: connectorReason(status),
    };
    if (options.strict) {
      if (candidate.setupLabel !== preflight.setupLabel) {
        throw new Error(`${label}.setupLabel must be synthesized from connector`);
      }
      if (candidate.reason !== preflight.reason) {
        throw new Error(`${label}.reason must use the public status taxonomy`);
      }
      if (candidate.connected !== preflight.connected) {
        throw new Error(`${label}.connected must match status`);
      }
      if (candidate.requiresAuth !== preflight.requiresAuth) {
        throw new Error(`${label}.requiresAuth must match status`);
      }
      if (status === "ready" && preflight.missingScopes.length !== 0) {
        throw new Error(`${label}.missingScopes must be empty when status is ready`);
      }
      if (status === "insufficient_scope" && preflight.missingScopes.length === 0) {
        throw new Error(`${label}.missingScopes must identify at least one required scope`);
      }
    }
    return [preflight];
  });
}

export function parsePublicToolDependencies(
  value: Record<string, unknown>,
  skillSlug: string,
  options: PublicEndpointParseOptions = {},
): SkillToolDependencies | undefined {
  const label = options.label ?? "toolDependencies";
  const canonical = getSkillToolDependencies(skillSlug);
  if (canonical) {
    try {
      assertCanonicalToolDependencies(value, canonical, label);
    } catch (error) {
      if (options.strict) throw error;
      return undefined;
    }
    return structuredClone(canonical);
  }
  if (options.strict) {
    assertOnlyKeys(value, new Set([
      "schemaVersion", "skill", "category", "source", "dependencies", "gatewayBacked", "hostedRuntime",
    ]), label);
  }
  if (value.schemaVersion !== 1 || safeSkillSlug(value.skill) !== skillSlug || !Array.isArray(value.dependencies)) {
    if (options.strict) throw new Error(`${label} is invalid`);
    return undefined;
  }
  if (options.strict && value.dependencies.length > 50) {
    throw new Error(`${label}.dependencies exceeds the supported item limit`);
  }
  const category = enumValue(value.category, CATEGORIES);
  const source = enumValue(value.source, [
    "official", "custom", "remote", "private", "private-hosted", "upstream", "extension",
  ] as const);
  if (!category || !source || typeof value.gatewayBacked !== "boolean" || typeof value.hostedRuntime !== "boolean") {
    if (options.strict) throw new Error(`${label} has invalid taxonomy fields`);
    return undefined;
  }
  let invalidDependency = value.dependencies.length > 50;
  const dependencies = value.dependencies.slice(0, 50).flatMap((candidate, index) => {
    const dependencyLabel = `${label}.dependencies[${index}]`;
    if (!isRecord(candidate)) {
      if (options.strict) throw new Error(`${dependencyLabel} must be an object`);
      invalidDependency = true;
      return [];
    }
    if (options.strict) {
      assertOnlyKeys(candidate, new Set(["skill", "primitive", "family", "required", "reason"]), dependencyLabel);
      assertRequiredKeys(candidate, ["skill", "primitive", "family", "required", "reason"], dependencyLabel);
    }
    if (!Object.prototype.hasOwnProperty.call(candidate, "reason") || typeof candidate.reason !== "string") {
      if (options.strict) throw new Error(`${dependencyLabel}.reason is required`);
      invalidDependency = true;
      return [];
    }
    const primitive = typeof candidate.primitive === "string" ? getToolPrimitive(candidate.primitive) : undefined;
    if (!primitive || candidate.skill !== skillSlug || candidate.family !== primitive.family || typeof candidate.required !== "boolean") {
      if (options.strict) throw new Error(`${dependencyLabel} is invalid`);
      invalidDependency = true;
      return [];
    }
    const reason = `${primitive.title} capability is required.`;
    if (options.strict && candidate.reason !== reason) {
      throw new Error(`${dependencyLabel}.reason must use the primitive taxonomy`);
    }
    return [{
      skill: skillSlug,
      primitive: primitive.name,
      family: primitive.family,
      required: candidate.required,
      reason,
    }];
  });
  if (invalidDependency) return undefined;
  return {
    schemaVersion: 1,
    skill: skillSlug,
    category,
    source,
    dependencies,
    gatewayBacked: value.gatewayBacked,
    hostedRuntime: value.hostedRuntime,
  };
}

export function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} exposes an unsupported key: ${key}`);
    if (isProhibitedPublicKey(key)) throw new Error(`${label} exposes a prohibited key: ${key}`);
  }
}

function assertPresentation(
  record: Record<string, unknown>,
  expected: { displayName: string; description: string; category: string; tags: string[] },
  label: string,
): void {
  for (const key of ["displayName", "description", "category"] as const) {
    if (record[key] !== undefined && record[key] !== expected[key]) {
      throw new Error(`${label}.${key} must use canonical customer metadata`);
    }
  }
  if (record.tags !== undefined && !sameStringArray(record.tags, expected.tags)) {
    throw new Error(`${label}.tags must use canonical customer taxonomy`);
  }
}

function parseStrictCreditQuote(
  value: Record<string, unknown>,
  strict: boolean,
  label: string,
): PublicCreditQuote {
  if (strict) assertOnlyKeys(value, PUBLIC_CREDIT_QUOTE_KEYS, label);
  const parsed = toAuthoritativePublicCreditQuote(value);
  if (strict && canonicalJson(value) !== canonicalJson(parsed)) {
    throw new Error(`${label} is not canonical`);
  }
  return parsed;
}

function assertCanonicalToolDependencies(
  value: Record<string, unknown>,
  expected: SkillToolDependencies,
  label: string,
): void {
  assertOnlyKeys(value, new Set([
    "schemaVersion", "skill", "category", "source", "dependencies", "gatewayBacked", "hostedRuntime",
  ]), label);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error(`${label} does not match the package-owned dependency taxonomy`);
  }
}

function availabilityText(
  status: PublicRemoteAvailabilityStatus,
  code: string | undefined,
): { message?: string; details?: string[] } {
  if (status === "available") return {};
  if (code === "CONNECTOR_REQUIREMENTS_NOT_READY") {
    return { message: "Required connector accounts are not ready.", details: ["No credits were charged."] };
  }
  if (code === "CREDIT_METADATA_UNAVAILABLE" || code === "REMOTE_CREDIT_QUOTE_MISSING") {
    return { message: "Credit information is temporarily unavailable.", details: ["No credits were charged."] };
  }
  if (code === "AUTH_REQUIRED") {
    return { message: "Authentication is required.", details: ["No credits were charged."] };
  }
  return { message: "This skill is temporarily unavailable.", details: ["No credits were charged."] };
}

function quoteFailureText(
  code: string | undefined,
  status: PublicRemoteAvailabilityStatus | undefined,
): { error: string; detail: string } {
  if (code === "AUTH_REQUIRED") {
    return { error: "Authentication is required.", detail: "Sign in to request a credit quote." };
  }
  if (code === "CONNECTOR_REQUIREMENTS_NOT_READY") {
    return { error: "Required connector accounts are not ready.", detail: "No credits were charged." };
  }
  if (status === "unavailable") {
    return { error: "This skill is temporarily unavailable.", detail: "No credits were charged." };
  }
  return { error: "The Skills service could not provide a quote.", detail: "Quote detail is unavailable." };
}

function connectorReason(status: PublicConnectorPreflightStatus): string | null {
  if (status === "ready") return null;
  if (status === "missing") return "Connector account is not connected.";
  if (status === "expired") return "Connector account needs reauthentication.";
  if (status === "insufficient_scope") return "Connector account is missing required scopes.";
  return "Connector service is unavailable.";
}

function connectorContractsMatch(
  requirements: PublicConnectorRequirement[] | undefined,
  preflight: PublicConnectorPreflight[] | undefined,
): boolean {
  const requirementItems = requirements ?? [];
  const preflightItems = preflight ?? [];
  if (requirementItems.length !== preflightItems.length) return false;
  const requirementMap = uniqueConnectorMap(requirementItems);
  const preflightMap = uniqueConnectorMap(preflightItems);
  if (!requirementMap || !preflightMap || requirementMap.size !== preflightMap.size) return false;
  for (const [connector, requirement] of requirementMap) {
    const readiness = preflightMap.get(connector);
    if (!readiness) return false;
    const allRequiredScopesMustBeMissing = readiness.status === "missing"
      || readiness.status === "expired"
      || readiness.status === "unavailable";
    if (
      requirement.required !== readiness.required
      || requirement.authType !== readiness.authType
      || !sameStringSet(requirement.scopes, readiness.scopes)
      || !sameStringSet(requirement.operations, readiness.operations)
      || (readiness.status === "ready" && (!readiness.connected || readiness.missingScopes.length !== 0))
      || (readiness.status === "insufficient_scope" && readiness.missingScopes.length === 0)
      || (allRequiredScopesMustBeMissing && !sameStringSet(requirement.scopes, readiness.missingScopes))
      || readiness.missingScopes.some((scope) => !requirement.scopes.includes(scope))
    ) {
      return false;
    }
  }
  return true;
}

function uniqueConnectorMap<T extends { connector: string }>(items: T[]): Map<string, T> | undefined {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.connector)) return undefined;
    map.set(item.connector, item);
  }
  return map;
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function creditTransactionType(value: unknown): PublicCreditTransactionType | undefined {
  return enumValue(value, [
    "purchase", "debit", "refund", "adjustment", "grant", "expiration", "reservation", "release",
  ] as const);
}

function creditActivityDescription(transactionType: PublicCreditTransactionType): string {
  if (transactionType === "debit") return "Skill run credits";
  if (transactionType === "refund") return "Credit refund";
  if (transactionType === "purchase") return "Credit purchase";
  if (transactionType === "grant") return "Credit grant";
  if (transactionType === "expiration") return "Credit expiration";
  if (transactionType === "reservation") return "Credit reservation";
  if (transactionType === "release") return "Credit release";
  return "Credit adjustment";
}

function safePublicCode(value: unknown): PublicServiceCode | undefined {
  return isPublicServiceCode(value) ? value : undefined;
}

export function isPublicServiceCode(value: unknown): value is PublicServiceCode {
  return typeof value === "string" && PUBLIC_SERVICE_CODES.has(value);
}

export function publicRunFailureText(
  code: string | undefined,
  status: string | undefined,
): { message: string; details: string[] } {
  if (code === "INSUFFICIENT_BALANCE") {
    return { message: "Insufficient credits.", details: ["No credits were charged."] };
  }
  if (code === "AUTH_REQUIRED") {
    return { message: "Authentication is required.", details: ["No credits were charged."] };
  }
  if (code === "CONNECTOR_REQUIREMENTS_NOT_READY") {
    return { message: "Required connector accounts are not ready.", details: ["No credits were charged."] };
  }
  if (code === "RATE_LIMITED" || code === "CAPACITY_UNAVAILABLE") {
    return { message: "The Skills service is temporarily busy.", details: [] };
  }
  if (code === "RUN_NOT_FOUND" || code === "SKILL_NOT_FOUND" || code === "NOT_FOUND") {
    return { message: "The requested Skills resource was not found.", details: [] };
  }
  if (status === "cancelled" || status === "cancel_requested") {
    return { message: "The Skills run was cancelled.", details: [] };
  }
  if (status === "expired") {
    return { message: "The Skills run expired.", details: [] };
  }
  return { message: "The Skills run could not be completed.", details: [] };
}

function safeSkillSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const slug = value.trim();
  return slug.length <= 128 && SKILL_SLUG_PATTERN.test(slug) && !containsProhibitedPublicIdentity(slug)
    ? slug
    : undefined;
}

function safeConnectorSlug(value: unknown): string | undefined {
  return typeof value === "string"
    && value.length <= 64
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && !containsProhibitedPublicIdentity(value)
    ? value
    : undefined;
}

function safeConnectorValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string"
      && entry.length <= 256
      && CONNECTOR_VALUE_PATTERN.test(entry)
      && !containsProhibitedPublicIdentity(entry))
    .slice(0, 100);
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const identifier = value.trim();
  return identifier.length <= 200 && IDENTIFIER_PATTERN.test(identifier) && !containsProhibitedPublicIdentity(identifier)
    ? identifier
    : undefined;
}

function safeProfileName(value: unknown): string | undefined {
  return typeof value === "string"
    && value.length <= 100
    && /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(value)
    && !containsProhibitedPublicIdentity(value)
    ? value
    : undefined;
}

function safeVersion(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 128 && SEMVER_PATTERN.test(value) ? value : undefined;
}

function safeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function safeOpaqueToken(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && /^[\x21-\x7E]+$/.test(value)
    ? value
    : undefined;
}

function publicSourceType(value: unknown): PublicRemoteSourceType | undefined {
  if (value === "upstream") return "upstream";
  return enumValue(value, ["hosted", "private_hosted", "uploaded", "generated", "remote"] as const)
    ? "hosted"
    : undefined;
}

function titleize(value: string): string {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : undefined;
}

function pickSafeInteger(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = safeNonNegativeInteger(record[key]);
  return value !== undefined ? { [key]: value } : {};
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function safeSignedInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function pickSafeSignedInteger(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = safeSignedInteger(record[key]);
  return value !== undefined ? { [key]: value } : {};
}

function assertOptionalExact(
  record: Record<string, unknown>,
  key: string,
  expected: unknown,
  label: string,
): void {
  if (record[key] !== undefined && record[key] !== expected) {
    throw new Error(`${label}.${key} must use canonical customer metadata`);
  }
}

function assertOptionalValid<T>(
  record: Record<string, unknown>,
  key: string,
  parser: (value: unknown) => T | undefined,
  label: string,
): void {
  if (record[key] !== undefined && parser(record[key]) === undefined) {
    throw new Error(`${label}.${key} is invalid`);
  }
}

function assertOptionalValidOrNull<T>(
  record: Record<string, unknown>,
  key: string,
  parser: (value: unknown) => T | undefined,
  label: string,
): void {
  if (record[key] !== undefined && record[key] !== null && parser(record[key]) === undefined) {
    throw new Error(`${label}.${key} is invalid`);
  }
}

function assertOptionalRecord(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] !== undefined && !isRecord(record[key])) throw new Error(`${label}.${key} must be an object`);
}

function assertOptionalArray(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] !== undefined && !Array.isArray(record[key])) throw new Error(`${label}.${key} must be an array`);
}

function assertOptionalBoolean(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] !== undefined && typeof record[key] !== "boolean") throw new Error(`${label}.${key} must be a boolean`);
}

function assertRequiredKeys(record: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new Error(`${label}.${key} is required`);
  }
}

function assertStrictConnectorValues(record: Record<string, unknown>, key: string, label: string): void {
  if (record[key] === undefined) return;
  if (!Array.isArray(record[key]) || record[key].length > 100) {
    throw new Error(`${label}.${key} must be a bounded array`);
  }
  const parsed = safeConnectorValues(record[key]);
  if (!sameStringArray(record[key], parsed)) throw new Error(`${label}.${key} contains an invalid value`);
}

function isCompleteConnectorRequirement(record: Record<string, unknown>): boolean {
  const keys = ["connector", "scopes", "operations", "authType", "required", "destructive", "setupLabel"];
  return keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
    && safeConnectorSlug(record.connector) !== undefined
    && enumValue(record.authType, ["oauth", "api_key", "none"] as const) !== undefined
    && typeof record.required === "boolean"
    && typeof record.destructive === "boolean"
    && typeof record.setupLabel === "string"
    && areCompleteConnectorValues(record.scopes)
    && areCompleteConnectorValues(record.operations);
}

function isCompleteConnectorPreflight(record: Record<string, unknown>): boolean {
  const keys = [
    "connector", "required", "status", "connected", "scopes", "missingScopes", "operations",
    "authType", "setupLabel", "requiresAuth", "accountId", "profileName", "reason",
  ];
  const status = enumValue(record.status, [
    "ready", "missing", "expired", "insufficient_scope", "unavailable",
  ] as const);
  return keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
    && safeConnectorSlug(record.connector) !== undefined
    && status !== undefined
    && enumValue(record.authType, ["oauth", "api_key", "none"] as const) !== undefined
    && typeof record.required === "boolean"
    && typeof record.connected === "boolean"
    && record.connected === (status === "ready")
    && typeof record.requiresAuth === "boolean"
    && record.requiresAuth === (status !== "ready" && status !== "unavailable")
    && typeof record.setupLabel === "string"
    && (record.accountId === null || safeIdentifier(record.accountId) !== undefined)
    && (record.profileName === null || safeProfileName(record.profileName) !== undefined)
    && (record.reason === null || typeof record.reason === "string")
    && areCompleteConnectorValues(record.scopes)
    && areCompleteConnectorValues(record.missingScopes)
    && (status !== "ready" || safeConnectorValues(record.missingScopes).length === 0)
    && (status !== "insufficient_scope" || safeConnectorValues(record.missingScopes).length > 0)
    && areCompleteConnectorValues(record.operations);
}

function areCompleteConnectorValues(value: unknown): boolean {
  return Array.isArray(value)
    && value.length <= 100
    && sameStringArray(value, safeConnectorValues(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameStringArray(value: unknown, expected: string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
