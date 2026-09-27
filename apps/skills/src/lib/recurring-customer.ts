import { RemoteSkillsClient } from "./remote-client.js";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { resolveSkillsConnection } from "./fleet-credentials.js";
import { prepareProfileWorkspace } from "./workspace-profile.js";
import { selectedSkillsProfile, skillsProfileCredentialFiles } from "./instance-credentials.js";
import { workspaceContext, parseWorkspaceIdentity, workspaceExpectedUserId, type RemoteWorkspaceContext } from "./remote-workspace-selection.js";
import { recurringInput, RecurringInputError, RemoteRecurringError, RemoteRecurringReadError,
  RemoteRecurringUnavailableError, RemoteRecurringUnconfirmedError,
  type RecurringAction, type RecurringInputs, type RecurringResults } from "./remote-recurring.js";

type Env = Record<string, string | undefined>;
export class RecurringCustomerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "RecurringCustomerError"; }
}
const changed = (): never => { throw new RecurringCustomerError("RECURRING_TARGET_CHANGED", "The selected server, profile or credential changed. Preserve the original recovery directory and use its original workspace."); };
export interface RecurringCustomer {
  readonly apiOrigin: string;
  readonly profile: string | null;
  readonly context: RemoteWorkspaceContext | undefined;
  /** Present only after actual fresh session and selected-workspace verification. */
  readonly organizationId: string | undefined;
  assertCurrent(): Promise<void>;
  call<A extends RecurringAction>(action: A, input: RecurringInputs[A]): Promise<RecurringResults[A]>;
  requestCode(email: string): Promise<void>;
  fresh(email: string, code: string): Promise<RecurringCustomer>;
}

function invoke<A extends RecurringAction>(client: RemoteSkillsClient, context: RemoteWorkspaceContext | undefined, action: A, input: RecurringInputs[A]): Promise<RecurringResults[A]> {
  const row = input as RecurringInputs[RecurringAction];
  switch (action) {
    case "preview": return client.previewRecurringConsent(row as RecurringInputs["preview"], context) as Promise<RecurringResults[A]>;
    case "draft": return client.getRecurringDraft((row as RecurringInputs["draft"]).draftId, context) as Promise<RecurringResults[A]>;
    case "activate": { const value = row as RecurringInputs["activate"]; return client.activateRecurringConsent(value.draftId, value.approval, context) as Promise<RecurringResults[A]>; }
    case "list": return client.listRecurringConsents(row as RecurringInputs["list"], context) as Promise<RecurringResults[A]>;
    case "get": return client.getRecurringConsent((row as RecurringInputs["get"]).consentId, context) as Promise<RecurringResults[A]>;
    case "occurrences": { const { consentId, ...page } = row as RecurringInputs["occurrences"]; return client.listRecurringOccurrences(consentId, page, context) as Promise<RecurringResults[A]>; }
    case "revoke": return client.revokeRecurringConsent((row as RecurringInputs["revoke"]).consentId, context) as Promise<RecurringResults[A]>;
  }
  throw new RecurringInputError();
}
function verification(email: string, code?: string) {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    || (code !== undefined && !/^\d{6}$/.test(code))) throw new RecurringInputError();
  return normalized;
}

/** Capture before prompting. Fresh authority comes only from the existing OTP and
 * workspace session verifier; a profile/context never grants that authority. */
export async function prepareRecurringCustomer(requested?: RemoteWorkspaceContext, source: Env = process.env): Promise<RecurringCustomer> {
  const env = { ...source }, profile = selectedSkillsProfile(env);
  const paths = skillsProfileCredentialFiles(env);
  const wanted = requested === undefined ? undefined : workspaceContext(requested);
  const pending = prepareProfileWorkspace("Manage recurring consent", env);
  const connection = await resolveSkillsConnection(env);
  if (!connection || connection.apiOrigin !== pending.origin)
    throw new RecurringCustomerError("RECURRING_AUTH_REQUIRED", "Select a Skills server and sign in before managing recurring consent.");
  const target = await pending.resolve();
  if (wanted && target.context && (wanted.userId !== target.context.userId || wanted.membershipId !== target.context.membershipId)) changed();
  const context = wanted ?? target.context;
  if (context) Object.freeze(context);
  async function assertCurrent() {
    target.unchanged();
    if (selectedSkillsProfile(source) !== profile || JSON.stringify(skillsProfileCredentialFiles(source)) !== JSON.stringify(paths)) changed();
    const current = await resolveSkillsConnection({ ...source });
    target.unchanged();
    if (!current || current.apiOrigin !== connection!.apiOrigin || current.apiKey !== connection!.apiKey) changed();
  }
  let originalIdentity: string | undefined;
  async function currentAccountEmail(email: string) {
    const normalized = verification(email);
    await assertCurrent();
    const value = await new RemoteSkillsClient(connection!.apiKey, connection!.apiOrigin).getIdentity();
    const user = value.user as { id?: unknown } | undefined;
    const identity = parseWorkspaceIdentity(value, context?.userId ?? workspaceExpectedUserId(user?.id));
    await assertCurrent();
    if (value.authMethod !== "api_key" || (context && identity.user.membershipId !== context.membershipId)) changed();
    const binding = JSON.stringify([identity.user.id, identity.user.membershipId, identity.organization.id]);
    if (originalIdentity !== undefined && originalIdentity !== binding) changed();
    originalIdentity = binding;
    if (verification(identity.user.email) !== normalized)
      throw new RecurringCustomerError("RECURRING_ACCOUNT_EMAIL_MISMATCH", "Use the selected account's current email. No verification request or recurring activation was submitted.");
    return normalized;
  }
  function customer(client: RemoteSkillsClient, organizationId?: string): RecurringCustomer {
    return Object.freeze({ apiOrigin: connection!.apiOrigin, profile, context, organizationId, assertCurrent,
      async call<A extends RecurringAction>(action: A, input: RecurringInputs[A]): Promise<RecurringResults[A]> {
        const captured = recurringInput(action, input);
        await assertCurrent();
        const result = await invoke(client, context, action, captured);
        try { await assertCurrent(); }
        catch (error) {
          if (["preview", "activate", "revoke"].includes(action)) throw new RemoteRecurringUnconfirmedError();
          throw error;
        }
        return result;
      },
      async requestCode(email: string) {
        const normalized = await currentAccountEmail(email);
        try { await new RemoteSkillsAuthClient(connection!.apiOrigin).requestCode(normalized); }
        catch { throw new RecurringCustomerError("RECURRING_VERIFICATION_UNCONFIRMED", "The verification request could not be confirmed. Check for the original email before making another explicit request."); }
        await assertCurrent();
      },
      async fresh(email: string, code: string) {
        verification(email, code);
        if (!context) throw new RecurringCustomerError("RECURRING_CONTEXT_REQUIRED", "Use an enrolled named profile or both observed user and membership IDs for fresh approval.");
        const normalized = await currentAccountEmail(email);
        let session;
        try { session = await new RemoteSkillsAuthClient(connection!.apiOrigin).switchWorkspace(normalized, code, context); }
        catch { throw new RecurringCustomerError("RECURRING_VERIFICATION_FAILED", "Fresh verification for the original account and membership was refused. No recurring activation was requested."); }
        await assertCurrent();
        return customer(new RemoteSkillsClient(session.token, connection!.apiOrigin), session.organization.id);
      },
    });
  }
  await assertCurrent();
  return customer(new RemoteSkillsClient(connection.apiKey, connection.apiOrigin));
}

/** Never echo authentication/transport bodies or caller-supplied credentials. */
export function recurringCustomerError(error: unknown) {
  const known = error instanceof RecurringInputError || error instanceof RecurringCustomerError || error instanceof RemoteRecurringError
    || error instanceof RemoteRecurringReadError || error instanceof RemoteRecurringUnavailableError || error instanceof RemoteRecurringUnconfirmedError;
  return { code: known ? error.code : "RECURRING_ACTION_FAILED",
    error: known ? error.message : "The recurring action failed. Preserve its recovery directory and inspect the original request before another mutation.",
    outcomeUnknown: error instanceof RemoteRecurringUnconfirmedError,
    ...(error instanceof RemoteRecurringError ? { status: error.status } : {}),
  };
}
