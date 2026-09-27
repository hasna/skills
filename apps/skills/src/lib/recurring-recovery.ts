import { constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { canonicalJson, canonicalJsonSha256 } from "./canonical-json.js";
import { normalizeSkillsApiOrigin } from "./fleet-credentials.js";
import { recurringActivationSchema, recurringInput, RecurringInputError, RemoteRecurringError, RemoteRecurringReadError, RemoteRecurringUnavailableError, RemoteRecurringUnconfirmedError,
  type RecurringActivation, type RecurringPreview, type RecurringConsentView } from "./remote-recurring.js";
import { RecurringCustomerError, type RecurringCustomer } from "./recurring-customer.js";

const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const common = z.object({ contractVersion: z.literal(1), apiOrigin: z.string().min(1).max(4096),
  profile: z.string().max(128).nullable(), organizationId: uuid, userId: uuid, membershipId: uuid });
const intentSchema = z.discriminatedUnion("operation", [
  common.extend({ operation: z.literal("activate"), draftId: uuid, termsSha256: sha,
    approvalDeadline: z.string().datetime(), approval: recurringActivationSchema }).strict(),
  common.extend({ operation: z.literal("revoke"), consentId: uuid }).strict(),
]);
type Intent = z.infer<typeof intentSchema>;
const stateSchema = z.object({ contractVersion: z.literal(1), intentSha256: sha,
  phase: z.enum(["prepared", "pending", "observed"]), consentId: uuid.nullable() }).strict();
type State = z.infer<typeof stateSchema>;
const invalid = (): never => { throw new RecurringCustomerError("RECURRING_RECOVERY_INVALID", "The original recovery directory or record is invalid or changed. Preserve it; do not create a replacement activation automatically."); };

/** Captured owner identity survives awaits. No cleanup of recovery roots occurs. */
class RecoveryOwner {
  private readonly parents: Array<{ path: string; dev: number; ino: number }> = [];
  constructor(readonly directory: string) {
    if (!isAbsolute(directory) || resolve(directory) !== directory || realpathSync(directory) !== directory) invalid();
    for (let path = directory; ; path = dirname(path)) {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
      this.parents.push({ path, dev: stat.dev, ino: stat.ino });
      if (path === dirname(path)) break;
    }
    this.assert();
  }
  assert() {
    if (realpathSync(this.directory) !== this.directory) invalid();
    for (const prior of this.parents) {
      const now = lstatSync(prior.path);
      if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== prior.dev || now.ino !== prior.ino) invalid();
    }
    const own = lstatSync(this.directory);
    if ((own.mode & 0o0777) !== 0o700 || (own.mode & 0o7000) !== 0 || (process.getuid && own.uid !== process.getuid())) invalid();
  }
  read(name: string): string {
    this.assert();
    const fd = openSync(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o7777) !== 0o600 || before.size < 1 || before.size > 8192
        || (process.getuid && before.uid !== process.getuid())) invalid();
      const bytes = Buffer.alloc(before.size + 1); let size = 0;
      while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, size); if (!n) break; size += n; }
      const after = fstatSync(fd), path = lstatSync(join(this.directory, name));
      if (size !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || path.dev !== before.dev || path.ino !== before.ino || !path.isFile() || path.isSymbolicLink()) invalid();
      this.assert(); return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    } finally { closeSync(fd); }
  }
  write(name: string, value: unknown) {
    this.assert(); const bytes = canonicalJson(value, 8192) + "\n";
    const fd = openSync(join(this.directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    this.assert(); this.sync();
  }
  sync() {
    this.assert(); const fd = openSync(this.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  saveState(state: State, expected: string) {
    if (this.read("state.json") !== expected) invalid();
    const name = `.state-${randomUUID()}.json`; this.write(name, state);
    if (this.read("state.json") !== expected) invalid();
    this.assert(); renameSync(join(this.directory, name), join(this.directory, "state.json")); this.sync();
  }
  async locked<T>(action: () => Promise<T>): Promise<T> {
    this.assert(); let fd: number;
    try { fd = openSync(join(this.directory, "operation.lock"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch { throw new RecurringCustomerError("RECURRING_RECOVERY_BUSY", "Recovery is locked. Confirm the original process has stopped before explicitly reconciling the retained lock; no request was retried."); }
    const owner = fstatSync(fd);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); fsyncSync(fd); this.sync(); return await action(); }
    finally {
      closeSync(fd); this.assert(); const now = lstatSync(join(this.directory, "operation.lock"));
      if (owner.dev !== now.dev || owner.ino !== now.ino || !now.isFile() || now.isSymbolicLink()) invalid();
      unlinkSync(join(this.directory, "operation.lock")); this.sync();
    }
  }
}
function load(owner: RecoveryOwner) {
  try {
    const stateText = owner.read("state.json"), state = stateSchema.parse(JSON.parse(stateText));
    const intent = intentSchema.parse(JSON.parse(owner.read(`intent-${state.intentSha256}.json`)));
    if (canonicalJsonSha256(intent) !== state.intentSha256 || normalizeSkillsApiOrigin(intent.apiOrigin) !== intent.apiOrigin
      || (intent.operation === "activate" && intent.approval.acceptedTermsSha256 !== intent.termsSha256)
      || (state.phase === "observed" ? state.consentId === null : state.consentId !== null)
      || (intent.operation === "revoke" && state.consentId !== null && state.consentId !== intent.consentId)) invalid();
    return { intent, state, stateText };
  } catch { return invalid(); }
}
/** Refuse a substituted target before displaying saved terms or requesting OTP.
 * The recovery executor repeats this fence while holding the original record. */
export function bindRecurringRecovery(customer: RecurringCustomer, intent: Intent) {
  if (customer.apiOrigin !== intent.apiOrigin || customer.profile !== intent.profile || customer.context?.userId !== intent.userId
    || customer.context?.membershipId !== intent.membershipId || (customer.organizationId && customer.organizationId !== intent.organizationId))
    throw new RecurringCustomerError("RECURRING_RECOVERY_TARGET_MISMATCH", "Use the recovery record's original server, profile, account and exact membership. No replacement request was submitted.");
}
function base(customer: RecurringCustomer, organizationId: string) {
  if (!customer.context) throw new RecurringCustomerError("RECURRING_CONTEXT_REQUIRED", "Use an enrolled profile or both observed user and membership IDs to retain exact recovery authority.");
  return { contractVersion: 1 as const, apiOrigin: customer.apiOrigin, profile: customer.profile, organizationId,
    userId: customer.context.userId, membershipId: customer.context.membershipId };
}
function create(directory: string, intent: Intent) {
  // Require an already-existing canonical parent. Never create or adopt an existing recovery directory.
  if (!isAbsolute(directory) || resolve(directory) !== directory || realpathSync(dirname(directory)) !== dirname(directory)) invalid();
  mkdirSync(directory, { mode: 0o700 });
  const owner = new RecoveryOwner(directory), checked = intentSchema.parse(intent), intentSha256 = canonicalJsonSha256(checked);
  owner.write(`intent-${intentSha256}.json`, checked);
  owner.write("state.json", { contractVersion: 1, intentSha256, phase: "prepared", consentId: null });
  return owner;
}
function draftMatches(draft: RecurringPreview | null, intent: Extract<Intent, { operation: "activate" }>) {
  if (!draft || draft.draftId !== intent.draftId || draft.termsSha256 !== intent.termsSha256 || draft.approvalDeadline !== intent.approvalDeadline
    || draft.terms.organizationId !== intent.organizationId || draft.terms.approvedByUserId !== intent.userId || draft.terms.approvedMembershipId !== intent.membershipId)
    throw new RemoteRecurringError("RECURRING_TERMS_UNAVAILABLE");
}
function consentMatches(consent: RecurringConsentView | null, intent: Intent) {
  if (!consent || consent.terms.organizationId !== intent.organizationId) throw new RemoteRecurringError("RECURRING_NOT_FOUND");
  if (intent.operation === "activate" && (consent.termsSha256 !== intent.termsSha256
    || consent.terms.approvedByUserId !== intent.userId || consent.terms.approvedMembershipId !== intent.membershipId))
    throw new RemoteRecurringError("RECURRING_TERMS_UNAVAILABLE");
  return consent;
}
export async function prepareRecurringActivation(customer: RecurringCustomer, directory: string, draftId: string, approval: RecurringActivation) {
  const captured = recurringInput("activate", { draftId, approval });
  const draft = await customer.call("draft", { draftId: captured.draftId });
  if (!draft || draft.termsSha256 !== captured.approval.acceptedTermsSha256) throw new RemoteRecurringError("RECURRING_TERMS_UNAVAILABLE");
  const intent: Intent = { ...base(customer, draft.terms.organizationId), operation: "activate", draftId: draft.draftId,
    termsSha256: draft.termsSha256, approvalDeadline: draft.approvalDeadline, approval: captured.approval };
  draftMatches(draft, intent); await customer.assertCurrent(); create(directory, intent);
  return draft;
}
export async function prepareRecurringRevocation(customer: RecurringCustomer, directory: string, consentId: string) {
  const input = recurringInput("revoke", { consentId }), consent = await customer.call("get", input);
  if (!consent) throw new RemoteRecurringError("RECURRING_NOT_FOUND");
  await customer.assertCurrent(); create(directory, { ...base(customer, consent.terms.organizationId), operation: "revoke", consentId: input.consentId });
  return consent;
}
export function readRecurringRecovery(directory: string) {
  const { intent, state } = load(new RecoveryOwner(directory));
  return { intent, phase: state.phase, consentId: state.consentId };
}
export interface RecurringRecoveryOptions { confirm: boolean; email?: string; code?: string }

/** One explicit action, never an internal POST retry. Pending remains uncertain
 * even when later verification, local persistence or custody checks fail. */
export async function continueRecurringRecovery(customer: RecurringCustomer, directory: string, options: RecurringRecoveryOptions) {
  const captured = { ...options }, owner = new RecoveryOwner(directory);
  let pending = load(owner).state.phase === "pending";
  try {
    const completed = await owner.locked(async () => {
      const loaded = load(owner), { intent } = loaded; let { state, stateText } = loaded;
      pending = state.phase === "pending"; bindRecurringRecovery(customer, intent); await customer.assertCurrent();
      const save = (next: State) => { owner.saveState(next, stateText); state = next; stateText = owner.read("state.json"); };
      const result = (value: unknown) => ({ recoveryDirectory: directory, operation: intent.operation,
        outcomeUnknown: state.phase === "pending", phase: state.phase, result: value });
      if (state.phase === "observed") {
        const consent = consentMatches(await customer.call("get", { consentId: state.consentId! }), intent);
        owner.assert(); return result(consent);
      }
      let draft: RecurringPreview | null = null;
      if (intent.operation === "activate") {
        draft = await customer.call("draft", { draftId: intent.draftId }); draftMatches(draft, intent);
      } else {
        const consent = consentMatches(await customer.call("get", { consentId: intent.consentId }), intent);
        if (consent.revokedAt !== null) { save({ ...state, phase: "observed", consentId: consent.consentId }); return result(consent); }
        if (!captured.confirm) return result(consent);
      }
      if (!captured.confirm) return result(draft);
      let active = customer;
      if (intent.operation === "activate") {
        if (!captured.email || !captured.code) throw new RecurringCustomerError("RECURRING_VERIFICATION_REQUIRED", "Fresh human verification is required before explicitly replaying the original activation.");
        active = await customer.fresh(captured.email, captured.code); bindRecurringRecovery(active, intent);
      }
      owner.assert(); await active.assertCurrent();
      const previousUnknown = pending;
      save({ ...state, phase: "pending", consentId: null }); pending = true;
      let response;
      try { response = intent.operation === "activate"
        ? await active.call("activate", { draftId: intent.draftId, approval: intent.approval })
        : await active.call("revoke", { consentId: intent.consentId }); }
      catch (error) {
        // A recognized refusal resolves this first attempt, never an earlier
        // unknown attempt. Keep the same immutable intent for explicit retry.
        if (!previousUnknown && (error instanceof RemoteRecurringError || error instanceof RemoteRecurringReadError
          || error instanceof RemoteRecurringUnavailableError || error instanceof RecurringInputError)) {
          save({ ...state, phase: "prepared", consentId: null }); pending = false;
        }
        throw error;
      }
      const consentId = "consent" in response ? response.consent.consentId : response.consentId;
      save({ ...state, phase: "observed", consentId });
      return result(response);
    });
    pending = false; return completed;
  } catch (error) {
    if (pending) throw new RemoteRecurringUnconfirmedError();
    throw error;
  }
}
