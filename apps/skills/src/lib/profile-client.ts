import pkg from "../../package.json" with { type: "json" };
import {
  resolveSkillsConnection,
  normalizeSkillsApiOrigin,
  skillsApiRequestUrl,
} from "./fleet-credentials.js";
import { readBoundedResponse } from "./remote-files.js";
import { selectionAliasError, selectionSnapshotsEqual } from "./selection-aliases.js";
import { MAX_PROFILE_SELECTIONS, MAX_PROFILE_DOCUMENT_BYTES, MAX_RESOLVED_PROFILE_BYTES, profileDocumentBytes, profileSelectionSnapshot, requiresProfileCapacity, assertAdvertisedProfileCapacity } from "./profile-limits.js";
import type {
  ResolvedSkillProfile,
  SkillSelection,
  StationSkillState,
  StationSkillStateInput,
} from "../types/skill-selection.js";

export interface ProfileClient {
  readonly authority: string;
  /** Stable whoami subject; raw credential/key identities are intentionally excluded. */
  resolvePrincipal?(): Promise<AuthenticatedProfilePrincipal>;
  resolveProfile(id: string): Promise<ResolvedSkillProfile>;
  recordStation(
    id: string,
    state: StationSkillStateInput,
  ): Promise<StationSkillState>;
  getBundle(slug: string, version: string): Promise<Response | null>;
}
export type AuthenticatedProfileRole = "owner" | "admin" | "member" | "viewer";
export interface AuthenticatedProfilePrincipal {
  userId: string;
  accountId: string;
  role: AuthenticatedProfileRole;
}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) &&
    !value.includes("..")
  );
}
function invalid(): never {
  throw new Error("The Skills API returned an invalid profile response");
}
function validateSelection(value: unknown): asserts value is SkillSelection {
  if (
    !object(value) ||
    !identifier(value.slug) ||
    typeof value.version !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value.version) ||
    value.version.includes("..") ||
    typeof value.bundleDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.bundleDigest)
  )
    invalid();
  if (selectionAliasError([value as unknown as SkillSelection])) invalid();
  if (value.triggers !== undefined) {
    if (
      !object(value.triggers) ||
      Object.keys(value.triggers).some(
        (key) => !["keywords", "paths", "always"].includes(key),
      )
    )
      invalid();
    if (
      value.triggers.always !== undefined &&
      typeof value.triggers.always !== "boolean"
    )
      invalid();
    for (const key of ["keywords", "paths"]) {
      const values = value.triggers[key];
      if (
        values !== undefined &&
        (!Array.isArray(values) ||
          values.length > 32 ||
          values.some(
            (term) =>
              typeof term !== "string" || !term.trim() || term.length > 256,
          ))
      )
        invalid();
    }
  }
}
export class HttpProfileClient implements ProfileClient {
  readonly authority: string;
  private origin: string;
  constructor(
    private key: string,
    origin: string,
  ) {
    if (!key.trim()) throw new Error("A Skills credential is required");
    this.origin = normalizeSkillsApiOrigin(origin);
    this.authority = skillsApiRequestUrl(this.origin, "/api/v1/").replace(
      /\/+$/,
      "",
    );
  }
  private async requestRoute(
    route: string,
    init: RequestInit = {},
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(
        skillsApiRequestUrl(this.origin, route),
        {
          ...init,
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.timeout(15_000),
          headers: {
            "Content-Type": "application/json",
            "User-Agent": `hasna-skills/${pkg.version}`,
            Authorization: `Bearer ${this.key}`,
            ...init.headers,
          },
        },
      );
    } catch {
      throw new Error("Unable to reach the configured Skills API");
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(`Skills API request failed (HTTP ${response.status})`);
    }
    return response;
  }
  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.requestRoute(`/api/v1${path}`, init);
  }
  private async read(response: Response, limit = MAX_PROFILE_DOCUMENT_BYTES): Promise<unknown> {
    try {
      return JSON.parse(
        new TextDecoder().decode(
          await readBoundedResponse(response, limit),
        ),
      );
    } catch {
      invalid();
    }
  }
  async resolveProfile(id: string): Promise<ResolvedSkillProfile> {
    if (!identifier(id)) throw new Error("Invalid selection profile id");
    const result = await this.read(
      await this.request(`/profiles/${encodeURIComponent(id)}/resolve`),
      MAX_RESOLVED_PROFILE_BYTES,
    );
    if (
      !object(result) ||
      result.profileId !== id ||
      result.authority !== this.authority ||
      !identifier(result.workspaceId) ||
      !identifier(result.profileRevision) ||
      !Array.isArray(result.selections) ||
      result.selections.length > MAX_PROFILE_SELECTIONS
    )
      invalid();
    const seen = new Set<string>();
    for (const entry of result.selections) {
      validateSelection(entry);
      const item = entry as SkillSelection & Record<string, unknown>;
      if (
        seen.has(item.slug) ||
        item.authority !== this.authority ||
        item.workspaceId !== result.workspaceId ||
        item.profileRevision !== result.profileRevision
      )
        invalid();
      seen.add(item.slug);
    }
    if (selectionAliasError(result.selections as SkillSelection[])) invalid();
    return result as unknown as ResolvedSkillProfile;
  }
  async resolvePrincipal(): Promise<AuthenticatedProfilePrincipal> {
    const result = await this.read(await this.requestRoute("/api/auth/whoami"), 16 * 1024);
    if (
      !object(result) ||
      Object.keys(result).sort().join(",") !== "organization,user" ||
      !object(result.user) ||
      Object.keys(result.user).sort().join(",") !== "email,id,role" ||
      !object(result.organization) ||
      Object.keys(result.organization).sort().join(",") !== "id,name,slug" ||
      !identifier(result.user.id) ||
      typeof result.user.email !== "string" ||
      !result.user.email.trim() ||
      !["owner", "admin", "member", "viewer"].includes(String(result.user.role)) ||
      !identifier(result.organization.id) ||
      !identifier(result.organization.slug) ||
      typeof result.organization.name !== "string" ||
      !result.organization.name.trim()
    )
      invalid();
    return { userId: result.user.id, accountId: result.organization.id, role: result.user.role as AuthenticatedProfileRole };
  }
  async recordStation(
    id: string,
    input: StationSkillStateInput,
  ): Promise<StationSkillState> {
    if (
      !identifier(id) ||
      !identifier(input.profileId) ||
      !identifier(input.profileRevision) ||
      !Array.isArray(input.selections) ||
      input.selections.length > MAX_PROFILE_SELECTIONS
    )
      throw new Error("Invalid station state");
    input.selections.forEach(validateSelection);
    if (selectionAliasError(input.selections)) throw new Error("Invalid station selection aliases");
    const snapshot = { ...input, selections: profileSelectionSnapshot(input.selections) };
    const bodyBytes = profileDocumentBytes(snapshot);
    if (bodyBytes > MAX_PROFILE_DOCUMENT_BYTES) throw new Error("Station state exceeds the profile document size limit");
    if (requiresProfileCapacity(input.selections, bodyBytes)) {
      const capabilities = await this.read(await this.request("/capabilities"));
      assertAdvertisedProfileCapacity(capabilities, input.selections.length, bodyBytes);
    }
    const result = await this.read(
      await this.request(`/stations/${encodeURIComponent(id)}/state`, {
        method: "PUT",
        body: JSON.stringify(snapshot),
      }),
    );
    if (
      !object(result) ||
      result.stationId !== id ||
      result.profileId !== input.profileId ||
      result.profileRevision !== input.profileRevision ||
      !identifier(result.workspaceId) ||
      !identifier(result.actorId) ||
      typeof result.appliedAt !== "string" ||
      !Array.isArray(result.selections) || result.selections.length > MAX_PROFILE_SELECTIONS
    )
      invalid();
    result.selections.forEach(validateSelection);
    if (selectionAliasError(result.selections as SkillSelection[])) invalid();
    if (!selectionSnapshotsEqual(input.selections, result.selections as SkillSelection[])) invalid();
    return result as unknown as StationSkillState;
  }
  async getBundle(slug: string, version: string): Promise<Response | null> {
    if (
      !identifier(slug) ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(version) ||
      version.includes("..")
    )
      throw new Error("Invalid immutable skill reference");
    return this.request(
      `/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/bundle`,
    );
  }
}
export async function createProfileClient(): Promise<ProfileClient> {
  const connection = await resolveSkillsConnection();
  if (!connection)
    throw new Error("Selection profiles require a configured Skills API");
  return new HttpProfileClient(connection.apiKey, connection.apiOrigin);
}
