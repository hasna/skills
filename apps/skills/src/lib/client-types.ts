/**
 * The @hasna/contracts client types that cross this package's published
 * boundary, spelled locally.
 *
 * WHY THIS FILE EXISTS. `bun build --target bun` inlines @hasna/contracts into
 * every shipped bundle, so the runtime never needs it installed alongside
 * @hasna/skills and it is correctly a build-time devDependency. `tsc
 * --emitDeclarationOnly` inlines nothing: the moment a PUBLIC declaration names
 * a type from `@hasna/contracts/client`, the published `.d.ts` imports it, and
 * a consumer who installed only this package's declared runtime dependencies
 * fails type-checking (7 x TS2307 before #1782 fixed the same shape in
 * @hasna/secrets).
 *
 * This file is NOT the vendored resolver returning: it has no imports, no
 * runtime statement, no tier, no Keychain read, no URL ladder — only the
 * shapes, copied from the @hasna/contracts/@1.0.2 declarations. Its sibling
 * `client-types.test.ts` asserts each one is mutually assignable with the real
 * declaration, in the direction it actually crosses, so a drifted shape fails
 * `tsc` in the same build step that emits the declarations it protects.
 *
 * `src/lib/fleet-credentials.ts` keeps importing the resolver and its VALUE
 * exports from @hasna/contracts/client (inlined at runtime); only the types it
 * re-exports or names in its own public signatures come from here.
 *
 * Do not add an import. Do not add a value. This file must stay a leaf.
 */

/** Which link of the chain supplied the credential. */
export type CredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

export interface ResolvedCredential {
  /** The secret. Property access and destructuring work; it is never enumerated or serialized. */
  readonly apiKey: string;
  readonly tier: CredentialTier;
  /** Where it came from: an env key NAME, an absolute file path, or a Keychain item reference. Never a value. */
  readonly source: string;
  /** True for tiers an operator sets on purpose. These never fall through. */
  readonly deliberate: boolean;
  /** When tier === "pointer", the vault ITEM KEY to resolve at request time. Never a credential value. */
  readonly pointerVaultKey?: string;
  /** The disk paths consulted before this credential was chosen. */
  readonly diskCandidates: readonly string[];
  /** Human-readable advisory. Never contains key material. */
  readonly warning: string | null;
}

/** The captured outcome of one `security` invocation. `stdout` IS the secret; it is never logged. */
export interface KeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type KeychainCommandRunner = (argv: readonly string[]) => KeychainCommandResult;

/** Tier 3 controls. Every field is optional; production callers pass nothing. */
export interface KeychainTierOptions {
  /**
   * Whether the Keychain is consulted for a caller-built env object. The tier
   * is AMBIENT: by default it runs only for the live `process.env`. Injecting
   * `run` implies `true`.
   */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name, used as the account when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: KeychainCommandRunner;
}

export interface CredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: KeychainTierOptions;
}