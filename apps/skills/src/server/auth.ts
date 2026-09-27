import { createHash } from "node:crypto";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

export async function authenticateRequest(
  store: SkillsProductStore,
  request: Request,
): Promise<ApiPrincipal | null> {
  const token = bearerToken(request);
  if (!token) return null;
  return store.authenticateApiKeyHash(hashApiKey(token));
}

export function publicPrincipal(partial: Partial<ApiPrincipal> = {}): ApiPrincipal {
  return {
    apiKeyId: partial.apiKeyId || "key_dev",
    orgId: partial.orgId || "org_dev",
    orgSlug: partial.orgSlug || "dev",
    orgName: partial.orgName || "Development",
    userId: partial.userId || "user_dev",
    email: partial.email || "dev@example.com",
    role: partial.role || "owner",
    // This helper provisions the administrative bootstrap principal. Explicit
    // narrow scopes, even for owners, are never expanded by authorization.
    scopes: partial.scopes ?? ["*"],
  };
}

/** Scope checks apply to the key, independently of its user's workspace role. */
export function permitsSkillsRoute(principal: ApiPrincipal, method: string, resource: string): boolean {
  const scopes = new Set(principal.scopes);
  if (resource === "execution-grants") {
    const read = method === "GET" || method === "HEAD";
    if (!read && method !== "POST" && !["owner", "admin"].includes(principal.role)) return false;
    const allowed = read ? ["*", "execution-grants:*", "execution-grants:read"]
      : method === "POST" ? ["*", "execution-grants:*", "execution-grants:resolve", "skills:read", "skills:*"]
      : ["*", "execution-grants:*", "execution-grants:write"];
    return allowed.some(scope => scopes.has(scope));
  }
  if (scopes.has("*")) return true;
  const read = method === "GET" || method === "HEAD";
  if (resource === "capabilities" && read) return true;
  let allowed: string[];
  if (resource === "runs" || resource === "executions") {
    allowed = read ? ["runs:read", "runs:*", "skills:read", "skills:*"] : ["runs:write", "runs:*"];
  } else if (resource === "stations") {
    allowed = read ? ["stations:read", "stations:*", "skills:read", "skills:*"] : ["stations:write", "stations:*", "skills:*"];
  } else if (["skills", "pins", "tags", "profiles", "capabilities"].includes(resource)) {
    allowed = read ? ["skills:read", "skills:*"] : ["skills:write", "skills:publish", "skills:*"];
  } else return true; // Unknown resources retain the router's 404 contract.
  return allowed.some(scope => scopes.has(scope));
}
