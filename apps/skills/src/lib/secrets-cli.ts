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
import { defaultFleetGatewayBaseUrl, resolveConfiguredClientAuthority, toV1BaseUrl } from "@hasna/contracts";

type Env = Record<string, string | undefined>;
const SECRETS_SDK_SPECIFIER = "@hasna/secrets/sdk";
const SECRETS_CLI = "secrets";
const CLI_TIMEOUT_MS = 15_000;
const CLI_VALUE_MAX_BYTES = 16_384;
/** A vault key as the bindings contract accepts it; never starts with "-", so it can't be read as a flag. */
const VAULT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface SecretsCliResult { status: number | null; stdout: Uint8Array }
export interface SecretsCliRunOptions { timeoutMs: number; maxBytes: number; signal?: AbortSignal; env?: Env }
export interface DefaultSecretsClientDependencies {
  /** Load the @hasna/secrets SDK. A module-not-found error for that package means "not installed". */
  importSdk: () => Promise<unknown>;
  /** Absolute path of the installed `secrets` CLI on the PATH of `env` (default: this process), or null. */
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
  findCli: (env: Env = process.env) => Bun.which(SECRETS_CLI, { PATH: env.PATH ?? "" }),
  resolveAuthority: () => resolveConfiguredClientAuthority("secrets", process.env)?.baseUrl ?? toV1BaseUrl(defaultFleetGatewayBaseUrl("secrets")),
  runCli: defaultRunCli,
});

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
