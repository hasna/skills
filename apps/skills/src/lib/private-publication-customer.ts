import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { RemotePrivatePublicationsClient, PrivatePublicationError, publicationUuid } from "./remote-private-publications.js";
import { prepareProfileWorkspace } from "./workspace-profile.js";
import { selectedSkillsProfile } from "./instance-credentials.js";
import type { RemoteWorkspaceContext } from "./remote-workspace-selection.js";

/** Capture before code input, so a later profile/origin change cannot retarget consent. */
export function preparePrivatePublicationSession(requested?: RemoteWorkspaceContext) {
  const selectors = ["HASNA_PROFILE", "HASNA_HOME", "HASNA_CONFIG_HOME", "HASNA_STATION", "HASNA_SKILLS_API_URL", "SKILLS_API_URL",
    "HASNA_SKILLS_API_KEY_OVERRIDE", "HASNA_SKILLS_API_KEY_REF", "HASNA_SKILLS_API_KEY", "SKILLS_API_KEY"] as const;
  const before = new Map(selectors.map(key => [key, process.env[key]]));
  const profile = selectedSkillsProfile(process.env), pending = prepareProfileWorkspace("Manage private publications");
  const captured = requested ? { ...requested } : undefined;
  const unchanged = () => {
    if (selectors.some(key => process.env[key] !== before.get(key)) || selectedSkillsProfile(process.env) !== profile)
      throw new PrivatePublicationError("PUBLICATION_TARGET_CHANGED", "The selected profile or server changed during verification. Start again with a stable target; no skill action was sent.");
  };
  return { origin: pending.origin, async verify(email: string, code: string): Promise<RemotePrivatePublicationsClient> {
    unchanged();
    const target = await pending.resolve();
    const context = captured ?? target.context;
    if (!context || !publicationUuid(context.userId) || !publicationUuid(context.membershipId)
      || (target.context && (context.userId !== target.context.userId || context.membershipId !== target.context.membershipId)))
      throw new PrivatePublicationError("PUBLICATION_CONTEXT_REQUIRED", "Provide the observed user and membership IDs, or select an enrolled workspace profile.");
    unchanged(); target.unchanged();
    const client = await new RemoteSkillsAuthClient(target.origin).openPrivatePublications(email, code, context);
    unchanged(); target.unchanged();
    return client;
  } };
}
/** Neither the session nor a signed upload capability is saved to host credentials. */
export async function privatePublicationSession(email: string, code: string, requested?: RemoteWorkspaceContext): Promise<RemotePrivatePublicationsClient> {
  return preparePrivatePublicationSession(requested).verify(email, code);
}
export function privatePublicationCustomerError(error: unknown): { error: string; code: string; uncertain: boolean } {
  return error instanceof PrivatePublicationError
    ? { error: error.message, code: error.code, uncertain: error.uncertain }
    : { error: "The publication action could not be confirmed. Preserve the recovery directory and inspect the same intent; credentials were not changed.", code: "PUBLICATION_ACTION_UNCONFIRMED", uncertain: true };
}
