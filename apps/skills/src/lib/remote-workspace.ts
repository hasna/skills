import type { RemoteCustomerRole } from "./remote-profile.js";

export type RemoteWorkspaceMember = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: RemoteCustomerRole;
  /** Exact server timestamp, including microseconds; never rounded to Date. */
  createdAt: string;
};
export type RemoteWorkspaceMembersPage = {
  organizationId: string;
  members: RemoteWorkspaceMember[];
  nextCursor: string | null;
};
export type RemoteWorkspaceMembersOptions = { limit?: number; cursor?: string };
export type SetRemoteWorkspaceMemberRole = { role: RemoteCustomerRole; expectedRole: RemoteCustomerRole };
export type RemoveRemoteWorkspaceMember = { expectedRole: RemoteCustomerRole };
export type RemoteWorkspaceMemberRoleResult = { organizationId: string; member: RemoteWorkspaceMember; changed: boolean };
export type RemoteWorkspaceMemberRemovalResult = { organizationId: string; membershipId: string; removed: true; alreadyRemoved: boolean };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const cursor = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Pagination is transport input, not a workspace or authority selector. */
export function workspaceMembersQuery(options: RemoteWorkspaceMembersOptions = {}): string {
  if (!record(options) || Object.keys(options).some(key => key !== "limit" && key !== "cursor")
    || (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100))
    || (options.cursor !== undefined && !cursor(options.cursor))) throw new Error("Use a roster limit from 1 to 100 and an unchanged continuation cursor.");
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor !== undefined) query.set("cursor", options.cursor);
  return query.size ? `?${query}` : "";
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 23) === value.slice(0, 23);
}

function parseMember(row: unknown, fail: () => never): RemoteWorkspaceMember {
  if (!record(row) || !uuid(row.membershipId) || !uuid(row.userId) || typeof row.email !== "string" || !row.email
    || !(row.displayName === null || typeof row.displayName === "string") || !isRole(row.role) || !timestamp(row.createdAt)) return fail();
  return { membershipId: row.membershipId, userId: row.userId, email: row.email, displayName: row.displayName,
    role: row.role, createdAt: row.createdAt };
}

const isRole = (value: unknown): value is RemoteCustomerRole => typeof value === "string" && ["owner", "admin", "member", "viewer"].includes(value);
export class WorkspaceMemberInputError extends Error {
  constructor() { super("Use an unchanged lowercase membership ID and the exact role and expected-role parameters from the roster."); this.name = "WorkspaceMemberInputError"; }
}
function mutationInput(membershipId: string, input: unknown, roleChange: boolean) {
  if (typeof membershipId !== "string" || !uuid(membershipId) || membershipId !== membershipId.toLowerCase() || !record(input)
    || Object.keys(input).sort().join(",") !== (roleChange ? "expectedRole,role" : "expectedRole")) throw new WorkspaceMemberInputError();
  const expectedRole = input.expectedRole, role = roleChange ? input.role : undefined;
  if (!isRole(expectedRole) || (roleChange && !isRole(role))) throw new WorkspaceMemberInputError();
  return { membershipId, role, expectedRole };
}
/** Snapshot transport input before verification awaits; authority stays on the server. */
export function workspaceMemberRoleInput(membershipId: string, input: SetRemoteWorkspaceMemberRole) {
  const value = mutationInput(membershipId, input, true);
  return { membershipId: value.membershipId, body: { role: value.role as RemoteCustomerRole, expectedRole: value.expectedRole } };
}
export function workspaceMemberRemovalInput(membershipId: string, input: RemoveRemoteWorkspaceMember) {
  const value = mutationInput(membershipId, input, false);
  return { membershipId: value.membershipId, body: { expectedRole: value.expectedRole } };
}
export const invalidMemberResult = "The server returned an invalid workspace member result. Refresh the roster before another action.";
export function parseWorkspaceMemberRoleResult(value: unknown, membershipId: string, role: RemoteCustomerRole): RemoteWorkspaceMemberRoleResult {
  const fail = (): never => { throw new Error(invalidMemberResult); };
  if (!record(value) || !uuid(value.organizationId) || typeof value.changed !== "boolean") return fail();
  const member = parseMember(value.member, fail);
  if (member.membershipId !== membershipId || member.role !== role) return fail();
  return { organizationId: value.organizationId, member, changed: value.changed };
}
export function parseWorkspaceMemberRemovalResult(value: unknown, membershipId: string): RemoteWorkspaceMemberRemovalResult {
  if (!record(value) || !uuid(value.organizationId) || value.membershipId !== membershipId || value.removed !== true || typeof value.alreadyRemoved !== "boolean") throw new Error(invalidMemberResult);
  return { organizationId: value.organizationId, membershipId, removed: true, alreadyRemoved: value.alreadyRemoved };
}

/** Only known code/status pairs become public messages; arbitrary server text stays private. */
export const workspaceMemberFailures = {
  INVALID_REQUEST: [400, "Provide the exact membership role parameters."],
  ACCOUNT_UNAVAILABLE: [403, "Account is unavailable."],
  INTERACTIVE_SESSION_REQUIRED: [403, "Fresh interactive sign-in is required."],
  WORKSPACE_ADMIN_REQUIRED: [403, "A current workspace owner or admin is required."],
  MEMBERSHIP_ACTION_FORBIDDEN: [403, "Your current workspace role cannot perform this membership action."],
  MEMBERSHIP_NOT_FOUND: [404, "Membership was not found in the current workspace."],
  SELF_REMOVAL_UNAVAILABLE: [409, "Leaving your own workspace is not available through member removal."],
  MEMBERSHIP_ROLE_CHANGED: [409, "The member role changed. Refresh the roster before another action."],
  LAST_OWNER_REQUIRED: [409, "The workspace must retain at least one active owner."],
  MEMBERSHIP_BUSY: [503, "Membership is busy. Refresh the roster before another action."],
} as const;
export type RemoteWorkspaceMemberErrorCode = keyof typeof workspaceMemberFailures;
export function workspaceMemberFailure(value: unknown, status: number): RemoteWorkspaceMemberErrorCode | null {
  if (!record(value) || typeof value.code !== "string" || !Object.hasOwn(workspaceMemberFailures, value.code)) return null;
  const code = value.code as RemoteWorkspaceMemberErrorCode;
  return workspaceMemberFailures[code][0] === status ? code : null;
}

/** Project the documented roster only; auth metadata and other fields stay out. */
export function parseWorkspaceMembersPage(value: unknown): RemoteWorkspaceMembersPage {
  const fail = (): never => { throw new Error("The server returned an invalid workspace roster."); };
  if (!record(value) || !uuid(value.organizationId) || !Array.isArray(value.members) || value.members.length > 100
    || !(value.nextCursor === null || cursor(value.nextCursor))
    || (!value.members.length && value.nextCursor !== null)) return fail();
  const members = value.members.map((row: unknown) => parseMember(row, fail));
  if (new Set(members.map(row => row.membershipId)).size !== members.length) return fail();
  return { organizationId: value.organizationId, members, nextCursor: value.nextCursor };
}
