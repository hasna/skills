import { z } from "zod/v4";
import { canonicalJson, canonicalJsonAtDepth, canonicalJsonSha256 } from "./canonical-json.js";
import { recurringRequestSchema, recurringTermsSchema, recurringActivationSchema, MAX_RECURRING_CREDITS,
  type RecurringRequest, type RecurringActivation, type RecurringPreview, type RecurringConsentView,
  type RecurringActivationResult, type RecurringPage, type RecurringOccurrenceView, type RecurringRevocation,
  type RecurringTerms } from "./remote-recurring-contract.js";
import type { RemoteWorkspaceIdentity } from "./remote-workspace-selection.js";
export * from "./remote-recurring-contract.js";

export interface RecurringCapability { contractVersion: 1; available: boolean }
export type RecurringListOptions = Readonly<{ limit?: number; cursor?: string }>;
export type RecurringAction = "preview" | "draft" | "activate" | "list" | "get" | "occurrences" | "revoke";
export type RecurringInputs = {
  preview: RecurringRequest; draft: { draftId: string };
  activate: { draftId: string; approval: RecurringActivation };
  list: RecurringListOptions; get: { consentId: string };
  occurrences: RecurringListOptions & { consentId: string }; revoke: { consentId: string };
};
export type RecurringResults = {
  preview: RecurringPreview; draft: RecurringPreview | null; activate: RecurringActivationResult;
  list: RecurringPage<RecurringConsentView>; get: RecurringConsentView | null;
  occurrences: RecurringPage<RecurringOccurrenceView>; revoke: RecurringRevocation;
};
export class RecurringInputError extends Error {
  readonly code = "RECURRING_INPUT_INVALID";
  constructor() { super("Provide only the documented recurring fields, bounded JSON and original approval identity."); this.name = "RecurringInputError"; }
}
export class RemoteRecurringUnavailableError extends Error {
  readonly code = "RECURRING_UNAVAILABLE";
  constructor() { super("The configured Skills server does not advertise a compatible available recurring capability."); this.name = "RemoteRecurringUnavailableError"; }
}
export class RemoteRecurringReadError extends Error {
  readonly code = "RECURRING_READ_FAILED";
  constructor() { super("Unable to verify a recurring response from the selected server and current account."); this.name = "RemoteRecurringReadError"; }
}
export class RemoteRecurringUnconfirmedError extends Error {
  readonly code = "RECURRING_OUTCOME_UNKNOWN";
  readonly outcomeUnknown = true;
  constructor() {
    super("The recurring mutation outcome is unconfirmed. Preserve the original server, account, input and request key. Read the original draft or consent and explicitly reconcile that same request; never replace its key or retry automatically.");
    this.name = "RemoteRecurringUnconfirmedError";
  }
}
const failures = {
  RECURRING_INVALID_REQUEST: [400, "Recurring parameters were refused."],
  RECURRING_INVALID_CURSOR: [400, "Recurring page cursor was refused."],
  RECURRING_BODY_TOO_LARGE: [413, "Recurring input exceeds the server limit."],
  RECURRING_UNAUTHENTICATED: [401, "A current authenticated membership is required."],
  RECURRING_HUMAN_APPROVAL_REQUIRED: [403, "A fresh human sign-in is required to activate recurring consent."],
  RECURRING_IMPERSONATION_DENIED: [403, "Recurring changes are unavailable while impersonating."],
  RECURRING_AUTHORITY_REFUSED: [403, "Current recurring authority was refused."],
  RECURRING_DEPLOYMENT_MISMATCH: [403, "The recurring draft belongs to another deployment."],
  RECURRING_SKILL_CHANGED: [409, "The recurring skill has changed."],
  RECURRING_TERMS_UNAVAILABLE: [409, "The original recurring terms are unavailable."],
  RECURRING_QUOTE_EXCEEDS_CEILING: [409, "The current quote exceeds the approved recurring ceiling."],
  RECURRING_NOT_FOUND: [404, "Recurring state is unavailable for this account."],
  RECURRING_METHOD_NOT_ALLOWED: [405, "The recurring operation is unsupported."],
  RECURRING_UNAVAILABLE: [503, "Recurring operations are unavailable on this server."],
  INSUFFICIENT_SCOPE: [403, "The credential lacks the required recurring scope."],
  RATE_LIMITED: [429, "The recurring request limit was reached. Wait before another explicit request."],
} as const;
export type RemoteRecurringErrorCode = keyof typeof failures;
export class RemoteRecurringError extends Error {
  readonly status: number;
  constructor(readonly code: RemoteRecurringErrorCode) { super(failures[code][1]); this.name = "RemoteRecurringError"; this.status = failures[code][0]; }
}
export function recurringFailure(value: unknown, status: number): RemoteRecurringErrorCode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.outcomeUnknown === true || typeof row.code !== "string" || !Object.hasOwn(failures, row.code)) return null;
  const code = row.code as RemoteRecurringErrorCode;
  return failures[code][0] === status ? code : null;
}
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const instant = z.string().max(32).datetime();
const integer = z.number().int().min(0).max(MAX_RECURRING_CREDITS);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const list = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(2048).optional() }).strict();
const inputs = {
  preview: recurringRequestSchema, draft: z.object({ draftId: uuid }).strict(),
  activate: z.object({ draftId: uuid, approval: recurringActivationSchema }).strict(),
  list, get: z.object({ consentId: uuid }).strict(), occurrences: list.extend({ consentId: uuid }).strict(),
  revoke: z.object({ consentId: uuid }).strict(),
};
/** Snapshot before any await. Validation does not substitute for server policy. */
export function recurringInput<A extends RecurringAction>(action: A, raw: RecurringInputs[A]): RecurringInputs[A] {
  try {
    const snapshot = JSON.parse(canonicalJson(raw, action === "preview" ? 1_048_576 : 4096));
    return inputs[action].parse(snapshot) as RecurringInputs[A];
  } catch { throw new RecurringInputError(); }
}
export function parseRecurringCapability(value: unknown): RecurringCapability | undefined {
  const result = z.object({ contractVersion: z.literal(1), available: z.boolean() }).safeParse(value);
  return result.success ? result.data : undefined;
}
const capabilityNames: Record<RecurringAction, string> = { preview: "recurring.preview", draft: "recurring.drafts.read",
  activate: "recurring.activate", list: "recurring.read", get: "recurring.read", occurrences: "recurring.occurrences", revoke: "recurring.revoke" };
export function assertRecurringCapability(value: unknown, action: RecurringAction): void {
  const parsed = z.object({ contractVersion: z.literal(1), apiVersion: z.literal(1), capabilities: z.array(z.string().max(128)).max(512),
    recurringConsents: z.object({ contractVersion: z.literal(1), available: z.literal(true) }) }).safeParse(value);
  if (!parsed.success || !parsed.data.capabilities.includes(capabilityNames[action])) throw new RemoteRecurringUnavailableError();
}
export function recurringRequest<A extends RecurringAction>(action: A, input: RecurringInputs[A]) {
  const row = input as Record<string, unknown>, base = "/api/v1/recurring-consents";
  const read = ["draft", "list", "get", "occurrences"].includes(action);
  let path = action === "preview" ? `${base}/preview` : action === "draft" ? `/api/v1/recurring-consent-drafts/${row.draftId}`
    : action === "activate" ? `${base}/${row.draftId}/activate` : action === "list" ? base
    : `${base}/${row.consentId}${action === "get" ? "" : `/${action}`}`;
  if (action === "list" || action === "occurrences") {
    const query = new URLSearchParams();
    if (row.limit !== undefined) query.set("limit", String(row.limit));
    if (row.cursor !== undefined) query.set("cursor", String(row.cursor));
    if (query.size) path += `?${query}`;
  }
  return { path, read, method: read ? "GET" : "POST", body: read ? undefined
    : JSON.stringify(action === "preview" ? input : action === "activate" ? row.approval : { contractVersion: 1 }) };
}
const budget = z.object({ reservedCredits: integer, settledCredits: integer, admittedOccurrences: integer });
const period = z.object({ startsAt: instant, endsAt: instant });
const preview = z.object({ contractVersion: z.literal(1), draftId: uuid, terms: recurringTermsSchema, termsSha256: digest,
  quote: z.object({ costCredits: integer, quotedAt: instant, admissionReprices: z.literal(true) }), approvalDeadline: instant,
  firstDueInstants: z.array(instant).min(1).max(5), firstPeriod: period, additionalBudget: z.literal(true) });
const consent = z.object({ contractVersion: z.literal(1), consentId: uuid, scheduleId: uuid, terms: recurringTermsSchema, termsSha256: digest,
  state: z.enum(["active", "revoked", "expired"]), activatedAt: instant, revokedAt: instant.nullable(), total: budget,
  currentPeriod: budget.extend(period.shape).nullable(), nextDueAt: instant.nullable() });
const refusal = z.enum(["consent-inactive", "authority-revoked", "policy-disabled", "policy-changed", "skill-changed", "quote-unavailable",
  "per-run-ceiling", "period-ceiling", "total-ceiling", "period-count", "total-count", "insufficient-credits", "input-quota", "runtime-unavailable", "dispatch-grace-elapsed"]);
const occurrence = z.object({ occurrenceId: uuid, scheduleId: uuid, dueAt: instant, periodStartsAt: instant, periodEndsAt: instant,
  outcome: z.enum(["admitted", "skipped", "refused"]), reason: refusal.nullable(), runId: uuid.nullable(), quotedCredits: integer.nullable(),
  allocationState: z.enum(["reserved", "captured", "released"]).nullable() });
const revocation = z.object({ contractVersion: z.literal(1), consentId: uuid, revokedAt: instant,
  authorizedRuns: z.array(z.object({ runId: uuid, attempt: z.number().int().min(1).max(10), reservedCredits: integer })).max(100),
  authorizedRunCount: integer, residualReservedCredits: integer, inFlightPolicy: z.literal("finish-authorized-attempt"), cancellationIsSeparate: z.literal(true) });
const page = <T extends z.ZodType>(item: T) => z.object({ contractVersion: z.literal(1), items: z.array(item).max(100), nextCursor: z.string().min(1).max(2048).nullable() });
const results = { preview, draft: preview.nullable(), activate: z.object({ replayed: z.boolean(), consent }), list: page(consent), get: consent.nullable(), occurrences: page(occurrence), revoke: revocation };
function requireResult(value: unknown): asserts value { if (!value) throw new RemoteRecurringReadError(); }
function termsIntegrity(terms: RecurringTerms, hash: string, identity: RemoteWorkspaceIdentity, own: boolean) {
  requireResult(terms.organizationId === identity.organization.id && (!own || terms.approvedByUserId === identity.user.id && terms.approvedMembershipId === identity.user.membershipId));
  requireResult(canonicalJsonSha256(terms) === hash);
  requireResult(canonicalJsonSha256({ skill: terms.skill, input: terms.input, args: terms.args, runtime: terms.runtime }) === terms.payloadSha256);
  requireResult(Date.parse(terms.expiresAt) > Date.parse(terms.startsAt));
}
function previewIntegrity(value: RecurringPreview, identity: RemoteWorkspaceIdentity) {
  termsIntegrity(value.terms, value.termsSha256, identity, true);
  requireResult(Date.parse(value.approvalDeadline) > Date.parse(value.quote.quotedAt));
  const anchor = Date.parse(value.terms.startsAt), end = Date.parse(value.terms.expiresAt), cadence = value.terms.everyMinutes * 60_000;
  requireResult(value.firstDueInstants.every((at, i) => Date.parse(at) === anchor + i * cadence && Date.parse(at) < end));
  requireResult(value.firstDueInstants.length === Math.min(5, Math.ceil((end - anchor) / cadence)));
  const day = Date.parse(value.firstPeriod.startsAt);
  requireResult(day % 86_400_000 === 0 && day <= anchor && anchor < Date.parse(value.firstPeriod.endsAt) && Date.parse(value.firstPeriod.endsAt) === day + 86_400_000);
}
/** Projects known response fields. Immutable terms remain exact and hash-bound. */
export function parseRecurringResult<A extends RecurringAction>(action: A, value: unknown, input: RecurringInputs[A], identity: RemoteWorkspaceIdentity): RecurringResults[A] {
  // Allow only this operation's wrappers above a valid request's depth:
  // terms; consent.terms; or items[].terms. Terms retain their own 64 limit.
  const wrappers: Record<RecurringAction, number> = { preview: 1, draft: 1, activate: 2, list: 3, get: 1, occurrences: 0, revoke: 0 };
  canonicalJsonAtDepth(value, 64 * 1024 * 1024, 64 + wrappers[action]);
  const result = results[action].parse(value) as RecurringResults[A];
  if (result === null) return result;
  const row = input as Record<string, unknown>;
  if (action === "preview" || action === "draft") {
    const p = result as RecurringPreview; previewIntegrity(p, identity);
    if (action === "draft") requireResult(p.draftId === row.draftId);
    else {
      const requested = input as RecurringRequest, projected = recurringRequestSchema.parse(Object.fromEntries(Object.keys(requested).map(key => [key, (p.terms as unknown as Record<string, unknown>)[key]])));
      // The server canonicalizes timestamps and operation ordering; compare those
      // documented normalizations without retargeting any request value.
      const normalized = { ...requested, startsAt: new Date(requested.startsAt).toISOString(), expiresAt: new Date(requested.expiresAt).toISOString(),
        runtime: { ...requested.runtime, connectorOperations: [...requested.runtime.connectorOperations].sort((a,b) => {
          const l = `${a.connectorSlug}:${a.operationName}`, r = `${b.connectorSlug}:${b.operationName}`; return l < r ? -1 : l > r ? 1 : 0;
        }) } };
      requireResult(canonicalJson(projected) === canonicalJson(normalized));
    }
  }
  const views = action === "list" ? (result as RecurringPage<RecurringConsentView>).items : action === "get" ? [result as RecurringConsentView]
    : action === "activate" ? [(result as RecurringActivationResult).consent] : [];
  for (const view of views) {
    termsIntegrity(view.terms, view.termsSha256, identity, action === "activate");
    requireResult((view.state === "revoked") === (view.revokedAt !== null));
    if (action === "get") requireResult(view.consentId === row.consentId);
    if (action === "activate") requireResult(view.termsSha256 === (row.approval as RecurringActivation).acceptedTermsSha256);
  }
  if (action === "list" || action === "occurrences") {
    const p = result as RecurringPage<RecurringConsentView | RecurringOccurrenceView>;
    requireResult(p.items.length <= ((row.limit as number | undefined) ?? 20));
    requireResult(p.nextCursor === null || p.items.length > 0 && p.nextCursor !== row.cursor);
    const ids = p.items.map(item => "consentId" in item ? item.consentId : item.occurrenceId);
    requireResult(new Set(ids).size === ids.length);
  }
  if (action === "occurrences") for (const item of (result as RecurringPage<RecurringOccurrenceView>).items) {
    requireResult(Date.parse(item.periodStartsAt) <= Date.parse(item.dueAt) && Date.parse(item.dueAt) < Date.parse(item.periodEndsAt));
    requireResult(item.outcome === "admitted" ? item.runId !== null && item.reason === null && item.quotedCredits !== null && item.allocationState !== null : item.runId === null && item.allocationState === null && item.reason !== null);
  }
  if (action === "revoke") {
    const r = result as RecurringRevocation;
    requireResult(r.consentId === row.consentId && r.authorizedRunCount >= r.authorizedRuns.length && new Set(r.authorizedRuns.map(run => run.runId)).size === r.authorizedRuns.length);
    requireResult(r.authorizedRuns.reduce((sum, run) => sum + run.reservedCredits, 0) <= r.residualReservedCredits);
  }
  return result;
}
