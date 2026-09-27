/** Explicit, value-free grants for a selected local execution. Never read bindings from a skill bundle. */
import { constants, closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { hostname as stationHostname } from "node:os";
import { createSecretsClientFromEnv } from "@hasna/secrets/sdk";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { SkillSelectionError } from "./selection-cache.js";

export interface SelectedSecretBindings {
  schema: "hasna.skills-secret-bindings.v1";
  selection: Pick<ResolvedSkillSelection, "authority" | "workspaceId" | "profileRevision" | "slug" | "version" | "bundleDigest"> & { profileId: string };
  consumer: { stationId: string; workspaceDirectory: string };
  /** Exact canonical /v1 authority of the independently configured Secrets client. */
  secretsAuthority: string;
  /** Declared environment name -> vault key. Values are resolved freshly for each run. */
  bindings: Record<string, string>;
}
export interface SelectedSecretsClient {
  readonly baseUrl: string;
  getSecret(query: { key: string }, init?: RequestInit): Promise<{ key: string; value: string; expires_at?: string | null }>;
}
export interface SelectedSecretScope {
  selection: ResolvedSkillSelection;
  profileId: string;
  cwd: string;
}
export function selectedSecretBindingsTemplate(scope: SelectedSecretScope, names: string[], createClient: () => SelectedSecretsClient = createSecretsClientFromEnv): SelectedSecretBindings {
  let secretsAuthority: string;
  try { secretsAuthority = createClient().baseUrl; }
  catch { return refuse("LOCAL_SECRET_UNAVAILABLE", "Configure the Secrets CLI authority and authentication before preparing execution bindings."); }
  const { authority, workspaceId, profileRevision, slug, version, bundleDigest } = scope.selection;
  return {
    schema: "hasna.skills-secret-bindings.v1",
    selection: { authority, workspaceId, profileId: scope.profileId, profileRevision, slug, version, bundleDigest },
    consumer: { stationId: process.env.HASNA_STATION || stationHostname(), workspaceDirectory: realpathSync(scope.cwd) },
    secretsAuthority, bindings: Object.fromEntries(names.map(name => [name, ""])),
  };
}
function refuse(code: string, message: string): never { throw new SkillSelectionError(code, message); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 2048 && !/[\x00-\x20\x7f]/.test(value); }

/** Runtime controls must not be supplied as credentials, even by a reviewed binding. */
export function declaredSecretNames(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32 || value.some(name => typeof name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) || new Set(value).size !== value.length) {
    return refuse("INVALID_SKILL_MANIFEST", "Runtime environment references must be unique uppercase identifiers (at most 32).");
  }
  if (value.some(name => /^(?:PATH|HOME|TMPDIR|TEMP|TMP|LANG|LC_ALL|TERM|SHELL|ENV|BASH_ENV|IFS|NODE_OPTIONS|NODE_PATH)$/.test(name) || /^(?:SKILLS_|BUN_|PYTHON|LD_|DYLD_)/.test(name))) {
    return refuse("INVALID_SKILL_MANIFEST", "Runtime environment references cannot override execution controls.");
  }
  return value;
}

/** Reading is bounded and rejects symlinks/devices. Parsing errors never echo file contents. */
export function readSelectedSecretBindings(path: string): SelectedSecretBindings {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65_536) throw new Error();
    const bytes = Buffer.alloc(65_537);
    let size = 0, count: number;
    while ((count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) { size += count; if (size > 65_536) throw new Error(); }
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes.subarray(0, size)));
  } catch { return refuse("INVALID_SECRET_BINDINGS", "Secret bindings must be a regular JSON file of at most 64 KiB, containing reference names only."); }
  finally { if (fd !== undefined) closeSync(fd); }
}

/** Validate every grant before constructing a client or reading any secret. */
export function validateSelectedSecretBindings(value: unknown, scope: SelectedSecretScope, names: string[]): SelectedSecretBindings {
  if (!record(value) || !exactKeys(value, ["schema", "selection", "consumer", "secretsAuthority", "bindings"]) || value.schema !== "hasna.skills-secret-bindings.v1" ||
      !record(value.selection) || !exactKeys(value.selection, ["authority", "workspaceId", "profileId", "profileRevision", "slug", "version", "bundleDigest"]) ||
      !record(value.consumer) || !exactKeys(value.consumer, ["stationId", "workspaceDirectory"]) || !record(value.bindings)) {
    return refuse("INVALID_SECRET_BINDINGS", "Secret bindings do not match the hasna.skills-secret-bindings.v1 contract.");
  }
  for (const [key, expected] of Object.entries({ authority: scope.selection.authority, workspaceId: scope.selection.workspaceId, profileId: scope.profileId, profileRevision: scope.selection.profileRevision, slug: scope.selection.slug, version: scope.selection.version, bundleDigest: scope.selection.bundleDigest })) {
    if (value.selection[key] !== expected) return refuse("SECRET_BINDING_SCOPE_MISMATCH", "Secret bindings do not match the exact selected authority, workspace, profile, revision, version and digest.");
  }
  let workspaceDirectory: string;
  try { workspaceDirectory = realpathSync(scope.cwd); }
  catch { return refuse("SECRET_BINDING_CONSUMER_MISMATCH", "The execution workspace cannot be resolved."); }
  if (value.consumer.stationId !== (process.env.HASNA_STATION || stationHostname()) || value.consumer.workspaceDirectory !== workspaceDirectory) {
    return refuse("SECRET_BINDING_CONSUMER_MISMATCH", "Secret bindings do not match this station and canonical workspace directory.");
  }
  try {
    if (!identifier(value.secretsAuthority)) throw new Error();
    const url = new URL(value.secretsAuthority);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/v1") || url.href !== value.secretsAuthority) throw new Error();
  } catch { return refuse("INVALID_SECRET_BINDINGS", "Secret bindings require a canonical HTTPS Secrets /v1 authority (loopback HTTP is allowed)."); }
  if (!exactKeys(value.bindings, names) || Object.values(value.bindings).some(key => !identifier(key) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) || key.split("/").some(part => !part || part === "." || part === ".."))) {
    return refuse("INVALID_SECRET_BINDINGS", "Bind every declared environment name exactly once to a vault key; undeclared bindings and values are refused.");
  }
  // Copy before any await: an SDK caller cannot expand a reviewed grant during resolution.
  return structuredClone(value) as unknown as SelectedSecretBindings;
}

export async function resolveSelectedSecrets(bindings: SelectedSecretBindings, createClient: () => SelectedSecretsClient = createSecretsClientFromEnv): Promise<Record<string, string>> {
  if (!Object.keys(bindings.bindings).length) return {};
  let client: SelectedSecretsClient;
  try { client = createClient(); }
  catch { return refuse("LOCAL_SECRET_UNAVAILABLE", "The configured Secrets client could not authenticate. No ambient credential fallback was attempted."); }
  if (client.baseUrl !== bindings.secretsAuthority) return refuse("SECRET_BINDING_AUTHORITY_MISMATCH", "The configured Secrets authority differs from the reviewed binding. No secret was requested.");
  const env: Record<string, string> = {};
  const signal = AbortSignal.timeout(15_000);
  try {
    for (const [name, key] of Object.entries(bindings.bindings)) {
      const secret = await client.getSecret({ key }, { signal });
      if (secret.key !== key || typeof secret.value !== "string" || !secret.value || secret.value.includes("\0") || Buffer.byteLength(secret.value) > 16_384 ||
          (secret.expires_at != null && (!Number.isFinite(Date.parse(secret.expires_at)) || Date.parse(secret.expires_at) <= Date.now()))) throw new Error();
      env[name] = secret.value;
    }
    return env;
  } catch { return refuse("LOCAL_SECRET_UNAVAILABLE", "A declared secret could not be resolved, was invalid, or has expired. The skill was not started; no fallback was attempted."); }
}

/** Limit accidental disclosure in child output. This is not a sandbox for hostile code. */
export function redactExecutionSecrets(text: string, env: Record<string, string>): string {
  const values = new Set(Object.values(env).flatMap(value => {
    let encoded: string = ""; try { encoded = encodeURIComponent(value); } catch { /* An unpaired surrogate still has literal and JSON forms. */ }
    return [value, JSON.stringify(value).slice(1, -1), Buffer.from(value).toString("base64"), encoded];
  }));
  for (const value of [...values].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(value).join("[REDACTED]");
  return text;
}
