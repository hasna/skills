/**
 * Signing in and out, shared by `skills login` / `skills logout` / `skills
 * whoami` and the interactive TUI's `/login`, `/logout` and `/whoami`.
 *
 * The flow follows the Codex CLI model the owner chose (2026-09-23): a browser
 * sign-in by default, a printed device code for headless machines, an API key
 * read from stdin, and a logout that revokes what the sign-in minted.
 *
 * Device authorization follows RFC 8628: poll no faster than the server's
 * `interval`, add five seconds on every `slow_down`, and stop on
 * `expired_token`, `invalid_device_code` or `access_denied`. A pending device
 * session is saved beside the credentials file, owner-only, so a headless
 * `skills login --device` can be finished later with `skills login --poll`
 * instead of starting a new session and discarding the code the user approved.
 *
 * Nothing here decides WHERE to sign in: callers pass the origin from
 * `resolveSkillsSignInOrigin()`, which never sends a legacy internal key to the
 * product default.
 */

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { resolveCredential } from "@hasna/contracts/client";
import { deleteStoredCredential, readStoredCredential, saveAuthConfig, type StoredCredentialOrigin, type StoredKeyIssuer } from "./auth-store.js";
import { isSkillsFleetCredentialError, resolveSkillsConnection, skillsCredentialFilePath, type SkillsFleetOptions } from "./fleet-credentials.js";
import { selectedSkillsProfile } from "./instance-credentials.js";
import { selectedCliSkillsCredentialProfile } from "./cli-credential-profile.js";
import { SKILLS_PRODUCT_DEFAULT_ORIGIN } from "./product-default.js";
import { HostedApiError, RemoteSkillsAuthClient } from "./remote-auth.js";

type Env = Record<string, string | undefined>;

/** The CLI's device-authorization client label, recorded by the server. */
export const SKILLS_CLI_DEVICE_CLIENT = "skills-cli";

// Match the hosted grant issued directly by device and first-login flows.
// Generic API-key creation keeps its separate, narrower server default.
const HOSTED_CLI_API_KEY_SCOPES = [
  "skills:read",
  "skills:run",
  "runs:read",
  "connectors:read",
  "connectors:write",
  "billing:read",
  "billing:write",
] as const;

/** RFC 8628 §3.5: every slow_down adds five seconds to the polling interval. */
export const SLOW_DOWN_INCREMENT_MS = 5_000;

const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 60_000;
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_EXPIRES_IN_SECONDS = 900;

export interface DeviceAuthorizationStart {
  /** Bearer capability for the pending key. Never printed; stored owner-only. */
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

/** What a successful sign-in returns: the key (or a session to mint one) and who signed in. */
export interface SignInResult {
  apiKey?: string;
  token?: string;
  user?: { id?: string; email?: string; role?: string };
  organization?: { id?: string; slug?: string; name?: string };
  firstLogin?: boolean;
}

export type DevicePollOutcome =
  | { status: "authorized"; result: SignInResult }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "denied" }
  | { status: "timeout" }
  | { status: "cancelled" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, max = 2048): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined;
}

function httpUrl(value: unknown): string | undefined {
  const text = boundedText(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? text : undefined;
  } catch {
    return undefined;
  }
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clampIntervalMs(seconds: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(seconds * 1000)));
}

/** Validate the server's device-start answer; a malformed one is refused, never guessed at. */
export function parseDeviceAuthorizationStart(body: unknown): DeviceAuthorizationStart {
  const record = isRecord(body) ? body : {};
  if (typeof record.error === "string") {
    throw new Error(typeof record.detail === "string" ? record.detail : record.error);
  }
  const deviceCode = boundedText(record.deviceCode, 512);
  const userCode = boundedText(record.userCode, 64);
  const verificationUri = httpUrl(record.verificationUri);
  if (!deviceCode || !userCode || !verificationUri) {
    throw new Error("The Skills server returned an incomplete device sign-in (deviceCode, userCode and verificationUri are required)");
  }
  const verificationUriComplete = httpUrl(record.verificationUriComplete);
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(verificationUriComplete ? { verificationUriComplete } : {}),
    expiresIn: positiveNumber(record.expiresIn, DEFAULT_EXPIRES_IN_SECONDS),
    interval: positiveNumber(record.interval, DEFAULT_INTERVAL_SECONDS),
  };
}

/** Ask the instance for a device code. Sends no credential. */
export async function startDeviceAuthorization(origin: string, client = SKILLS_CLI_DEVICE_CLIENT): Promise<DeviceAuthorizationStart> {
  const body = await new RemoteSkillsAuthClient(origin).request("/api/auth/device/start", {
    method: "POST",
    body: JSON.stringify({ client }),
  });
  return parseDeviceAuthorizationStart(body);
}

/** One poll of the token endpoint. Sends only the device code. */
export function pollDeviceToken(origin: string, deviceCode: string): Promise<unknown> {
  return new RemoteSkillsAuthClient(origin).request("/api/auth/device/token", {
    method: "POST",
    body: JSON.stringify({ deviceCode }),
  });
}

/** The RFC 8628 error code carried by a token-endpoint failure, if any. */
function deviceErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HostedApiError) &&
      !(isRecord(error) && (error as { name?: unknown }).name === "HostedApiError")) return undefined;
  const failure = error as HostedApiError;
  const named = [failure.code, failure.detail, failure.message].find((value) =>
    value === "slow_down" || value === "authorization_pending" || value === "expired_token" ||
    value === "invalid_device_code" || value === "access_denied");
  if (named) return named;
  if (failure.status === 429) return "slow_down";
  if (failure.status === 410) return "expired_token";
  return undefined;
}

function abortableSleep(signal?: AbortSignal): (ms: number) => Promise<void> {
  return (ms) => new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface PollDeviceAuthorizationInput {
  /** One token-endpoint request. Resolves with the body or throws HostedApiError. */
  poll: () => Promise<unknown>;
  intervalSeconds: number;
  /** Epoch milliseconds after which polling stops with `timeout`. */
  deadline: number;
  signal?: AbortSignal;
  /** Called with the new interval each time the server asks to slow down. */
  onSlowDown?: (intervalMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Poll until the user approves, the code expires, or the deadline passes.
 *
 * Transport failures and unexpected server errors are thrown, never read as
 * "still pending": a sign-in that cannot reach its server must say so.
 */
export async function pollDeviceAuthorization(input: PollDeviceAuthorizationInput): Promise<DevicePollOutcome> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? abortableSleep(input.signal);
  let intervalMs = clampIntervalMs(input.intervalSeconds);
  const wait = () => sleep(Math.min(intervalMs, Math.max(0, input.deadline - now())));
  const slowDown = () => {
    intervalMs = Math.min(MAX_INTERVAL_MS * 2, intervalMs + SLOW_DOWN_INCREMENT_MS);
    input.onSlowDown?.(intervalMs);
  };

  for (;;) {
    if (input.signal?.aborted) return { status: "cancelled" };
    if (now() >= input.deadline) return { status: "timeout" };

    let body: unknown;
    try {
      body = await input.poll();
    } catch (error) {
      switch (deviceErrorCode(error)) {
        case "authorization_pending": await wait(); continue;
        case "slow_down": slowDown(); await wait(); continue;
        case "expired_token": return { status: "expired" };
        case "invalid_device_code": return { status: "invalid" };
        case "access_denied": return { status: "denied" };
        default: throw error;
      }
    }

    const record = isRecord(body) ? body : {};
    const code = typeof record.error === "string" ? record.error : undefined;
    if (code === "authorization_pending" || (code === undefined && record.status === "pending")) { await wait(); continue; }
    if (code === "slow_down") { slowDown(); await wait(); continue; }
    if (code === "expired_token") return { status: "expired" };
    if (code === "invalid_device_code") return { status: "invalid" };
    if (code === "access_denied") return { status: "denied" };
    if (code) throw new Error(typeof record.detail === "string" ? record.detail : code);
    return { status: "authorized", result: record as SignInResult };
  }
}

// ── Pending device session (resume with `skills login --poll`) ──────────────

export interface PendingDeviceSignIn {
  origin: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  interval: number;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** `device-login[-<profile>]`: the file-name stem for this profile's pending sessions. */
function pendingDeviceSignInStem(env: Env): { dir: string; stem: string } {
  const file = skillsCredentialFilePath(env);
  return { dir: dirname(file), stem: basename(file).replace(/^credentials/, "device-login") };
}

/**
 * Beside the credentials file, one per profile AND instance:
 * `device-login[-<profile>]-<origin hash>.json`. Keyed by origin so a sign-in
 * started on one server never overwrites a pending session for another.
 */
export function pendingDeviceSignInPath(origin: string, env: Env = process.env): string {
  const { dir, stem } = pendingDeviceSignInStem(env);
  return join(dir, `${stem}-${createHash("sha256").update(origin).digest("hex").slice(0, 16)}.json`);
}

export function savePendingDeviceSignIn(origin: string, start: DeviceAuthorizationStart, env: Env = process.env, now = Date.now()): string {
  const path = pendingDeviceSignInPath(origin, env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pending: PendingDeviceSignIn = {
    origin,
    deviceCode: start.deviceCode,
    userCode: start.userCode,
    verificationUri: start.verificationUri,
    ...(start.verificationUriComplete ? { verificationUriComplete: start.verificationUriComplete } : {}),
    interval: start.interval,
    expiresAt: now + start.expiresIn * 1000,
  };
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(pending) + "\n", { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  return path;
}

/**
 * The saved session for exactly this instance, if it has not expired. A session
 * saved for a different instance is never returned, so its device code is only
 * ever sent back to the server that issued it.
 */
export function loadPendingDeviceSignIn(origin: string, env: Env = process.env, now = Date.now()): PendingDeviceSignIn | null {
  let path: string;
  let parsed: unknown;
  try {
    path = pendingDeviceSignInPath(origin, env);
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const deviceCode = boundedText(parsed.deviceCode, 512);
  const userCode = boundedText(parsed.userCode, 64);
  const verificationUri = httpUrl(parsed.verificationUri);
  const expiresAt = Number(parsed.expiresAt);
  if (parsed.origin !== origin || !deviceCode || !userCode || !verificationUri || !Number.isFinite(expiresAt)) return null;
  if (expiresAt <= now) {
    clearPendingDeviceSignIn(env, origin);
    return null;
  }
  const verificationUriComplete = httpUrl(parsed.verificationUriComplete);
  return {
    origin,
    deviceCode,
    userCode,
    verificationUri,
    ...(verificationUriComplete ? { verificationUriComplete } : {}),
    interval: positiveNumber(parsed.interval, DEFAULT_INTERVAL_SECONDS),
    expiresAt,
  };
}

/** The instances with an unexpired pending sign-in for this profile. */
export function pendingDeviceSignInOrigins(env: Env = process.env, now = Date.now()): string[] {
  let location: { dir: string; stem: string };
  try { location = pendingDeviceSignInStem(env); } catch { return []; }
  let entries: string[];
  try { entries = readdirSync(location.dir); } catch { return []; }
  const origins: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(`${location.stem}-`) || !/-[0-9a-f]{16}\.json$/.test(entry)) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(location.dir, entry), "utf8")) as unknown;
      if (isRecord(parsed) && typeof parsed.origin === "string" && Number(parsed.expiresAt) > now &&
          pendingDeviceSignInPath(parsed.origin, env) === join(location.dir, entry)) origins.push(parsed.origin);
    } catch {}
  }
  return origins.sort();
}

/** Forget the pending session for one instance, or every pending session of this profile. */
export function clearPendingDeviceSignIn(env: Env = process.env, origin?: string): void {
  if (origin !== undefined) {
    try { unlinkSync(pendingDeviceSignInPath(origin, env)); } catch {}
    return;
  }
  let location: { dir: string; stem: string };
  try { location = pendingDeviceSignInStem(env); } catch { return; }
  let entries: string[];
  try { entries = readdirSync(location.dir); } catch { return; }
  const own = new RegExp(`^${location.stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[0-9a-f]{16}\\.json$`);
  for (const entry of entries) {
    if (own.test(entry)) {
      try { unlinkSync(join(location.dir, entry)); } catch {}
    }
  }
}

// ── Completing a sign-in ────────────────────────────────────────────────────

/**
 * Store the key a sign-in produced, bound to the instance that issued it.
 * A session-only answer (a token, no key) mints a CLI key first.
 */
export async function persistSignIn(
  result: SignInResult,
  origin: string,
  env: Env = process.env,
  issuedBy: StoredKeyIssuer = "sign-in",
): Promise<string> {
  let apiKey = typeof result.apiKey === "string" && result.apiKey.trim() ? result.apiKey : undefined;
  if (!apiKey && typeof result.token === "string" && result.token) {
    const created = await new RemoteSkillsAuthClient(origin).request("/api/auth/keys", {
      method: "POST",
      headers: { Authorization: `Bearer ${result.token}` },
      body: JSON.stringify({ name: "cli", scopes: HOSTED_CLI_API_KEY_SCOPES }),
    });
    apiKey = isRecord(created) && typeof created.key === "string" && created.key.trim() ? created.key : undefined;
  }
  if (!apiKey) throw new Error("Sign-in succeeded but the server returned no API key");
  return saveAuthConfig({
    apiKey,
    ...(boundedText(result.user?.email) ? { email: result.user!.email } : {}),
    ...(boundedText(result.organization?.id) ? { orgId: result.organization!.id } : {}),
    ...(boundedText(result.organization?.slug) ? { orgSlug: result.organization!.slug } : {}),
    ...(boundedText(result.user?.id) ? { userId: result.user!.id } : {}),
  }, env, origin, issuedBy);
}

// ── Signing out ─────────────────────────────────────────────────────────────
//
// Instructions rule global-cli-logout-semantics (v1, ratified 2026-09-23;
// Knowledge k_muefop2y_im709a; #asks 797728). In short:
//   1. Only the credential `skills login` stored for the active profile is
//      revoked or deleted. Environment variables, flags, the Keychain and other
//      profiles are never touched; a credential login did not store is left in
//      place, named, and the command exits non-zero.
//   2. Login-minted keys are revoked by default (best-effort); user-brought keys
//      only with an explicit --revoke. A login-minted key that cannot be revoked
//      is deleted, the output says where to revoke it by hand, exit non-zero.
//   3. Local deletion happens first and never depends on revocation. Exit 0 only
//      when signed out; any non-zero reason wins.
//   4. Revocation goes only to the origin the credential is bound to, never
//      follows a redirect, and never reaches a public host for a gateway key.
//   5. Already signed out says so. No credential is ever printed.
//   7. A profile pointer left behind is named, never silently followed.

/**
 * What happened to server-side revocation.
 *
 *   revoked        — the server confirmed it revoked the key.
 *   already_ended  — the server no longer accepts the key (HTTP 401/403).
 *   not_requested  — a user-brought key deleted without --revoke (still works).
 *   skipped        — --no-revoke on a login-minted key (may still be live).
 *   unsupported    — cannot be revoked: the server has no revoke route
 *                    (404/405/501), the internal gateway has no login service,
 *                    or an older sign-in left no record of how it was issued.
 *   not_revoked    — the server answered without confirming revocation.
 *   failed         — the request did not complete (network, 5xx, bad answer).
 *   none           — no credential stored by `skills login` to revoke.
 */
export type RevocationOutcome =
  | "revoked" | "already_ended" | "not_requested" | "skipped" | "unsupported" | "not_revoked" | "failed" | "none";

/** A stable reason code plus one plain sentence. Never contains a credential. */
export interface SignOutReason {
  code:
    | "revocation_failed"
    | "revocation_not_confirmed"
    | "revocation_unsupported"
    | "revocation_skipped"
    | "credential_not_from_login"
    | "credential_still_active"
    | "local_delete_failed";
  message: string;
}

export interface SignOutResult {
  /** Exit 0 when true: every reason list is empty. */
  signedOut: boolean;
  /** What happened to the active profile's stored credential. */
  stored: "deleted" | "none" | "left_alone" | "delete_failed";
  storedBy?: StoredCredentialOrigin;
  /** The credentials file, when one holds a credential. */
  file?: string;
  /** The instance the stored credential belongs to. */
  origin?: string;
  revocation: RevocationOutcome;
  /** Sentences for a human: what was done, in order. */
  notes: string[];
  /** Why the command must exit non-zero. Empty when signed out. */
  reasons: SignOutReason[];
}

export interface SignOutOptions {
  /**
   * true: also revoke a user-brought or legacy key (`--revoke`).
   * false: revoke nothing (`--no-revoke`); a login-minted key left live exits non-zero.
   * undefined: the default — revoke only what login minted.
   */
  revoke?: boolean;
  env?: Env;
  /** Resolution controls (a fake Keychain in tests). */
  fleet?: SkillsFleetOptions;
  /**
   * A profile the ENVIRONMENT selects that differs from the active one, e.g.
   * `HASNA_PROFILE=b skills --profile a logout`. If it still holds a credential,
   * the next plain command uses it, so logout names it and exits non-zero.
   */
  environmentProfile?: string;
}

/** Where a person revokes a key by hand. Never a composed URL. */
export function manualRevocationHint(origin: string): string {
  if (origin === SKILLS_PRODUCT_DEFAULT_ORIGIN) {
    return `in your ${new URL(SKILLS_PRODUCT_DEFAULT_ORIGIN).host} account under Settings → API keys`;
  }
  return `wherever API keys are managed for ${origin}`;
}

/**
 * Ask the credential's own server to revoke it. Only `origin` — the instance
 * the credential is bound to — is ever contacted; the transport refuses
 * redirects, and the internal gateway (no login contract) is refused before
 * any request is made.
 */
async function revokeStoredKey(origin: string, apiKey: string): Promise<{ outcome: RevocationOutcome; detail?: string }> {
  let body: unknown;
  try {
    body = await new RemoteSkillsAuthClient(origin).request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({}),
    });
  } catch (error) {
    if (isSkillsFleetCredentialError(error) && error.code === "GATEWAY_AUTH_UNAVAILABLE") {
      return { outcome: "unsupported", detail: "the internal gateway has no sign-in service" };
    }
    if (error instanceof HostedApiError && error.status !== undefined) {
      if (error.status === 404 || error.status === 405 || error.status === 501) return { outcome: "unsupported", detail: `the server has no revoke endpoint (HTTP ${error.status})` };
      if (error.status === 401 || error.status === 403) return { outcome: "already_ended" };
      return { outcome: "failed", detail: `HTTP ${error.status}` };
    }
    return { outcome: "failed", detail: "the server could not be reached" };
  }
  if (isRecord(body) && body.revoked === true) return { outcome: "revoked" };
  return { outcome: "not_revoked", detail: "the server answered without confirming revocation" };
}

/** The credential source the ladder would use now, by NAME (a variable, a Keychain item or a path), or null. */
function activeCredentialSource(env: Env, options: SkillsFleetOptions, profile?: string): string | null {
  try {
    return resolveCredential("skills", env, {
      ...options.credentials,
      profile: profile ?? options.credentials?.profile ?? selectedSkillsProfile(env) ?? undefined,
    })?.source ?? null;
  } catch {
    // A deliberate selection that cannot be honoured (for example a profile
    // with no key) is not an active credential: the next command fails naming it.
    return null;
  }
}

export async function signOut(options: SignOutOptions = {}): Promise<SignOutResult> {
  const env = options.env ?? process.env;
  const fleet = options.fleet ?? {};
  const notes: string[] = [];
  const reasons: SignOutReason[] = [];
  const stored = readStoredCredential(env);
  let storedState: SignOutResult["stored"] = "none";
  let revocation: RevocationOutcome = "none";

  clearPendingDeviceSignIn(env);

  // A vault reference (no key in the file) is never something login stored.
  if (stored && (stored.storedBy === "external" || stored.apiKey === null)) {
    storedState = "left_alone";
    reasons.push({
      code: "credential_not_from_login",
      message: `${stored.file} holds a Skills credential that \`skills login\` did not store (for example a provisioned key or a vault reference). ` +
        "It was left in place; remove it there to sign this profile out.",
    });
  } else if (stored) {
    // 1. Local deletion first. The key stays in memory only for the revoke call.
    const apiKey = stored.apiKey;
    try {
      deleteStoredCredential(env, stored.urlWrittenByLogin);
      storedState = "deleted";
      notes.push(stored.urlWrittenByLogin
        ? `Removed the stored key and the server URL sign-in had saved (${stored.origin}) from ${stored.file}.`
        : `Removed the stored key from ${stored.file}.`);
    } catch (error) {
      storedState = "delete_failed";
      reasons.push({ code: "local_delete_failed", message: `Could not remove the stored key from ${stored.file}: ${(error as Error).message}` });
    }

    // 2. Revocation, decided by who created the key.
    const where = manualRevocationHint(stored.origin);
    const wantsRevoke = options.revoke === true || (options.revoke === undefined && stored.storedBy === "sign-in");
    if (!wantsRevoke) {
      if (stored.storedBy === "sign-in") {
        revocation = "skipped";
        reasons.push({ code: "revocation_skipped", message: `The key was not revoked (--no-revoke) and may still be live: revoke it ${where}.` });
      } else if (stored.storedBy === "api-key") {
        revocation = "not_requested";
        notes.push(`This was an API key you added, so it was only removed from this machine. It still works until you revoke it ${where} (or run: skills logout --revoke).`);
      } else {
        revocation = "unsupported";
        reasons.push({
          code: "revocation_unsupported",
          message: `An older sign-in stored this key without recording how it was issued, so it was not revoked automatically. Revoke it ${where}, or run: skills logout --revoke on a fresh sign-in.`,
        });
      }
    } else {
      const result = await revokeStoredKey(stored.origin, apiKey as string);
      revocation = result.outcome;
      switch (result.outcome) {
        case "revoked":
          notes.push(`Revoked the key on ${stored.origin}.`);
          break;
        case "already_ended":
          notes.push(`${stored.origin} no longer accepts this key; its session had already ended.`);
          break;
        case "unsupported":
          reasons.push({ code: "revocation_unsupported", message: `${stored.origin} cannot revoke this key (${result.detail}). It was removed from this machine; revoke it by hand ${where}.` });
          break;
        case "not_revoked":
          reasons.push({ code: "revocation_not_confirmed", message: `${stored.origin} did not confirm revoking this key (${result.detail}). It may still be live: revoke it ${where}.` });
          break;
        default:
          reasons.push({ code: "revocation_failed", message: `Could not revoke the key on ${stored.origin} (${result.detail}). It may still be live: revoke it ${where}.` });
      }
    }
  }

  // 3. Anything that still authenticates, named and left untouched.
  const still = activeCredentialSource(env, fleet);
  if (still && !(storedState === "left_alone" && still === stored?.file)) {
    reasons.push({
      code: "credential_still_active",
      message: `Not fully signed out: ${still} still provides a Skills credential. It was not changed; unset or remove it to finish signing out.`,
    });
  }
  const selected = selectedSkillsProfile(env);
  const other = options.environmentProfile;
  if (other !== undefined && other !== selected) {
    const otherSource = activeCredentialSource({ ...env, HASNA_PROFILE: other }, fleet, other);
    if (otherSource) {
      reasons.push({
        code: "credential_still_active",
        message: `Not fully signed out: HASNA_PROFILE=${other} in your environment selects a profile that still has a credential (${otherSource}). It was not changed.`,
      });
    }
  }
  if (selected && !still) {
    notes.push(selectedCliSkillsCredentialProfile()
      ? `--profile selected profile "${selected}", which now has no credential. A future command with the same flag will stop and name it until you run skills login for that profile.`
      : `HASNA_PROFILE still selects profile "${selected}", which now has no credential. The next command will stop and name it until you run skills login or unset HASNA_PROFILE.`);
  }

  if (!stored && reasons.length === 0) notes.push("Already signed out: this profile has no credential stored by skills login.");

  return {
    signedOut: reasons.length === 0,
    stored: storedState,
    ...(stored ? { storedBy: stored.storedBy, file: stored.file, origin: stored.origin } : {}),
    revocation,
    notes,
    reasons,
  };
}

// ── Who is signed in ────────────────────────────────────────────────────────

export type SignedInAccount =
  | { signedIn: false; reason: string }
  | { signedIn: true; apiOrigin: string; source: string; email?: string; organization?: string; error?: string };

/** The account in effect, for a compact display (the TUI's `/whoami`). */
export async function readSignedInAccount(env: Env = process.env): Promise<SignedInAccount> {
  let connection: Awaited<ReturnType<typeof resolveSkillsConnection>>;
  try {
    connection = await resolveSkillsConnection(env);
  } catch (error) {
    if (isSkillsFleetCredentialError(error)) return { signedIn: false, reason: error.message };
    throw error;
  }
  if (!connection) return { signedIn: false, reason: "Local mode (HASNA_SKILLS_LOCAL=1): not signed in. Run: skills login" };
  const base = { signedIn: true as const, apiOrigin: connection.apiOrigin, source: connection.apiKeySource };
  try {
    const body = await new RemoteSkillsAuthClient(connection.apiOrigin).request("/api/auth/whoami", {
      headers: { Authorization: `Bearer ${connection.apiKey}` },
    });
    const record = isRecord(body) ? body : {};
    const data = isRecord(record.data) ? record.data : {};
    const user = isRecord(record.user) ? record.user : isRecord(data.user) ? data.user : {};
    const organization = isRecord(record.organization) ? record.organization : isRecord(data.organization) ? data.organization : {};
    const email = boundedText(user.email, 320);
    const org = boundedText(organization.slug, 200) ?? boundedText(organization.name, 200);
    return { ...base, ...(email ? { email } : {}), ...(org ? { organization: org } : {}) };
  } catch (error) {
    return { ...base, error: error instanceof HostedApiError && error.status !== undefined ? `whoami failed (HTTP ${error.status})` : "whoami failed" };
  }
}

// ── Browser ─────────────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The verification page to open, or null when it must only be printed.
 *
 * The URL comes from the server's answer, so it is opened only when it is an
 * https URL (http only on loopback) with no userinfo, on the sign-in origin
 * itself or on `auth.<sign-in host>` — where rule global-product-auth-url-layout
 * will move the identity endpoints. Anything else is printed for the user to
 * judge and never handed to the operating system.
 */
export function verificationUrlToOpen(raw: string, signInOrigin: string): string | null {
  let url: URL;
  let origin: URL;
  try {
    url = new URL(raw);
    origin = new URL(signInOrigin);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && loopback))) return null;
  const sameOrigin = url.origin === origin.origin;
  const authHost = url.protocol === "https:" && origin.protocol === "https:" && url.port === origin.port && url.hostname === `auth.${origin.hostname}`;
  return sameOrigin || authHost ? url.href : null;
}

/**
 * The opener argv for a platform. Never a shell: on Windows `cmd /c start`
 * would re-parse `&`, `|` and `^` in a server-provided URL, so the URL goes to
 * the URL protocol handler as one argument instead.
 */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): string[] {
  const href = new URL(url).href;
  if (platform === "darwin") return ["open", href];
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", href];
  return ["xdg-open", href];
}

/**
 * Best effort: the URL and code are always printed too, so a refusal or a
 * failure here costs nothing. Returns whether a browser was asked to open it.
 */
export function openVerificationPage(url: string, signInOrigin: string): boolean {
  const safe = verificationUrlToOpen(url, signInOrigin);
  if (!safe) return false;
  try {
    Bun.spawn(browserCommand(safe), { stdout: "ignore", stderr: "ignore" });
    return true;
  } catch {
    return false;
  }
}
