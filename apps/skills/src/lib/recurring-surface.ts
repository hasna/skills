import { isAbsolute } from "node:path";
import { z } from "zod/v4";
import { canonicalJsonAtDepth } from "./canonical-json.js";
import { recurringRequestSchema, recurringActivationSchema, RecurringInputError, RemoteRecurringError,
  RemoteRecurringUnconfirmedError, type RecurringPreview } from "./remote-recurring.js";
import { prepareRecurringCustomer, RecurringCustomerError } from "./recurring-customer.js";
import { prepareRecurringActivation, prepareRecurringRevocation, readRecurringRecovery, bindRecurringRecovery, continueRecurringRecovery } from "./recurring-recovery.js";

const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const context = { userId: uuid.optional(), membershipId: uuid.optional() };
const page = { limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(2048).optional() };
const directory = z.string().max(4096).refine(isAbsolute, "Use an absolute recovery directory");
const email = z.string().trim().toLowerCase().email().max(254), code = z.string().regex(/^\d{6}$/);
export const recurringSurfaceSchemas = {
  preview: z.object({ ...context, request: recurringRequestSchema }).strict(),
  draft: z.object({ ...context, draftId: uuid }).strict(),
  activate: z.object({ ...context, draftId: uuid, approval: recurringActivationSchema, recoveryDirectory: directory,
    email, code: code.optional(), confirm: z.boolean().optional() }).strict(),
  list: z.object({ ...context, ...page }).strict(),
  get: z.object({ ...context, consentId: uuid }).strict(),
  occurrences: z.object({ ...context, ...page, consentId: uuid }).strict(),
  revoke: z.object({ ...context, consentId: uuid, recoveryDirectory: directory, confirm: z.literal(true) }).strict(),
  recover: z.object({ ...context, recoveryDirectory: directory, confirm: z.boolean().optional(), email: email.optional(), code: code.optional() }).strict(),
  verification: z.object({ ...context, draftId: uuid, email, confirm: z.literal(true) }).strict(),
};
export type RecurringSurfaceAction = keyof typeof recurringSurfaceSchemas;
export const recurringSurfaceOperations = [
  { action: "preview", name: "preview_recurring_consent", title: "Preview recurring consent", cli: "preview", read: false, recovery: false },
  { action: "draft", name: "get_recurring_draft", title: "Read original recurring draft", cli: "draft", read: true, recovery: false },
  { action: "activate", name: "activate_recurring_consent", title: "Authorize recurring credit use", cli: "activate", read: false, recovery: true },
  { action: "list", name: "list_recurring_consents", title: "List recurring consents", cli: "list", read: true, recovery: false },
  { action: "get", name: "get_recurring_consent", title: "Inspect recurring consent and budgets", cli: "get", read: true, recovery: false },
  { action: "occurrences", name: "list_recurring_occurrences", title: "Inspect recurring occurrence history", cli: "occurrences", read: true, recovery: false },
  { action: "revoke", name: "revoke_recurring_consent", title: "Revoke recurring authority", cli: "revoke", read: false, recovery: true },
  { action: "recover", name: "recover_recurring_consent", title: "Reconcile original recurring request", cli: "recover", read: false, recovery: true },
  { action: "verification", name: "request_recurring_verification", title: "Request recurring approval verification", cli: "verification", read: false, recovery: false },
] as const;
/** The host must obtain explicit acceptance and a real human OTP. A boolean alone
 * never grants recurring authority. Host request history may retain supplied OTPs. */
export function recurringMcpSchema(action: RecurringSurfaceAction) {
  return action === "activate" ? recurringSurfaceSchemas.activate.extend({ code, confirm: z.literal(true) }) : recurringSurfaceSchemas[action];
}
export interface RecurringInteraction {
  accept(draft: RecurringPreview): Promise<boolean>;
  verification(email: string, requestCode: () => Promise<void>): Promise<string | null>;
}
const cancelled = () => ({ cancelled: true, activated: false });
function expectedDraft(draft: RecurringPreview | null, hash: string) {
  if (!draft || draft.termsSha256 !== hash) throw new RemoteRecurringError("RECURRING_TERMS_UNAVAILABLE");
  return draft;
}

/** Shared CLI/MCP orchestration only. The SDK owns wire validation/transport; the
 * selected server owns grants, freshness, prices, financial state and execution. */
export async function executeRecurringSurface(action: RecurringSurfaceAction, raw: unknown,
  env: Record<string, string | undefined> = process.env, interaction?: RecurringInteraction) {
  // One recognized request wrapper above the existing depth-64 request, never a
  // larger allowance within its immutable terms. Do not retain this secret-bearing input.
  let value: z.infer<(typeof recurringSurfaceSchemas)[RecurringSurfaceAction]>;
  try { value = recurringSurfaceSchemas[action].parse(JSON.parse(canonicalJsonAtDepth(raw, action === "preview" ? 1_052_672 : 8192, action === "preview" ? 65 : 64))); }
  catch { throw new RecurringInputError(); }
  if ((value.userId === undefined) !== (value.membershipId === undefined)) throw new RecurringInputError();
  const requested = value.userId === undefined ? undefined : { userId: value.userId, membershipId: value.membershipId! };
  const saved = action === "recover" ? readRecurringRecovery((value as z.infer<typeof recurringSurfaceSchemas.recover>).recoveryDirectory) : undefined;
  if (action === "activate" && !interaction) {
    const input = value as z.infer<typeof recurringSurfaceSchemas.activate>;
    if (input.confirm !== true || !input.code) throw new RecurringCustomerError("RECURRING_CONFIRMATION_REQUIRED", "Noninteractive activation requires explicit recurring acceptance, the original terms hash/key, confirm=true and a fresh verification code.");
  }
  try {
    const customer = await prepareRecurringCustomer(requested ?? (saved ? { userId: saved.intent.userId, membershipId: saved.intent.membershipId } : undefined), env);
    if (saved) bindRecurringRecovery(customer, saved.intent);
    switch (action) {
      case "preview": return customer.call("preview", (value as z.infer<typeof recurringSurfaceSchemas.preview>).request);
      case "draft": return customer.call("draft", { draftId: (value as z.infer<typeof recurringSurfaceSchemas.draft>).draftId });
      case "list": { const row = value as z.infer<typeof recurringSurfaceSchemas.list>; return customer.call("list", { ...(row.limit !== undefined ? { limit: row.limit } : {}), ...(row.cursor !== undefined ? { cursor: row.cursor } : {}) }); }
      case "get": return customer.call("get", { consentId: (value as z.infer<typeof recurringSurfaceSchemas.get>).consentId });
      case "occurrences": {
        const row = value as z.infer<typeof recurringSurfaceSchemas.occurrences>;
        return customer.call("occurrences", { consentId: row.consentId, ...(row.limit !== undefined ? { limit: row.limit } : {}), ...(row.cursor !== undefined ? { cursor: row.cursor } : {}) });
      }
      case "verification": {
        const row = value as z.infer<typeof recurringSurfaceSchemas.verification>;
        const draft = await customer.call("draft", { draftId: row.draftId });
        if (!draft) throw new RemoteRecurringError("RECURRING_TERMS_UNAVAILABLE");
        await customer.requestCode(row.email);
        return { verificationRequested: true, deliveryConfirmed: false, draftId: draft.draftId, activated: false };
      }
      case "activate": {
        const row = value as z.infer<typeof recurringSurfaceSchemas.activate>;
        const draft = expectedDraft(await customer.call("draft", { draftId: row.draftId }), row.approval.acceptedTermsSha256);
        if (interaction && !await interaction.accept(draft)) return cancelled();
        await prepareRecurringActivation(customer, row.recoveryDirectory, row.draftId, row.approval);
        const proof = row.code ?? await interaction!.verification(row.email, () => customer.requestCode(row.email));
        if (proof === null) return { ...cancelled(), recoveryDirectory: row.recoveryDirectory, phase: "prepared", outcomeUnknown: false };
        return continueRecurringRecovery(customer, row.recoveryDirectory, { confirm: true, email: row.email, code: proof });
      }
      case "revoke": {
        const row = value as z.infer<typeof recurringSurfaceSchemas.revoke>;
        await prepareRecurringRevocation(customer, row.recoveryDirectory, row.consentId);
        return continueRecurringRecovery(customer, row.recoveryDirectory, { confirm: true });
      }
      case "recover": {
        const row = value as z.infer<typeof recurringSurfaceSchemas.recover>;
        let proof = row.code;
        if (row.confirm && saved!.intent.operation === "activate" && saved!.phase !== "observed" && interaction) {
          const draft = expectedDraft(await customer.call("draft", { draftId: saved!.intent.draftId }), saved!.intent.termsSha256);
          if (!await interaction.accept(draft)) return { cancelled: true, outcomeUnknown: saved!.phase === "pending", recoveryDirectory: row.recoveryDirectory };
          if (!row.email) throw new RecurringInputError();
          const entered = proof ?? await interaction.verification(row.email, () => customer.requestCode(row.email!));
          if (entered === null) return { cancelled: true, outcomeUnknown: saved!.phase === "pending", recoveryDirectory: row.recoveryDirectory };
          proof = entered;
        }
        return continueRecurringRecovery(customer, row.recoveryDirectory, { confirm: row.confirm === true,
          ...(row.email ? { email: row.email } : {}), ...(proof ? { code: proof } : {}) });
      }
    }
  } catch (error) {
    if (saved?.phase === "pending") throw new RemoteRecurringUnconfirmedError();
    throw error;
  }
}
