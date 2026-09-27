import { loginWorkspace } from "./workspace-selection.js";
import { captureProfileWorkspace } from "../../lib/workspace-profile.js";
import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { getAuthConfig, getAuthIdentity, getApiUrl, getAuthFilePath, saveAuthConfig } from "../../lib/auth-store.js";
import { gatewaySignInRefusal, resolveSkillsFleet, resolveSkillsConnection, resolveSkillsSignInOrigin, SkillsFleetCredentialError, SKILLS_API_KEY_ENV, SKILLS_API_URL_ENV, type SignInTarget } from "../../lib/fleet-credentials.js";
import { RemoteSkillsClient } from "../../lib/remote-client.js";
import { getEnvironmentProfile } from "../profile-selection.js";
import type { RemoteSkillsAccess } from "../../lib/remote-permissions.js";
import {
  clearPendingDeviceSignIn,
  loadPendingDeviceSignIn,
  openVerificationPage,
  pendingDeviceSignInOrigins,
  persistSignIn,
  pollDeviceAuthorization,
  pollDeviceToken,
  savePendingDeviceSignIn,
  signOut,
  startDeviceAuthorization,
  type PendingDeviceSignIn,
  type SignInResult,
} from "../../lib/sign-in.js";


const isTTY = process.stdin.isTTY && process.stdout.isTTY;
const DEFAULT_DEVICE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

import { HostedApiError, RemoteSkillsAuthClient } from "../../lib/remote-auth.js";
const CONFIG_HINT_STATUSES = new Set([401, 403, 404, 405, 501]);



function prompt(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: string | null) => {
      if (settled) return;
      settled = true;
      rl.close();
      if (answer === null) process.exitCode = 130;
      resolve(answer);
    };
    rl.once("SIGINT", () => finish(null));
    rl.once("close", () => finish(null));
    rl.question(question, answer => finish(answer.trim()));
  });
}
function authForPrompt() {
  try { return getAuthConfig(); }
  catch (error) {
    if (error instanceof SkillsFleetCredentialError && error.code === "MISSING_API_CREDENTIAL") return null;
    throw error;
  }
}

async function apiRequest(path: string, options?: RequestInit, instance?: string) {
  const origin = instance ?? getApiUrl(`${(options?.method || "GET").toUpperCase()} ${path}`);
  return new RemoteSkillsAuthClient(origin).request(path, options);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function commandErrorPayload(err: unknown, fallback: string): Record<string, unknown> {
  if (err instanceof HostedApiError) {
    return {
      error: err.message || fallback,
      ...(err.status !== undefined ? { status: err.status } : {}),
      ...(err.code ? { code: err.code } : {}),
      ...(err.detail && err.detail !== err.message ? { detail: err.detail } : {}),
      ...(err.endpoint ? { endpoint: err.endpoint } : {}),
      ...(err.apiUrl ? { apiUrl: err.apiUrl } : {}),
    };
  }
  const code = isRecord(err) && typeof err.code === "string" ? err.code : undefined;
  return {
    error: (err as Error)?.message || fallback,
    ...(code ? { code } : {}),
    ...(isRecord(err) && Array.isArray(err.next) ? { next: err.next } : {}),
  };
}

function writeCommandError(err: unknown, fallback: string, json?: boolean): void {
  const payload = commandErrorPayload(err, fallback);
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
    return;
  }

  const message = String(payload.detail || payload.error || fallback);
  const status = typeof payload.status === "number" ? payload.status : undefined;
  const showStatus = status !== undefined && !message.startsWith(String(status));
  console.error(chalk.red(showStatus ? `${message} (HTTP ${status})` : message));
  if (payload.endpoint) console.error(chalk.dim(`Endpoint: ${payload.endpoint}`));
  if (status !== undefined && CONFIG_HINT_STATUSES.has(status)) {
    console.error(chalk.dim(`Hint: check ${SKILLS_API_URL_ENV} (currently ${payload.apiUrl}) or run: skills setup`));
  }
  process.exitCode = 1;
}

/**
 * Which rung of the fleet ladder supplied the credential in effect.
 *
 * Reported, never re-resolved: `whoami` shows the operator where the key it just
 * used came from — an env key NAME, a Keychain item reference, or a file path —
 * so a stale export and a rotated file are told apart at a glance. Never a value.
 */
function credentialSource(): string | null {
  try {
    const fleet = resolveSkillsFleet();
    return fleet.mode === "hosted" ? fleet.apiKeySource : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function identityApiKey(live: unknown): unknown {
  const root = recordField(live);
  return root && Object.hasOwn(root, "apiKey") ? root.apiKey : recordField(root?.data)?.apiKey;
}

function authIdentityPayload(
  authSource: string,
  live: unknown,
  cached?: { email?: string; orgId?: string; orgSlug?: string; userId?: string } | null,
  offline = false,
): Record<string, unknown> {
  const root = recordField(live) ?? {};
  const data = recordField(root.data);
  const user = recordField(root.user) ?? recordField(data?.user);
  const organization = recordField(root.organization) ?? recordField(root.org) ?? recordField(data?.organization);
  const email = stringField(user?.email) ?? cached?.email;
  const orgSlug = stringField(organization?.slug) ?? cached?.orgSlug;
  const orgName = stringField(organization?.name);
  const userId = stringField(user?.id) ?? cached?.userId;
  const orgId = stringField(organization?.id) ?? cached?.orgId;
  const role = stringField(user?.role);
  const apiKey = recordField(identityApiKey(live));
  const apiKeyId = stringField(apiKey?.id);
  const apiKeyScopes = apiKey?.scopes;
  const safeApiKeyId = apiKeyId && /^[A-Za-z0-9_-]{1,256}$/.test(apiKeyId) ? apiKeyId : undefined;
  const safeApiKeyScopes = Array.isArray(apiKeyScopes) && apiKeyScopes.length <= 32 && apiKeyScopes.every((scope) => typeof scope === "string" && scope.length <= 128 && /^(?:\*|[a-z][a-z0-9_-]*:(?:\*|[a-z][a-z0-9_-]*))$/.test(scope)) ? [...apiKeyScopes] : undefined;

  return {
    status: "authenticated",
    authSource,
    ...(offline ? { offline: true } : {}),
    ...(email ? { email } : {}),
    ...(orgSlug ? { organization: orgSlug } : {}),
    ...(orgName ? { organizationName: orgName } : {}),
    ...(userId ? { userId } : {}),
    ...(orgId ? { orgId } : {}),
    ...(role ? { role } : {}),
    ...(safeApiKeyId && safeApiKeyScopes ? { apiKeyId: safeApiKeyId, scopes: safeApiKeyScopes } : {}),
  };
}

function printWhoami(payload: Record<string, unknown>): void {
  if (payload.email) console.log(chalk.bold("Email:  ") + payload.email);
  if (payload.organization) console.log(chalk.bold("Org:    ") + payload.organization);
  if (payload.role) console.log(chalk.bold("Role:   ") + payload.role);
  if (payload.apiKeyId) console.log(chalk.bold("Key:    ") + payload.apiKeyId);
  if (payload.organizationName) console.log(chalk.bold("Name:   ") + payload.organizationName);
  if (payload.authSource) console.log(chalk.dim(`Auth:   ${payload.authSource}`));
  const permissions = recordField(payload.permissions);
  if (permissions) {
    const label = (value: unknown) => value === true ? "allowed" : value === false ? "denied" : "unknown";
    console.log(`Publish: ${label(permissions.publish)}`);
    console.log(`Profiles write: ${label(permissions.profilesWrite)}`);
  }
  if (payload.offline) console.log(chalk.dim("(offline — showing cached info)"));
}

/**
 * Where this sign-in goes, or null after reporting why it cannot go anywhere.
 * A target on the internal gateway (which has no sign-in service) is refused
 * here, before any request, naming what to unset.
 */
function signInTarget(url: string | undefined, json?: boolean): SignInTarget | null {
  try {
    const target = resolveSkillsSignInOrigin(process.env, {}, url);
    const refusal = gatewaySignInRefusal(target);
    if (refusal) throw refusal;
    return target;
  } catch (error) {
    writeCommandError(error, "Could not select a Skills server to sign in to", json);
    return null;
  }
}

/** The flag that selects this target again, for a printed follow-up command. */
function targetFlag(target: SignInTarget): string {
  return target.source === "--url" ? ` --url ${target.origin}` : "";
}

/**
 * Print a completed sign-in and, on a terminal, offer the agent MCP setup so
 * the account "just works" in Claude, Codex and the rest. Non-interactive runs
 * print the same next step instead of changing agent configuration unasked.
 */
async function finishSignIn(result: SignInResult, target: SignInTarget, json?: boolean): Promise<void> {
  const email = result.user?.email;
  const organization = result.organization?.slug;
  if (json || !isTTY) {
    console.log(JSON.stringify({
      status: "authenticated",
      ...(email ? { email } : {}),
      ...(organization ? { organization } : {}),
      ...(result.firstLogin !== undefined ? { firstLogin: result.firstLogin } : {}),
      apiUrl: target.origin,
      next: ["skills setup agents"],
    }));
    return;
  }

  console.log(chalk.green(`\n✓ Signed in${email ? ` as ${email}` : ""}`));
  if (result.organization?.name) console.log(chalk.dim(`  Organization: ${result.organization.name}`));
  console.log(chalk.dim(`  Server: ${target.origin}`));
  // The real path, not an assumed one: HASNA_HOME / HASNA_CONFIG_HOME relocate
  // the credentials file the shared ladder reads.
  console.log(chalk.dim(`  API key saved to ${getAuthFilePath()}`));
  await offerAgentSetup();
}

async function offerAgentSetup(): Promise<void> {
  // Optional: declining or interrupting it never turns a completed sign-in into a failure.
  const before = process.exitCode;
  const answer = await prompt("\nRegister Skills with your coding agents now (skills setup agents)? [Y/n] ");
  if (answer === null) {
    // `undefined` does not reset an exit code once set, so restore explicitly.
    process.exitCode = before ?? 0;
    console.log(chalk.dim("\nSkipped. Run it any time: skills setup agents"));
    return;
  }
  if (answer !== "" && !/^y(es)?$/i.test(answer)) {
    console.log(chalk.dim("Skipped. Run it any time: skills setup agents"));
    return;
  }
  // Sign-in already succeeded; an agent that is not installed must not turn
  // that into a failed command. Each registration prints its own result.
  const { handleMcp } = await import("./runtime-mcp.js");
  await handleMcp({ register: "all", json: false });
  process.exitCode = before ?? 0;
}

/** Read one line without echoing it (an API key typed at a terminal). */
function promptHidden(question: string): Promise<string | null> {
  const stdin = process.stdin;
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    const done = (answer: string | null) => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      process.stdout.write("\n");
      if (answer === null) process.exitCode = 130;
      resolve(answer);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") return done(value.trim());
        if (character === "\u0003" || character === "\u0004") return done(null);
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/**
 * The key for `--api-key` given without a value: stdin, like
 * `codex login --with-api-key`. A key on the command line is visible to every
 * process listing and lands in shell history; stdin is neither.
 */
async function readApiKeyInput(): Promise<string | null> {
  if (process.stdin.isTTY) return promptHidden("API key (input hidden): ");
  const text = (await Bun.stdin.text()).trim();
  if (text.includes("\n")) throw new Error("stdin must contain exactly one API key");
  return text;
}

async function doLogin(email: string, code: string | undefined, json: boolean | undefined, target: SignInTarget) {
  const env = { ...process.env };
  const origin = target.origin;
  if (!email || !email.includes("@")) {
    writeCommandError(new Error("Invalid email"), "Invalid email", json);
    process.exitCode = 1;
    return;
  }

  if (!code) {
    if (!json) console.log(chalk.dim(`Sending a sign-in code to ${email} from ${origin}...`));
    let sendRes: any;
    try {
      sendRes = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email }),
      }, origin);
    } catch (err) {
      writeCommandError(err, "Failed to request login code", json);
      return;
    }

    if (sendRes.error) {
      writeCommandError(new Error(sendRes.error), "Failed to request login code", json);
      return;
    }

    if (!json) console.log(chalk.green("✓ Code sent to " + email));

    if (json || !isTTY) {
      console.log(JSON.stringify({ status: "code_sent", email, message: `Check email for 6-digit code, then run: skills login --email ${email} --code <CODE>${targetFlag(target)}` }));
      return;
    }

    const answer = await prompt(chalk.bold("Code: "));
    if (answer === null) return;
    code = answer;
  }

  let verifyRes: any;
  try {
    verifyRes = await apiRequest("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }, origin);
  } catch (err) {
    writeCommandError(err, "Failed to verify login code", json);
    return;
  }

  if (verifyRes.error) {
    writeCommandError(new Error(verifyRes.error), "Failed to verify login code", json);
    return;
  }

  try {
    await persistSignIn(verifyRes, origin, env, "sign-in");
  } catch (err) {
    writeCommandError(err, "Login succeeded but API key creation failed", json);
    return;
  }

  await finishSignIn(verifyRes, target, json);
}

async function doApiKeyLogin(apiKey: string | true, json: boolean | undefined, target: SignInTarget) {
  const env = { ...process.env };
  const origin = target.origin;
  if (apiKey !== true) {
    // Kept for compatibility; a key in argv is visible to process listings and shell history.
    console.error(chalk.yellow("Warning: an API key on the command line is visible to other processes and your shell history. Pipe it on stdin instead: printenv MY_SKILLS_KEY | skills login --api-key"));
  }
  let supplied: string | null;
  try {
    supplied = apiKey === true ? await readApiKeyInput() : apiKey;
  } catch (err) {
    writeCommandError(err, "Could not read the API key", json);
    return;
  }
  if (supplied === null) return;
  const trimmed = supplied.trim();
  if (!trimmed) {
    writeCommandError(new Error("API key required (pipe it on stdin: printenv MY_SKILLS_KEY | skills login --api-key)"), "API key required", json);
    return;
  }

  let whoami: any;
  try {
    whoami = await apiRequest("/api/auth/whoami", {
      headers: { Authorization: `Bearer ${trimmed}` },
    }, origin);
  } catch (err) {
    writeCommandError(err, "Failed to verify API key", json);
    return;
  }

  const identity = authIdentityPayload("stored", whoami);
  const email = stringField(identity.email);
  const orgId = stringField(identity.orgId);
  const orgSlug = stringField(identity.organization);
  const userId = stringField(identity.userId);

  // Only what `whoami` actually returned is stored. Filling a missing identity
  // field with a placeholder both invents a fact about the user and, when the
  // placeholder names a deployment variant, hands every later reader of
  // `auth.json` a fingerprint of the instance the key belongs to.
  saveAuthConfig({
    apiKey: trimmed,
    ...(email ? { email } : {}),
    ...(orgId ? { orgId } : {}),
    ...(orgSlug ? { orgSlug } : {}),
    ...(userId ? { userId } : {}),
  }, env, origin, "api-key");

  if (json || !isTTY) {
    console.log(JSON.stringify({ ...identity, status: "authenticated", apiUrl: origin, next: ["skills setup agents"] }, null, 2));
    return;
  }

  printWhoami(identity);
  console.log(chalk.dim(`Server: ${origin}`));
  await offerAgentSetup();
}

interface DeviceLoginOptions {
  json?: boolean;
  open?: boolean;
  poll?: boolean;
  pollTimeoutMs?: string;
  /** Print the code for another device; never open a browser here. */
  device?: boolean;
}

function printDeviceCode(session: PendingDeviceSignIn, resumed: boolean, write: (line: string) => void): void {
  write(chalk.bold(resumed ? "\nResuming sign-in\n" : "\nSign in in your browser\n"));
  write(`${chalk.dim("Code:")} ${session.userCode}`);
  write(`${chalk.dim("URL:")}  ${session.verificationUriComplete || session.verificationUri}`);
}

async function doDeviceLogin(options: DeviceLoginOptions, target: SignInTarget) {
  const timeoutMs = Number(options.pollTimeoutMs ?? DEFAULT_DEVICE_POLL_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_DEVICE_POLL_TIMEOUT_MS) {
    writeCommandError(new Error("Device polling timeout must be an integer from 1 to 600000 milliseconds"), "Invalid polling timeout", options.json);
    return;
  }
  const env = { ...process.env };
  const origin = target.origin;
  const json = Boolean(options.json);
  const interactive = Boolean(isTTY && !json);
  const next = `skills login --poll${targetFlag(target)}`;

  // `--poll` finishes the session a headless `skills login --device` started:
  // the code the user already approved must not be thrown away for a new one.
  let session = options.poll ? loadPendingDeviceSignIn(origin, env) : null;
  if (options.poll && !session) {
    // Never start over (or overwrite) while another server holds a sign-in the
    // user may already have approved: name it instead.
    const others = pendingDeviceSignInOrigins(env).filter((other) => other !== origin);
    if (others.length > 0) {
      writeCommandError(new Error(
        `No pending sign-in for ${origin}. Pending: ${others.map((other) => `skills login --poll --url ${other}`).join("; ")}`,
      ), "No pending sign-in", json);
      return;
    }
  }
  const resumed = session !== null;
  if (!session) {
    try {
      const start = await startDeviceAuthorization(origin);
      savePendingDeviceSignIn(origin, start, env);
      session = loadPendingDeviceSignIn(origin, env) ?? {
        origin, ...start, expiresAt: Date.now() + start.expiresIn * 1000,
      };
    } catch (err) {
      writeCommandError(err, "Failed to start device login", json);
      return;
    }
  }

  const verificationUrl = session.verificationUriComplete || session.verificationUri;
  const shouldPoll = Boolean(options.poll || interactive);
  const expiresIn = Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000));

  if (!resumed && !options.device && options.open !== false && isTTY) {
    if (!openVerificationPage(verificationUrl, origin) && !json) {
      console.error(chalk.dim("Open the URL below in your browser (it was not opened automatically)."));
    }
  }

  if (!shouldPoll) {
    // Never the device code: it is the bearer capability for the pending key,
    // and it stays in the owner-only pending file for `skills login --poll`.
    console.log(JSON.stringify({
      status: "pending",
      userCode: session.userCode,
      verificationUri: session.verificationUri,
      ...(session.verificationUriComplete ? { verificationUriComplete: session.verificationUriComplete } : {}),
      expiresIn,
      interval: session.interval,
      next,
    }, null, 2));
    return;
  }

  if (json) {
    // stdout carries exactly one JSON document (the result); the code the user
    // has to enter goes to stderr so it is visible without breaking parsing.
    if (!resumed) console.error(JSON.stringify({ status: "pending", userCode: session.userCode, verificationUri: session.verificationUri, expiresIn }));
  } else {
    printDeviceCode(session, resumed, (line) => console.log(line));
    console.log(chalk.dim("\nWaiting for authentication..."));
  }

  let outcome: Awaited<ReturnType<typeof pollDeviceAuthorization>>;
  try {
    const deviceCode = session.deviceCode;
    outcome = await pollDeviceAuthorization({
      poll: () => pollDeviceToken(origin, deviceCode),
      intervalSeconds: session.interval,
      deadline: Math.min(Date.now() + timeoutMs, session.expiresAt),
      onSlowDown: (intervalMs) => {
        if (!json) console.error(chalk.dim(`The server asked to slow down; checking every ${Math.round(intervalMs / 1000)}s.`));
      },
    });
  } catch (err) {
    writeCommandError(err, "Failed to poll device login", json);
    return;
  }

  if (outcome.status !== "authorized") {
    const ended: Record<typeof outcome.status, string> = {
      expired: "The sign-in code expired before it was approved. Start again: skills login",
      invalid: "The server no longer recognises this sign-in code. Start again: skills login",
      denied: "Sign-in was denied in the browser.",
      timeout: `Device login timed out before browser authentication completed. Resume with: ${next}`,
      cancelled: "Sign-in cancelled.",
    };
    // A timeout keeps the session so --poll can pick it up; every other ending
    // makes the saved code useless, so it is removed.
    if (outcome.status !== "timeout") clearPendingDeviceSignIn(env, origin);
    const error = ended[outcome.status];
    if (json || !isTTY) console.log(JSON.stringify({ status: outcome.status, error, ...(outcome.status === "timeout" ? { next } : {}) }));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  try {
    await persistSignIn(outcome.result, origin, env, "sign-in");
  } catch (err) {
    writeCommandError(err, "Login succeeded but API key creation failed", json);
    return;
  }
  clearPendingDeviceSignIn(env, origin);
  await finishSignIn(outcome.result, target, json);
}

interface LoginOptions {
  url?: string;
  email?: string;
  code?: string;
  apiKey?: string | true;
  device?: boolean;
  open?: boolean;
  poll?: boolean;
  pollTimeoutMs?: string;
  json?: boolean;
}

/**
 * `skills login` and `skills auth login` (without workspace enrollment).
 * Browser sign-in by default, `--device` for another device, `--email` for an
 * email code, `--api-key` for a key read from stdin.
 */
async function runLogin(options: LoginOptions): Promise<void> {
  if (options.apiKey !== undefined && (options.device || options.poll || options.email || options.code)) {
    writeCommandError(new Error("--api-key cannot be combined with --device, --poll, --email or --code"), "Invalid login options", options.json);
    return;
  }
  if (!options.apiKey && (options.device || options.poll || (!options.email && !options.code))) {
    // Validate before resolving anything, so a bad flag never reaches a server.
    const timeoutMs = Number(options.pollTimeoutMs ?? DEFAULT_DEVICE_POLL_TIMEOUT_MS);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_DEVICE_POLL_TIMEOUT_MS) {
      writeCommandError(new Error("Device polling timeout must be an integer from 1 to 600000 milliseconds"), "Invalid polling timeout", options.json);
      return;
    }
  }
  const target = signInTarget(options.url, options.json);
  if (!target) return;

  if (options.apiKey !== undefined) {
    await doApiKeyLogin(options.apiKey, options.json, target);
    return;
  }
  if (options.device || options.poll || (!options.email && !options.code)) {
    await doDeviceLogin(options, target);
    return;
  }

  let email = options.email;
  if (!email && isTTY && !options.json) {
    const existing = authForPrompt();
    if (existing) {
      console.log(chalk.dim(`Already signed in as ${existing.email}`));
      const again = await prompt("Sign in with a different account? (y/N) ");
      if (again === null || again.toLowerCase() !== "y") return;
    }
    const answer = await prompt(chalk.bold("Email: "));
    if (answer === null) return;
    email = answer;
  }

  if (!email) {
    writeCommandError(new Error("Email required. Use: skills login --email you@example.com"), "Email required", options.json);
    return;
  }

  await doLogin(email, options.code, options.json, target);
}

/**
 * `skills logout` / `skills auth logout`, per Instructions rule
 * global-cli-logout-semantics: exit 0 only when signed out; every reason that
 * leaves a credential live or active is named and exits non-zero.
 */
async function runLogout(options: { json?: boolean; revoke?: boolean }): Promise<void> {
  const result = await signOut({ revoke: options.revoke, environmentProfile: getEnvironmentProfile() });
  if (!result.signedOut) process.exitCode = 1;
  if (options.json) {
    console.log(JSON.stringify({
      status: result.signedOut ? "signed_out" : "not_signed_out",
      stored: result.stored,
      ...(result.storedBy ? { storedBy: result.storedBy } : {}),
      ...(result.origin ? { apiUrl: result.origin } : {}),
      revocation: result.revocation,
      reasons: result.reasons,
      notes: result.notes,
    }, null, 2));
    return;
  }
  for (const note of result.notes) console.log(note);
  for (const reason of result.reasons) console.error(chalk.yellow(reason.message));
  if (result.signedOut) console.log(chalk.green(result.stored === "none" ? "Signed out." : "✓ Signed out."));
}

async function runWhoami(options: { json?: boolean }): Promise<void> {
  let fleet: Awaited<ReturnType<typeof resolveSkillsConnection>>;
  try {
    fleet = await resolveSkillsConnection();
  } catch (err) {
    writeCommandError(err, "Failed to resolve the Skills credential", options.json);
    return;
  }
  if (!fleet) {
    const payload = {
      status: "unauthenticated",
      error: `Not signed in. Run: skills login, or set ${SKILLS_API_KEY_ENV}`,
    };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else console.log(chalk.dim(payload.error));
    return;
  }

  // The recorded identity belongs to the credential THIS CLI stored. When the
  // key in effect came from anywhere else — an env var, the Keychain, an
  // override — that identity describes a different principal, and showing it
  // would attribute one key's session to another key's account.
  const cached = (fleet.apiKeyTier === "disk" || fleet.apiKeyTier === "profile") ? getAuthIdentity() : null;
  const authSource = fleet.apiKeySource;
  try {
    const res = await apiRequest("/api/auth/whoami", {
      headers: { Authorization: `Bearer ${fleet.apiKey}` },
    }, fleet.apiOrigin);
    const payload = authIdentityPayload(authSource, res, cached);
    let access: RemoteSkillsAccess | undefined;
    try { access = await new RemoteSkillsClient(fleet.apiKey, fleet.apiOrigin).getCapabilities(); }
    catch { /* Identity can succeed while an older or unavailable API cannot report access. */ }
    payload.permissions = { publish: access?.permissions?.publish ?? null, profilesWrite: access?.permissions?.profilesWrite ?? null };
    // Identity scopes are an exact snapshot used by enrollment CAS. Capability
    // scopes may be sorted; use them only when identity scopes are absent,
    // never to replace an empty array or conceal malformed identity metadata.
    const apiKey = identityApiKey(res);
    if (access?.scopes && (apiKey === undefined || (isRecord(apiKey) && !Object.hasOwn(apiKey, "scopes")))) {
      payload.scopes = access.scopes;
    }
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printWhoami(payload);
    }
  } catch (err) {
    if (cached && Object.keys(cached).length > 0 && !(err instanceof HostedApiError && err.status !== undefined && err.status < 500)) {
      const payload = authIdentityPayload(authSource, {}, cached, true);
      payload.permissions = { publish: null, profilesWrite: null };
      if (options.json) console.log(JSON.stringify(payload, null, 2));
      else printWhoami(payload);
      return;
    }
    writeCommandError(err, "Failed to fetch current account", options.json);
  }
}

/** The sign-in flags shared by `skills login` and `skills auth login`. */
function withLoginOptions(command: Command): Command {
  return command
    .option("--url <origin>", "Sign in to this Skills server instead of the default (your own instance)")
    .option("--email <email>", "Sign in with an email code (non-interactive with --code)")
    .option("--code <code>", "Verification code from the sign-in email")
    .option("--api-key [key]", "Verify and store an API key; with no value, read it from stdin")
    .option("--device", "Print a code to approve on another device; do not open a browser", false)
    .option("--no-open", "Do not open a browser")
    .option("--poll", "Wait for approval, resuming a pending `skills login --device` session", false)
    .option("--poll-timeout-ms <ms>", "Maximum time to wait for approval")
    .option("--json", "Output result as JSON", false);
}

/** `skills login`, `skills logout`, `skills whoami` — the account verbs, at the top level. */
export function registerAccountCommands(parent: Command) {
  withLoginOptions(parent
    .command("login")
    .description("Sign in (browser by default; --device, --email or --api-key; --url for your own server)"))
    .action(async (options: LoginOptions) => runLogin(options));

  parent
    .command("logout")
    .description("Sign out this profile: remove the key skills login stored, and revoke it on its server when login minted it")
    .option("--revoke", "Also revoke an API key you added with --api-key (login-minted keys are revoked by default)")
    .option("--no-revoke", "Do not ask the server to revoke anything; exits non-zero if a login-minted key is left live")
    .option("--json", "Output as JSON", false)
    .action(async (options: { json?: boolean; revoke?: boolean }) => runLogout(options));

  parent
    .command("whoami")
    .description("Show the signed-in account")
    .option("--json", "Output as JSON", false)
    .action(async (options: { json?: boolean }) => runWhoami(options));
}

export function registerAuth(parent: Command) {
  const auth = parent
    .command("auth")
    .description("Manage account authentication");

  const keys = auth.command("keys").description("Manage API keys on the configured instance");
  keys.command("list").option("--json", "Output as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .action(async (options: { json: boolean; email: string; code: string }) => {
      try { const target = await captureProfileWorkspace("List API keys"); target.unchanged(); console.log(JSON.stringify(await new RemoteSkillsAuthClient(target.origin).listApiKeys(options.email, options.code, target.context), null, 2)); }
      catch (error) { writeCommandError(error, "Failed to list API keys", options.json); }
    });
  keys.command("create").argument("<name>").option("--scope <scope>", "Limit key scope (repeatable)", (value: string, all: string[]) => [...all, value], [] as string[])
    .option("--json", "Output the newly created key as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .description("Create a key; the returned secret is shown once and must be stored securely")
    .action(async (name: string, options: { json: boolean; scope: string[]; email: string; code: string }) => {
      try {
        const target = await captureProfileWorkspace("Create API key");
        const client = new RemoteSkillsAuthClient(target.origin); target.unchanged();
        const created = await client.createApiKey(options.email, options.code, name, options.scope.length ? options.scope : undefined, target.context);
        console.log(JSON.stringify(created, null, 2));
      } catch (error) { writeCommandError(error, "Failed to create API key", options.json); }
    });
  keys.command("revoke").argument("<key-id>").option("--json", "Output as JSON", false)
    .requiredOption("--email <email>", "Account email for fresh reauthentication")
    .requiredOption("--code <code>", "Fresh OTP requested through auth signup/login")
    .action(async (id: string, options: { json: boolean; email: string; code: string }) => {
      try { const target = await captureProfileWorkspace("Revoke API key"); target.unchanged(); console.log(JSON.stringify(await new RemoteSkillsAuthClient(target.origin).revokeApiKey(options.email, options.code, id, target.context), null, 2)); }
      catch (error) { writeCommandError(error, "Failed to revoke API key", options.json); }
    });
  keys.command("add-publish-scope").argument("<key-id>").requiredOption("--expected-scopes <csv>", "Current comma-separated scopes; stale values are refused")
    .option("--json", "Output as JSON", false)
    .description("Add skills:publish to one existing key without minting or rotating it")
    .action(async (id: string, options: { expectedScopes: string; json: boolean }) => {
      try {
        const connection = await resolveSkillsConnection();
        if (!connection) throw new Error("A hosted Skills credential is required for key scope administration");
        const identity = await apiRequest("/api/auth/whoami", { headers: { Authorization: `Bearer ${connection.apiKey}` } }, connection.apiOrigin);
        const identityOrg = recordField(identity.organization);
        const orgId = stringField(identityOrg?.id);
        if (!orgId) throw new Error("The Skills authority did not return a tenant identity; refusing key scope administration");
        const result = await new RemoteSkillsClient(connection.apiKey, connection.apiOrigin).addSkillPublishScope(id, options.expectedScopes.split(",").map((scope) => scope.trim()).filter(Boolean), orgId);
        if (options.json || !isTTY) console.log(JSON.stringify(result, null, 2));
        else console.log(chalk.green(`Added skills:publish to ${id}; scopes read back from the server.`));
      } catch (error) { writeCommandError(error, "Failed to add Skills publication scope", options.json); }
    });

  withLoginOptions(auth
    .command("login")
    .description("Sign in with browser/device code, email code or an API key (same as `skills login`)")
    .option("--membership-id <id>", "Enroll an exact workspace membership into an explicit HASNA_PROFILE")
    .option("--code-stdin", "Read a fresh six-digit code for workspace enrollment from stdin"))
    .action(async (options: LoginOptions & { membershipId?: string; codeStdin?: boolean }) => {
      if (options.membershipId !== undefined) {
        if (options.apiKey || options.device || options.code || options.poll || options.url) {
          writeCommandError(new Error("Workspace login uses email and --code-stdin; do not combine it with device, API key, --url or --code login."), "Invalid login options", options.json); return;
        }
        await loginWorkspace({ email: options.email, codeStdin: options.codeStdin, json: options.json, membershipId: options.membershipId }); return;
      }
      if (options.codeStdin) { writeCommandError(new Error("--code-stdin requires --membership-id for this login flow."), "Invalid login options", options.json); return; }
      await runLogin(options);
    });

  auth
    .command("signup")
    .description("Create or sign in with your email (passwordless)")
    .option("--url <origin>", "Sign up on this Skills server instead of the default (your own instance)")
    .option("--email <email>", "Email address (non-interactive)")
    .option("--code <code>", "Verification code (non-interactive)")
    .option("--json", "Output result as JSON without prompting", false)
    .action(async (options: { url?: string; email?: string; code?: string; json?: boolean }) => {
      let email = options.email;

      if (!email && isTTY && !options.json) {
        const existing = authForPrompt();
        if (existing) {
          console.log(chalk.dim(`Already signed in as ${existing.email}`));
          const again = await prompt("Continue with a different account? (y/N) ");
          if (again === null || again.toLowerCase() !== "y") return;
        }
        const answer = await prompt(chalk.bold("Email: "));
        if (answer === null) return;
        email = answer;
      }

      if (!email) {
        const error = "Email required. Use: skills auth signup --email you@example.com";
        if (options.json) console.log(JSON.stringify({ error })); else console.error(chalk.red(error));
        process.exitCode = 1;
        return;
      }

      const target = signInTarget(options.url, options.json);
      if (!target) return;
      await doLogin(email, options.code, options.json, target);
    });

  auth
    .command("logout")
    .description("Sign out this profile (same as `skills logout`)")
    .option("--revoke", "Also revoke an API key you added with --api-key (login-minted keys are revoked by default)")
    .option("--no-revoke", "Do not ask the server to revoke anything; exits non-zero if a login-minted key is left live")
    .option("--json", "Output as JSON", false)
    .action(async (options: { json?: boolean; revoke?: boolean }) => runLogout(options));

  auth
    .command("whoami")
    .description("Show current account info (same as `skills whoami`)")
    .option("--json", "Output as JSON", false)
    .action(async (options: { json?: boolean }) => runWhoami(options));

  registerAccountCommands(parent);
}
