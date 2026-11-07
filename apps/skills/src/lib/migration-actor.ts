import { hostname as operatingSystemHostname } from "node:os";
import pkg from "../../package.json" with { type: "json" };
import { INTEGRATION_AGENTS } from "./agent-adapters.js";

/**
 * Actor provenance for the three migration records Skills writes under
 * `<dataDir>/migration/<uuid>/`: the integration receipt (`skills hook install`,
 * `rebind-settings`, `rebind-cache`, `retain-review-artifact`, `trust-native`),
 * the Codex reconcile receipt (`skills hook codex-reconcile`) and the native
 * archive journal (`skills migrate native`). Before this block a receipt held
 * hashes and backup paths and nothing that said which process wrote it.
 *
 * The block has two halves that are never mixed:
 *
 * - `observed` holds what this process measured about itself when it wrote the
 *   record: its clock, its package version, its pid, ppid and uid, its start time,
 *   its host, its executable and, when it was started as one of the allowlisted
 *   Skills commands, that command and the allowlisted flag NAMES it was given.
 *   Nothing in it comes from a caller or from an environment variable. The
 *   invocation is the process's own arguments filtered through the allowlist: it
 *   records what the process claimed to be running, not proof that it was Skills.
 * - `supplied` holds labels somebody else controls: an agent identifier and a
 *   parent session identifier read from the environment, and the app, command and
 *   version an SDK caller names for itself. Any process can set or forge them, so
 *   they are tracing aids for a human reading the record, never an identity, and
 *   the block says so (`authenticated: false`). An environment label that looks
 *   like a credential (a token prefix, a scheme separator, user:password@host) is
 *   refused: only its name is recorded, in `rejected`.
 *
 * Nothing here records generic argv. A command is recorded only when it is a key
 * of MIGRATION_COMMANDS, a flag only when it is listed for that command, and a
 * flag's value only when the flag is enumerated and the value is a member. A path,
 * a digest, a profile id, a stray positional or an unlisted flag leaves no trace.
 */

export const MIGRATION_ACTOR_SCHEMA = "hasna.skills-migration-actor.v1";

/** How a listed flag is recorded. `switch` takes no value; `named` takes a value
 * this module never records (a path, digest or free-form id); `enum` records its
 * value only when it is exactly one of `values`. */
type FlagRule = { readonly kind: "switch" } | { readonly kind: "named" } | { readonly kind: "enum"; readonly values: readonly string[] };
const SWITCH: FlagRule = { kind: "switch" };
const NAMED: FlagRule = { kind: "named" };
const oneOf = (values: readonly string[]): FlagRule => ({ kind: "enum", values });
const APPLY_JSON = { "--apply": SWITCH, "--json": SWITCH } as const;

/** The only commands, and for each the only flags, a migration record can name.
 * Every command here reaches one of the three writers; the test
 * migration-actor.test.ts fails when a CLI command that has `--apply` is neither
 * here nor on its explicit not-a-migration list. */
export const MIGRATION_COMMANDS: Readonly<Record<string, Readonly<Record<string, FlagRule>>>> = {
  "hook install": {
    "--agent": oneOf([...INTEGRATION_AGENTS, "all"]), "--command": NAMED, "--selection-profile": NAMED, "--include-vendor": SWITCH,
    "--discovery-inputs": NAMED, "--codex-skill-denials": NAMED, "--codex-native-catalog": NAMED, "--reviewed-cache-alias": NAMED, "--allow-root-aliases": SWITCH, ...APPLY_JSON,
  },
  "hook rebind-settings": {
    "--agent": oneOf(["claude", "codex", "sumi"]), "--reviewed-preimage": NAMED, "--expected-policy-sha256": NAMED, "--expected-settings-sha256": NAMED,
    "--codex-witness-version": oneOf(["2", "3", "4", "5", "7", "8"]), "--claude-witness-version": oneOf(["3", "4", "5"]), ...APPLY_JSON,
  },
  "hook rebind-cache": {
    "--agent": oneOf(["codex"]), "--expected-policy-sha256": NAMED, "--expected-settings-sha256": NAMED, "--app-only-parent": NAMED,
    "--reviewed-hook-parent": NAMED, "--expected-cache-witness-sha256": NAMED, ...APPLY_JSON,
  },
  "hook retain-review-artifact": {
    "--kind": oneOf(["codex-native-catalog"]), "--source": NAMED, "--expected-policy-sha256": NAMED, "--expected-source-sha256": NAMED, ...APPLY_JSON,
  },
  "hook trust-native": {
    "--platform": oneOf(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]), "--digest": NAMED, "--expected-policy-sha256": NAMED, ...APPLY_JSON,
  },
  "hook codex-reconcile": { "--codex-command": NAMED, ...APPLY_JSON },
  "migrate native": {
    "--agent": oneOf(INTEGRATION_AGENTS), "--project": NAMED, "--include-unmanaged": SWITCH, "--include-vendor": SWITCH, "--reviewed-cache-alias": NAMED,
    "--target-manifest": NAMED, "--discovery-inputs": NAMED, "--allow-root-aliases": SWITCH, ...APPLY_JSON,
  },
};

/** The apps that may name themselves through the SDK `actor` option, and the
 * commands each may name. A new caller is added here, in a Skills release, before
 * its label is recorded; until then it is dropped and `supplied.rejected` says so. */
export const MIGRATION_SDK_CALLERS: Readonly<Record<string, readonly string[]>> = {
  hooks: ["install", "remove", "prune", "mcp"],
  mementos: ["init", "session setup-hook"],
};

/** What an SDK caller may say about itself. Anything outside this shape, or
 * outside MIGRATION_SDK_CALLERS, is dropped. */
export interface MigrationActorInput { app?: string; command?: string; version?: string }
/** Mixed into the options of each of the three writers. */
export interface MigrationActorOptions { actor?: MigrationActorInput }

/** The process's own arguments filtered through the allowlist. It records what the process claimed to be running when it started, not proof that
 * it was the Skills CLI: another program started with the same words would record the same thing. */
export interface MigrationObservedInvocation {
  /** A key of MIGRATION_COMMANDS. */
  command: string;
  /** Allowlisted flag names this process was started with, sorted. Never values. */
  flags: string[];
  /** Values of enumerated flags, only when the value is exactly a listed member. */
  flagValues?: Record<string, string>;
}
export interface MigrationObserved {
  writtenAt: string;
  cliVersion: string;
  pid: number;
  ppid: number;
  uid?: number;
  processStartedAt: string;
  hostname?: string;
  execPath: string;
  invocation?: MigrationObservedInvocation;
}
export interface MigrationSupplied {
  /** Always false: every field below is controlled by the caller or the environment. */
  authenticated: false;
  /** First set of SKILLS_AGENT_ID, HASNA_AGENT_ID, AGENT_ID, as publish provenance reads them. */
  agent?: { id: string; source: string };
  /** The parent coding agent's session id, read from CLAUDE_CODE_SESSION_ID when present. Caller-supplied, not authenticated. */
  parentSession?: { id: string; source: string };
  sdk?: { app: string; command?: string; version?: string };
  /** Names of supplied labels that were present and dropped (not their values). */
  rejected?: string[];
}
export interface MigrationActor { schema: typeof MIGRATION_ACTOR_SCHEMA; observed: MigrationObserved; supplied: MigrationSupplied }

/** Everything the block reads from the running process, so a test can pin it. */
export interface MigrationProcessProbe {
  readonly now: () => Date;
  readonly pid: number;
  readonly ppid: number;
  readonly uid: number | undefined;
  readonly uptimeSeconds: number;
  readonly hostname: () => string;
  readonly execPath: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cliVersion: string;
}

export function currentProcessProbe(): MigrationProcessProbe {
  return {
    now: () => new Date(), pid: process.pid, ppid: process.ppid, uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    uptimeSeconds: process.uptime(), hostname: operatingSystemHostname, execPath: process.execPath, argv: process.argv, env: process.env, cliVersion: pkg.version,
  };
}

const AGENT_ENVIRONMENT = ["SKILLS_AGENT_ID", "HASNA_AGENT_ID", "AGENT_ID"] as const;
/** The parent session id is read from this variable when it is present. The value is whatever the environment holds: caller-supplied, not authenticated. */
const SESSION_ENVIRONMENT = ["CLAUDE_CODE_SESSION_ID"] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
/** Starts of common credential formats (GitHub, Stripe-style, Slack, AWS key ids, npm, GitLab, Google API keys, JWTs). A label that starts with one,
 * or has one right after a separator, is refused. Case matters: AKIA, ASIA, AIza and eyJ are the exact spellings. */
const CREDENTIAL_PREFIXES = [
  "ghp_", "gho_", "ghs_", "ghu_", "ghr_", "github_pat_", "sk-", "sk_live_", "sk_test_", "rk_live_", "rk_test_", "pk_live_",
  "xox", "xapp-", "AKIA", "ASIA", "AIza", "npm_", "glpat-", "eyJ",
] as const;
const LABEL_SEPARATORS = ":@._-/";
/** True for a value shaped like a credential or a credential-bearing address: a scheme separator, a user:password@host pair, or a known token prefix. */
function looksLikeCredential(value: string): boolean {
  if (value.includes("://") || (value.includes(":") && value.includes("@"))) return true;
  for (let start = 0; start <= value.length; start += 1) {
    if (start !== 0 && !LABEL_SEPARATORS.includes(value[start - 1]!)) continue;
    if (CREDENTIAL_PREFIXES.some(prefix => value.startsWith(prefix, start))) return true;
  }
  return false;
}
/** A label worth recording: a short identifier that does not look like a credential. */
const isLabel = (value: string): boolean => IDENTIFIER.test(value) && !looksLikeCredential(value);
const SEMVER = /^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-(?:alpha|beta|rc|next|canary|dev)(?:\.\d{1,5})?)?$/;
const bounded = (value: string, limit: number): string => value.length > limit ? value.slice(0, limit) : value;

/** The allowlisted command and flags a process was started with, or undefined
 * when argv is not one of MIGRATION_COMMANDS. Mirrors how the CLI parser reads
 * arguments: a flag that takes a value consumes the next token even when it
 * begins with a dash, so that token is never read as a flag of its own. */
export function observeInvocation(argv: readonly string[]): MigrationObservedInvocation | undefined {
  const tokens = argv.slice(2);
  let end = 0;
  while (end < tokens.length && typeof tokens[end] === "string" && !tokens[end]!.startsWith("-")) end += 1;
  let command: string | undefined, words = 0;
  for (words = Math.min(end, 3); words >= 1; words -= 1) {
    const candidate = tokens.slice(0, words).join(" ");
    if (Object.hasOwn(MIGRATION_COMMANDS, candidate)) { command = candidate; break; }
  }
  if (command === undefined) return undefined;
  const rules = MIGRATION_COMMANDS[command]!;
  const flags = new Set<string>(), values: Record<string, string> = {};
  for (let index = words; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (typeof token !== "string") continue;
    if (token === "--") break;
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("="), name = equals === -1 ? token : token.slice(0, equals);
    if (!Object.hasOwn(rules, name)) continue;
    const rule = rules[name]!;
    flags.add(name);
    if (rule.kind === "switch") continue;
    const value = equals === -1 ? tokens[++index] : token.slice(equals + 1);
    if (rule.kind === "enum" && typeof value === "string" && rule.values.includes(value)) values[name] = value;
  }
  const sorted = (record: Record<string, string>) => Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]!]));
  return { command, flags: [...flags].sort(), ...(Object.keys(values).length ? { flagValues: sorted(values) } : {}) };
}

function readLabel(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object") return undefined;
  try { return (input as Record<string, unknown>)[key]; } catch { return undefined; }
}

function suppliedSdk(input: unknown, rejected: string[]): MigrationSupplied["sdk"] {
  if (input === undefined) return undefined;
  if (input === null || typeof input !== "object" || Array.isArray(input)) { rejected.push("sdk"); return undefined; }
  const app = readLabel(input, "app"), command = readLabel(input, "command"), version = readLabel(input, "version");
  if (typeof app !== "string" || !Object.hasOwn(MIGRATION_SDK_CALLERS, app)) {
    rejected.push("sdk.app");
    if (command !== undefined) rejected.push("sdk.command");
    if (version !== undefined) rejected.push("sdk.version");
    return undefined;
  }
  const sdk: NonNullable<MigrationSupplied["sdk"]> = { app };
  if (command !== undefined) { if (typeof command === "string" && MIGRATION_SDK_CALLERS[app]!.includes(command)) sdk.command = command; else rejected.push("sdk.command"); }
  if (version !== undefined) { if (typeof version === "string" && SEMVER.test(version)) sdk.version = version; else rejected.push("sdk.version"); }
  return sdk;
}

function environmentLabel(env: MigrationProcessProbe["env"], names: readonly string[], field: string, rejected: string[]): { id: string; source: string } | undefined {
  for (const name of names) {
    const value = env[name];
    if (value === undefined) continue;
    if (typeof value === "string" && isLabel(value)) return { id: value, source: name };
    rejected.push(field);
    return undefined;
  }
  return undefined;
}

/** Build the actor block. It never throws for a bad label and never reads
 * anything but the probe: a migration is not refused over its provenance. */
export function buildMigrationActor(input?: MigrationActorInput, probe: MigrationProcessProbe = currentProcessProbe()): MigrationActor {
  const now = probe.now();
  let hostname: string | undefined;
  try { hostname = bounded(probe.hostname(), 255); } catch { hostname = undefined; }
  const invocation = observeInvocation(probe.argv);
  const observed: MigrationObserved = {
    writtenAt: now.toISOString(), cliVersion: probe.cliVersion, pid: probe.pid, ppid: probe.ppid,
    ...(probe.uid === undefined ? {} : { uid: probe.uid }),
    processStartedAt: new Date(now.getTime() - Math.round(probe.uptimeSeconds * 1000)).toISOString(),
    ...(hostname === undefined ? {} : { hostname }),
    execPath: bounded(probe.execPath, 1024),
    ...(invocation ? { invocation } : {}),
  };
  const rejected: string[] = [];
  const agent = environmentLabel(probe.env, AGENT_ENVIRONMENT, "agent", rejected);
  const parentSession = environmentLabel(probe.env, SESSION_ENVIRONMENT, "parentSession", rejected);
  const sdk = suppliedSdk(input, rejected);
  const supplied: MigrationSupplied = { authenticated: false, ...(agent ? { agent } : {}), ...(parentSession ? { parentSession } : {}), ...(sdk ? { sdk } : {}), ...(rejected.length ? { rejected } : {}) };
  return { schema: MIGRATION_ACTOR_SCHEMA, observed, supplied };
}

/** The additive receipt fragment each writer spreads into its record. */
export function migrationActorReceipt(input?: MigrationActorInput, probe?: MigrationProcessProbe): { actor: MigrationActor } {
  return { actor: buildMigrationActor(input, probe) };
}
