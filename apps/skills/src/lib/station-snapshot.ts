/**
 * `skills sync --station <id>` — the per-station additive snapshot of
 * installed skill homes into a reviewed snapshot repo
 * (`resources/<stationId>/skills/{skills,custom,agent-homes/<agent>}`) with a
 * v3 sync-manifest, the dedup hydrator's wire input.
 *
 * Ported from hasna-internal/fleet-resources scripts/sync-skills.mjs (producer
 * v3-2026-08-15) under the package-abstractions rule (todos FLE-00037).
 * Portable-filter, exclusions, refusals and symlink fail-closed behavior come
 * from portable-snapshot-filter.ts, which the hydrator shares.
 *
 * Contract carried over from the source script, unchanged:
 * - additive: never deletes on the repo side;
 * - symlinks inside skill homes are refused (fail closed, exit 2);
 * - an existing destination file with different content is terminal
 *   non-acceptance (exit 2);
 * - dry-run is the default mode and writes nothing; --populate writes.
 *
 * One deliberate correction: the source script wrote non-conflicting files
 * before discovering conflicts and then reported "nothing written". The port
 * detects every conflict first and writes only when none exist, so the
 * stated contract is true.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import pkg from "../../package.json" with { type: "json" };

import {
  destinationFor,
  homePathFor,
  isExcludedSkillFileName,
  isPortableWithinSkill,
  isRegularFile,
  REFUSED_SCANNER_FLAGGED,
  SYNC_HOMES,
  walkEntries,
  type SyncHomeDefinition
} from "./portable-snapshot-filter.js";

/**
 * The wire schema of the per-station sync-manifest. The name keeps the
 * fleet-resources spelling deliberately: the fleet hydrator (and the snapshot
 * repo's consumers) record and compare this string, so the package-owned
 * producer writes the same value the retired script wrote.
 */
export const STATION_SYNC_MANIFEST_SCHEMA = "hasna.fleet-resources.skills-sync-manifest/v1";

/** Package identity recorded in the manifest's producer field. */
export const STATION_SNAPSHOT_PRODUCER = { name: "@hasna/skills", version: pkg.version };

export type StationSnapshotErrorCode =
  | "INVALID_STATION"
  | "SYMLINKS_REFUSED"
  | "CONFLICT"
  | "DESTINATION_ESCAPE"
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_HASH_MISMATCH";

export class StationSnapshotError extends Error {
  readonly code: StationSnapshotErrorCode;
  /** Per-item lines for the CONFLICT class (printed before the summary). */
  readonly detail: string[];

  constructor(code: StationSnapshotErrorCode, message: string, detail: string[] = []) {
    super(message);
    this.name = "StationSnapshotError";
    this.code = code;
    this.detail = detail;
  }
}

/** Validate a station id the same way the source script does. */
export function validateStationId(stationId: string): void {
  if (!/^[a-z0-9-]+$/.test(stationId)) {
    throw new StationSnapshotError(
      "INVALID_STATION",
      `station id must be a slug, got: ${stationId}`
    );
  }
}

export interface PortableSnapshotFile {
  relativePath: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
  mtimeIso: string;
}

export interface SnapshotSkip {
  relativePath: string;
  reason: "symlink" | "not-portable" | "excluded" | "refused-scanner-flagged" | "not-regular-file";
}

export interface ScannedHome {
  definition: SyncHomeDefinition;
  homePath: string;
  portable: PortableSnapshotFile[];
  skipped: SnapshotSkip[];
}

export interface SnapshotPlan {
  definition: SyncHomeDefinition;
  source: PortableSnapshotFile;
  destination: string;
  digest: string;
}

export interface StationSnapshotOptions {
  stationId: string;
  /** Target repo root; the snapshot lands in <repoRoot>/resources/<stationId>/skills. */
  repoRoot?: string;
  /** Stage the homes from a mirror instead of this machine's real $HOME. */
  homesRoot?: string;
  /** Report without writing anything (the default, as in the source script). */
  dryRun?: boolean;
}

export interface StationSnapshotManifestFile {
  relativePath: string;
  destination: string;
  subClass: "skills" | "custom" | "agent-homes";
  agent: string | null;
  sha256: string;
  sourceMtimeMs: number;
  sourceMtimeIso: string;
  size: number;
}

export interface StationSnapshotResult {
  stationId: string;
  mode: "dry-run" | "populate";
  repoRoot: string;
  stats: {
    files: number;
    bytes: number;
    written?: number;
    unchanged?: number;
  };
  homes: Array<{
    name: string;
    homePath: string;
    files: number;
    skipped: number;
  }>;
  manifestPath?: string;
  files: StationSnapshotManifestFile[];
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function scanHome(
  definition: SyncHomeDefinition,
  homesRoot?: string
): ScannedHome {
  const homePath = homePathFor(definition, homesRoot);
  const entries = walkEntries(homePath);
  const portable: PortableSnapshotFile[] = [];
  const skipped: SnapshotSkip[] = [];
  for (const entry of entries) {
    const relativeParts = entry.relativePath.split(sep);
    const fileName = relativeParts[relativeParts.length - 1];
    if (entry.kind === "symlink") {
      skipped.push({ relativePath: entry.relativePath, reason: "symlink" });
      continue;
    }
    if (!isPortableWithinSkill(relativeParts)) {
      skipped.push({ relativePath: entry.relativePath, reason: "not-portable" });
      continue;
    }
    if (isExcludedSkillFileName(fileName)) {
      skipped.push({ relativePath: entry.relativePath, reason: "excluded" });
      continue;
    }
    if (REFUSED_SCANNER_FLAGGED.has(entry.relativePath)) {
      skipped.push({ relativePath: entry.relativePath, reason: "refused-scanner-flagged" });
      continue;
    }
    if (!isRegularFile(entry.fullPath)) {
      skipped.push({ relativePath: entry.relativePath, reason: "not-regular-file" });
      continue;
    }
    const info = statSync(entry.fullPath);
    portable.push({
      relativePath: entry.relativePath,
      fullPath: entry.fullPath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      mtimeIso: info.mtime.toISOString()
    });
  }
  return { definition, homePath, portable, skipped };
}

/** Scan every home and build the write plan; fails closed on symlinks. */
export function planStationSnapshot(options: StationSnapshotOptions): {
  scanned: ScannedHome[];
  plans: SnapshotPlan[];
  totalBytes: number;
} {
  validateStationId(options.stationId);
  const scanned = SYNC_HOMES.map(
    (definition) => scanHome(definition, options.homesRoot)
  );
  const symlinks = scanned.reduce(
    (sum, item) => sum + item.skipped.filter((entry) => entry.reason === "symlink").length,
    0
  );
  if (symlinks > 0) {
    throw new StationSnapshotError(
      "SYMLINKS_REFUSED",
      `${symlinks} symlink(s) inside skill homes; symlinks are refused (fail closed)`
    );
  }

  const plans: SnapshotPlan[] = [];
  for (const item of scanned) {
    for (const file of item.portable) {
      plans.push({
        definition: item.definition,
        source: file,
        destination: destinationFor(item.definition, options.stationId, file.relativePath),
        digest: sha256File(file.fullPath)
      });
    }
  }
  const totalBytes = plans.reduce((sum, plan) => sum + plan.source.size, 0);
  return { scanned, plans, totalBytes };
}

function humanHomes(scanned: ScannedHome[]): StationSnapshotResult["homes"] {
  return scanned.map((item) => ({
    name: item.definition.name,
    homePath: item.homePath,
    files: item.portable.length,
    skipped: item.skipped.length
  }));
}

/**
 * Run the per-station snapshot. Dry-run reports and writes nothing; populate
 * detects conflicts across the whole plan first and only then writes, so the
 * terminal refusal genuinely writes nothing.
 */
export function writeStationSnapshot(options: StationSnapshotOptions): StationSnapshotResult {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const { scanned, plans, totalBytes } = planStationSnapshot(options);
  const manifestFiles: StationSnapshotManifestFile[] = plans.map((plan) => ({
    relativePath: plan.source.relativePath,
    destination: plan.destination,
    subClass: plan.definition.subClass,
    agent: plan.definition.agent,
    sha256: plan.digest,
    sourceMtimeMs: plan.source.mtimeMs,
    sourceMtimeIso: plan.source.mtimeIso,
    size: plan.source.size
  }));

  const base: StationSnapshotResult = {
    stationId: options.stationId,
    mode: "dry-run",
    repoRoot,
    stats: { files: plans.length, bytes: totalBytes },
    homes: humanHomes(scanned),
    files: manifestFiles
  };
  if (options.dryRun !== false) {
    return base;
  }

  // Conflict detection first: an existing destination with different content
  // is terminal non-acceptance, and no file may be written in that case.
  const conflicts: string[] = [];
  const untouched: SnapshotPlan[] = [];
  for (const plan of plans) {
    const destination = resolve(repoRoot, plan.destination);
    const destinationRelative = relative(repoRoot, destination);
    if (destinationRelative.startsWith("..") ||
      destinationRelative.startsWith(sep) ||
      isAbsolute(destinationRelative)) {
      throw new StationSnapshotError(
        "DESTINATION_ESCAPE",
        `destination escapes repo root: ${plan.destination}`
      );
    }
    let existingDigest: string | null = null;
    try {
      existingDigest = sha256File(destination);
    } catch {
      // destination absent
    }
    if (existingDigest !== null) {
      if (existingDigest === plan.digest) {
        // unchanged; nothing to write
        continue;
      }
      conflicts.push(
        `existing destination differs from staged source: ${plan.destination}`
      );
      continue;
    }
    untouched.push(plan);
  }
  if (conflicts.length > 0) {
    throw new StationSnapshotError(
      "CONFLICT",
      `${conflicts.length} conflict(s); terminal non-acceptance, nothing written`,
      conflicts
    );
  }

  let written = 0;
  for (const plan of untouched) {
    const destination = resolve(repoRoot, plan.destination);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(plan.source.fullPath, destination);
    written += 1;
  }
  const unchanged = plans.length - untouched.length;

  const manifest = {
    schema: STATION_SYNC_MANIFEST_SCHEMA,
    stationId: options.stationId,
    syncedAt: new Date().toISOString(),
    producer: STATION_SNAPSHOT_PRODUCER,
    stats: {
      written,
      unchanged,
      files: plans.length,
      bytes: totalBytes
    },
    files: manifestFiles
  };
  const manifestPath = resolve(
    repoRoot, "resources", options.stationId, "skills", "sync-manifest.json"
  );
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    ...base,
    mode: "populate",
    stats: { files: plans.length, bytes: totalBytes, written, unchanged },
    manifestPath
  };
}
