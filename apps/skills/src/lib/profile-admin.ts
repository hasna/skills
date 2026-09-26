import { resolveSkillsConnection, skillsApiRequestUrl } from "./fleet-credentials.js";
import { readBoundedResponse } from "./remote-files.js";
import type { SkillProfile, SkillSelection, StationSkillState } from "../types/skill-selection.js";
import { selectionAliasError, selectionSnapshotsEqual } from "./selection-aliases.js";
import { MAX_PROFILE_SELECTIONS, MAX_PROFILE_DOCUMENT_BYTES, profileDocumentBytes, requiresProfileCapacity, assertAdvertisedProfileCapacity } from "./profile-limits.js";
import { parseSkillsAccess, assertSkillsPermission } from "./remote-permissions.js";

type Connection = NonNullable<Awaited<ReturnType<typeof resolveSkillsConnection>>>;

function id(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes("..")) throw new Error("Invalid Skills profile or station id");
  return encodeURIComponent(value);
}
async function request(path: string, init: RequestInit = {}, captured?: Connection, optionalCapability = false): Promise<unknown> {
  const connection = captured ?? await resolveSkillsConnection();
  if (!connection) throw new Error("Profile administration requires a configured Skills API");
  const response = await fetch(skillsApiRequestUrl(connection.apiOrigin, `/api/v1${path}`), {
    ...init, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "hasna-skills", "Content-Type": "application/json", Authorization: `Bearer ${connection.apiKey}`, ...init.headers },
  });
  if (!response.ok) {
    void response.body?.cancel();
    if (optionalCapability && [404, 405].includes(response.status)) return undefined;
    throw new Error(`Skills profile request failed (HTTP ${response.status})`);
  }
  const text = new TextDecoder().decode(await readBoundedResponse(response, MAX_PROFILE_DOCUMENT_BYTES));
  try {
    const value = JSON.parse(text);
    if (optionalCapability && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error();
    return value;
  } catch { throw new Error(optionalCapability ? "Invalid Skills capability response" : "Invalid Skills profile response"); }
}
export async function readSkillProfile(profileId: string): Promise<SkillProfile> {
  const value = await request(`/profiles/${id(profileId)}`) as SkillProfile;
  if (value.id !== profileId || !Array.isArray(value.selections) || value.selections.length > MAX_PROFILE_SELECTIONS || typeof value.revision !== "string") throw new Error("Invalid Skills profile response");
  return value;
}
export async function saveSkillProfile(profileId: string, selections: SkillSelection[], revision?: string): Promise<SkillProfile> {
  if (!Array.isArray(selections) || selections.length > MAX_PROFILE_SELECTIONS) throw new Error(`A profile requires at most ${MAX_PROFILE_SELECTIONS} exact selections`);
  id(profileId);
  const aliasError = selectionAliasError(selections);
  if (aliasError) throw new Error(aliasError);
  if (revision !== undefined) id(revision);
  const input = { selections }, bodyBytes = profileDocumentBytes(input);
  if (bodyBytes > MAX_PROFILE_DOCUMENT_BYTES) throw new Error("Profile input exceeds the size limit");
  const large = requiresProfileCapacity(selections, bodyBytes);
  const aliases = selections.some(selection => selection.aliases?.length);
  const connection = await resolveSkillsConnection();
  if (!connection) throw new Error("Profile administration requires a configured Skills API");
  // The permission read and mutation use one captured connection, even if a
  // credential selector changes while the read is in flight.
  const capabilities = await request("/capabilities", {}, connection, true) as { selectionAliases?: boolean } | undefined;
  assertSkillsPermission(parseSkillsAccess(capabilities), "profilesWrite");
  if (aliases || large) {
    if (aliases && capabilities?.selectionAliases !== true) throw new Error("This Skills API does not advertise selection aliases. Upgrade the API before saving this profile.");
    if (large) assertAdvertisedProfileCapacity(capabilities, selections.length, bodyBytes);
  }
  const value = await request(`/profiles/${id(profileId)}`, {
    method: "PUT", headers: revision ? { "If-Match": `"${revision}"` } : { "If-None-Match": "*" }, body: JSON.stringify(input),
  }, connection) as SkillProfile;
  if (value.id !== profileId || !Array.isArray(value.selections) || typeof value.revision !== "string") throw new Error("Invalid Skills profile response");
  if (selectionAliasError(value.selections) || !selectionSnapshotsEqual(selections, value.selections)) throw new Error("The Skills API did not preserve the complete selections; read the profile before retrying.");
  return value;
}
export async function readStationSkillState(stationId: string): Promise<StationSkillState> {
  const value = await request(`/stations/${id(stationId)}/state`) as StationSkillState;
  if (value.stationId !== stationId || !Array.isArray(value.selections) || value.selections.length > MAX_PROFILE_SELECTIONS) throw new Error("Invalid Skills station response");
  return value;
}
