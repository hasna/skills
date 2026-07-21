export const CLOUD_API_ORIGIN = "https://skills.md";

export class SkillsServiceOriginError extends Error {
  readonly code = "SKILLS_SERVICE_ORIGIN_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "SkillsServiceOriginError";
  }
}

export function isExplicitInsecureLoopbackEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const explicitProfile = env.SKILLS_TEST_MODE === "1" || env.SKILLS_PREVIEW_MODE === "1";
  return env.NODE_ENV !== "production"
    && env.SKILLS_ALLOW_INSECURE_LOOPBACK === "1"
    && explicitProfile;
}

export function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === "localhost"
    || hostname === "::1"
    || hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function normalizeSkillsApiOrigin(
  apiUrl: string,
  env: Record<string, string | undefined> = process.env,
): string {
  let url: URL;
  try {
    url = new URL(apiUrl.trim());
  } catch {
    throw new SkillsServiceOriginError("Skills API origin must be a valid absolute URL.");
  }

  if (url.username || url.password) {
    throw new SkillsServiceOriginError("Skills API origin must not contain user information.");
  }
  if (url.search || url.hash) {
    throw new SkillsServiceOriginError("Skills API origin must not contain a query or fragment.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SkillsServiceOriginError("Skills API origin must use HTTPS.");
  }
  const loopback = isLoopbackOrigin(url.origin);
  if (url.protocol !== "https:") {
    if (url.protocol !== "http:" || !loopback || !isExplicitInsecureLoopbackEnabled(env)) {
      throw new SkillsServiceOriginError(
        "Skills API origin must use HTTPS. HTTP is allowed only for an explicitly enabled test or preview loopback profile.",
      );
    }
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname !== "/" && pathname !== "/api" && pathname !== "/api/v1") {
    throw new SkillsServiceOriginError("Skills API origin must not contain an application path.");
  }

  return url.origin;
}

export function normalizeCloudApiOrigin(
  apiUrl: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const normalized = normalizeSkillsApiOrigin(apiUrl || CLOUD_API_ORIGIN, env);
  if (normalized === CLOUD_API_ORIGIN) return normalized;
  if (isLoopbackOrigin(normalized) && isExplicitInsecureLoopbackEnabled(env)) return normalized;
  throw new SkillsServiceOriginError(
    `Skills cloud uses the fixed service origin ${CLOUD_API_ORIGIN}. Select self-hosted mode for an operator origin.`,
  );
}
