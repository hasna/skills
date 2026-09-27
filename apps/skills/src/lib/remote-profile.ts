export type RemoteCustomerRole = "owner" | "admin" | "member" | "viewer";
export type RemoteCustomerProfile = { id: string; email: string; displayName: string | null; role: RemoteCustomerRole };
export type RemoteCurrentWorkspace = { id: string; slug: string; name: string };
export type UpdateRemoteProfile = { displayName: string };
export type UpdateRemoteWorkspace = { name: string };

/** Client input checks do not grant authority; the selected server owns policy. */
export function customerNamePatch(input: unknown, field: "displayName" | "name"): Record<string, string> {
  if (!isRecord(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, field)) throw new Error("Provide only the requested name field.");
  const value = input[field];
  if (typeof value !== "string" || /[\p{Cc}\p{Cs}\u2028\u2029]/u.test(value) || !value.trim() || [...value.trim()].length > 100) {
    throw new Error("Use a name of 1–100 characters without control characters or newlines.");
  }
  return { [field]: value.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function string(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

export function parseUpdatedProfile(value: unknown): { user: RemoteCustomerProfile } {
  const user = isRecord(value) && value.user;
  if (!isRecord(user) || !string(user.id) || !string(user.email)
    || !(user.displayName === null || typeof user.displayName === "string")
    || typeof user.role !== "string" || !["owner", "admin", "member", "viewer"].includes(user.role)) {
    throw new Error("The server returned an invalid account profile.");
  }
  return { user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role as RemoteCustomerRole } };
}

export function parseUpdatedWorkspace(value: unknown): { organization: RemoteCurrentWorkspace } {
  const organization = isRecord(value) && value.organization;
  if (!isRecord(organization) || !string(organization.id) || !string(organization.slug) || !string(organization.name)) {
    throw new Error("The server returned an invalid workspace.");
  }
  return { organization: { id: organization.id, slug: organization.slug, name: organization.name } };
}
