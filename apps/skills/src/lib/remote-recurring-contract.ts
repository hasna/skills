import { z } from "zod/v4";

/** Portable versioned wire values only. Eligibility, repricing, freshness, budgets
 * and execution authority are verified by the configured server. */
export const RECURRING_CONTRACT_VERSION = 1 as const;
export const MAX_RECURRING_CREDITS = 2_147_483_647;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const boundedInteger = z.number().int().min(0).max(MAX_RECURRING_CREDITS);
const positiveInteger = boundedInteger.min(1);
const instant = z.string().datetime({ offset: false });
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(128);

export const recurringRequestSchema = z.object({
  contractVersion: z.literal(RECURRING_CONTRACT_VERSION),
  skill: slug,
  input: z.record(z.string(), z.json()),
  args: z.array(z.string().max(8_192)).max(256),
  runtime: z.object({
    timeoutMs: z.number().int().min(1_000).max(900_000),
    maxOutputBytes: z.number().int().min(4_096).max(262_144),
    maxAttempts: z.number().int().min(1).max(10),
    connectorOperations: z.array(z.object({ connectorSlug: slug,
      operationName: z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/).max(128) }).strict()).max(64),
  }).strict(),
  everyMinutes: positiveInteger.multipleOf(60),
  startsAt: instant,
  expiresAt: instant,
  dispatchGraceSeconds: positiveInteger,
  period: z.literal("utc-day"),
  inFlightPolicy: z.literal("finish-authorized-attempt"),
  maxCreditsPerRun: boundedInteger,
  maxCreditsPerPeriod: boundedInteger,
  maxCreditsTotal: boundedInteger,
  maxOccurrencesPerPeriod: positiveInteger,
  maxOccurrencesTotal: positiveInteger,
}).strict();
export type RecurringRequest = z.infer<typeof recurringRequestSchema>;

export interface RecurringTerms extends RecurringRequest {
  deploymentId: string;
  organizationId: string;
  approvedByUserId: string;
  approvedMembershipId: string;
  policyId: string;
  policyRevision: number;
  skillId: string;
  skillVersionId: string;
  runtimeApprovalDigest: string;
  payloadSha256: string;
}
export const recurringTermsSchema = recurringRequestSchema.extend({
  deploymentId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
  organizationId: z.uuid(), approvedByUserId: z.uuid(), approvedMembershipId: z.uuid(),
  policyId: z.uuid(), policyRevision: positiveInteger, skillId: z.uuid(), skillVersionId: z.uuid(),
  runtimeApprovalDigest: sha256Schema, payloadSha256: sha256Schema,
}).strict();

export interface RecurringQuote {
  costCredits: number;
  quotedAt: string;
  /** Quote is informational: admission always reprices under authority locks. */
  admissionReprices: true;
}
export interface RecurringPreview {
  contractVersion: typeof RECURRING_CONTRACT_VERSION;
  draftId: string;
  terms: RecurringTerms;
  termsSha256: string;
  quote: RecurringQuote;
  approvalDeadline: string;
  firstDueInstants: string[];
  firstPeriod: { startsAt: string; endsAt: string };
  additionalBudget: true;
}
export const recurringActivationSchema = z.object({
  contractVersion: z.literal(RECURRING_CONTRACT_VERSION),
  acceptedTermsSha256: sha256Schema,
  acceptance: z.literal("authorize-recurring-credit-use"),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
}).strict();
export type RecurringActivation = z.infer<typeof recurringActivationSchema>;
export interface RecurringBudget {
  reservedCredits: number;
  settledCredits: number;
  admittedOccurrences: number;
}
export interface RecurringConsentView {
  contractVersion: typeof RECURRING_CONTRACT_VERSION;
  consentId: string;
  scheduleId: string;
  terms: RecurringTerms;
  termsSha256: string;
  state: "active" | "revoked" | "expired";
  activatedAt: string;
  revokedAt: string | null;
  total: RecurringBudget;
  currentPeriod: (RecurringBudget & { startsAt: string; endsAt: string }) | null;
  nextDueAt: string | null;
}
export interface RecurringActivationResult { replayed: boolean; consent: RecurringConsentView }
export interface RecurringPage<T> { contractVersion: typeof RECURRING_CONTRACT_VERSION; items: T[]; nextCursor: string | null }
export type RecurringRefusal = "consent-inactive" | "authority-revoked" | "policy-disabled"
  | "policy-changed" | "skill-changed" | "quote-unavailable" | "per-run-ceiling"
  | "period-ceiling" | "total-ceiling" | "period-count" | "total-count"
  | "insufficient-credits" | "input-quota" | "runtime-unavailable";
export interface RecurringOccurrenceView {
  occurrenceId: string;
  scheduleId: string;
  dueAt: string;
  periodStartsAt: string;
  periodEndsAt: string;
  outcome: "admitted" | "skipped" | "refused";
  reason: RecurringRefusal | "dispatch-grace-elapsed" | null;
  runId: string | null;
  quotedCredits: number | null;
  allocationState: "reserved" | "captured" | "released" | null;
}
export interface RecurringRevocation {
  contractVersion: typeof RECURRING_CONTRACT_VERSION;
  consentId: string;
  revokedAt: string;
  /** Bounded snapshot; separate paginated occurrences contains every run. */
  authorizedRuns: { runId: string; attempt: number; reservedCredits: number }[];
  authorizedRunCount: number;
  residualReservedCredits: number;
  inFlightPolicy: "finish-authorized-attempt";
  cancellationIsSeparate: true;
}
