/**
 * Unmarked-home adoption, conflicts ledger, rollback records, and prune.
 *
 * Agent homes are full of skill directories the `skills` CLI never wrote — the
 * ad-hoc sed/scp/rsync era. Those directories carry no `.hasna-skills.json`
 * marker, and the sync write path refuses to touch them by design. Adoption is
 * the migration mode for that population: hash each unmarked home skill's
 * SKILL.md against the canonical corpus cache and
 *
 *   - exact hash match  -> write a marker and adopt (the dir is canonical)
 *   - content differs   -> record to the conflicts ledger and SKIP (never
 *                          overwrite an unmarked dir)
 *   - no canonical entry -> report as unknown and SKIP
 *
 * Read-only by default; --apply is what writes markers and the conflicts
 * ledger. Nothing is ever deleted by adoption. Prune is a separate, flag-gated
 * operation that removes only marked-and-stray directories (marker present, no
 * canonical corpus entry) after recording every removal in the rollback store.
 */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  SYNC_AGENTS,
  SYNC_MARKER_FILE,
  SYNC_MARKER_MANAGED_BY,
  agentGlobalSkillsDir,
  isSkillsOwnershipMarker,
  type SyncAgent,
  type SyncMarker,
} from "./agent-sync.js";
import { getDataDir } from "./config.js";
import { resolveCorpusRoot } from "./home-migration.js";
import { hashSkillMarkdownFile } from "./skill-hash.js";
import type { PortableSkillOptions } from "./portable-skills.js";
import { normalizePortableSkillName } from "./portable-skills-files.js";

export const CONFLICTS_LEDGER_FILE = "conflicts.json";
export const ROLLBACK_DIRNAME = "rollback";

export interface HomeSkillEntry {
  agent: SyncAgent;
  skill: string;
  /** The agent home skills directory (e.g. ~/.claude/skills). */
  home: string;
  /** The skill's own directory under the agent home. */
  path: string;
  hash: string;
  /** SKILL.md mtime (ISO). */
  mtime: string;
}

export interface HomeConflict extends HomeSkillEntry {
  canonicalHash: string;
}

export interface UnknownHomeSkill extends HomeSkillEntry {}

export interface AdoptionScan {
  /** Unmarked home dirs whose SKILL.md hash matches the canonical corpus entry. */
  adoptable: HomeSkillEntry[];
  /** Unmarked home dirs whose content differs from canonical; never touched. */
  conflicts: HomeConflict[];
  /** Unmarked home dirs with no canonical corpus entry; reported and skipped. */
  unknown: UnknownHomeSkill[];
  /** Already-marked dirs, counted only. */
  managed: number;
}

export interface AdoptionOptions extends PortableSkillOptions {
  agents?: SyncAgent[];
  /** Optional selected home/corpus names; omitted means all names. */
  names?: string[];
  /** Write markers and the conflicts ledger. Without it, scan only. */
  apply?: boolean;
}

export interface AdoptionResult extends AdoptionScan {
  applied: boolean;
  /** Rollback record path, when markers were written. */
  rollbackFile?: string;
}

export interface RollbackMarker {
  agent: SyncAgent;
  skill: string;
  path: string;
  hash: string;
  marker: SyncMarker;
}

export interface RollbackRecord {
  version: 1;
  mode: "adopt" | "prune";
  timestamp: string;
  entries: RollbackMarker[];
}

export interface PruneCandidate extends RollbackMarker {
  /** The agent home skills directory. */
  home: string;
}

export interface PruneResult {
  candidates: PruneCandidate[];
  pruned: number;
  dryRun: boolean;
  rollbackFile?: string;
}

/**
 * Canonical corpus index: skill name -> canonical SKILL.md hash. A skill is
 * canonical when the corpus cache holds a directory with a SKILL.md.
 */
export function indexCanonicalCorpus(corpusRoot: string): Map<string, string> {
  const byName = new Map<string, string>();
  if (!existsSync(corpusRoot)) return byName;
  let entries: string[] = [];
  try {
    entries = readdirSync(corpusRoot);
  } catch {
    return byName;
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) continue;
    const skillMd = join(corpusRoot, entry, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    try {
      byName.set(entry, hashSkillMarkdownFile(skillMd));
    } catch {
      // Unreadable canonical skill: not part of the index.
    }
  }
  return byName;
}

function readUnmarkedHomeSkills(homeDir: string, agents: SyncAgent[]): Array<{ agent: SyncAgent; dir: string; skill: string; skillMdPath: string }> {
  const found: Array<{ agent: SyncAgent; dir: string; skill: string; skillMdPath: string }> = [];
  for (const agent of agents) {
    const home = agentGlobalSkillsDir(agent, homeDir);
    if (!existsSync(home)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(home);
    } catch {
      continue;
    }
    for (const skill of entries.sort()) {
      if (skill.startsWith(".")) continue;
      const dir = join(home, skill);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(dir, SYNC_MARKER_FILE))) continue;
      const skillMdPath = join(dir, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      found.push({ agent, dir, skill, skillMdPath });
    }
  }
  return found;
}

/** A prune selection may name a stray home with no canonical corpus entry. */
function selectedHomeNames(options: AdoptionOptions, index: Map<string, string>, homeDir: string, agents: SyncAgent[]): Set<string> | undefined {
  if (!options.names?.length) return undefined;
  const names = new Set(options.names.map(name => name.trim()).filter(Boolean).map(normalizePortableSkillName));
  if (names.size === 0) throw new Error("At least one non-empty skill name is required");
  for (const name of names) {
    if (index.has(name)) continue;
    const present = agents.some(agent => {
      try { return statSync(join(agentGlobalSkillsDir(agent, homeDir), name)).isDirectory(); }
      catch { return false; }
    });
    if (!present) throw new Error(`Skill '${name}' not found in the selected corpus or agent homes`);
  }
  return names;
}

/**
 * Census of unmarked home skill dirs against the canonical corpus. Read-only.
 */
export function scanUnmarkedHomes(options: AdoptionOptions = {}): AdoptionScan {
  const homeDir = options.homeDir ?? homedir();
  const corpusRoot = resolveCorpusRoot(options);
  const index = indexCanonicalCorpus(corpusRoot);
  const agents = options.agents?.length ? options.agents : [...SYNC_AGENTS];
  const names = selectedHomeNames(options, index, homeDir, agents);

  const scan: AdoptionScan = { adoptable: [], conflicts: [], unknown: [], managed: 0 };

  for (const agent of agents) {
    const home = agentGlobalSkillsDir(agent, homeDir);
    if (!existsSync(home)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(home);
    } catch {
      continue;
    }
    for (const skill of entries.sort()) {
      if (skill.startsWith(".")) continue;
      if (names && !names.has(skill)) continue;
      const dir = join(home, skill);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(dir, SYNC_MARKER_FILE))) {
        scan.managed += 1;
        continue;
      }
      const skillMdPath = join(dir, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;
      const hash = hashSkillMarkdownFile(skillMdPath);
      const mtime = statSync(skillMdPath).mtime.toISOString();
      const entry: HomeSkillEntry = { agent, skill, home, path: dir, hash, mtime };
      const canonicalHash = index.get(skill);
      if (canonicalHash === undefined) {
        scan.unknown.push({ ...entry });
      } else if (canonicalHash === hash) {
        scan.adoptable.push(entry);
      } else {
        scan.conflicts.push({ ...entry, canonicalHash });
      }
    }
  }
  return scan;
}

function appendConflictsLedger(appDir: string, conflicts: HomeConflict[]): void {
  if (conflicts.length === 0) return;
  const ledgerPath = join(appDir, CONFLICTS_LEDGER_FILE);
  let ledger: { version: 1; entries: HomeConflict[] } = { version: 1, entries: [] };
  if (existsSync(ledgerPath)) {
    try {
      const parsed = JSON.parse(readFileSync(ledgerPath, "utf-8"));
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
        ledger = parsed;
      }
    } catch {
      // Unreadable ledger: start a fresh one rather than losing this run's conflicts.
    }
  }
  const byKey = new Map<string, HomeConflict>();
  for (const entry of ledger.entries) byKey.set(`${entry.agent}/${entry.skill}`, entry);
  for (const conflict of conflicts) byKey.set(`${conflict.agent}/${conflict.skill}`, conflict);
  ledger.entries = [...byKey.values()].sort((a, b) => `${a.agent}/${a.skill}`.localeCompare(`${b.agent}/${b.skill}`));
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * Write one rollback record listing every marker written (mode "adopt") or
 * every directory removed (mode "prune"), so both operations are auditable
 * from a single machine-readable file. Deleted resource bytes are not stored.
 */
export function writeRollbackRecord(mode: "adopt" | "prune", entries: RollbackMarker[], appDir: string = getDataDir()): string {
  const dir = join(appDir, ROLLBACK_DIRNAME);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${mode}-${Date.now()}.json`);
  const record: RollbackRecord = { version: 1, mode, timestamp: new Date().toISOString(), entries };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/**
 * Adopt unmarked home skills whose content exactly matches the canonical
 * corpus. Without `apply` this is a pure scan; with `apply` it writes one
 * marker per exact match, appends diverging dirs to the conflicts ledger, and
 * records every written marker in a rollback file. Never deletes anything.
 */
export function adoptUnmarkedHomes(options: AdoptionOptions = {}): AdoptionResult {
  const scan = scanUnmarkedHomes(options);
  if (!options.apply) {
    return { ...scan, applied: false };
  }

  const appDir = options.homeDir ? join(options.homeDir, ".hasna", "skills") : getDataDir();
  const markers: RollbackMarker[] = scan.adoptable.map((entry) => {
    const marker: SyncMarker = {
      managedBy: SYNC_MARKER_MANAGED_BY,
      skill: entry.skill,
      source: "adopted",
      syncedAt: new Date().toISOString(),
    };
    writeFileSync(join(entry.path, SYNC_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
    return { agent: entry.agent, skill: entry.skill, path: entry.path, hash: entry.hash, marker };
  });

  appendConflictsLedger(appDir, scan.conflicts);

  let rollbackFile: string | undefined;
  if (markers.length > 0) {
    rollbackFile = writeRollbackRecord("adopt", markers, appDir);
  }
  return { ...scan, applied: true, rollbackFile };
}

/**
 * List (or, with `apply`, remove) marked home skill dirs that have no canonical
 * corpus entry. Never touches an unmarked directory. Removals are recorded in
 * the rollback store before they happen.
 */
/** Read a bounded regular marker without following links and retain its identity
 * for the final pre-removal check. A rollback write cannot grant new ownership. */
function pruneOwnership(dir: string): { marker: SyncMarker; identity: string } | undefined {
  let descriptor: number | undefined;
  try {
    const directory = lstatSync(dir);
    if (!directory.isDirectory()) return;
    const markerPath = join(dir, SYNC_MARKER_FILE), markerPathBefore = lstatSync(markerPath);
    if (!markerPathBefore.isFile()) return;
    descriptor = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.dev !== markerPathBefore.dev || before.ino !== markerPathBefore.ino
      || before.size !== markerPathBefore.size || before.mtimeMs !== markerPathBefore.mtimeMs || before.ctimeMs !== markerPathBefore.ctimeMs
      || before.size < 1 || before.size > 65536) return;
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, length);
      if (!count) break; length += count;
    }
    const after = fstatSync(descriptor), current = lstatSync(dir), markerPathAfter = lstatSync(markerPath);
    if (!markerPathAfter.isFile() || markerPathAfter.dev !== before.dev || markerPathAfter.ino !== before.ino
      || markerPathAfter.size !== before.size || markerPathAfter.mtimeMs !== before.mtimeMs || markerPathAfter.ctimeMs !== before.ctimeMs
      || length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || !current.isDirectory() || current.dev !== directory.dev || current.ino !== directory.ino) return;
    const text = bytes.subarray(0, length).toString("utf8"), marker: unknown = JSON.parse(text);
    if (!isSkillsOwnershipMarker(marker)) return;
    return { marker: marker as unknown as SyncMarker, identity: JSON.stringify([directory.dev, directory.ino, before.dev, before.ino, before.mtimeMs, before.ctimeMs, text]) };
  } catch { return; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

export function pruneStrayHomes(options: AdoptionOptions = {}): PruneResult {
  const homeDir = options.homeDir ?? homedir();
  const corpusRoot = resolveCorpusRoot(options);
  const index = indexCanonicalCorpus(corpusRoot);
  const agents = options.agents?.length ? options.agents : [...SYNC_AGENTS];
  const names = selectedHomeNames(options, index, homeDir, agents);

  const candidates: PruneCandidate[] = [];
  const ownership = new Map<string, string>();
  for (const agent of agents) {
    const home = agentGlobalSkillsDir(agent, homeDir);
    if (!existsSync(home)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(home);
    } catch {
      continue;
    }
    for (const skill of entries.sort()) {
      if (skill.startsWith(".")) continue;
      if (names && !names.has(skill)) continue;
      const dir = join(home, skill);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      if (index.has(skill)) continue;
      const owned = pruneOwnership(dir);
      if (!owned) continue;
      const marker = owned.marker;
      ownership.set(dir, owned.identity);
      const skillMdPath = join(dir, "SKILL.md");
      const hash = existsSync(skillMdPath) ? hashSkillMarkdownFile(skillMdPath) : "";
      candidates.push({ agent, skill, home, path: dir, hash, marker });
    }
  }

  if (!options.apply) {
    return { candidates, pruned: 0, dryRun: true };
  }

  const appDir = options.homeDir ? join(options.homeDir, ".hasna", "skills") : getDataDir();
  const rollbackFile = writeRollbackRecord(
    "prune",
    candidates.map(({ agent, skill, path, hash, marker }) => ({ agent, skill, path, hash, marker })),
    appDir,
  );
  let pruned = 0;
  for (const candidate of candidates) {
    if (pruneOwnership(candidate.path)?.identity !== ownership.get(candidate.path)) continue;
    rmSync(candidate.path, { recursive: true, force: true });
    pruned++;
  }
  return { candidates, pruned, dryRun: false, rollbackFile };
}
