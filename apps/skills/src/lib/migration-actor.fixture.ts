import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { MIGRATION_ACTOR_SCHEMA } from "./migration-actor.js";

/** The closed set of fields a migration record's `actor.observed` may hold. */
export const OBSERVED_FIELDS = ["cliVersion", "execPath", "hostname", "pid", "ppid", "processStartedAt", "uid", "writtenAt"] as const;

/** A migration record exactly as the writers emitted it before the actor block
 * existed (version 1 receipts, version 2 archive journal). The integration and
 * journal files were produced by the unmodified writers at 6f567da on a synthetic
 * home; codex-reconcile.json is written out from that writer's source because its
 * real fixture needs a fake Codex app server. Paths are normalised to /home/fixture. */
export function frozenRecord(name: "integration-first-apply" | "integration-second-apply" | "native-archive-journal" | "codex-reconcile"): string {
  return readFileSync(join(import.meta.dir, "fixtures", "migration-receipts", `${name}.json`), "utf8");
}

/** What this process is, as a record it wrote should say. A test that runs the
 * writer in a child process passes that child's identity instead. */
export interface ExpectedProcess { pid: number; ppid: number; uid: number | undefined; execPath: string; startedBetween: [number, number] }
export const thisProcess = (): ExpectedProcess => {
  const started = Date.now() - process.uptime() * 1000;
  return { pid: process.pid, ppid: process.ppid, uid: process.getuid?.(), execPath: process.execPath, startedBetween: [started - 2000, started + 2000] };
};

/** Assert an `actor` block was measured by `identity` inside [from, to] (epoch ms)
 * and that its supplied half is exactly `supplied` (when given; otherwise only that it is marked unauthenticated). */
export function expectMeasuredActor(actor: any, identity: ExpectedProcess, window: { from: number; to: number }, supplied?: Record<string, unknown>): void {
  expect(actor.schema).toBe(MIGRATION_ACTOR_SCHEMA);
  expect(Object.keys(actor).sort()).toEqual(["observed", "schema", "supplied"]);
  const observed = actor.observed;
  expect(observed.cliVersion).toBe(pkg.version);
  expect(observed.pid).toBe(identity.pid);
  expect(observed.ppid).toBe(identity.ppid);
  expect(observed.uid).toBe(identity.uid);
  expect(observed.hostname).toBe(hostname());
  expect(observed.execPath).toBe(identity.execPath);
  const writtenAt = Date.parse(observed.writtenAt), startedAt = Date.parse(observed.processStartedAt);
  expect(new Date(writtenAt).toISOString()).toBe(observed.writtenAt);
  expect(writtenAt).toBeGreaterThanOrEqual(window.from);
  expect(writtenAt).toBeLessThanOrEqual(window.to);
  expect(startedAt).toBeLessThan(writtenAt);
  expect(startedAt).toBeGreaterThanOrEqual(identity.startedBetween[0]);
  expect(startedAt).toBeLessThanOrEqual(identity.startedBetween[1]);
  if (supplied) expect(actor.supplied).toEqual(supplied); else expect(actor.supplied.authenticated).toBe(false);
}

const IDENTITY_ENVIRONMENT = ["SKILLS_AGENT_ID", "HASNA_AGENT_ID", "AGENT_ID", "CLAUDE_CODE_SESSION_ID"] as const;
/** Clear the variables a record reads as supplied labels, so a test run inside an agent session (or a CI job that sets AGENT_ID) sees only what it sets. Returns the restore. */
export function isolateIdentityEnvironment(): () => void {
  const saved = Object.fromEntries(IDENTITY_ENVIRONMENT.map(name => [name, process.env[name]]));
  for (const name of IDENTITY_ENVIRONMENT) delete process.env[name];
  return () => { for (const name of IDENTITY_ENVIRONMENT) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } };
}

/** Run a body with environment variables set (undefined deletes), then restore them. */
export function withEnvironment<T>(values: Record<string, string | undefined>, body: () => T): T {
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  const apply = (source: Record<string, string | undefined>) => { for (const [name, value] of Object.entries(source)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
  apply(values);
  try { return body(); } finally { apply(saved); }
}

/** A reader that relies only on the keys these records have always carried, as an
 * operator's script reading a migration directory would. It must parse an old
 * record and a new one alike and see the same thing in both. */
export function readMigrationRecord(text: string): unknown {
  const value = JSON.parse(text);
  if (value === null || typeof value !== "object") throw new Error("unreadable migration record");
  if (value.version === 2) {
    if (typeof value.operationId !== "string" || typeof value.status !== "string" || !Array.isArray(value.entries)) throw new Error("unreadable archive journal");
    return { kind: "archive-journal", status: value.status, entries: value.entries.map((entry: any) => ({ source: entry.source, archive: entry.archive, hash: entry.hash, status: entry.status })), targetManifest: value.targetManifest ?? null, rootAliases: value.rootAliases ?? null, nativeAdmission: value.nativeAdmission ?? null };
  }
  if (value.version === 1) {
    if (!Array.isArray(value.changes) || !Array.isArray(value.backups)) throw new Error("unreadable receipt");
    return {
      kind: "receipt", changes: value.changes.map((change: any) => ({ path: change.path, beforeNull: change.beforeHash === null, afterHash: change.afterHash, writer: change.writer ?? null })),
      backups: value.backups, codexReconcile: value.codexReconcile ?? null, cacheWitnessUpgrade: value.cacheWitnessUpgrade ?? null, retainedReviewArtifacts: value.retainedReviewArtifacts ?? null,
      rootAliases: value.rootAliases ?? null, nativeAdmission: value.nativeAdmission ?? null,
    };
  }
  throw new Error(`unsupported migration record version ${String(value.version)}`);
}

/** The record without its actor block, with the volatile parts masked, for
 * comparing a new record against the frozen old one from the same scenario. */
export function recordShape(text: string, homes: readonly string[] = []): unknown {
  let normalized = text;
  for (const home of homes) normalized = normalized.split(home).join("/home/fixture");
  const mask = (value: unknown): unknown => typeof value === "string"
    ? value.replace(/[0-9a-f]{64}/g, "<sha256>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>").replace(/\b(\d+)-[0-9a-f]{12}\b/g, "$1-<h12>")
    : Array.isArray(value) ? value.map(mask)
      : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mask(item)])) : value;
  const { actor: _actor, ...rest } = JSON.parse(normalized);
  return mask(rest);
}
