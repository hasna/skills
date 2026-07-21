import { createHash } from "node:crypto";
import { API_KEY_SCOPES, type ApiKeyScope } from "../lib/api-key-scopes.js";
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

export function selfHostedPrincipal(token: string, partial: Partial<ApiPrincipal> = {}): ApiPrincipal {
  const keyDigest = hashApiKey(token).slice(0, 20);
  return {
    apiKeyId: partial.apiKeyId || `key_${keyDigest}`,
    orgId: partial.orgId || "org_self_hosted",
    orgSlug: partial.orgSlug || "self-hosted",
    orgName: partial.orgName || "Self-hosted operator",
    userId: partial.userId || "user_operator",
    email: partial.email || "operator@localhost.invalid",
    role: partial.role || "owner",
    scopes: partial.scopes || [...API_KEY_SCOPES],
  };
}

export function principalHasScope(principal: ApiPrincipal, requiredScope: ApiKeyScope): boolean {
  return principal.scopes.includes(requiredScope);
}
