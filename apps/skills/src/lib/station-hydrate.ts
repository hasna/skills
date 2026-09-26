/**
 * `skills hydrate` — hydrate the canonical dedup corpus cache from a reviewed
 * per-station skills snapshot (`resources/<stationId>/skills/agent-homes/...`
 * plus its sync-manifest.json).
 *
 * Ported from hasna-internal/fleet-resources scripts/hydrate-cache.mjs
 * (v1-2026-08-15) under the package-abstractions rule (todos FLE-00037).
 * Wired to package internals where they exist instead of re-porting:
 * `isPointerSkillMd` / `POINTER_MARKER_PHRASE` from agent-sync.ts (the source
 * script mirrored them), `SYNC_AGENTS` for agent order, and
 * `resolveCorpusRoot()` for the default cache destination — the canonical
 * corpus resolution, so a migrated owner layout is never bypassed.
 *
 * Dedup rule per skill ident and per portable file (carried over unchanged):
 * for SKILL.md a content-bearing copy always beats a sync pointer stub
 * (`kind: executable` + the catalog pointer sentence — the defect output of
 * the absent-kind coercion, task 568efaaa / P-01641); a stub wins only when
 * every candidate is a stub. Among the eligible copies the winner is the one
 * whose (agent, path) pair is recorded in the snapshot's sync-manifest AND
 * whose bytes hash to the recorded sha256 (hash-winner rule; the manifest
 * record is a hash claim, verified against the candidate bytes — a record
 * whose hash does not match the bytes is an integrity violation and refuses
 * the whole hydration), otherwise the freshest mtime; ties break by agent
 * order claude < codewith < codex < opencode < cursor.
 *
 * Same fail-closed contract as the snapshot: symlinks refused, an existing
 * destination with different content is terminal non-acceptance, a
 * manifest-recorded sha256 that does not match the candidate bytes is
 * terminal non-acceptance (MANIFEST_HASH_MISMATCH). The port additionally
 * makes "nothing written" true by detecting conflicts across the whole plan
 * before writing anything.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import pkg from "../../package.json" with { type: "json" };

import {
  isPointerSkillMd,
  SYNC_AGENTS,
  type SyncAgent
} from "./agent-sync.js";
import { resolveCorpusRoot } from "./home-migration.js";
import {
  isExcludedSkillFileName,
  isPortableWithinSkill,
  isRegularFile,
  REFUSED_SCANNER_FLAGGED,
  walkEntries,
  type WalkEntry
} from "./portable-snapshot-filter.js";
import {
  sha256File,
  StationSnapshotError,
  validateStationId,
  type StationSnapshotErrorCode
} from "./station-snapshot.js";

/**
 * The wire schema of the per-station hydration manifest; keeps the
 * fleet-resources spelling for the same wire-compat reason as the
 * sync-manifest.
 */
export const STATION_HYDRATION_MANIFEST_SCHEMA = "hasna.fleet-resources.skills-hydration-manifest/v1";

/** Package identity recorded in the manifest's producer field. */
export const STATION_HYDRATION_PRODUCER = { name: "@hasna/skills", version: pkg.version };

export interface HydrationCandidate {
  ident: string;
  agent: SyncAgent;
  /** Ident-relative portable path, e.g. `scripts/run.sh`. */
  withinIdent: string;
  fullPath: string;
  size: number;
  mtimeMs: number;
  /** The manifest's recorded sha256 for (agent, home-relative path), if any. */
  manifestHash: string | null;
  /** True when the candidate's bytes hash to the manifest record (verified match). */
  verified: boolean;
}

export interface HydrationWinnerFile {
  withinIdent: string;
  winner: HydrationCandidate;
  /** The losing copies' agents, for reporting. */
  alternates: SyncAgent[];
}

export interface HydrationWinnerSkill {
  ident: string;
  files: HydrationWinnerFile[];
}

export interface StationHydrationOptions {
  stationId: string;
  /** Repo root holding resources/<stationId>/skills and its sync-manifest. */
  repoRoot?: string;
  /** Destination corpus cache; defaults to the canonical corpus root. */
  cacheRoot?: string;
  /** Report without writing anything (the default, as in the source script). */
  dryRun?: boolean;
}

export interface StationHydrationResult {
  stationId: string;
  mode: "dry-run" | "apply";
  cacheRoot: string;
  snapshotRoot: string;
  sourceSnapshotSha: string;
  stats: {
    idents: number;
    files: number;
    bytes: number;
    written?: number;
    unchanged?: number;
  };
  /** The full winner plan, for reporting (never written to the manifest). */
  winners: HydrationWinnerSkill[];
  /** The manifest payload shape: per-skill files plus the skill's sha256. */
  skills: Array<{
    ident: string;
    files: Array<{
      relativePath: string;
      sourceAgent: SyncAgent;
      sourceMtimeMs: number;
      size: number;
    }>;
    sha256: string | null;
  }>;
  manifestPath?: string;
}

interface SnapshotManifestFile {
  relativePath: string;
  agent: string | null;
  sha256: string;
}

interface SnapshotManifest {
  files?: SnapshotManifestFile[];
}

/**
 * Separator joining agent and path in the manifest-hash map key, mirroring
 * the source script's agent-separator-path compound key shape (its separator
 * is the NUL character). Built at runtime so the source file itself never
 * carries a literal NUL byte.
 */
const MANIFEST_HASH_KEY_SEP = String.fromCharCode(0);

function fail(
  code: StationSnapshotErrorCode,
  message: string,
  detail: string[] = []
): never {
  throw new StationSnapshotError(code, message, detail);
}

function snapshotRootFor(repoRoot: string, stationId: string): string {
  return join(repoRoot, "resources", stationId, "skills");
}

function readSnapshotManifest(repoRoot: string, stationId: string): {
  manifest: SnapshotManifest;
  manifestPath: string;
  sourceSnapshotSha: string;
} {
  const snapshotRoot = snapshotRootFor(repoRoot, stationId);
  const manifestPath = join(snapshotRoot, "sync-manifest.json");
  let manifest: SnapshotManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  } catch (error) {
    fail(
      "MANIFEST_UNREADABLE",
      `cannot read snapshot manifest: ${manifestPath}: ${(error as Error).message}`
    );
  }
  const sourceSnapshotSha = sha256File(manifestPath);
  return { manifest, manifestPath, sourceSnapshotSha };
}

interface HydrationPlan {
  manifest: SnapshotManifest;
  sourceSnapshotSha: string;
  winners: HydrationWinnerSkill[];
  skippedByRule: Array<{ ident: string; agent: SyncAgent; relativePath: string; reason: string }>;
  totalFiles: number;
  totalBytes: number;
}

/**
 * Build the dedup winner plan from the snapshot. Fails closed on symlinks and
 * on a missing or unreadable sync-manifest.
 */
export function planStationHydration(
  stationId: string,
  repoRoot: string
): HydrationPlan {
  validateStationId(stationId);
  const { manifest, sourceSnapshotSha } = readSnapshotManifest(repoRoot, stationId);
  const snapshotRoot = snapshotRootFor(repoRoot, stationId);

  // manifest hash lookup keyed by agent + snapshot-relative path
  const manifestHashes = new Map<string, string>();
  for (const file of manifest.files ?? []) {
    const relativePath = file.relativePath;
    const agent = file.agent;
    if (agent && relativePath) {
      manifestHashes.set(`${agent}${MANIFEST_HASH_KEY_SEP}${relativePath}`, file.sha256);
    }
  }

  const candidates: HydrationCandidate[] = [];
  const symlinks: Array<{ ident: string; agent: SyncAgent; relativePath: string }> = [];
  const hashMismatches: Array<{ ident: string; agent: SyncAgent; relativePath: string }> = [];
  const skippedByRule: HydrationPlan["skippedByRule"] = [];
  for (const agent of SYNC_AGENTS) {
    const agentRoot = join(snapshotRoot, "agent-homes", agent);
    let identEntries;
    try {
      identEntries = readdirSync(agentRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const identEntry of identEntries) {
      if (!identEntry.isDirectory() || identEntry.name.startsWith(".")) {
        continue;
      }
      const identRoot = join(agentRoot, identEntry.name);
      const entries: WalkEntry[] = walkEntries(identRoot);
      for (const entry of entries) {
        const relativeParts = [identEntry.name, ...entry.relativePath.split(sep)];
        if (entry.kind === "symlink") {
          symlinks.push({ ident: identEntry.name, agent, relativePath: entry.relativePath });
          continue;
        }
        if (!isPortableWithinSkill(relativeParts)) {
          skippedByRule.push({
            ident: identEntry.name, agent,
            relativePath: entry.relativePath, reason: "not-portable"
          });
          continue;
        }
        const fileName = relativeParts[relativeParts.length - 1];
        if (isExcludedSkillFileName(fileName)) {
          skippedByRule.push({
            ident: identEntry.name, agent,
            relativePath: entry.relativePath, reason: "excluded"
          });
          continue;
        }
        const withinIdent = relativeParts.slice(1).join(sep);
        const homeRelative = relativeParts.join(sep);
        if (REFUSED_SCANNER_FLAGGED.has(homeRelative)) {
          skippedByRule.push({
            ident: identEntry.name, agent,
            relativePath: entry.relativePath, reason: "refused-scanner-flagged"
          });
          continue;
        }
        if (!isRegularFile(entry.fullPath)) {
          skippedByRule.push({
            ident: identEntry.name, agent,
            relativePath: entry.relativePath, reason: "not-regular-file"
          });
          continue;
        }
        const info = statSync(entry.fullPath);
        const manifestHash =
          manifestHashes.get(`${agent}${MANIFEST_HASH_KEY_SEP}${homeRelative}`) ?? null;
        // A manifest record is a hash claim: verify the candidate's bytes
        // against it. Presence alone must never rank as a match (release
        // review P1) — a stale or tampered file whose bytes differ from the
        // reviewed record is an integrity violation, not a winner.
        let verified = false;
        if (manifestHash !== null) {
          verified = sha256File(entry.fullPath) === manifestHash;
          if (!verified) {
            hashMismatches.push({
              ident: identEntry.name,
              agent,
              relativePath: entry.relativePath
            });
          }
        }
        candidates.push({
          ident: identEntry.name,
          agent,
          withinIdent,
          fullPath: entry.fullPath,
          size: info.size,
          mtimeMs: info.mtimeMs,
          manifestHash,
          verified
        });
      }
    }
  }
  if (symlinks.length > 0) {
    fail(
      "SYMLINKS_REFUSED",
      `${symlinks.length} symlink(s) inside the snapshot; symlinks are refused (fail closed)`
    );
  }
  if (hashMismatches.length > 0) {
    fail(
      "MANIFEST_HASH_MISMATCH",
      `${hashMismatches.length} snapshot file(s) no longer match their sync-manifest sha256; ` +
        "stale or tampered content is refused (fail closed), nothing written — re-run sync to refresh the manifest",
      hashMismatches.map(
        (mismatch) => `agent-homes/${mismatch.agent}/${mismatch.ident}/${mismatch.relativePath}`
      )
    );
  }

  const byIdent = new Map<string, HydrationCandidate[]>();
  for (const candidate of candidates) {
    const group = byIdent.get(candidate.ident) ?? [];
    group.push(candidate);
    byIdent.set(candidate.ident, group);
  }

  // per (ident, withinIdent) winner: manifest-hash presence > freshest mtime >
  // agent order tie-break. For SKILL.md, content beats a pointer stub first:
  // stubs are filtered out of the candidate set unless every candidate is a
  // stub (task 568efaaa / P-01641) — the stub's `kind: executable` is the
  // defect output of the absent-kind coercion, never a declaration worth
  // distributing while real content exists.
  const winners: HydrationWinnerSkill[] = [];
  for (const [ident, group] of byIdent) {
    const byFile = new Map<string, HydrationCandidate[]>();
    for (const candidate of group) {
      const copies = byFile.get(candidate.withinIdent) ?? [];
      copies.push(candidate);
      byFile.set(candidate.withinIdent, copies);
    }
    const files: HydrationWinnerFile[] = [];
    for (const [withinIdent, copies] of byFile) {
      let eligible = copies;
      if (withinIdent === "SKILL.md") {
        const content: HydrationCandidate[] = [];
        for (const copy of copies) {
          let isStub = false;
          try {
            isStub = isPointerSkillMd(readFileSync(copy.fullPath, "utf8"));
          } catch {
            // Unreadable content is treated as content; never prefer a stub
            // over a file we could not read.
            isStub = false;
          }
          if (!isStub) content.push(copy);
        }
        if (content.length > 0) {
          eligible = content;
        }
      }
      eligible.sort((left, right) => {
        const leftHash = left.verified;
        const rightHash = right.verified;
        if (leftHash !== rightHash) {
          return leftHash ? -1 : 1;
        }
        if (right.mtimeMs !== left.mtimeMs) {
          return right.mtimeMs - left.mtimeMs;
        }
        return SYNC_AGENTS.indexOf(left.agent) - SYNC_AGENTS.indexOf(right.agent);
      });
      const winner = eligible[0];
      files.push({
        withinIdent,
        winner,
        // The source script reported alternates as the walk-order tail; the
        // port reports the actual losing copies (reporting only).
        alternates: copies.filter((copy) => copy !== winner).map((copy) => copy.agent)
      });
    }
    files.sort((left, right) => left.withinIdent.localeCompare(right.withinIdent));
    winners.push({ ident, files });
  }
  winners.sort((left, right) => left.ident.localeCompare(right.ident));

  const totalFiles = winners.reduce((sum, skill) => sum + skill.files.length, 0);
  const totalBytes = winners.reduce(
    (sum, skill) => sum + skill.files.reduce(
      (inner, file) => inner + file.winner.size, 0
    ),
    0
  );

  return { manifest, sourceSnapshotSha, winners, skippedByRule, totalFiles, totalBytes };
}

/** sha256 of the skill's SKILL.md when present, else the single file, else the joined sorted file hashes. */
function skillSha256(skill: HydrationWinnerSkill): string {
  const skillMd = skill.files.find((file) => file.withinIdent === "SKILL.md");
  if (skillMd) {
    return sha256File(skillMd.winner.fullPath);
  }
  if (skill.files.length === 1) {
    return sha256File(skill.files[0].winner.fullPath);
  }
  const joined = skill.files.map((file) => sha256File(file.winner.fullPath));
  return createHash("sha256")
    .update(joined.sort().join("\n"))
    .digest("hex");
}

/**
 * Run the hydration. Dry-run reports and writes nothing; apply detects
 * conflicts across the whole plan first and only then writes, so the terminal
 * refusal genuinely writes nothing.
 */
export function writeStationHydration(options: StationHydrationOptions): StationHydrationResult {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const cacheRoot = resolve(options.cacheRoot ?? resolveCorpusRoot());
  const plan = planStationHydration(options.stationId, repoRoot);

  const resultSkills: StationHydrationResult["skills"] = plan.winners.map((skill) => ({
    ident: skill.ident,
    files: skill.files.map((file) => ({
      relativePath: file.withinIdent,
      sourceAgent: file.winner.agent,
      sourceMtimeMs: file.winner.mtimeMs,
      size: file.winner.size
    })),
    sha256: skillSha256(skill)
  }));

  const base: StationHydrationResult = {
    stationId: options.stationId,
    mode: "dry-run",
    cacheRoot,
    snapshotRoot: snapshotRootFor(repoRoot, options.stationId),
    sourceSnapshotSha: plan.sourceSnapshotSha,
    stats: {
      idents: plan.winners.length,
      files: plan.totalFiles,
      bytes: plan.totalBytes
    },
    winners: plan.winners,
    skills: resultSkills
  };
  if (options.dryRun !== false) {
    return base;
  }

  // Conflict detection first: an existing destination with different content
  // is terminal non-acceptance, and no file may be written in that case.
  const conflicts: string[] = [];
  const toWrite: Array<{ destination: string; fullPath: string }> = [];
  for (const skill of plan.winners) {
    for (const file of skill.files) {
      const destination = join(cacheRoot, skill.ident, file.withinIdent);
      const digest = sha256File(file.winner.fullPath);
      let existingDigest: string | null = null;
      try {
        existingDigest = sha256File(destination);
      } catch {
        // destination absent
      }
      if (existingDigest !== null) {
        if (existingDigest === digest) {
          // unchanged; nothing to write
          continue;
        }
        conflicts.push(
          `existing destination differs from snapshot winner: ${destination}`
        );
        continue;
      }
      toWrite.push({ destination, fullPath: file.winner.fullPath });
    }
  }
  if (conflicts.length > 0) {
    fail(
      "CONFLICT",
      `${conflicts.length} conflict(s); terminal non-acceptance, nothing written`,
      conflicts
    );
  }

  let written = 0;
  for (const entry of toWrite) {
    mkdirSync(dirname(entry.destination), { recursive: true });
    copyFileSync(entry.fullPath, entry.destination);
    written += 1;
  }
  const unchanged = plan.totalFiles - written;

  const hydration = {
    schema: STATION_HYDRATION_MANIFEST_SCHEMA,
    stationId: options.stationId,
    hydratedAt: new Date().toISOString(),
    producer: STATION_HYDRATION_PRODUCER,
    sourceSnapshotSha: plan.sourceSnapshotSha,
    cacheRoot,
    stats: {
      idents: plan.winners.length,
      written,
      unchanged,
      files: plan.totalFiles,
      bytes: plan.totalBytes
    },
    skills: resultSkills
  };
  const hydrationManifestPath = join(
    dirname(cacheRoot), `hydration-${options.stationId}.json`
  );
  mkdirSync(dirname(hydrationManifestPath), { recursive: true });
  writeFileSync(hydrationManifestPath, `${JSON.stringify(hydration, null, 2)}\n`);

  return {
    ...base,
    mode: "apply",
    stats: { ...base.stats, written, unchanged },
    manifestPath: hydrationManifestPath
  };
}
