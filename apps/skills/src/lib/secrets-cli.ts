/**
 * Access to the separately installed Hasna Secrets tooling: the @hasna/secrets SDK when it is
 * installed beside Skills, otherwise the installed `secrets` CLI.
 *
 * @hasna/secrets is restricted on npm, so the Skills runtime that `skills self-update` installs
 * anonymously never contains it. The SDK is resolved at call time and never bundled (every build
 * marks it external). A value read through the CLI travels from its stdout into memory only: it is
 * never in argv, the console, an error or a log, the caller's environment is passed unchanged, the
 * CLI's stderr is discarded and every buffer that held the value is zeroed.
 */
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, resolve, sep } from "node:path";
import { defaultFleetGatewayBaseUrl, resolveConfiguredClientAuthority, toV1BaseUrl } from "@hasna/contracts";

type Env = Record<string, string | undefined>;
const SECRETS_SDK_SPECIFIER = "@hasna/secrets/sdk";
const SECRETS_CLI = "secrets";
const CLI_TIMEOUT_MS = 15_000;
const CLI_VALUE_MAX_BYTES = 16_384;
const CLI_METADATA_MAX_BYTES = 1_048_576;
const CLI_METADATA_PAGE = 200; // the CLI's own MAX_LIST_LIMIT
const CLI_METADATA_MAX_PAGES = 50;
/** A vault key as the bindings contract accepts it; never starts with "-", so it can't be read as a flag. */
const VAULT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface SecretsCliResult { status: number | null; stdout: Uint8Array }
export interface SecretsCliRunOptions { timeoutMs: number; maxBytes: number; signal?: AbortSignal; env?: Env }
export interface DefaultSecretsClientDependencies {
  /** Load the @hasna/secrets SDK. A module-not-found error for that package means "not installed". */
  importSdk: () => Promise<unknown>;
  /**
   * Absolute path of the installed `secrets` CLI on the PATH of `env` (default: this process), or null.
   * Throws SecretsCliLocationError when the first `secrets` found is in a place it must not run from
   * (see locateSecretsCli); a caller treats that exactly like a missing CLI and never searches further.
   */
  findCli: (env?: Env) => string | null;
  /**
   * The Secrets authority the CLI will use, from the URL-only part of the shared @hasna/contracts resolver
   * (HASNA_SECRETS_API_URL, the Keychain api-url item, the credentials file, else the fleet gateway: the
   * order `secrets --help` documents). It reads no credential.
   */
  resolveAuthority: () => string;
  /** Run the CLI with these arguments only, in `options.env` (default: this process's environment) unchanged; stderr is discarded. */
  runCli: (executable: string, args: string[], options: SecretsCliRunOptions) => Promise<SecretsCliResult>;
}

/** True only for a module-not-found error that names @hasna/secrets itself, not one of its dependencies. */
export function isSecretsSdkNotInstalled(error: unknown): boolean {
  const failure = error as { code?: unknown; message?: unknown } | null;
  return !!failure && (failure.code === "ERR_MODULE_NOT_FOUND" || failure.code === "MODULE_NOT_FOUND") &&
    typeof failure.message === "string" && /['"]@hasna\/secrets(?:\/[^'"]*)?['"]/.test(failure.message);
}

/** Whether the SDK resolves from the Skills runtime tree. A broken install counts as installed, so its own refusal stands. */
export async function isSecretsSdkInstalled(dependencies: Pick<DefaultSecretsClientDependencies, "importSdk"> = defaultSecretsClientDependencies): Promise<boolean> {
  try { await dependencies.importSdk(); return true; }
  catch (error) { return !isSecretsSdkNotInstalled(error); }
}

/** The `secrets` found on PATH is in a place it must not run from. The message names the reason only, never a path. */
export class SecretsCliLocationError extends Error {
  readonly code = "SECRETS_CLI_UNTRUSTED_LOCATION";
  constructor(readonly reason: string) {
    super(`SECRETS_CLI_UNTRUSTED_LOCATION: ${reason}`);
    this.name = "SecretsCliLocationError";
  }
}

function isExecutableFile(candidate: string): boolean {
  try { if (!statSync(candidate).isFile()) return false; accessSync(candidate, constants.X_OK); return true; }
  catch { return false; }
}

/** `child` is `parent` or lies below it. Both are real, absolute paths; the separator stops /a/bc counting as under /a/b. */
function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Find the `secrets` CLI without trusting the working folder. Skills runs from whatever folder an agent
 * hook starts it in, often a cloned repository, so:
 * - only absolute, non-empty PATH entries are searched, in order; a relative entry such as "." or
 *   "node_modules/.bin" would resolve against that folder, so it is skipped;
 * - the first executable regular file named `secrets` decides: a candidate whose path is not already in
 *   resolved form ("/a/../b") is refused, and so is one whose real path lies inside the real working folder
 *   (npx, npm run and bun run put the checkout's own node_modules/.bin on PATH as an absolute entry);
 * - a refusal throws SecretsCliLocationError and nothing further is searched.
 * A working folder that is the user's home or one of its ancestors ("/" for a launchd job) is not a
 * checkout: everything the user installed lies below it, so the inside-the-working-folder check is not
 * applied there. Absolute PATH entries elsewhere are trusted, as a shell trusts them.
 */
export function locateSecretsCli(env: Env = process.env, context: { cwd?: string; home?: string } = {}): string | null {
  for (const entry of (env.PATH ?? "").split(delimiter)) {
    if (!entry || !isAbsolute(entry)) continue;
    const candidate = entry.endsWith("/") ? entry + SECRETS_CLI : `${entry}/${SECRETS_CLI}`;
    if (!isExecutableFile(candidate)) continue;
    if (resolve(candidate) !== candidate) throw new SecretsCliLocationError("the PATH entry that holds it is not in resolved form");
    let real: string, working: string, home: string;
    try { real = realpathSync(candidate); } catch { throw new SecretsCliLocationError("its real location could not be read"); }
    try { working = realpathSync(context.cwd ?? process.cwd()); } catch { throw new SecretsCliLocationError("the working folder could not be resolved"); }
    try { home = realpathSync(context.home ?? homedir()); } catch { home = ""; }
    const workingHoldsHome = home !== "" && isWithin(home, working);
    if (!workingHoldsHome && isWithin(real, working)) {
      throw new SecretsCliLocationError("it lies inside the working folder, where a checkout could have placed it");
    }
    return candidate;
  }
  return null;
}

async function defaultRunCli(executable: string, args: string[], options: SecretsCliRunOptions): Promise<SecretsCliResult> {
  // The CLI resolves its own credential from the caller's environment, exactly as it would for an
  // operator. Nothing is added: no flag, no variable, no value.
  const proc = Bun.spawn([executable, ...args], { env: options.env ?? process.env, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const stop = () => { try { proc.kill(); } catch { /* already exited */ } };
  const timer = setTimeout(stop, options.timeoutMs);
  options.signal?.addEventListener("abort", stop, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0, overflow = false;
    for await (const chunk of proc.stdout) {
      size += chunk.byteLength;
      if (size > options.maxBytes) { overflow = true; stop(); chunk.fill(0); break; }
      chunks.push(chunk);
    }
    const status = await proc.exited;
    const stdout = new Uint8Array(overflow ? 0 : size);
    let offset = 0;
    for (const chunk of chunks) { if (!overflow) stdout.set(chunk, offset); offset += chunk.byteLength; chunk.fill(0); }
    return { status: overflow || options.signal?.aborted ? null : status, stdout };
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); }
}

export const defaultSecretsClientDependencies: Readonly<DefaultSecretsClientDependencies> = Object.freeze({
  importSdk: () => import(SECRETS_SDK_SPECIFIER),
  findCli: (env: Env = process.env) => locateSecretsCli(env),
  resolveAuthority: () => resolveConfiguredClientAuthority("secrets", process.env)?.baseUrl ?? toV1BaseUrl(defaultFleetGatewayBaseUrl("secrets")),
  runCli: defaultRunCli,
});

export interface SecretsCliMetadata { expires_at: string | null; updated_at: string | null }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The expiry of one vault item through the documented metadata listing `secrets list <key> --json`, whose compact
 * items carry key, type, label, expires_at and updated_at and never the value (`get --plaintext` reports no expiry,
 * `get --check` only length and sha256). The listing returns the key itself and the keys below it, so it is paged
 * until the exact key appears; this is the lookup the CLI uses for its own metadata. An unset expiry is null in
 * the listing, as it is in the SDK's result. Throws a value-free error code when the item, or an expires_at that is
 * null or a string, cannot be established.
 */
export async function readSecretMetadataWithCli(executable: string, key: string, dependencies: Pick<DefaultSecretsClientDependencies, "runCli">,
  options: { signal?: AbortSignal; env?: Env } = {}): Promise<SecretsCliMetadata> {
  if (typeof key !== "string" || key.length > 2048 || !VAULT_KEY.test(key)) throw new Error("SECRETS_CLI_KEY_INVALID");
  const unavailable = () => new Error("SECRETS_CLI_METADATA_UNAVAILABLE");
  let cursor = 0;
  for (let page = 0; page < CLI_METADATA_MAX_PAGES; page++) {
    const result = await dependencies.runCli(executable, ["list", key, "--json", "--limit", String(CLI_METADATA_PAGE), "--cursor", String(cursor)], {
      timeoutMs: CLI_TIMEOUT_MS, maxBytes: CLI_METADATA_MAX_BYTES, ...(options.signal ? { signal: options.signal } : {}), ...(options.env ? { env: options.env } : {}),
    });
    let envelope: unknown;
    try {
      if (result.status !== 0) throw unavailable();
      envelope = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(result.stdout));
    } catch { throw unavailable(); } finally { result.stdout.fill(0); }
    if (!record(envelope) || !Array.isArray(envelope.items) || typeof envelope.has_more !== "boolean" ||
        !(envelope.next_cursor === null || Number.isSafeInteger(envelope.next_cursor))) throw unavailable();
    const entry = envelope.items.find(item => record(item) && item.key === key) as Record<string, unknown> | undefined;
    if (entry) {
      const expires = entry.expires_at, updated = entry.updated_at ?? null;
      if (!(expires === null || typeof expires === "string") || !(updated === null || typeof updated === "string")) throw unavailable();
      return { expires_at: expires, updated_at: updated };
    }
    const next = envelope.next_cursor as number | null;
    if (!envelope.has_more || next === null || next <= cursor) break;
    cursor = next;
  }
  throw unavailable();
}

/**
 * One value through the documented `secrets get <key> --plaintext`, which writes the bare value to a
 * non-TTY stdout. Throws a value-free error code on any failure.
 */
export async function readSecretWithCli(executable: string, key: string, dependencies: Pick<DefaultSecretsClientDependencies, "runCli">,
  options: { signal?: AbortSignal; env?: Env } = {}): Promise<string> {
  if (typeof key !== "string" || key.length > 2048 || !VAULT_KEY.test(key)) throw new Error("SECRETS_CLI_KEY_INVALID");
  const result = await dependencies.runCli(executable, ["get", key, "--plaintext"], {
    timeoutMs: CLI_TIMEOUT_MS, maxBytes: CLI_VALUE_MAX_BYTES, ...(options.signal ? { signal: options.signal } : {}), ...(options.env ? { env: options.env } : {}),
  });
  try {
    if (result.status !== 0) throw new Error("SECRETS_CLI_READ_FAILED");
    try { return new TextDecoder("utf8", { fatal: true }).decode(result.stdout); }
    catch { throw new Error("SECRETS_CLI_READ_FAILED"); }
  } finally { result.stdout.fill(0); }
}
