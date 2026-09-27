// The canonical build uses Zod 3; declared consumer dependencies may use Zod 4.
// Both expose this schema API at /v3, including its inferred declaration types.
import { z } from "zod/v3";

/** Version of the public, contract-only Skills administration API surface. */
export const SKILLS_ADMIN_API_CONTRACT_VERSION = "1.0.0" as const;
export const SKILLS_ADMIN_ENV_URL = "HASNA_SKILLS_API_URL" as const;
export const SKILLS_ADMIN_ENV_KEY = "HASNA_SKILLS_ADMIN_API_KEY" as const;
export const SKILLS_ADMIN_AUTH_HEADER = "Authorization" as const;
export const SKILLS_ADMIN_AUTH_SCHEME = "Bearer" as const;
export const SKILLS_ADMIN_AUTH_HEADER_FORM = "Authorization: Bearer <admin-api-key>" as const;
export const SKILLS_ADMIN_ADDITIVE_RESPONSE_FIELDS = "allowed" as const;

const identifier = z.string().min(1);
const timestamp = z.string().min(1);
const nullableTimestamp = timestamp.nullable();
const metadata = z.record(z.string(), z.unknown()).nullable();
const positiveInt = z.number().int().min(1);
const nonNegativeInt = z.number().int().min(0);

export const SkillsAdminEmptySchema = z.object({}).strict();
export const SkillsAdminPaginationQuerySchema = z.object({
  limit: positiveInt.max(200).optional(),
  offset: nonNegativeInt.optional(),
}).strict();
export const SkillsAdminOrganizationQuerySchema = SkillsAdminPaginationQuerySchema.extend({
  organizationId: identifier.optional(),
}).strict();
export const SkillsAdminOrganizationRequiredQuerySchema = z.object({
  organizationId: identifier,
}).strict();
export const SkillsAdminPathIdSchema = z.object({ id: identifier }).strict();

export const SkillsAdminErrorSchema = z.object({
  error: z.string().min(1),
  detail: z.unknown().optional(),
}).passthrough();

export const SkillsAdminOrganizationSchema = z.object({
  id: identifier,
  slug: z.string().min(1),
  name: z.string().min(1),
  metadata,
  createdAt: timestamp,
}).passthrough();

export const SkillsAdminUserSchema = z.object({
  id: identifier,
  email: z.string().min(1),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  organizationId: identifier.optional(),
  metadata,
  lastLoginAt: nullableTimestamp.optional(),
  createdAt: timestamp,
}).passthrough();

export const SkillsAdminUserRoleSchema = z.object({
  id: identifier,
  email: z.string().min(1),
  role: z.enum(["owner", "admin", "member", "viewer"]),
}).passthrough();

export const SkillsAdminEntitlementSchema = z.object({
  id: identifier,
  organizationId: identifier,
  skillId: identifier,
  source: z.enum(["subscription", "credit_purchase", "manual", "promotion"]),
  status: z.string().min(1),
  startsAt: timestamp,
  expiresAt: nullableTimestamp,
  creditsLimit: z.number().int().nullable(),
  runsLimit: z.number().int().nullable(),
  metadata,
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough();

export const SkillsAdminCreditBalanceSchema = z.object({
  availableCredits: z.number().int(),
  reservedCredits: z.number().int(),
  lifetimeCreditsPurchased: z.number().int(),
  lifetimeCreditsUsed: z.number().int(),
}).passthrough();

export const SkillsAdminCreditTransactionSchema = z.object({
  id: identifier,
  organizationId: identifier,
  transactionType: z.string().min(1),
  amountCredits: z.number().int(),
  balanceAfterAvailable: z.number().int(),
  balanceAfterReserved: z.number().int(),
  idempotencyKey: z.string().min(1),
  metadata,
  createdAt: timestamp,
}).passthrough();

export const SkillsAdminRunListRowSchema = z.object({
  id: identifier,
  organizationId: identifier,
  skill: z.string().min(1),
  status: z.string().min(1),
  creditsReserved: z.number().int(),
  creditsUsed: z.number().int(),
  createdAt: timestamp,
  completedAt: nullableTimestamp,
}).passthrough();

export const SkillsAdminRunSchema = z.object({
  id: identifier,
  organizationId: identifier,
  skillId: identifier,
  requestedSlug: z.string().min(1),
  canonicalSlug: z.string().min(1),
  status: z.string().min(1),
  requestSource: z.string().min(1),
  idempotencyKey: z.string().min(1),
  correlationId: z.string().min(1),
  creditsReserved: z.number().int(),
  creditsUsed: z.number().int(),
  metadata,
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough();

export const SkillsAdminCancelledRunSchema = z.object({
  id: identifier,
  status: z.literal("cancelled"),
}).passthrough();

export const SkillsAdminSubscriptionSchema = z.object({
  id: identifier,
  organizationId: identifier,
  customerId: identifier,
  provider: z.string().min(1),
  providerSubscriptionId: z.string().min(1),
  status: z.string().min(1),
  cancelAtPeriodEnd: z.boolean(),
  metadata,
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough();

export const SkillsAdminInvoiceSchema = z.object({
  id: identifier,
  organizationId: identifier,
  customerId: identifier,
  provider: z.string().min(1),
  providerInvoiceId: z.string().min(1),
  status: z.string().min(1),
  amountDueCents: nonNegativeInt,
  amountPaidCents: nonNegativeInt,
  currency: z.string().min(1),
  metadata,
  createdAt: timestamp,
  updatedAt: timestamp,
}).passthrough();

export const SkillsAdminAuditRowSchema = z.object({
  id: identifier,
  actorEmail: z.string().min(1),
  action: z.string().min(1),
  metadata,
  createdAt: timestamp,
}).passthrough();

export const SkillsAdminStatusResponseSchema = z.object({
  account: z.object({
    user: z.object({
      email: z.string().min(1),
      displayName: z.string().nullable(),
      role: z.string().min(1),
    }).passthrough(),
    organization: z.object({ slug: z.string().min(1), name: z.string().min(1) }).passthrough().nullable(),
    authMethod: z.string().min(1),
  }).passthrough(),
  queue: z.object({
    counts: z.object({
      queued: nonNegativeInt,
      running: nonNegativeInt,
      pendingApproval: nonNegativeInt,
      failed24h: nonNegativeInt,
    }).passthrough(),
    oldestQueuedAt: nullableTimestamp,
    lastActiveAt: nullableTimestamp,
    lastCompletedAt: nullableTimestamp,
  }).passthrough(),
  worker: z.object({
    mode: z.enum(["in-process", "separate-service"]),
    runnerEnabledInProcess: z.boolean(),
    healthSource: z.string().min(1),
  }).passthrough(),
  usage: z.object({
    recentCount: nonNegativeInt,
    recentNetAmountCents: z.number().int(),
    recentTransactions: z.array(z.object({
      transactionType: z.string().min(1),
      amountCents: z.number().int(),
      description: z.string().nullable(),
      createdAt: nullableTimestamp,
    }).passthrough()),
  }).passthrough(),
  connectors: z.object({
    status: z.enum(["configured", "unconfigured"]),
    readinessEndpoint: z.string().min(1),
  }).passthrough(),
  deployment: z.object({
    status: z.string().min(1),
    appEnv: z.string().min(1),
    nodeEnv: z.string().min(1),
    version: z.string().min(1),
    commitSha: z.string().nullable(),
    runnerEnabled: z.boolean(),
    serviceMode: z.boolean(),
    generatedAt: timestamp,
  }).passthrough(),
}).passthrough();

export const SkillsAdminSyncResponseSchema = z.object({
  synced: nonNegativeInt,
  created: nonNegativeInt,
  updated: nonNegativeInt,
  total: nonNegativeInt,
  version: z.string().min(1),
}).passthrough();

export const SkillsAdminListOrganizationsResponseSchema = z.object({
  organizations: z.array(SkillsAdminOrganizationSchema),
  limit: positiveInt,
  offset: nonNegativeInt,
}).passthrough();

export const SkillsAdminShowOrganizationResponseSchema = z.object({
  organization: SkillsAdminOrganizationSchema,
  users: z.array(SkillsAdminUserSchema),
  balance: SkillsAdminCreditBalanceSchema.nullable(),
  subscription: SkillsAdminSubscriptionSchema.nullable(),
}).passthrough();

const skillsAdminSuspensionReasonShape = {
  reason: z.string().min(1),
};
export const SkillsAdminSuspendOrganizationRequestSchema = z.object({
  suspended: z.literal(true),
  ...skillsAdminSuspensionReasonShape,
}).strict();
export const SkillsAdminResumeOrganizationRequestSchema = z.object({
  suspended: z.literal(false),
  ...skillsAdminSuspensionReasonShape,
}).strict();
export const SkillsAdminSuspendOrganizationResponseSchema = z.object({
  ok: z.literal(true),
  organization: z.object({ id: identifier, slug: z.string().min(1), metadata }).passthrough(),
}).passthrough();

export const SkillsAdminListUsersResponseSchema = z.object({
  // Global identities remain visible when their default workspace membership
  // is absent/revoked. Null grants no role; active organization rosters and
  // role mutations keep their nonnullable contracts.
  users: z.array(SkillsAdminUserSchema.extend({ role: SkillsAdminUserSchema.shape.role.nullable() })),
  limit: positiveInt,
  offset: nonNegativeInt,
}).passthrough();
export const SkillsAdminSetUserRoleRequestSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
}).strict();
export const SkillsAdminSetUserRoleResponseSchema = z.object({
  ok: z.literal(true),
  user: SkillsAdminUserRoleSchema,
}).passthrough();
export const SkillsAdminSuspendUserRequestSchema = z.object({
  suspended: z.literal(true),
  ...skillsAdminSuspensionReasonShape,
}).strict();
export const SkillsAdminResumeUserRequestSchema = z.object({
  suspended: z.literal(false),
  ...skillsAdminSuspensionReasonShape,
}).strict();
export const SkillsAdminSuspendUserResponseSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: identifier, email: z.string().min(1), metadata }).passthrough(),
}).passthrough();

export const SkillsAdminListEntitlementsResponseSchema = z.object({
  entitlements: z.array(SkillsAdminEntitlementSchema),
  limit: positiveInt,
  offset: nonNegativeInt,
}).passthrough();
export const SkillsAdminGrantEntitlementRequestSchema = z.object({
  organizationId: identifier,
  skillId: identifier.optional(),
  slug: z.string().min(1).optional(),
  source: z.enum(["subscription", "credit_purchase", "manual", "promotion"]),
  expiresAt: timestamp.optional(),
  creditsLimit: nonNegativeInt.optional(),
  runsLimit: nonNegativeInt.optional(),
}).strict().superRefine((value, context) => {
  if (Number(Boolean(value.skillId)) + Number(Boolean(value.slug)) !== 1) {
    context.addIssue({ code: "custom", message: "exactly one of skillId or slug is required" });
  }
});
export const SkillsAdminGrantEntitlementResponseSchema = z.object({
  ok: z.literal(true),
  entitlement: SkillsAdminEntitlementSchema,
}).passthrough();
export const SkillsAdminRevokeEntitlementRequestSchema = z.object({
  organizationId: identifier,
  skillId: identifier.optional(),
  slug: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (Number(Boolean(value.skillId)) + Number(Boolean(value.slug)) !== 1) {
    context.addIssue({ code: "custom", message: "exactly one of skillId or slug is required" });
  }
});
export const SkillsAdminRevokeEntitlementResponseSchema = z.object({
  ok: z.literal(true),
  revoked: nonNegativeInt,
}).passthrough();

export const SkillsAdminCreditsResponseSchema = z.object({
  organizationId: identifier,
  balance: SkillsAdminCreditBalanceSchema,
  transactions: z.array(SkillsAdminCreditTransactionSchema),
}).passthrough();
export const SkillsAdminAdjustCreditsRequestSchema = z.object({
  organizationId: identifier,
  amountCredits: z.number().int().safe().refine((value) => value !== 0, "amountCredits must be non-zero"),
  reason: z.string().min(1),
  idempotencyKey: z.string().min(1),
  transactionType: z.enum(["grant", "adjustment"]),
}).strict();
const creditAdjustApplied = z.object({
  ok: z.literal(true),
  transaction: SkillsAdminCreditTransactionSchema,
  balanceCents: z.number().int(),
}).passthrough();
const creditAdjustDuplicate = z.object({
  ok: z.literal(true),
  duplicate: z.literal(true),
  transaction: SkillsAdminCreditTransactionSchema,
}).passthrough();
export const SkillsAdminAdjustCreditsResponseSchema = z.union([creditAdjustApplied, creditAdjustDuplicate]);

export const SkillsAdminListRunsResponseSchema = z.object({
  runs: z.array(SkillsAdminRunListRowSchema),
  limit: positiveInt,
  offset: nonNegativeInt,
}).passthrough();
export const SkillsAdminShowRunResponseSchema = z.object({ run: SkillsAdminRunSchema }).passthrough();
export const SkillsAdminCancelRunRequestSchema = z.object({ reason: z.string().min(1) }).strict();
export const SkillsAdminCancelRunResponseSchema = z.object({
  ok: z.literal(true),
  run: SkillsAdminCancelledRunSchema,
}).passthrough();

export const SkillsAdminListSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(SkillsAdminSubscriptionSchema),
  limit: positiveInt,
  offset: nonNegativeInt,
}).passthrough();
export const SkillsAdminListInvoicesResponseSchema = z.object({
  invoices: z.array(SkillsAdminInvoiceSchema),
  limit: positiveInt,
  offset: nonNegativeInt,
}).passthrough();
export const SkillsAdminAuditQuerySchema = SkillsAdminPaginationQuerySchema.extend({
  action: z.string().min(1).optional(),
  organizationId: identifier.optional(),
}).strict();
export const SkillsAdminListAuditResponseSchema = z.object({
  audit: z.array(SkillsAdminAuditRowSchema),
  limit: positiveInt,
  offset: nonNegativeInt,
}).passthrough();

type HttpMethod = "GET" | "POST";
type ContractOperation = {
  method: HttpMethod;
  path: string;
  pathSchema: z.ZodType;
  querySchema: z.ZodType;
  bodySchema: z.ZodType;
  responseSchema: z.ZodType;
  successStatuses: readonly number[];
  errorStatuses: readonly number[];
  additiveResponseFields: typeof SKILLS_ADMIN_ADDITIVE_RESPONSE_FIELDS;
};

function operation<const T extends ContractOperation>(value: T): T {
  return value;
}

const contractDefaults = {
  pathSchema: SkillsAdminEmptySchema,
  querySchema: SkillsAdminEmptySchema,
  bodySchema: SkillsAdminEmptySchema,
  additiveResponseFields: SKILLS_ADMIN_ADDITIVE_RESPONSE_FIELDS,
};

/**
 * Contract-authoritative command operations. Resume operations deliberately
 * share their runtime endpoints with suspend and differ only by body value.
 */
export const SKILLS_ADMIN_OPERATIONS = {
  status: operation({ ...contractDefaults, method: "GET", path: "/api/v1/status", responseSchema: SkillsAdminStatusResponseSchema, successStatuses: [200], errorStatuses: [401, 403, 429, 500, 502, 503, 504] }),
  bootstrapSync: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/sync", responseSchema: SkillsAdminSyncResponseSchema, successStatuses: [200], errorStatuses: [401, 403, 429, 500, 502, 503, 504] }),
  orgsList: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/orgs", querySchema: SkillsAdminPaginationQuerySchema, responseSchema: SkillsAdminListOrganizationsResponseSchema, successStatuses: [200], errorStatuses: [401, 403, 429, 500, 502, 503, 504] }),
  orgsShow: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/orgs/:id", pathSchema: SkillsAdminPathIdSchema, responseSchema: SkillsAdminShowOrganizationResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  orgsSuspend: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/orgs/:id/suspend", pathSchema: SkillsAdminPathIdSchema, bodySchema: SkillsAdminSuspendOrganizationRequestSchema, responseSchema: SkillsAdminSuspendOrganizationResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  orgsResume: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/orgs/:id/suspend", pathSchema: SkillsAdminPathIdSchema, bodySchema: SkillsAdminResumeOrganizationRequestSchema, responseSchema: SkillsAdminSuspendOrganizationResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  usersList: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/users", querySchema: SkillsAdminOrganizationQuerySchema, responseSchema: SkillsAdminListUsersResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
  usersRoleSet: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/users/:id/role", pathSchema: SkillsAdminPathIdSchema, bodySchema: SkillsAdminSetUserRoleRequestSchema, responseSchema: SkillsAdminSetUserRoleResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  usersSuspend: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/users/:id/suspend", pathSchema: SkillsAdminPathIdSchema, bodySchema: SkillsAdminSuspendUserRequestSchema, responseSchema: SkillsAdminSuspendUserResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  usersResume: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/users/:id/suspend", pathSchema: SkillsAdminPathIdSchema, bodySchema: SkillsAdminResumeUserRequestSchema, responseSchema: SkillsAdminSuspendUserResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  entitlementsList: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/entitlements", querySchema: SkillsAdminOrganizationQuerySchema, responseSchema: SkillsAdminListEntitlementsResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
  entitlementsGrant: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/entitlements/grant", bodySchema: SkillsAdminGrantEntitlementRequestSchema, responseSchema: SkillsAdminGrantEntitlementResponseSchema, successStatuses: [201], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
  entitlementsRevoke: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/entitlements/revoke", bodySchema: SkillsAdminRevokeEntitlementRequestSchema, responseSchema: SkillsAdminRevokeEntitlementResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  creditsShow: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/credits", querySchema: SkillsAdminOrganizationRequiredQuerySchema, responseSchema: SkillsAdminCreditsResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
  creditsAdjust: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/credits/adjust", bodySchema: SkillsAdminAdjustCreditsRequestSchema, responseSchema: SkillsAdminAdjustCreditsResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 409, 429, 500, 502, 503, 504] }),
  runsList: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/runs", querySchema: SkillsAdminOrganizationQuerySchema, responseSchema: SkillsAdminListRunsResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
  runsShow: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/runs/:id", pathSchema: SkillsAdminPathIdSchema, responseSchema: SkillsAdminShowRunResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 429, 500, 502, 503, 504] }),
  runsCancel: operation({ ...contractDefaults, method: "POST", path: "/api/v1/admin/runs/:id/cancel", pathSchema: SkillsAdminPathIdSchema, bodySchema: SkillsAdminCancelRunRequestSchema, responseSchema: SkillsAdminCancelRunResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 404, 409, 429, 500, 502, 503, 504] }),
  billingSubscriptions: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/billing/subscriptions", querySchema: SkillsAdminOrganizationQuerySchema, responseSchema: SkillsAdminListSubscriptionsResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
  billingInvoices: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/billing/invoices", querySchema: SkillsAdminOrganizationQuerySchema, responseSchema: SkillsAdminListInvoicesResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
  auditList: operation({ ...contractDefaults, method: "GET", path: "/api/v1/admin/audit", querySchema: SkillsAdminAuditQuerySchema, responseSchema: SkillsAdminListAuditResponseSchema, successStatuses: [200], errorStatuses: [400, 401, 403, 429, 500, 502, 503, 504] }),
} as const;

export type SkillsAdminOperationId = keyof typeof SKILLS_ADMIN_OPERATIONS;
export type SkillsAdminOperationContract = (typeof SKILLS_ADMIN_OPERATIONS)[SkillsAdminOperationId];
