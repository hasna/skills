import {
  MAX_EXECUTION_GRANT_BYTES,
  executionGrantMatches,
  grantIdentifier,
  grantRecord,
  validateExecutionGrants,
  validateExecutionGrantRequest,
  type ExecutionGrant,
} from "../lib/execution-grants.js";
import { declaredSecretNames } from "../lib/execution-secrets.js";
import { describeEntries } from "../lib/selected-manifest.js";
import { inspectSkillBundle } from "../lib/skill-bundle.js";
import {
  normalizeSkillsApiOrigin,
  skillsApiRequestUrl,
} from "../lib/fleet-credentials.js";
import type { SkillProfile } from "../types/skill-selection.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";
import type { SkillsServerConfig } from "./config.js";
import type { ArtifactStorage } from "./artifact-storage.js";
import { SkillRequestError, readSkillVersionBundle } from "./skills-api.js";

function refuse(status: number, code: string, message: string): never {
  throw new SkillRequestError(status, code, message);
}
function invalid(): never {
  return refuse(
    400,
    "INVALID_EXECUTION_GRANT",
    "Invalid execution grant document or consumer scope."
  );
}
function json(value: unknown, status = 200, revision?: string): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(revision ? { ETag: `"${revision}"` } : {}),
    },
  });
}
async function body(request: Request, limit: number): Promise<unknown> {
  if (!request.body) invalid();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        refuse(
          413,
          "BODY_TOO_LARGE",
          "Execution grant request exceeds its size limit."
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    return invalid();
  }
}
function currentSelection(
  profile: SkillProfile,
  grant: ExecutionGrant["selection"]
) {
  const selected = profile.selections.find((s) => s.slug === grant.slug);
  if (
    !selected ||
    selected.version !== grant.version ||
    selected.bundleDigest !== grant.bundleDigest
  ) {
    refuse(
      409,
      "EXECUTION_SELECTION_MISMATCH",
      "The exact executable version and digest must still be selected in the current profile."
    );
  }
}
/** Read immutable bytes, not a mutable registry manifest or caller-supplied environment declaration. */
async function validatePublishedGrant(
  store: SkillsProductStore,
  artifacts: ArtifactStorage,
  principal: ApiPrincipal,
  grant: ExecutionGrant
) {
  const bundle = await readSkillVersionBundle(
    store,
    artifacts,
    principal,
    grant.selection.slug,
    grant.selection.version
  );
  if (
    `sha256:${bundle.version.bundleSha256}` !== grant.selection.bundleDigest
  ) {
    refuse(
      409,
      "EXECUTION_SELECTION_MISMATCH",
      "Execution grant digest does not match the published version."
    );
  }
  let names: string[];
  try {
    const { entries } = await inspectSkillBundle(bundle.bytes);
    const { kind, manifest } = describeEntries(entries);
    if (kind !== "executable") invalid();
    names = declaredSecretNames(manifest.runtime?.env);
  } catch {
    return invalid();
  }
  if (
    !names.length ||
    names.length !== Object.keys(grant.bindings).length ||
    names.some((name) => !Object.hasOwn(grant.bindings, name))
  )
    invalid();
}
export async function handleExecutionGrantApi(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  request: Request,
  parts: string[],
  config: SkillsServerConfig,
  artifacts: ArtifactStorage
): Promise<Response | null> {
  const [resource, id, child, revision] = parts;
  if (resource !== "execution-grants") return null;
  if (!grantIdentifier(id)) invalid();
  const policies = store.executionGrantStore,
    profiles = store.selectionStore;
  if (!policies || !profiles)
    refuse(
      503,
      "EXECUTION_GRANTS_UNAVAILABLE",
      "This store does not support execution grants."
    );
  const historical =
    parts.length === 4 && child === "versions" && grantIdentifier(revision);
  if (request.method === "GET" && (parts.length === 2 || historical)) {
    const policy = await policies.get(
      principal,
      id,
      historical ? revision : undefined
    );
    if (!policy)
      refuse(
        404,
        "EXECUTION_GRANTS_NOT_FOUND",
        "Execution grant policy not found."
      );
    return json(policy, 200, policy.revision);
  }
  if (request.method === "PUT" && parts.length === 2) {
    const match = request.headers.get("if-match"),
      create = request.headers.get("if-none-match");
    if ((!match && create !== "*") || (match && create)) {
      refuse(
        428,
        "EXECUTION_GRANT_PRECONDITION_REQUIRED",
        "Use If-None-Match: * to create or If-Match with the current policy revision to update."
      );
    }
    const expected = match
      ? /^"([a-zA-Z0-9-]{1,128})"$/.exec(match)?.[1]
      : null;
    if (match && !expected) invalid();
    const input = await body(
      request,
      Math.min(config.requestBodyLimitBytes, MAX_EXECUTION_GRANT_BYTES)
    );
    if (
      !grantRecord(input) ||
      Object.keys(input).length !== 1 ||
      !Object.hasOwn(input, "grants")
    )
      invalid();
    let grants: ExecutionGrant[];
    try {
      grants = validateExecutionGrants(input.grants);
    } catch {
      return invalid();
    }
    const profile = await profiles.getProfile(principal, id);
    if (!profile) refuse(404, "PROFILE_NOT_FOUND", "Profile not found.");
    for (const grant of grants) {
      currentSelection(profile, grant.selection);
      await validatePublishedGrant(store, artifacts, principal, grant);
    }
    if (
      (await profiles.getProfile(principal, id))?.revision !== profile.revision
    ) {
      refuse(
        409,
        "PROFILE_REVISION_CONFLICT",
        "Profile changed while validating grants; resolve it again."
      );
    }
    const saved = await policies.save(principal, id, grants, expected ?? null);
    if (!saved)
      refuse(
        409,
        "EXECUTION_GRANT_REVISION_CONFLICT",
        "Execution grant policy changed; read it before retrying."
      );
    return json(saved, create ? 201 : 200, saved.revision);
  }
  if (request.method === "POST" && parts.length === 3 && child === "resolve") {
    const input = await body(
      request,
      Math.min(config.requestBodyLimitBytes, 16_384)
    );
    let consumer;
    try {
      consumer = validateExecutionGrantRequest(input);
    } catch {
      return invalid();
    }
    const authority = skillsApiRequestUrl(
      normalizeSkillsApiOrigin(config.publicBaseUrl),
      "/api/v1/"
    ).replace(/\/+$/, "");
    if (
      consumer.selection.authority !== authority ||
      consumer.selection.workspaceId !== principal.orgId ||
      consumer.selection.profileId !== id
    ) {
      refuse(
        403,
        "EXECUTION_GRANT_SCOPE_MISMATCH",
        "The requested execution authority, workspace or profile does not match this request."
      );
    }
    const profile = await profiles.getProfile(principal, id);
    if (!profile) refuse(404, "PROFILE_NOT_FOUND", "Profile not found.");
    if (profile.revision !== consumer.selection.profileRevision)
      refuse(
        409,
        "PROFILE_REVISION_CONFLICT",
        "Resolve the current profile before requesting execution grants."
      );
    currentSelection(profile, consumer.selection);
    const policy = await policies.get(principal, id);
    const matches =
      policy?.grants.filter((grant) =>
        executionGrantMatches(grant, consumer, principal.userId)
      ) ?? [];
    if (matches.length !== 1)
      refuse(
        403,
        "EXECUTION_GRANT_DENIED",
        "No unique current execution grant permits this actor, executable and consumer."
      );
    const grant = matches[0]!;
    await validatePublishedGrant(store, artifacts, principal, grant);
    // Bundle reads can yield to policy/profile writes. Refuse a stale decision.
    if (
      (await profiles.getProfile(principal, id))?.revision !==
        profile.revision ||
      (await policies.get(principal, id))?.revision !== policy!.revision ||
      !executionGrantMatches(grant, consumer, principal.userId)
    ) {
      refuse(
        409,
        "EXECUTION_GRANT_REVISION_CONFLICT",
        "Execution authorization changed; resolve it again."
      );
    }
    return json({
      policyRevision: policy!.revision,
      grantId: grant.id,
      bindings: {
        schema: "hasna.skills-secret-bindings.v1",
        ...consumer,
        secretsAuthority: grant.secretsAuthority,
        bindings: grant.bindings,
      },
    });
  }
  return null;
}
