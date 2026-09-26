/**
 * Where this install stands on the fleet credential ladder — the SOURCES only.
 *
 * Shared by `skills setup-info` and the MCP `whoami` tool so an operator at a
 * terminal and an agent over MCP read the same block. Never a key value: an env
 * key NAME, a Keychain item reference or an absolute path is what an operator
 * needs to tell a stale export from a rotated file, and it is the most this may
 * report. `credentialsFileMode` is reported so a file the shared resolver would
 * REFUSE (anything but 0400/0600) is visible here rather than only at the
 * moment a command fails.
 */
import { credentialFileMode, getAuthFilePath } from "./auth-store.js";
import { resolveSkillsFleet } from "./fleet-credentials.js";

export interface CredentialState {
  /** `misconfigured` is the ladder's refusal carried as data; `error` says why. */
  mode: "hosted" | "local" | "misconfigured";
  apiUrl: string | null;
  apiUrlSource: string | null;
  apiKeySource: string | null;
  apiKeyTier: string | null;
  credentialsFile: string | null;
  credentialsFileMode: string | null;
  error: string | null;
}

export function describeCredentialState(): CredentialState {
  let credentialsFile: string | null = null;
  let mode: string | null = null;
  try {
    credentialsFile = getAuthFilePath();
    const bits = credentialFileMode();
    mode = bits === null ? null : `0${bits.toString(8).padStart(3, "0")}`;
  } catch {
    // No HOME: there is no credentials file to describe.
  }
  try {
    const fleet = resolveSkillsFleet();
    if (fleet.mode === "hosted") {
      return {
        mode: "hosted",
        apiUrl: fleet.apiOrigin,
        apiUrlSource: fleet.apiUrlSource,
        apiKeySource: fleet.apiKeySource,
        apiKeyTier: fleet.apiKeyTier,
        credentialsFile,
        credentialsFileMode: mode,
        error: null,
      };
    }
    return {
      mode: "local",
      apiUrl: null,
      apiUrlSource: null,
      apiKeySource: null,
      apiKeyTier: null,
      credentialsFile,
      credentialsFileMode: mode,
      error: null,
    };
  } catch (error) {
    return {
      mode: "misconfigured",
      apiUrl: null,
      apiUrlSource: null,
      apiKeySource: null,
      apiKeyTier: null,
      credentialsFile,
      credentialsFileMode: mode,
      error: (error as Error).message,
    };
  }
}
