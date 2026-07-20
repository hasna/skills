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
    scopes: partial.scopes || ["skills:read", "runs:write"],
  };
}
