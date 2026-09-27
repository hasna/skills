/**
 * run-routing.ts — where a skill run executes: on this machine, or on the
 * configured Skills API.
 *
 * One resolver serves every run surface (the CLI `skills run` path, the MCP
 * `run_skill` tool, and the `skills schedule run` surface) so they cannot drift
 * apart.
 *
 * A skill run is REMOTE only when all three hold:
 *
 *   1. a credential resolves on the fleet ladder (an argument, an env pointer,
 *      the macOS Keychain, `~/.hasna/skills/config/credentials`, or
 *      `$HASNA_SKILLS_API_KEY`) — see lib/fleet-credentials.ts;
 *   2. an authority follows from it (`$HASNA_SKILLS_API_URL`, the Keychain
 *      `api-url` item, the credentials file, else the fleet gateway);
 *   3. the skill carries the server-owned marker from its published contract
 *      (`skills.runtime: "hosted"` or `skills.source: "remote" |
 *      "private-hosted"` in the skill's `package.json` — see
 *      isHostedMetadataPackage in hosted-skill-set.ts).
 *
 * Otherwise the run is LOCAL, and local stays the default: an unconfigured
 * install never sends anything anywhere.
 *
 * A server-owned skill never falls back to local execution. Without the origin
 * or the credential the resolver fails closed with an error naming the exact
 * setup command, per the product brief: "Premium or server-executed skills
 * fail closed without API credentials and do not fall back to bundled local
 * execution."
 *
 * Premium-catalog and pricing metadata is server-side and never ships in this
 * package; the resolver concerns routing only.
 */

import type { SkillMeta } from "./registry-types.js";
import { resolveSkillsConnection, SkillsFleetCredentialError } from "./fleet-credentials.js";

export type RunRoutingErrorCode = "REMOTE_REQUIRES_ORIGIN" | "REMOTE_REQUIRES_CREDENTIAL";

export type RunRouting =
  | { route: "remote"; apiKey: string; apiOrigin: string }
  | { route: "local" }
  | { route: "error"; code: RunRoutingErrorCode; error: string };

/**
 * Is execution of this skill server-owned per its published contract?
 * The marker is the skill contract's declaration; absent means local
 * execution is the contract.
 */
export function isServerOwnedSkill(skill: Pick<SkillMeta, "serverOwned">): boolean {
  return skill.serverOwned === true;
}

/**
 * Decide the route for one skill run from injectable inputs, so tests can mock
 * the origin and the credential without touching the ambient environment.
 */
export function resolveRunRouting(
  skill: Pick<SkillMeta, "name" | "serverOwned">,
  apiKey: string | null | undefined,
  apiUrl: string | undefined,
): RunRouting {
  if (!isServerOwnedSkill(skill)) return { route: "local" };
  if (!apiUrl) {
    return {
      route: "error",
      code: "REMOTE_REQUIRES_ORIGIN",
      error:
        `${skill.name} is a server-owned skill. Point the CLI at a Skills API: ` +
        `skills setup --api-url <url> (or export HASNA_SKILLS_API_URL)`,
    };
  }
  if (!apiKey) {
    return {
      route: "error",
      code: "REMOTE_REQUIRES_CREDENTIAL",
      error: `${skill.name} is a server-owned skill. Run: skills auth login`,
    };
  }
  return { route: "remote", apiKey, apiOrigin: apiUrl };
}

/**
 * Resolve the route against the ambient configuration and credential store.
 * The returned `apiKey` on the remote route is the same value the resolver
 * validated, so the caller never re-reads (and cannot diverge from) the
 * credential the decision was made with.
 */
export async function resolveConfiguredRunRouting(
  skill: Pick<SkillMeta, "name" | "serverOwned">,
  env: Record<string, string | undefined> = process.env,
): Promise<RunRouting> {
  let connection;
  try {
    connection = await resolveSkillsConnection(env);
  } catch (error) {
    // The fail-closed refusal: no credential resolved and no authority is
    // configured without the local opt-in. The shared ladder is right to throw —
    // the alternative is running a server-owned skill locally, or running ANY
    // skill while pretending an unconfigured machine chose local mode — but a
    // scheduled run reports per-skill results, so the refusal is carried as this
    // resolver's own structured error rather than as an exception that aborts
    // the whole batch. A local route is never produced here.
    const isMissingCredential =
      isSkillsFleetCredentialError(error) &&
      (error as SkillsFleetCredentialError).code === "MISSING_API_CREDENTIAL";
    // A malformed authority is a different fault and is not this resolver's to
    // reshape: it propagates.
    if (!isMissingCredential) throw error;
    return {
      route: "error",
      code: "REMOTE_REQUIRES_CREDENTIAL",
      error: skill.serverOwned
        ? `${skill.name} is a server-owned skill. ${(error as Error).message}`
        : `${skill.name} cannot run: ${(error as Error).message}`,
    };
  }
  return resolveRunRouting(skill, connection?.apiKey, connection?.apiOrigin);
}

/** True for this package's own refusal, across bundle boundaries. */
function isSkillsFleetCredentialError(error: unknown): boolean {
  return (
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "SkillsFleetCredentialError")
  );
}
