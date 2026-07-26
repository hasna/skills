/**
 * Single source of truth for resolving the Skills API endpoint.
 *
 * Boundary rule (R1): an unconfigured install must never produce a URL on a
 * vendor-controlled host.
 *
 *   - Read paths fail closed: `resolveApiUrl()` returns `undefined` and the
 *     caller keeps working against the bundled local registry.
 *   - Auth and write paths fail loudly: `requireApiUrl()` throws an error that
 *     names the missing configuration.
 *
 * There is deliberately no fallback endpoint and no localhost default. An
 * unconfigured CLI has nothing sane to point a credential-bearing request at,
 * so it must say so rather than pick a host on the user's behalf.
 */

import { loadConfig, type SkillsConfig } from "./config.js";

export const API_URL_ENV_VAR = "SKILLS_API_URL";
export const API_URL_CONFIG_KEY = "apiUrl";

/** Hint shown wherever a Skills API URL is required but absent. */
export const MISSING_API_URL_HINT =
  `set ${API_URL_ENV_VAR}=<your Skills instance origin>, ` +
  `or run: skills setup --api-url <your Skills instance origin>`;

export class MissingApiUrlError extends Error {
  readonly code = "MISSING_API_URL";

  constructor(action = "This command") {
    super(`${action} requires a Skills API URL and none is configured — ${MISSING_API_URL_HINT}`);
    this.name = "MissingApiUrlError";
  }
}

/**
 * Resolve the configured Skills API origin, or `undefined` when the install has
 * not been pointed at an instance. `SKILLS_API_URL` wins over the config file.
 */
export function resolveApiUrl(
  config: SkillsConfig = loadConfig(),
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env[API_URL_ENV_VAR] || config[API_URL_CONFIG_KEY];
  const trimmed = raw?.trim().replace(/\/+$/, "");
  return trimmed || undefined;
}

/**
 * Resolve the configured Skills API origin, or throw naming the missing
 * configuration. Use this on every auth and write path.
 */
export function requireApiUrl(
  action = "This command",
  config?: SkillsConfig,
  env?: Record<string, string | undefined>,
): string {
  const resolved = resolveApiUrl(config ?? loadConfig(), env ?? process.env);
  if (!resolved) throw new MissingApiUrlError(action);
  return resolved;
}
