/** Effective access belongs to the credential, independently of workspace role. */
export interface RemoteSkillsPermissions {
  read?: boolean;
  publish?: boolean;
  profilesWrite?: boolean;
  stationStateWrite?: boolean;
  cloudSubmit?: boolean;
  executionGrantsRead?: boolean;
  executionGrantsWrite?: boolean;
  executionGrantsResolve?: boolean;
}

export interface RemoteSkillsAccess {
  scopes?: string[];
  permissions?: RemoteSkillsPermissions;
}

const permissionNames = ["read", "publish", "profilesWrite", "stationStateWrite", "cloudSubmit",
  "executionGrantsRead", "executionGrantsWrite", "executionGrantsResolve"] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Pick known fields only; never reflect additive provider fields into diagnostics. */
export function parseSkillsAccess(value: unknown): RemoteSkillsAccess {
  if (value === undefined) return {};
  if (!record(value)) throw new Error("Invalid Skills permission contract");
  const result: RemoteSkillsAccess = {};
  if (value.scopes !== undefined) {
    if (!Array.isArray(value.scopes) || value.scopes.length > 256 || value.scopes.some(scope =>
      typeof scope !== "string" || scope.length > 128 || !/^(?:\*|[a-z][a-z0-9.-]*:[a-z0-9.*-]+)$/.test(scope)))
      throw new Error("Invalid Skills scope contract");
    result.scopes = [...value.scopes];
  }
  if (value.permissions !== undefined) {
    if (!record(value.permissions)) throw new Error("Invalid Skills permission contract");
    result.permissions = {};
    for (const name of permissionNames) {
      const permission = value.permissions[name];
      if (permission === undefined) continue;
      if (typeof permission !== "boolean") throw new Error("Invalid Skills permission contract");
      result.permissions[name] = permission;
    }
  }
  return result;
}

export class RemoteSkillsPermissionError extends Error {
  readonly code = "SKILLS_PERMISSION_DENIED";
  readonly status = 403;
  constructor(readonly permission: "publish" | "profilesWrite") {
    super(`The current Skills credential cannot ${permission === "publish" ? "publish skills" : "write shared profiles"}. ` +
      "Workspace role does not override credential permissions. Ask the workspace administrator to authorize this credential, " +
      "then check skills auth whoami or skills capabilities. This write request was not sent.");
    this.name = "RemoteSkillsPermissionError";
  }
}

export function assertSkillsPermission(access: RemoteSkillsAccess, permission: "publish" | "profilesWrite"): void {
  // Missing fields on older servers mean unknown. The server remains the final
  // authority; neither scopes nor a role are used to invent a client-side grant.
  if (access.permissions?.[permission] === false) throw new RemoteSkillsPermissionError(permission);
}
