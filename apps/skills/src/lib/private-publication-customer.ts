import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { RemotePrivatePublicationsClient, PrivatePublicationError, publicationUuid } from "./remote-private-publications.js";
import { captureProfileWorkspace } from "./workspace-profile.js";
import type { RemoteWorkspaceContext } from "./remote-workspace-selection.js";

/** Capture host profile before fresh verification. Neither the session nor a
 * signed upload capability is written to the host's credentials. */
export async function privatePublicationSession(email: string, code: string, requested?: RemoteWorkspaceContext): Promise<RemotePrivatePublicationsClient> {
  const target = await captureProfileWorkspace("Manage private publications");
  const context = requested ?? target.context;
  if (!context || !publicationUuid(context.userId) || !publicationUuid(context.membershipId)
    || (target.context && (context.userId !== target.context.userId || context.membershipId !== target.context.membershipId)))
    throw new PrivatePublicationError("PUBLICATION_CONTEXT_REQUIRED", "Provide the observed user and membership IDs, or select an enrolled workspace profile.");
  target.unchanged();
  const client = await new RemoteSkillsAuthClient(target.origin).openPrivatePublications(email, code, context);
  target.unchanged();
  return client;
}
export function privatePublicationCustomerError(error: unknown): { error: string; code: string; uncertain: boolean } {
  return error instanceof PrivatePublicationError
    ? { error: error.message, code: error.code, uncertain: error.uncertain }
    : { error: "The publication action could not be confirmed. Preserve the recovery directory and inspect the same intent; credentials were not changed.", code: "PUBLICATION_ACTION_UNCONFIRMED", uncertain: true };
}
