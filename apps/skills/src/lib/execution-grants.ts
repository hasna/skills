/** Shared policy contains vault reference names, never credential values. */
import { posix, win32 } from "node:path";
import { declaredSecretNames } from "./execution-secrets.js";
import type { SelectedSecretBindings } from "./execution-secrets.js";
import { isValidSkillVersion } from "./skill-version.js";

export const MAX_EXECUTION_GRANTS = 256;
export const MAX_EXECUTION_GRANT_BYTES = 2 * 1024 * 1024;
export interface ExecutionGrant {
  id: string;
  target: "local";
  selection: { slug: string; version: string; bundleDigest: string };
  actors: string[];
  /** Canonical directory conditions, not cryptographic machine attestation. */
  consumers: {
    stationId: string;
    workspaceDirectory: string;
    includeDescendants?: boolean;
  }[];
  secretsAuthority: string;
  bindings: Record<string, string>;
  expiresAt?: string;
}
export interface ExecutionGrantPolicy {
  schema: "hasna.skills-execution-grants.v1";
  profileId: string;
  workspaceId: string;
  revision: string;
  previousRevision: string | null;
  updatedAt: string;
  actorId: string;
  grants: ExecutionGrant[];
}
export interface ExecutionGrantRequest {
  selection: SelectedSecretBindings["selection"];
  consumer: SelectedSecretBindings["consumer"];
}
export interface ResolvedExecutionGrant {
  policyRevision: string;
  grantId: string;
  bindings: SelectedSecretBindings;
}
export function grantIdentifier(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v) &&
    !v.includes("..")
  );
}
export function grantRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function keys(
  v: Record<string, unknown>,
  required: string[],
  optional: string[] = []
) {
  return (
    required.every((k) => Object.hasOwn(v, k)) &&
    Object.keys(v).every((k) => required.includes(k) || optional.includes(k))
  );
}
function invalid(): never {
  throw new Error(
    "Invalid execution grant policy: use exact selections, named actors and consumers, and vault reference names only."
  );
}
function authority(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 2048 || /[\x00-\x20\x7f]/.test(v))
    return false;
  try {
    const u = new URL(v);
    return (
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname.endsWith("/v1") &&
      u.href === v
    );
  } catch {
    return false;
  }
}
function pathFlavor(value: string) {
  return value.startsWith("/") ? posix : win32;
}
export function grantWorkspace(v: unknown): v is string {
  if (
    typeof v !== "string" ||
    !v ||
    v.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(v)
  )
    return false;
  const flavor = pathFlavor(v);
  if (flavor === win32 && !/^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+)/.test(v))
    return false;
  return flavor.isAbsolute(v) && flavor.normalize(v) === v;
}
export function grantDirectoryContains(
  root: string,
  directory: string,
  descendants = false
): boolean {
  if (
    !grantWorkspace(root) ||
    !grantWorkspace(directory) ||
    pathFlavor(root) !== pathFlavor(directory)
  )
    return false;
  if (root === directory) return true;
  const flavor = pathFlavor(root),
    relative = flavor.relative(root, directory);
  return (
    descendants &&
    !!relative &&
    relative !== ".." &&
    !relative.startsWith(`..${flavor.sep}`) &&
    !flavor.isAbsolute(relative)
  );
}
function selection(v: unknown): boolean {
  return (
    grantRecord(v) &&
    keys(v, ["slug", "version", "bundleDigest"]) &&
    grantIdentifier(v.slug) &&
    isValidSkillVersion(v.version) &&
    typeof v.bundleDigest === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(v.bundleDigest)
  );
}
export function validateExecutionGrants(value: unknown): ExecutionGrant[] {
  if (!Array.isArray(value) || value.length > MAX_EXECUTION_GRANTS) invalid();
  const ids = new Set<string>();
  for (const g of value) {
    if (
      !grantRecord(g) ||
      !keys(
        g,
        [
          "id",
          "target",
          "selection",
          "actors",
          "consumers",
          "secretsAuthority",
          "bindings",
        ],
        ["expiresAt"]
      ) ||
      !grantIdentifier(g.id) ||
      ids.has(g.id) ||
      g.target !== "local" ||
      !selection(g.selection) ||
      !authority(g.secretsAuthority)
    )
      invalid();
    ids.add(g.id);
    if (
      !Array.isArray(g.actors) ||
      !g.actors.length ||
      g.actors.length > 256 ||
      !g.actors.every(grantIdentifier) ||
      new Set(g.actors).size !== g.actors.length
    )
      invalid();
    if (
      !Array.isArray(g.consumers) ||
      !g.consumers.length ||
      g.consumers.length > 256
    )
      invalid();
    const consumers = new Set<string>();
    for (const c of g.consumers) {
      if (
        !grantRecord(c) ||
        !keys(c, ["stationId", "workspaceDirectory"], ["includeDescendants"]) ||
        !grantIdentifier(c.stationId) ||
        !grantWorkspace(c.workspaceDirectory) ||
        (c.includeDescendants !== undefined &&
          typeof c.includeDescendants !== "boolean")
      )
        invalid();
      const key = JSON.stringify([
        c.stationId,
        c.workspaceDirectory,
        c.includeDescendants === true,
      ]);
      if (consumers.has(key)) invalid();
      consumers.add(key);
    }
    if (!grantRecord(g.bindings) || !Object.keys(g.bindings).length) invalid();
    try {
      declaredSecretNames(Object.keys(g.bindings));
    } catch {
      invalid();
    }
    for (const ref of Object.values(g.bindings))
      if (
        typeof ref !== "string" ||
        ref.length > 2048 ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) ||
        ref.split("/").some((p) => !p || p === "." || p === "..")
      )
        invalid();
    if (
      g.expiresAt !== undefined &&
      (typeof g.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(g.expiresAt)) ||
        new Date(g.expiresAt).toISOString() !== g.expiresAt)
    )
      invalid();
  }
  if (
    Buffer.byteLength(JSON.stringify(value)) >
    MAX_EXECUTION_GRANT_BYTES - 2048
  )
    invalid();
  return structuredClone(value) as ExecutionGrant[];
}
export function validateExecutionGrantPolicy(
  value: unknown
): ExecutionGrantPolicy {
  if (
    !grantRecord(value) ||
    !keys(value, [
      "schema",
      "profileId",
      "workspaceId",
      "revision",
      "previousRevision",
      "updatedAt",
      "actorId",
      "grants",
    ]) ||
    value.schema !== "hasna.skills-execution-grants.v1" ||
    ![value.profileId, value.workspaceId, value.revision, value.actorId].every(
      grantIdentifier
    ) ||
    (value.previousRevision !== null &&
      !grantIdentifier(value.previousRevision)) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  )
    invalid();
  validateExecutionGrants(value.grants);
  return structuredClone(value) as unknown as ExecutionGrantPolicy;
}
export function validateExecutionGrantRequest(
  value: unknown
): ExecutionGrantRequest {
  if (
    !grantRecord(value) ||
    !keys(value, ["selection", "consumer"]) ||
    !grantRecord(value.selection) ||
    !keys(value.selection, [
      "authority",
      "workspaceId",
      "profileId",
      "profileRevision",
      "slug",
      "version",
      "bundleDigest",
    ]) ||
    !grantRecord(value.consumer) ||
    !keys(value.consumer, ["stationId", "workspaceDirectory"])
  )
    invalid();
  const s = value.selection,
    c = value.consumer;
  if (
    !selection({
      slug: s.slug,
      version: s.version,
      bundleDigest: s.bundleDigest,
    }) ||
    !authority(s.authority) ||
    ![s.workspaceId, s.profileId, s.profileRevision, c.stationId].every(
      grantIdentifier
    ) ||
    !grantWorkspace(c.workspaceDirectory)
  )
    invalid();
  return structuredClone(value) as unknown as ExecutionGrantRequest;
}
export function executionGrantMatches(
  g: ExecutionGrant,
  r: ExecutionGrantRequest,
  actorId: string,
  now = Date.now()
): boolean {
  return (
    g.target === "local" &&
    g.actors.includes(actorId) &&
    (!g.expiresAt || Date.parse(g.expiresAt) > now) &&
    g.selection.slug === r.selection.slug &&
    g.selection.version === r.selection.version &&
    g.selection.bundleDigest === r.selection.bundleDigest &&
    g.consumers.some(
      (c) =>
        c.stationId === r.consumer.stationId &&
        grantDirectoryContains(
          c.workspaceDirectory,
          r.consumer.workspaceDirectory,
          c.includeDescendants
        )
    )
  );
}
