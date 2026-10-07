import pkg from "../../package.json" with { type: "json" };
import {
  normalizeSkillsApiOrigin,
  skillsApiRequestUrl,
} from "../lib/fleet-credentials.js";
import { isValidSkillVersion } from "../lib/skill-version.js";
import type {
  SkillSelection,
  ResolvedSkillProfile,
  StationSkillStateInput,
} from "../types/skill-selection.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";
import type { SkillsServerConfig } from "./config.js";
import { SkillRequestError, assertPublishableSlug } from "./skills-api.js";
import { permitsSkillsRoute } from "./auth.js";
import { selectionAliasError } from "../lib/selection-aliases.js";
import { MAX_PROFILE_SELECTIONS, MAX_PROFILE_DOCUMENT_BYTES, MAX_RESOLVED_PROFILE_BYTES, profileDocumentBytes, resolvedProfileSnapshot } from "../lib/profile-limits.js";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !value.includes("..");
}
function invalid(message: string): never {
  throw new SkillRequestError(400, "INVALID_SELECTION", message);
}
function selected(value: unknown): SkillSelection[] {
  if (!Array.isArray(value) || value.length > MAX_PROFILE_SELECTIONS)
    invalid(`selections must be an array with at most ${MAX_PROFILE_SELECTIONS} entries`);
  const seen = new Set<string>();
  const selections = value
    .map((item) => {
      if (
        !object(item) ||
        typeof item.slug !== "string" ||
        !isValidSkillVersion(item.version) ||
        typeof item.bundleDigest !== "string" ||
        !DIGEST.test(item.bundleDigest)
      )
        invalid(
          "Each selection requires slug, exact version, and sha256 bundleDigest",
        );
      assertPublishableSlug(item.slug);
      if (seen.has(item.slug))
        invalid("A profile may select each skill only once");
      seen.add(item.slug);
      let triggers: SkillSelection["triggers"];
      if (item.triggers !== undefined) {
        if (
          !object(item.triggers) ||
          Object.keys(item.triggers).some(
            (key) => !["keywords", "paths", "always"].includes(key),
          )
        )
          invalid("Invalid selection triggers");
        triggers = {};
        for (const key of ["keywords", "paths"] as const) {
          const terms = item.triggers[key];
          if (terms !== undefined) {
            if (
              !Array.isArray(terms) ||
              terms.length > 32 ||
              terms.some(
                (term) =>
                  typeof term !== "string" || !term.trim() || term.length > 256,
              )
            )
              invalid("Trigger terms must be bounded nonempty strings");
            triggers[key] = terms as string[];
          }
        }
        if (item.triggers.always !== undefined) {
          if (typeof item.triggers.always !== "boolean")
            invalid("always must be boolean");
          triggers.always = item.triggers.always;
        }
      }
      return {
        slug: item.slug,
        version: item.version as string,
        bundleDigest: item.bundleDigest,
        ...(item.aliases !== undefined ? { aliases: item.aliases as string[] } : {}),
        ...(triggers ? { triggers } : {}),
      };
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const aliasError = selectionAliasError(selections);
  if (aliasError) invalid(aliasError);
  return selections;
}
async function validatePublished(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  selections: SkillSelection[],
) {
  const states = await store.getPublishedSelectionStates(principal, selections);
  if (states.length !== selections.length)
    throw new SkillRequestError(503, "SELECTION_UNAVAILABLE", "Selected publication state is unavailable");
  for (const [index, selection] of selections.entries()) {
    const state = states[index];
    // A malformed custom-store result must not validate a different selection.
    if (!state || state.slug !== selection.slug || state.version !== selection.version)
      throw new SkillRequestError(503, "SELECTION_UNAVAILABLE", "Selected publication state is unavailable");
    const current = state.current;
    if (!current || current.tombstonedAt)
      throw new SkillRequestError(
        current?.tombstonedAt ? 410 : 404,
        "SELECTION_UNAVAILABLE",
        `Selected skill '${selection.slug}' is unavailable`,
      );
    if (current.lifecycle === "archived") throw new SkillRequestError(409, "SELECTION_ARCHIVED", `Selected skill '${selection.slug}' is archived`);
    if (!state.versionBundleSha256 || `sha256:${state.versionBundleSha256}` !== selection.bundleDigest)
      throw new SkillRequestError(
        409,
        "SELECTION_VERSION_MISMATCH",
        `Selected version of '${selection.slug}' does not match its published digest`,
      );
    if (!state.bundleAvailable)
      throw new SkillRequestError(
        503,
        "SELECTION_BUNDLE_UNAVAILABLE",
        "Selected bundle is unavailable",
      );
  }
  return states;
}
async function body(
  request: Request,
  limit: number,
): Promise<Record<string, unknown>> {
  if (!request.body) invalid("JSON body required");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SkillRequestError(
          413,
          "BODY_TOO_LARGE",
          "Request body too large",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    invalid("Malformed JSON body");
  }
  if (!object(parsed)) invalid("JSON object required");
  return parsed;
}
function json(value: unknown, status = 200, revision?: string) {
  if (profileDocumentBytes(value) > MAX_PROFILE_DOCUMENT_BYTES) throw new SkillRequestError(413, "PROFILE_TOO_LARGE", "Profile document exceeds its size limit");
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(revision ? { ETag: `"${revision}"` } : {}),
    },
  });
}
export async function handleProfileApi(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  request: Request,
  parts: string[],
  config: SkillsServerConfig,
): Promise<Response | null> {
  const [resource, id, child] = parts;
  if (
    resource === "capabilities" &&
    request.method === "GET" &&
    parts.length === 1
  )
    return json({
      contractVersion: 1,
      apiVersion: 1,
      service: "skills",
      version: pkg.version,
      capabilities: [
        "skills.registry",
        "skills.versions",
        "skills.session-pin-renewal",
        ...(store.selectionStore && store.executionGrantStore ? ["skills.execution-grants"] : []),
        ...(store.selectionStore
          ? ["skills.profiles", "skills.station-state"]
          : []),
      ],
      executionGrants: Boolean(store.selectionStore && store.executionGrantStore),
      profileResolution: Boolean(store.selectionStore),
      selectionAliases: Boolean(store.selectionStore),
      profileLimits: {
        maxSelections: MAX_PROFILE_SELECTIONS,
        maxDocumentBytes: MAX_PROFILE_DOCUMENT_BYTES,
        maxResolvedProfileBytes: MAX_RESOLVED_PROFILE_BYTES,
        requestBodyLimitBytes: Math.min(config.requestBodyLimitBytes, MAX_PROFILE_DOCUMENT_BYTES),
      },
      immutableVersions: true,
      stationState: Boolean(store.selectionStore),
      incrementalSync: false,
      scopes: [...principal.scopes].sort(),
      permissions: {
        executionGrantsRead: permitsSkillsRoute(principal, "GET", "execution-grants"),
        executionGrantsWrite: permitsSkillsRoute(principal, "PUT", "execution-grants"),
        executionGrantsResolve: permitsSkillsRoute(principal, "POST", "execution-grants"),
        read: permitsSkillsRoute(principal, "GET", "skills"),
        publish: permitsSkillsRoute(principal, "POST", "skills"),
        profilesWrite: permitsSkillsRoute(principal, "PUT", "profiles"),
        stationStateWrite: permitsSkillsRoute(principal, "PUT", "stations"),
        cloudSubmit: permitsSkillsRoute(principal, "POST", "executions"),
      },
    });
  if (resource !== "profiles" && resource !== "stations") return null;
  if (!id || !identifier(id))
    throw new SkillRequestError(
      400,
      "INVALID_ID",
      "A path-safe identifier is required",
    );
  const adapter = store.selectionStore;
  if (!adapter)
    throw new SkillRequestError(
      503,
      "PROFILES_UNAVAILABLE",
      "This store does not support profiles",
    );
  if (
    resource === "profiles" &&
    parts.length === 2 &&
    request.method === "PUT"
  ) {
    const input = await body(request, Math.min(config.requestBodyLimitBytes, MAX_PROFILE_DOCUMENT_BYTES)),
      selections = selected(input.selections);
    const match = request.headers.get("if-match"),
      create = request.headers.get("if-none-match");
    if ((!match && create !== "*") || (match && create))
      throw new SkillRequestError(
        428,
        "PROFILE_PRECONDITION_REQUIRED",
        "Use If-None-Match: * to create or If-Match with the current revision to update",
      );
    const expected = match
      ? /^"([a-zA-Z0-9-]{1,128})"$/.exec(match)?.[1]
      : null;
    if (match && !expected)
      throw new SkillRequestError(
        400,
        "INVALID_PRECONDITION",
        "A quoted revision ETag is required",
      );
    // Admission must fit the resolved profile, full session envelope and station
    // submission, not only the smaller profile PUT. Reserve a maximum revision
    // identifier before the store generates its actual revision, so refusal never
    // happens after persisting an unusable candidate.
    const authority = skillsApiRequestUrl(normalizeSkillsApiOrigin(config.publicBaseUrl), "/api/v1/").replace(/\/+$/, "");
    const revision = "x".repeat(128);
    const projected = resolvedProfileSnapshot({ id, workspaceId: principal.orgId, revision, selections }, authority);
    projected.selections = projected.selections.map(selection => ({ ...selection, authorizationEpoch: "0".repeat(32) }));
    if (profileDocumentBytes(projected) > MAX_RESOLVED_PROFILE_BYTES
        || profileDocumentBytes({ profileId: id, profileRevision: revision, selections }) > Math.min(config.requestBodyLimitBytes, MAX_PROFILE_DOCUMENT_BYTES)) {
      throw new SkillRequestError(413, "PROFILE_TOO_LARGE", "The complete resolved profile and station/session receipts must fit the advertised profile limits");
    }
    await validatePublished(store, principal, selections);
    const saved = await adapter.saveProfile(
      principal,
      id,
      selections,
      expected ?? null,
    );
    if (!saved)
      throw new SkillRequestError(
        409,
        "PROFILE_REVISION_CONFLICT",
        "Profile changed; read it before retrying",
      );
    return json(saved, create ? 201 : 200, saved.revision);
  }
  if (
    resource === "profiles" &&
    request.method === "GET" &&
    (parts.length === 2 || (parts.length === 3 && child === "resolve"))
  ) {
    const profile = await adapter.getProfile(principal, id);
    if (!profile)
      throw new SkillRequestError(
        404,
        "PROFILE_NOT_FOUND",
        "Profile not found",
      );
    if (profile.selections.length > MAX_PROFILE_SELECTIONS) throw new SkillRequestError(413, "PROFILE_TOO_LARGE", "Profile exceeds the advertised selection limit");
    if (!child) return json(profile, 200, profile.revision);
    const authority = skillsApiRequestUrl(
      normalizeSkillsApiOrigin(config.publicBaseUrl),
      "/api/v1/",
    ).replace(/\/+$/, "");
    const result: ResolvedSkillProfile = resolvedProfileSnapshot(profile, authority);
    if (result.selections.length > MAX_PROFILE_SELECTIONS || profileDocumentBytes(result) > MAX_RESOLVED_PROFILE_BYTES) throw new SkillRequestError(413, "PROFILE_TOO_LARGE", "Resolved profile exceeds the advertised profile limits");
    const states = await validatePublished(store, principal, profile.selections);
    result.selections = result.selections.map((selection, index) => {
      const epoch = states[index]!.current?.authorizationEpoch;
      if (!epoch || !/^[a-f0-9]{32}$/.test(epoch)) throw new SkillRequestError(503, "PIN_AUTHORIZATION_UNAVAILABLE", "The selection lifecycle fence is unavailable");
      return { ...selection, authorizationEpoch: epoch };
    });
    if (profileDocumentBytes(result) > MAX_RESOLVED_PROFILE_BYTES) throw new SkillRequestError(413, "PROFILE_TOO_LARGE", "Resolved profile exceeds the advertised profile limits");
    return json(result, 200, profile.revision);
  }
  if (resource === "stations" && parts.length === 3 && child === "state") {
    if (request.method === "GET") {
      const state = await adapter.getStationState(principal, id);
      if (!state)
        throw new SkillRequestError(
          404,
          "STATION_STATE_NOT_FOUND",
          "No station state reported",
        );
      return json(state);
    }
    if (request.method === "PUT") {
      const input = await body(request, Math.min(config.requestBodyLimitBytes, MAX_PROFILE_DOCUMENT_BYTES));
      if (!identifier(input.profileId) || !identifier(input.profileRevision))
        invalid("profileId and profileRevision are required");
      const receipt: StationSkillStateInput = {
        profileId: input.profileId,
        profileRevision: input.profileRevision,
        selections: selected(input.selections),
      };
      const profile = await adapter.getProfile(principal, receipt.profileId);
      if (!profile || profile.revision !== receipt.profileRevision)
        throw new SkillRequestError(
          409,
          "PROFILE_REVISION_CONFLICT",
          "Resolve the current profile before reporting state",
        );
      if (
        JSON.stringify(profile.selections) !==
        JSON.stringify(receipt.selections)
      )
        throw new SkillRequestError(
          409,
          "STATION_SELECTION_MISMATCH",
          "Applied selections must match the complete resolved profile",
        );
      await validatePublished(store, principal, receipt.selections);
      const saved = await adapter.saveStationState(principal, id, receipt);
      if (!saved)
        throw new SkillRequestError(
          409,
          "PROFILE_REVISION_CONFLICT",
          "Profile changed while reporting state",
        );
      return json(saved);
    }
  }
  return null;
}
