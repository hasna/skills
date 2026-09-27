/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure a Skills authority, and if not, did the operator ask
 * for the on-box local run?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the SDK all
 * have to answer identically — a second spelling is a second thing that can
 * drift — and because the resolver seam (`lib/fleet-credentials.ts`) must be
 * able to ask without pulling any other machinery into the answer. Its only
 * import is the env-key derivation from @hasna/contracts, so the NAMES it
 * looks for are the resolver's own rather than a copy that can fall behind.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * opt-in: a run with `HASNA_SKILLS_API_KEY` set goes hosted, and a
 * half-configured one fails loudly, rather than quietly serving the bundled
 * corpus because a stale `HASNA_SKILLS_LOCAL` was lying around. But when the
 * environment configures nothing, the opt-in is answered WITHOUT calling the
 * resolver — no Keychain item and no credential file is read — which is what
 * lets a scrubbed test environment still promise that it physically cannot
 * reach a real credential store, now that a credential can arrive from
 * somewhere an env dictionary cannot blank.
 *
 * Fail-closed ruling (owner directive 2026-09-04, hasna/apps#1720; class-patch
 * order, 2026-09-06): hosted mode with no credential exits non-zero with no
 * SQLite and no local-fallback event. The on-machine run is reachable ONLY
 * through this deliberate opt-in, not by the absence of a credential.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";

/** The deliberate unhosted opt-in, canonical name first. */
export const SKILLS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_SKILLS_LOCAL", "SKILLS_LOCAL"] as const;

export type SkillsLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator deliberately asked for the unhosted on-machine run. */
export function isSkillsLocalOptIn(env: SkillsLocalOptInEnv = process.env): boolean {
  return SKILLS_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a Skills authority or credential, resolver-derived. */
export function skillsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("skills");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("skills"),
    credentialPointerEnvKey("skills"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a Skills authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the opt-in short-circuit exists to provide. It reads the env
 * dictionary and nothing else.
 *
 * A DECLARED-BUT-BLANK variable counts as absent HERE — a blank has always been
 * this package's spelling for "not configured", and helpers in the wild blank
 * rather than delete. It is NOT absent once we do go hosted: the resolver
 * refuses a blank loudly rather than falling through to another identity, which
 * is the behaviour that matters at that point.
 */
export function hasSkillsEnvAuthorityIntent(env: SkillsLocalOptInEnv = process.env): boolean {
  return skillsAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when this environment should be served by the on-box local run. */
export function selectsSkillsLocalMode(env: SkillsLocalOptInEnv = process.env): boolean {
  return !hasSkillsEnvAuthorityIntent(env) && isSkillsLocalOptIn(env);
}