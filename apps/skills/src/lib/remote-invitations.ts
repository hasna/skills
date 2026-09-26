import type { RemoteCustomerRole } from "./remote-profile.js";

export type RemoteWorkspaceInvitation = {
  id: string; organizationId: string; email: string; role: RemoteCustomerRole; generation: number;
  status: "pending" | "expired" | "accepted" | "revoked"; expiresAt: string; createdAt: string;
  delivery: { state: "queued" | "sending" | "uncertain" | "provider_accepted" | "failed" | "cancelled"; attempts: number };
};
export type RemoteWorkspaceInvitationsPage = { organizationId: string; invitations: RemoteWorkspaceInvitation[]; nextCursor: string | null };
export type RemoteWorkspaceInvitationResult = { invitation: RemoteWorkspaceInvitation; changed: boolean };
export type RemoteWorkspaceInvitationAcceptance = { organizationId: string; membershipId: string; accepted: true; changed: boolean };
export type ListRemoteWorkspaceInvitations = Readonly<{ after?: string }>;
export type IssueRemoteWorkspaceInvitation = Readonly<{ email: string; role: RemoteCustomerRole; idempotencyKey: string; confirm: true }>;
export type ResendRemoteWorkspaceInvitation = Readonly<{ expectedGeneration: number; idempotencyKey: string; confirm: true }>;
export type RevokeRemoteWorkspaceInvitation = Readonly<{ expectedGeneration: number; confirm: true }>;
/** Secret input, never returned or persisted by the client. Acceptance does not select the new membership. */
export type AcceptRemoteWorkspaceInvitation = Readonly<{ token: string; confirm: true }>;

export class WorkspaceInvitationInputError extends Error {
  readonly code = "INVITATION_INPUT_INVALID";
  constructor() { super("Provide only the documented invitation fields, exact lowercase IDs, expected generation and explicit confirmation. Issue and resend require your stable idempotency key."); this.name = "WorkspaceInvitationInputError"; }
}
export const invitationFailures = {
  INVALID_REQUEST: [400, "Invitation parameters were refused."],
  ACCOUNT_UNAVAILABLE: [403, "Account is unavailable."],
  INTERACTIVE_SESSION_REQUIRED: [403, "Fresh interactive sign-in is required."],
  WORKSPACE_ADMIN_REQUIRED: [403, "A current workspace owner or admin is required."],
  INVITATION_FORBIDDEN: [403, "Your current role cannot manage this invitation."],
  INVITATION_UNAVAILABLE: [404, "Invitation is unavailable for this account."],
  INVITATION_CHANGED: [409, "Invitation changed. Read its current generation before another action."],
  INVITATION_EXISTS: [409, "A pending invitation already exists. Read current invitations."],
  ALREADY_MEMBER: [409, "An active membership already exists. An invitation cannot change its role."],
  IDEMPOTENCY_CONFLICT: [409, "This request key was used for different invitation parameters. Reconcile the original request."],
  INVITATION_LIMIT: [429, "Invitation limit reached. Wait before issuing or resending."],
  INVITATION_BUSY: [503, "Invitation is busy. Read its state before another action."],
  INVITATION_DELIVERY_UNAVAILABLE: [503, "Invitation email delivery is unavailable."],
} as const;
export type RemoteWorkspaceInvitationErrorCode = keyof typeof invitationFailures;
export class RemoteWorkspaceInvitationError extends Error {
  readonly status: number;
  constructor(readonly code: RemoteWorkspaceInvitationErrorCode) { super(invitationFailures[code][1]); this.name = "RemoteWorkspaceInvitationError"; this.status = invitationFailures[code][0]; }
}
export class RemoteWorkspaceInvitationUnconfirmedError extends Error {
  readonly code = "INVITATION_UNCONFIRMED";
  constructor() {
    super("The invitation outcome is unconfirmed. Read current invitations or memberships. Reconcile issue/resend only with the same request key, parameters, server and membership; never generate a new key or retry automatically. Saved credentials are unchanged.");
    this.name = "RemoteWorkspaceInvitationUnconfirmedError";
  }
}
export class RemoteWorkspaceInvitationReadError extends Error {
  readonly code = "INVITATION_READ_FAILED";
  constructor() { super("Unable to read a valid invitation result. Check the selected server, account, current membership and permissions."); this.name = "RemoteWorkspaceInvitationReadError"; }
}
export function invitationFailure(value: unknown, status: number) {
  if (!record(value) || typeof value.code !== "string" || !Object.hasOwn(invitationFailures, value.code)) return null;
  const code = value.code as RemoteWorkspaceInvitationErrorCode;
  return invitationFailures[code][0] === status ? code : null;
}

export type InvitationAction = "list" | "get" | "issue" | "resend" | "revoke" | "accept";
export type InvitationInputs = {
  list: ListRemoteWorkspaceInvitations; get: Readonly<{ invitationId: string }>;
  issue: IssueRemoteWorkspaceInvitation;
  resend: ResendRemoteWorkspaceInvitation & Readonly<{ invitationId: string }>;
  revoke: RevokeRemoteWorkspaceInvitation & Readonly<{ invitationId: string }>;
  accept: AcceptRemoteWorkspaceInvitation & Readonly<{ invitationId: string }>;
};
export type InvitationResults = {
  list: RemoteWorkspaceInvitationsPage; get: { invitation: RemoteWorkspaceInvitation };
  issue: RemoteWorkspaceInvitationResult; resend: RemoteWorkspaceInvitationResult; revoke: RemoteWorkspaceInvitationResult;
  accept: RemoteWorkspaceInvitationAcceptance;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const role = (v: unknown): v is RemoteCustomerRole => typeof v === "string" && ["owner", "admin", "member", "viewer"].includes(v);
const email = (v: unknown): v is string => typeof v === "string" && v.length <= 254 && !/[\p{Cc}\p{Cs}\u2028\u2029\s]/u.test(v) && /^[^@]+@[^@]+\.[^@]+$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const inputFailure = (): never => { throw new WorkspaceInvitationInputError(); };
export function invitationId(value: unknown): string { return uuid(value) ? value : inputFailure(); }
/** Capture and validate all caller values before authentication or other awaits. */
export function invitationInput<A extends InvitationAction>(action: A, input: InvitationInputs[A]): InvitationInputs[A] {
  if (!record(input)) return inputFailure();
  const keys: Record<InvitationAction, string[]> = { list: ["after"], get: ["invitationId"], issue: ["email", "role", "idempotencyKey", "confirm"],
    resend: ["invitationId", "expectedGeneration", "idempotencyKey", "confirm"], revoke: ["invitationId", "expectedGeneration", "confirm"], accept: ["invitationId", "token", "confirm"] };
  if (Object.keys(input).some(key => !keys[action].includes(key)) || (action !== "list" && keys[action].some(key => !Object.hasOwn(input, key)))) return inputFailure();
  const value = { ...input } as Record<string, unknown>;
  if (action === "list") { if (value.after !== undefined && !uuid(value.after)) return inputFailure(); }
  if (["get", "resend", "revoke", "accept"].includes(action) && !uuid(value.invitationId)) return inputFailure();
  if (!["list", "get"].includes(action) && value.confirm !== true) return inputFailure();
  if (["issue", "resend"].includes(action) && !uuid(value.idempotencyKey)) return inputFailure();
  if (action === "issue") {
    if (typeof value.email !== "string") return inputFailure();
    value.email = value.email.trim().toLowerCase();
    if (!email(value.email) || !role(value.role)) return inputFailure();
  }
  if (["resend", "revoke"].includes(action) && (!Number.isInteger(value.expectedGeneration) || Number(value.expectedGeneration) < 1 || Number(value.expectedGeneration) > 10)) return inputFailure();
  if (action === "accept" && (typeof value.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.token))) return inputFailure();
  return value as InvitationInputs[A];
}
export function invitationRequest<A extends InvitationAction>(action: A, input: InvitationInputs[A]) {
  const base = "/api/v1/workspace/invitations", value = input as Record<string, unknown>;
  const { confirm: _confirm, invitationId: id, ...body } = value;
  if (action === "list") return { path: base + (value.after ? `?after=${value.after}` : ""), method: "GET" };
  if (action === "get") return { path: `${base}/${id}`, method: "GET" };
  if (action === "accept") return { path: "/api/v1/account/invitations/accept", method: "POST", body: JSON.stringify({ invitationId: id, token: value.token }) };
  return { path: action === "issue" ? base : `${base}/${id}${action === "resend" ? "/resend" : ""}`, method: action === "revoke" ? "DELETE" : "POST", body: JSON.stringify(body) };
}
function invalid(): never { throw new RemoteWorkspaceInvitationReadError(); }
function projection(v: unknown, organizationId: string): RemoteWorkspaceInvitation {
  if (!record(v) || !uuid(v.id) || v.organizationId !== organizationId || !email(v.email) || v.email !== v.email.trim().toLowerCase() || !role(v.role)
    || !Number.isInteger(v.generation) || Number(v.generation) < 1 || Number(v.generation) > 10
    || typeof v.status !== "string" || !["pending", "expired", "accepted", "revoked"].includes(v.status) || !timestamp(v.expiresAt) || !timestamp(v.createdAt)
    || !record(v.delivery) || typeof v.delivery.state !== "string" || !["queued", "sending", "uncertain", "provider_accepted", "failed", "cancelled"].includes(v.delivery.state)
    || !Number.isInteger(v.delivery.attempts) || Number(v.delivery.attempts) < 0 || Number(v.delivery.attempts) > 5) return invalid();
  return { id: v.id, organizationId, email: v.email, role: v.role, generation: Number(v.generation), status: v.status as RemoteWorkspaceInvitation["status"],
    expiresAt: v.expiresAt, createdAt: v.createdAt, delivery: { state: v.delivery.state as RemoteWorkspaceInvitation["delivery"]["state"], attempts: Number(v.delivery.attempts) } };
}
/** Project only validated contract fields; never surface arbitrary response metadata. */
export function parseInvitationResult<A extends InvitationAction>(action: A, value: unknown, input: InvitationInputs[A], organizationId: string): InvitationResults[A] {
  if (!record(value)) return invalid();
  const request = input as Record<string, unknown>;
  if (action === "accept") {
    if (!uuid(value.organizationId) || !uuid(value.membershipId) || value.accepted !== true || typeof value.changed !== "boolean") return invalid();
    return { organizationId: value.organizationId, membershipId: value.membershipId, accepted: true, changed: value.changed } as InvitationResults[A];
  }
  if (action === "list") {
    if (value.organizationId !== organizationId || !Array.isArray(value.invitations) || value.invitations.length > 50 || (value.nextCursor !== null && !uuid(value.nextCursor))) return invalid();
    const invitations = value.invitations.map(v => projection(v, organizationId));
    if (invitations.some((v, n) => v.id <= String(n ? invitations[n - 1].id : request.after ?? ""))
      || (value.nextCursor !== null && (invitations.length !== 50 || value.nextCursor !== invitations.at(-1)?.id))) return invalid();
    return { organizationId, invitations, nextCursor: value.nextCursor } as InvitationResults[A];
  }
  const invitation = projection(value.invitation, organizationId);
  if (action !== "issue" && invitation.id !== request.invitationId) return invalid();
  if (action === "get") return { invitation } as InvitationResults[A];
  if (typeof value.changed !== "boolean") return invalid();
  if (action === "issue" && (invitation.email !== request.email || invitation.role !== request.role || (value.changed && invitation.generation !== 1))) return invalid();
  if (action === "resend" && (value.changed ? invitation.generation !== Number(request.expectedGeneration) + 1 : invitation.generation <= Number(request.expectedGeneration))) return invalid();
  if (action === "revoke" && (invitation.status !== "revoked" || invitation.generation < Number(request.expectedGeneration) || (value.changed && invitation.generation !== request.expectedGeneration))) return invalid();
  return { invitation, changed: value.changed } as InvitationResults[A];
}
