import { clientTransportEnvKeys, CREDENTIAL_PROFILE_ENV_KEY } from "@hasna/contracts/client";
import { isAbsolute } from "node:path";
import { selectedSkillsProfile } from "./instance-credentials.js";
import { configuredSkillsApiUrl } from "./fleet-credentials.js";

const urlKeys = clientTransportEnvKeys("skills").apiUrlKeys;

/** Safe selectors for a later MCP process. Credentials still resolve in that process. */
export function skillsMcpRegistrationEnvironment(env: Record<string, string | undefined> = process.env, origin?: string): Record<string, string> {
  const result: Record<string, string> = {};
  const profile = selectedSkillsProfile(env);
  if (profile) result[CREDENTIAL_PROFILE_ENV_KEY] = profile;
  for (const key of ["HASNA_HOME", "HASNA_CONFIG_HOME"] as const) {
    const value = env[key];
    if (value === undefined) continue;
    if (!isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${key}; expected an absolute configuration path`);
    result[key] = value;
  }
  // Stored profile routing remains with the credential resolver. Only an
  // invocation-specific URL (including a captured login target) needs projection.
  if (origin !== undefined || urlKeys.some(key => env[key] !== undefined)) {
    try {
      const source = origin === undefined ? env : { ...env, ...Object.fromEntries(urlKeys.map(key => [key, origin])) };
      const configured = configuredSkillsApiUrl(source);
      if (!configured) throw new Error();
      for (const key of urlKeys) result[key] = configured.value;
    } catch { throw new Error("Invalid Skills MCP API URL; expected matching HTTPS or loopback HTTP origins without credentials, query or fragment"); }
  }
  return Object.freeze(result);
}
