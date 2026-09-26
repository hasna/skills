import type { RemoteCurrentWorkspace, RemoteCustomerProfile, RemoteCustomerRole } from "./remote-profile.js";

/** An observed identity and exact membership incarnation, never a slug or cached role. */
export type RemoteWorkspaceContext = Readonly<{ userId: string; membershipId: string }>;
export type RemoteAccountWorkspace = {
  membershipId: string;
  organization: RemoteCurrentWorkspace;
  role: RemoteCustomerRole;
  current: boolean;
};
export type RemoteAccountWorkspaces = { workspaces: RemoteAccountWorkspace[] };
export type RemoteWorkspaceIdentity = {
  user: RemoteCustomerProfile & { membershipId: string };
  organization: RemoteCurrentWorkspace;
};
/** Contains a secret. SDK callers own its lifetime; never print or persist it implicitly. */
export type RemoteWorkspaceSession = RemoteWorkspaceIdentity & { token: string };
export type RemoteAccountWorkspaceDiscovery = RemoteAccountWorkspaces & { userId: string };

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const text = (v: unknown, max = 1024): v is string => typeof v === "string" && !!v.trim() && v.length <= max && !/[\p{Cc}\p{Cs}\u2028\u2029]/u.test(v);
const role = (v: unknown): v is RemoteCustomerRole => typeof v === "string" && ["owner", "admin", "member", "viewer"].includes(v);
export const invalidWorkspaceResult = "The server returned an invalid workspace selection result.";
export class WorkspaceContextInputError extends Error {
  constructor() { super("Provide the observed user ID and exact lowercase membership ID."); this.name = "WorkspaceContextInputError"; }
}
export class WorkspaceIdentityMismatchError extends Error {
  constructor() { super("The verified account does not match the requested workspace context."); this.name = "WorkspaceIdentityMismatchError"; }
}
export function workspaceExpectedUserId(value: unknown): string {
  if (!uuid(value)) throw new WorkspaceContextInputError();
  return value;
}
/** Copy before the first await: caller mutations cannot retarget verification. */
export function workspaceContext(value: unknown): RemoteWorkspaceContext {
  if (!record(value) || Object.keys(value).sort().join(",") !== "membershipId,userId" || !uuid(value.userId) || !uuid(value.membershipId)) throw new WorkspaceContextInputError();
  return { userId: value.userId, membershipId: value.membershipId };
}
function invalid(): never { throw new Error(invalidWorkspaceResult); }
function organization(v: unknown): RemoteCurrentWorkspace {
  if (!record(v) || !uuid(v.id) || !text(v.slug) || !text(v.name)) return invalid();
  return { id: v.id, slug: v.slug, name: v.name };
}
/** Project documented fields only; server extras cannot reach display metadata. */
export function parseAccountWorkspaces(value: unknown): RemoteAccountWorkspaces {
  if (!record(value) || !Array.isArray(value.workspaces) || !value.workspaces.length || value.workspaces.length > 1000) return invalid();
  const workspaces = value.workspaces.map((v: unknown): RemoteAccountWorkspace => {
    if (!record(v) || !uuid(v.membershipId) || !role(v.role) || typeof v.current !== "boolean") return invalid();
    return { membershipId: v.membershipId, organization: organization(v.organization), role: v.role, current: v.current };
  });
  if (workspaces.filter(w => w.current).length !== 1 || new Set(workspaces.map(w => w.membershipId)).size !== workspaces.length
    || new Set(workspaces.map(w => w.organization.id)).size !== workspaces.length) return invalid();
  return { workspaces };
}
export function parseWorkspaceIdentity(value: unknown, expectedUserId: string): RemoteWorkspaceIdentity {
  if (!record(value)) return invalid();
  const user = value.user;
  if (!record(user) || !uuid(user.id) || !uuid(user.membershipId) || !text(user.email, 320)
    || !(user.displayName === null || text(user.displayName)) || !role(user.role)) return invalid();
  if (user.id !== expectedUserId) throw new WorkspaceIdentityMismatchError();
  return { user: { id: user.id, membershipId: user.membershipId, email: user.email, displayName: user.displayName, role: user.role }, organization: organization(value.organization) };
}
function sessionToken(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 8192 || /[^\x21-\x7e]/.test(value) || value.startsWith("sk_")) return invalid();
  return value;
}
/** The service still verifies the token; response metadata never grants authority. */
export function parseWorkspaceSession(value: unknown, expected: RemoteWorkspaceContext): RemoteWorkspaceSession {
  const identity = parseWorkspaceIdentity(value, expected.userId);
  if (identity.user.membershipId !== expected.membershipId) throw new WorkspaceIdentityMismatchError();
  return { token: sessionToken((value as Record<string, unknown>).token), ...identity };
}
/** Fresh verification does not require newer workspace metadata from default-only servers. */
export function parseWorkspaceLogin(value: unknown, expectedUserId?: string): { token: string; userId: string } {
  const user = record(value) && value.user;
  if (!record(value) || !record(user) || !uuid(user.id)) return invalid();
  if (expectedUserId !== undefined && user.id !== expectedUserId) throw new WorkspaceIdentityMismatchError();
  return { token: sessionToken(value.token), userId: user.id };
}
export const workspaceSelectionFailures = {
  INVALID_WORKSPACE_SELECTION: [400, "Provide only the exact membership ID from your workspace list."],
  SESSION_EXPIRED: [401, "Sign in again before selecting a workspace."],
  ACCOUNT_UNAVAILABLE: [403, "Account is unavailable."],
  INTERACTIVE_SESSION_REQUIRED: [403, "Interactive sign-in is required to select a workspace."],
  WORKSPACE_UNAVAILABLE: [404, "Workspace is unavailable. Refresh your workspace list."],
  WORKSPACE_BUSY: [503, "Workspace is busy. Refresh before retrying."],
} as const;
export type RemoteWorkspaceSelectionErrorCode = keyof typeof workspaceSelectionFailures;
export function workspaceSelectionFailure(value: unknown, status: number): RemoteWorkspaceSelectionErrorCode | null {
  if (!record(value) || typeof value.code !== "string" || !Object.hasOwn(workspaceSelectionFailures, value.code)) return null;
  const code = value.code as RemoteWorkspaceSelectionErrorCode;
  return workspaceSelectionFailures[code][0] === status ? code : null;
}
