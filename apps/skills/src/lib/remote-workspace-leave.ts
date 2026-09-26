import { workspaceContext, WorkspaceIdentityMismatchError, type RemoteWorkspaceContext } from "./remote-workspace-selection.js";
import { workspaceMemberRemovalInput } from "./remote-workspace.js";
import type { RemoteCustomerRole } from "./remote-profile.js";

export type LeaveRemoteWorkspace = Readonly<{ expectedRole: RemoteCustomerRole; confirm: true }>;
export type RemoteWorkspaceLeaveResult = { organizationId: string; membershipId: string; removed: true; signInRequired: true };
export class WorkspaceLeaveInputError extends Error {
  constructor() { super("Confirm leaving the exact observed user and membership with its expected role."); this.name = "WorkspaceLeaveInputError"; }
}
export function workspaceLeaveInput(context: RemoteWorkspaceContext, input: LeaveRemoteWorkspace) {
  const target = workspaceContext(context);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "confirm,expectedRole" || input.confirm !== true)
    throw new WorkspaceLeaveInputError();
  const captured = workspaceMemberRemovalInput(target.membershipId, { expectedRole: input.expectedRole });
  return { context: target, input: { expectedRole: captured.body.expectedRole, confirm: true as const },
    body: { membershipId: target.membershipId, expectedRole: captured.body.expectedRole } };
}
export const workspaceLeaveFailures = {
  INVALID_REQUEST: [400, "Provide the exact current membership and expected role."],
  ACCOUNT_UNAVAILABLE: [403, "Account is unavailable."],
  INTERACTIVE_SESSION_REQUIRED: [403, "Fresh interactive sign-in is required to leave a workspace."],
  MEMBERSHIP_ROLE_CHANGED: [409, "Your role changed. Sign in and inspect the workspace before leaving."],
  LAST_OWNER_REQUIRED: [409, "The workspace must retain another active owner."],
  LAST_WORKSPACE_REQUIRED: [409, "Another available workspace is required before leaving."],
  MEMBERSHIP_BUSY: [503, "Membership is busy. Inspect the workspace before another leave action."],
} as const;
export type RemoteWorkspaceLeaveErrorCode = keyof typeof workspaceLeaveFailures;
export class RemoteWorkspaceLeaveError extends Error {
  readonly status: number;
  constructor(readonly code: RemoteWorkspaceLeaveErrorCode) { super(workspaceLeaveFailures[code][1]); this.name = "RemoteWorkspaceLeaveError"; this.status = workspaceLeaveFailures[code][0]; }
}
export class RemoteWorkspaceLeaveUnconfirmedError extends Error {
  readonly code = "WORKSPACE_LEAVE_UNCONFIRMED";
  constructor() { super("The leave outcome is unconfirmed. Sign in again and inspect available memberships before another action. Do not retry automatically; saved credentials are unchanged."); this.name = "RemoteWorkspaceLeaveUnconfirmedError"; }
}
export function workspaceLeaveFailure(value: unknown, status: number): RemoteWorkspaceLeaveErrorCode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && Object.hasOwn(workspaceLeaveFailures, code) && workspaceLeaveFailures[code as RemoteWorkspaceLeaveErrorCode][0] === status ? code as RemoteWorkspaceLeaveErrorCode : null;
}
export function parseWorkspaceLeaveResult(value: unknown, membershipId: string, organizationId: string): RemoteWorkspaceLeaveResult {
  const row = value as Partial<RemoteWorkspaceLeaveResult> | null;
  if (!row || typeof row !== "object" || Array.isArray(row) || row.membershipId !== membershipId || row.organizationId !== organizationId || row.removed !== true || row.signInRequired !== true)
    throw new RemoteWorkspaceLeaveUnconfirmedError();
  return { membershipId, organizationId, removed: true, signInRequired: true };
}

/** A configured profile may constrain an explicit leave, never retarget it. */
export function workspaceLeaveProfileContext(membershipId: string, userId: string | undefined, profile?: RemoteWorkspaceContext): RemoteWorkspaceContext {
  const observed = profile === undefined ? undefined : workspaceContext(profile);
  const target = workspaceContext({ userId: userId ?? observed?.userId, membershipId });
  if (observed && (observed.userId !== target.userId || observed.membershipId !== target.membershipId)) throw new WorkspaceIdentityMismatchError();
  return target;
}
