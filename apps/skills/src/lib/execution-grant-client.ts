import { isDeepStrictEqual } from "node:util";
import {
  resolveSkillsConnection,
  skillsApiRequestUrl,
} from "./fleet-credentials.js";
import { readBoundedResponse } from "./remote-files.js";
import { SkillSelectionError } from "./selection-cache.js";
import {
  MAX_EXECUTION_GRANT_BYTES,
  grantIdentifier,
  grantRecord,
  validateExecutionGrants,
  validateExecutionGrantPolicy,
  validateExecutionGrantRequest,
  type ExecutionGrant,
  type ExecutionGrantPolicy,
  type ExecutionGrantRequest,
  type ResolvedExecutionGrant,
} from "./execution-grants.js";

function id(value: string): string {
  if (!grantIdentifier(value))
    throw new Error("Invalid execution grant profile or revision identifier.");
  return encodeURIComponent(value);
}
async function request(
  path: string,
  init: RequestInit = {},
  authority?: string
): Promise<unknown> {
  try {
    const connection = await resolveSkillsConnection();
    if (!connection) throw new Error();
    const configured = skillsApiRequestUrl(
      connection.apiOrigin,
      "/api/v1/"
    ).replace(/\/+$/, "");
    // Never transmit the Skills credential to an authority supplied by a bundle or response.
    if (authority !== undefined && authority !== configured) throw new Error();
    const response = await fetch(
      skillsApiRequestUrl(connection.apiOrigin, `/api/v1${path}`),
      {
        ...init,
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hasna-skills",
          Authorization: `Bearer ${connection.apiKey}`,
          ...init.headers,
        },
      }
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new SkillSelectionError(
        "EXECUTION_GRANT_UNAVAILABLE",
        `Skills execution grant request failed (HTTP ${response.status}); no fallback was attempted.`
      );
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readBoundedResponse(response, MAX_EXECUTION_GRANT_BYTES)
      )
    );
  } catch (error) {
    if (error instanceof SkillSelectionError) throw error;
    throw new SkillSelectionError(
      "EXECUTION_GRANT_UNAVAILABLE",
      "The configured Skills execution grant service could not be reached or returned an invalid response; no fallback was attempted."
    );
  }
}
export async function readExecutionGrantPolicy(
  profileId: string,
  revision?: string
): Promise<ExecutionGrantPolicy> {
  const policy = validateExecutionGrantPolicy(
    await request(
      `/execution-grants/${id(profileId)}${
        revision === undefined ? "" : `/versions/${id(revision)}`
      }`
    )
  );
  if (
    policy.profileId !== profileId ||
    (revision !== undefined && policy.revision !== revision)
  )
    throw new Error("Execution grant policy response scope mismatch.");
  return policy;
}
export async function saveExecutionGrantPolicy(
  profileId: string,
  grants: ExecutionGrant[],
  revision?: string
): Promise<ExecutionGrantPolicy> {
  const snapshot = validateExecutionGrants(grants);
  if (revision !== undefined) id(revision);
  const policy = validateExecutionGrantPolicy(
    await request(`/execution-grants/${id(profileId)}`, {
      method: "PUT",
      headers:
        revision === undefined
          ? { "If-None-Match": "*" }
          : { "If-Match": `"${revision}"` },
      body: JSON.stringify({ grants: snapshot }),
    })
  );
  if (
    policy.profileId !== profileId ||
    policy.previousRevision !== (revision ?? null) ||
    !isDeepStrictEqual(policy.grants, snapshot)
  ) {
    throw new Error(
      "The API did not preserve the reviewed execution grant policy; read it before retrying."
    );
  }
  return policy;
}
/** No disk cache: every execution obtains a current decision from its configured Skills authority. */
export async function resolveExecutionGrant(
  input: ExecutionGrantRequest
): Promise<ResolvedExecutionGrant> {
  const snapshot = validateExecutionGrantRequest(input);
  const value = await request(
    `/execution-grants/${id(snapshot.selection.profileId)}/resolve`,
    { method: "POST", body: JSON.stringify(snapshot) },
    snapshot.selection.authority
  );
  if (
    !grantRecord(value) ||
    Object.keys(value).length !== 3 ||
    !grantIdentifier(value.policyRevision) ||
    !grantIdentifier(value.grantId) ||
    !grantRecord(value.bindings)
  ) {
    throw new SkillSelectionError(
      "INVALID_EXECUTION_GRANT",
      "The Skills API returned an invalid execution grant."
    );
  }
  // Execution also checks the complete binding schema, exact consumer and declared environment names.
  if (
    !isDeepStrictEqual(value.bindings.selection, snapshot.selection) ||
    !isDeepStrictEqual(value.bindings.consumer, snapshot.consumer)
  ) {
    throw new SkillSelectionError(
      "EXECUTION_GRANT_SCOPE_MISMATCH",
      "The Skills API returned a grant for a different selection or consumer."
    );
  }
  return value as unknown as ResolvedExecutionGrant;
}
