/**
 * The credential the CLI signs in with, and the identity it displays.
 *
 * READING is not done here. Every read goes through `fleet-credentials.ts` →
 * `@hasna/contracts/client`, so the argument, the env pointer, the macOS
 * Keychain, `~/.hasna/skills/config/credentials` and `HASNA_SKILLS_API_KEY` are
 * consulted in the fleet's one order, on every call. There is no cache: a
 * credential is mutable state, and a value captured at process start is the
 * defect the ladder exists to remove (a shell that outlives a key rotation).
 *
 * WRITING lands in exactly one file — `~/.hasna/skills/config/credentials`,
 * mode 0600, the shared seam's disk tier — so `skills auth login` on this
 * machine and a station wrapper reading the same file cannot disagree.
 * `HASNA_HOME` / `HASNA_CONFIG_HOME` relocate it; `$HASNA_SKILLS_DIR` does not,
 * because that variable relocates this app's DATA (corpus, database, config),
 * and the fleet credential is not app data — it is the machine's, shared with
 * every other Hasna CLI.
 *
 * The display identity (`email`, org, user ids) is NOT a credential and lives
 * beside it in `identity.json`. It is only ever what the server's `whoami`
 * returned; nothing here invents a field.
 *
 * `~/.skills/auth.json` and `~/.hasna/skills/auth.json` are retired locations and
 * are not read. `skills auth login` writes the credentials file; an operator
 * still holding an old auth.json is told to sign in again.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { defaultFleetGatewayBaseUrl } from "@hasna/contracts/client";
import { SKILLS_BOUND_API_URL, selectedSkillsProfile } from "./instance-credentials.js";

import {
  requireSkillsApiOrigin,
  resolveSkillsApiKey,
  resolveSkillsFleet,
  skillsCredentialFilePath,
  SKILLS_API_KEY_ENV,
  SKILLS_API_URL_ENV,
  normalizeSkillsApiOrigin,
  resolveSkillsApiOrigin,
  type SkillsFleetOptions,
} from "./fleet-credentials.js";
import { credentialPointerEnvKey, resolveCredential } from "@hasna/contracts/client";

const SKILLS_API_KEY_REF = credentialPointerEnvKey("skills");

export { normalizeSkillsApiOrigin } from "./fleet-credentials.js";

type Env = Record<string, string | undefined>;

/** The credentials file this package writes and the shared seam reads. */
export function getAuthFilePath(env: Env = process.env): string {
  return skillsCredentialFilePath(env);
}

/**
 * Write-free path resolution for read-only paths (e.g. `sync --dry-run`).
 *
 * Identical to getAuthFilePath(): nothing in the credential path writes as a
 * side effect of resolving any more. Kept as a separate name so the read-only
 * callers keep reading as read-only.
 */
export function getAuthFilePathReadOnly(env: Env = process.env): string {
  return skillsCredentialFilePath(env);
}

/** The display identity file beside the credential. Never holds a secret. */
export function getIdentityFilePath(env: Env = process.env): string {
  const file = skillsCredentialFilePath(env);
  return join(dirname(file), basename(file).replace(/^credentials/, "identity") + ".json");
}

/**
 * Stored credentials for a Skills API instance.
 *
 * `apiKey` is the credential the ladder resolved — not necessarily one this CLI
 * wrote. The identity fields are display metadata echoed back from the
 * instance's `whoami`, so they are optional: an instance that does not return
 * them leaves them unset. They are never invented locally — a placeholder
 * written here is indistinguishable from a value the server actually returned.
 */
export interface AuthConfig {
  /**
   * The credential the ladder resolved, or null when it is a vault POINTER that
   * only the async path can complete (see {@link getApiKeyAsync}). Callers that
   * need to SEND it must resolve it there; the display surfaces below only need
   * to know that one is configured.
   */
  apiKey: string | null;
  email?: string;
  orgId?: string;
  orgSlug?: string;
  userId?: string;
}

/** The identity half, on its own: what `whoami` said, with no credential. */
export type AuthIdentity = Omit<AuthConfig, "apiKey">;

/**
 * What `saveAuthConfig` is handed: a key this CLI actually holds.
 *
 * Distinct from {@link AuthConfig}, whose `apiKey` may be null for a vault
 * pointer — there is nothing to write to disk in that case, and writing an
 * empty line would masquerade as a stored credential.
 */
export type StoredAuthConfig = AuthIdentity & { apiKey: string };

export function getAuthIdentity(env: Env = process.env): AuthIdentity {
  return readIdentity(env);
}

function readIdentity(env: Env = process.env): AuthIdentity {
  try {
    const parsed = JSON.parse(readFileSync(getIdentityFilePath(env), "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const selected = resolveSkillsApiOrigin(env)?.origin;
    const bound = typeof record.apiUrl === "string" ? record.apiUrl : readCredentialValue(SKILLS_BOUND_API_URL, env) ?? readStoredApiUrl(env) ?? defaultFleetGatewayBaseUrl("skills");
    if (selected && normalizeSkillsApiOrigin(bound) !== selected) return {};
    const identity: AuthIdentity = {};
    for (const field of ["email", "orgId", "orgSlug", "userId"] as const) {
      const value = record[field];
      if (typeof value === "string" && value.length > 0) identity[field] = value;
    }
    return identity;
  } catch {
    return {};
  }
}

/**
 * The credential in effect plus whatever identity was recorded for it, or null
 * when no credential resolves anywhere on the ladder.
 */
export function getAuthConfig(env: Env = process.env, options: SkillsFleetOptions = {}): AuthConfig | null {
  const fleet = resolveSkillsFleet(env, options);
  if (fleet.mode !== "hosted") return null;
  // A vault pointer IS a configured credential; keyed off the synchronous value
  // alone this reported "not signed in" for one, which is a false negative the
  // operator would chase in the wrong place.
  return { apiKey: fleet.apiKey, ...readIdentity(env) };
}

/** Alias kept for the read-only callers; resolution never writes. */
export function getAuthConfigReadOnly(env: Env = process.env, options: SkillsFleetOptions = {}): AuthConfig | null {
  return getAuthConfig(env, options);
}

/** Merge `values` into the credentials file, atomically, at mode 0600. */
function writeCredentialValues(values: Record<string, string | null>, env: Env = process.env): string {
  const file = skillsCredentialFilePath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });

  const lines: string[] = [];
  const written = new Set<string>();
  if (existsSync(file)) {
    for (const raw of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
      const key = match?.[1];
      if (key && key in values) {
        const next = values[key];
        if (next !== null && next !== undefined) {
          lines.push(`${key}=${next}`);
          written.add(key);
        }
        // A null value deletes the line.
        continue;
      }
      lines.push(raw);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || written.has(key)) continue;
    lines.push(`${key}=${value}`);
  }

  const body = lines.filter((line, index) => !(line.trim() === "" && index === lines.length - 1)).join("\n") + "\n";
  // Written through a sibling temp file so a reader never sees a half-written
  // credential, and created 0600 from the start so it is never briefly readable.
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, body, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  return file;
}

/** Read one value out of the credentials file, or null. */
function readCredentialValue(key: string, env: Env = process.env): string | null {
  let file: string;
  try {
    file = skillsCredentialFilePath(env);
  } catch {
    return null;
  }
  if (!existsSync(file)) return null;
  try {
    for (const raw of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const match = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`).exec(raw);
      if (!match) continue;
      let value = (match[1] ?? "").trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
        value = value.slice(1, -1);
      }
      return value || null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Persist the credential (and any identity the server returned) for this user.
 *
 * Returns the file it wrote, so the CLI can name the real path rather than a
 * path it assumed.
 */
/** identity.json as a plain record, or null. Holds no secret. */
function readIdentityRecord(env: Env = process.env): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(getIdentityFilePath(env), "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function safeOrigin(url: string): string | null {
  try {
    return normalizeSkillsApiOrigin(url);
  } catch {
    return null;
  }
}

/**
 * How the stored key was obtained. `sign-in` keys were minted for this CLI by a
 * browser/device or email sign-in, so `skills logout` may revoke them on the
 * server; an `api-key` the user pasted is theirs to manage and is only
 * forgotten locally. Recorded in identity.json (never a secret).
 */
export type StoredKeyIssuer = "sign-in" | "api-key";

export function saveAuthConfig(config: StoredAuthConfig, env: Env = process.env, authenticatedOrigin?: string, issuedBy?: StoredKeyIssuer): string {
  const apiKey = config.apiKey.trim();
  if (!apiKey) throw new Error("Refusing to store an empty Skills API key.");
  if (/[^\t\x20-\x7e]/.test(apiKey)) {
    throw new Error("Refusing to store a Skills API key containing control characters or non-ASCII bytes.");
  }
  const apiUrl = authenticatedOrigin ? normalizeSkillsApiOrigin(authenticatedOrigin) : resolveSkillsApiOrigin(env)?.origin ?? defaultFleetGatewayBaseUrl("skills");
  // Provenance of the URL line: did the user configure this URL in the file
  // (`skills setup --api-url`), or is it here only because this sign-in wrote
  // it? Logout removes a URL that login wrote together with the key, so no
  // later credential can be paired with a server nobody configured.
  const previousUrl = readStoredApiUrl(env);
  const previous = readIdentityRecord(env);
  const loginWroteBefore = previous?.urlWrittenBy === "login" && typeof previous.apiUrl === "string" && safeOrigin(previous.apiUrl) === apiUrl;
  // Recorded only for a sign-in flow (an issuer is given); other writers keep
  // the file exactly as before.
  const urlWrittenByLogin = issuedBy !== undefined && (!previousUrl || safeOrigin(previousUrl) !== apiUrl || loginWroteBefore);
  const file = writeCredentialValues({ SKILLS_API_KEY: null, SKILLS_API_URL: null, [SKILLS_API_KEY_REF]: null, [SKILLS_API_KEY_ENV]: apiKey, [SKILLS_BOUND_API_URL]: apiUrl, [SKILLS_API_URL_ENV]: apiUrl }, env);

  const identity: AuthIdentity = {};
  for (const field of ["email", "orgId", "orgSlug", "userId"] as const) {
    const value = config[field];
    if (typeof value === "string" && value.length > 0) identity[field] = value;
  }
  const identityFile = getIdentityFilePath(env);
  if (Object.keys(identity).length > 0 || issuedBy || urlWrittenByLogin) {
    writeFileSync(identityFile, JSON.stringify({ ...identity, apiUrl, ...(issuedBy ? { issuedBy } : {}), ...(urlWrittenByLogin ? { urlWrittenBy: "login" } : {}) }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(identityFile, 0o600);
  } else {
    try { unlinkSync(identityFile); } catch {}
  }
  return file;
}

/**
 * Who put the active profile's stored credential there — the question
 * `skills logout` has to answer before it touches it (Instructions rule
 * global-cli-logout-semantics, points 1 and 2).
 *
 *   sign-in  — minted for this CLI by `skills login` (browser, device code,
 *              email code) or workspace enrollment. Revoked on logout by default.
 *   api-key  — brought by the user with `skills login --api-key`. Deleted
 *              locally on logout; revoked only with an explicit `--revoke`.
 *   legacy   — stored by an older `skills auth login` that did not record how
 *              the key was issued, so it cannot be revoked automatically.
 *   external — no sign-in record at all: a provisioned key, a vault pointer, or
 *              one written by another tool. Logout leaves it alone.
 */
export type StoredCredentialOrigin = StoredKeyIssuer | "legacy" | "external";

/** The active profile's stored credential, as `skills logout` sees it. The key is never printed. */
export interface StoredCredential {
  /** The credentials file. A path: safe to print. */
  file: string;
  /** The stored key, or null when the file holds only a vault pointer. Never printed or logged. */
  apiKey: string | null;
  /** The instance the credential belongs to: its recorded binding, else the file URL, else the internal gateway. */
  origin: string;
  storedBy: StoredCredentialOrigin;
  /** True when the file's URL line is there only because `skills login` wrote it; logout then removes it too. */
  urlWrittenByLogin: boolean;
}

/**
 * Read the active profile's stored credential WITHOUT the resolution ladder:
 * logout must act on exactly the credential login stored for this profile,
 * never on one the environment or the Keychain would supply instead.
 */
export function readStoredCredential(env: Env = process.env): StoredCredential | null {
  let file: string;
  try {
    file = skillsCredentialFilePath(env);
  } catch {
    return null;
  }
  if (!existsSync(file)) return null;
  const apiKey = readCredentialValue(SKILLS_API_KEY_ENV, env) ?? readCredentialValue("SKILLS_API_KEY", env);
  const pointer = readCredentialValue(SKILLS_API_KEY_REF, env);
  if (!apiKey && !pointer) return null;
  const origin = normalizeSkillsApiOrigin(readCredentialValue(SKILLS_BOUND_API_URL, env) ?? readStoredApiUrl(env) ?? defaultFleetGatewayBaseUrl("skills"));
  let storedBy: StoredCredentialOrigin = "external";
  let urlWrittenByLogin = false;
  const record = apiKey ? readIdentityRecord(env) : null;
  const recordedFor = record && typeof record.apiUrl === "string" ? safeOrigin(record.apiUrl) : null;
  if (record && recordedFor === origin) {
    storedBy = record.issuedBy === "sign-in" || record.issuedBy === "api-key" ? record.issuedBy : "legacy";
    const fileUrl = readStoredApiUrl(env);
    urlWrittenByLogin = storedBy !== "legacy" && record.urlWrittenBy === "login" && fileUrl !== null && safeOrigin(fileUrl) === origin;
  }
  return { file, apiKey: apiKey ?? null, origin, storedBy, urlWrittenByLogin };
}

/**
 * Delete the stored credential for the active profile, and throw when it cannot
 * be deleted: the key, its binding, any vault pointer and the display identity.
 *
 * `removeUrl` also deletes the URL line, for a URL that `skills login` wrote
 * (the product default or a `--url` given only to login). Leaving it would let
 * a later environment-only key pair with a server nobody configured. A URL the
 * user configured (`skills setup --api-url`) stays.
 */
export function deleteStoredCredential(env: Env = process.env, removeUrl = false): string {
  const file = writeCredentialValues({
    [SKILLS_API_KEY_ENV]: null, SKILLS_API_KEY: null, [SKILLS_API_KEY_REF]: null, [SKILLS_BOUND_API_URL]: null,
    ...(removeUrl ? { [SKILLS_API_URL_ENV]: null, SKILLS_API_URL: null } : {}),
  }, env);
  if (readCredentialValue(SKILLS_API_KEY_ENV, env) || readCredentialValue("SKILLS_API_KEY", env) || readCredentialValue(SKILLS_API_KEY_REF, env) ||
      (removeUrl && readStoredApiUrl(env))) {
    throw new Error(`The stored credential is still present in ${file} after deleting it.`);
  }
  try {
    unlinkSync(getIdentityFilePath(env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return file;
}

/** Store (or clear, with null) the API URL beside the credential. */
export function saveApiUrl(apiUrl: string | null, env: Env = process.env): string {
  const next = apiUrl === null ? null : normalizeSkillsApiOrigin(apiUrl);
  const values: Record<string, string | null> = { [SKILLS_API_URL_ENV]: next, SKILLS_API_URL: null };
  // Preserve the PREVIOUS file authority before editing a legacy unbound key.
  // A new URL must never retroactively bind an old credential to another server.
  if (!readCredentialValue(SKILLS_BOUND_API_URL, env) &&
      (readCredentialValue(SKILLS_API_KEY_ENV, env) || readCredentialValue("SKILLS_API_KEY", env) || readCredentialValue(SKILLS_API_KEY_REF, env))) {
    values[SKILLS_BOUND_API_URL] = normalizeSkillsApiOrigin(readStoredApiUrl(env) ?? defaultFleetGatewayBaseUrl("skills"));
  }
  const file = writeCredentialValues(values, env);
  // The URL is now the user's configuration, not something login wrote.
  const record = readIdentityRecord(env);
  if (record && "urlWrittenBy" in record) {
    const { urlWrittenBy: _dropped, ...rest } = record;
    const identityFile = getIdentityFilePath(env);
    writeFileSync(identityFile, JSON.stringify(rest, null, 2) + "\n", { mode: 0o600 });
    chmodSync(identityFile, 0o600);
  }
  return file;
}

/** The API URL recorded in the credentials file, or null. */
export function readStoredApiUrl(env: Env = process.env): string | null {
  return readCredentialValue(SKILLS_API_URL_ENV, env) ?? readCredentialValue("SKILLS_API_URL", env);
}

/**
 * Remove the credential this CLI wrote.
 *
 * Only the file is cleared: a key injected from the environment or held in the
 * Keychain belongs to the machine, not to this command, and silently appearing
 * to remove it would be a lie. The caller is told whether one still resolves.
 */
export function clearAuthConfig(env: Env = process.env): { stillResolves: boolean } {
  try {
    writeCredentialValues({ [SKILLS_API_KEY_ENV]: null, SKILLS_API_KEY: null, [SKILLS_API_KEY_REF]: null, [SKILLS_BOUND_API_URL]: null }, env);
  } catch {
    // No home, or nothing to clear.
  }
  try { unlinkSync(getIdentityFilePath(env)); } catch {}
  // "Does one still resolve", not "can this process read its value": a vault
  // pointer resolves without yielding a key synchronously, and a credential
  // that resolves but is refused (a broken deliberate selection) is still a
  // credential the operator has configured somewhere. Both must keep the
  // "clear it there to finish signing out" line honest.
  let stillResolves: boolean;
  try {
    stillResolves = resolveCredential("skills", env, { profile: selectedSkillsProfile(env) ?? undefined }) !== null;
  } catch {
    const emptyProfile = selectedSkillsProfile(env) && !env.HASNA_SKILLS_API_KEY_OVERRIDE && !env.HASNA_SKILLS_API_KEY_REF &&
      !readCredentialValue(SKILLS_API_KEY_ENV, env) && !readCredentialValue("SKILLS_API_KEY", env) && !readCredentialValue(SKILLS_API_KEY_REF, env);
    stillResolves = !emptyProfile;
  }
  return { stillResolves };
}

/**
 * The credential in effect, resolved fresh through the shared ladder.
 *
 * SYNCHRONOUS, so it cannot complete a vault pointer
 * (`HASNA_SKILLS_API_KEY_REF`): for that tier it returns null, because the
 * pointer's own value is the empty string and handing THAT back as a key is how
 * `Authorization: Bearer ` reached the wire. Any path that is about to SEND the
 * key must use {@link getApiKeyAsync} (or `resolveSkillsApiKey`), which fetches
 * the vault item and refuses loudly when it cannot.
 */
export function getApiKey(env: Env = process.env, options: SkillsFleetOptions = {}): string | null {
  const fleet = resolveSkillsFleet(env, options);
  return fleet.mode === "hosted" ? fleet.apiKey : null;
}

/**
 * The credential in effect, completing a vault pointer through the secrets
 * vault. Null only in local mode; throws when a configured credential cannot
 * be produced. Use this wherever the key is about to be sent.
 */
export async function getApiKeyAsync(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): Promise<string | null> {
  return resolveSkillsApiKey(env, options);
}

/** Identical to getApiKey(): resolution has no write side effects. */
export function getApiKeyReadOnly(env: Env = process.env, options: SkillsFleetOptions = {}): string | null {
  return getApiKey(env, options);
}

/**
 * Origin every credential-bearing request is sent to.
 *
 * The AUTHORITY, not the whole hosted resolution: `skills auth login` runs
 * before there is a credential, and requiring one here would make signing in
 * impossible. Throws when nothing names a service: an install that named none
 * must not decide on the user's behalf where their email address, login code,
 * or API key goes.
 */
export function getApiUrl(action?: string, env: Env = process.env, options: SkillsFleetOptions = {}): string {
  return requireSkillsApiOrigin(action, env, options);
}

/** Permission bits of the credentials file, for `skills auth status`-style output. */
export function credentialFileMode(env: Env = process.env): number | null {
  try {
    return statSync(skillsCredentialFilePath(env)).mode & 0o777;
  } catch {
    return null;
  }
}
