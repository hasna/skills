import type { RemoteSkillsAuthClient } from "./remote-auth.js";
import { workspaceContext, WorkspaceIdentityMismatchError, type RemoteWorkspaceContext } from "./remote-workspace-selection.js";
import { invitationInput, type InvitationAction, type InvitationInputs, type InvitationResults,
  WorkspaceInvitationInputError, RemoteWorkspaceInvitationError, RemoteWorkspaceInvitationUnconfirmedError, RemoteWorkspaceInvitationReadError } from "./remote-invitations.js";

/** A saved profile constrains explicit input; it never silently supplies another target. */
export function invitationProfileContext(userId: string, membershipId: string, profile?: RemoteWorkspaceContext) {
  const target = workspaceContext({ userId, membershipId });
  if (profile && (profile.userId !== target.userId || profile.membershipId !== target.membershipId)) throw new WorkspaceIdentityMismatchError();
  return target;
}
/** Surface adapters share this dispatch; the remote client owns validation and transport. */
export async function invokeFreshInvitation<A extends InvitationAction>(client: RemoteSkillsAuthClient, email: string, code: string, context: RemoteWorkspaceContext, action: A, input: InvitationInputs[A]): Promise<InvitationResults[A]> {
  const target = workspaceContext(context), captured = invitationInput(action, input);
  let result: InvitationResults[InvitationAction];
  switch (action) {
    case "list": result = await client.listWorkspaceInvitations(email, code, target, captured as InvitationInputs["list"]); break;
    case "get": result = await client.getWorkspaceInvitation(email, code, target, (captured as InvitationInputs["get"]).invitationId); break;
    case "issue": result = await client.issueWorkspaceInvitation(email, code, target, captured as InvitationInputs["issue"]); break;
    case "resend": { const { invitationId, ...options } = captured as InvitationInputs["resend"]; result = await client.resendWorkspaceInvitation(email, code, target, invitationId, options); break; }
    case "revoke": { const { invitationId, ...options } = captured as InvitationInputs["revoke"]; result = await client.revokeWorkspaceInvitation(email, code, target, invitationId, options); break; }
    case "accept": { const { invitationId, ...options } = captured as InvitationInputs["accept"]; result = await client.acceptWorkspaceInvitation(email, code, target, invitationId, options); break; }
    default: throw new WorkspaceInvitationInputError();
  }
  return result as InvitationResults[A];
}
export function invitationCustomerError(error: unknown) {
  if (error instanceof WorkspaceInvitationInputError || error instanceof RemoteWorkspaceInvitationError || error instanceof RemoteWorkspaceInvitationUnconfirmedError || error instanceof RemoteWorkspaceInvitationReadError)
    return { code: error.code, error: error.message };
  return { code: "INVITATION_VERIFICATION_FAILED", error: "Invitation verification failed. Check the selected server, profile, exact user and current membership, then obtain a fresh code. No invitation result was confirmed; saved credentials are unchanged." };
}
