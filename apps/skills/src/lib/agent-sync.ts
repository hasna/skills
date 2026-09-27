/**
 * `skills sync` — the last mile: write skills from this machine's corpus
 * (the migrated owner-layout cache ~/.hasna/skills/skills/<name>/, or the
 * legacy ~/.hasna/skills/installed/<name>/ when not migrated) into each coding
 * agent's global skills directory, per-tool adapted, so an agent auto-loads
 * them.
 *
 * This is the deliberate reversal of the old "pins, not installs" stub: agent skill
 * folders used to be left entirely unmanaged and every write path returned success:false.
 * They are now written — but only the ones this tool owns. Ownership is tracked with a
 * marker file. An unmarked directory is left alone by default; only one that already has
 * SKILL.md can be explicitly adopted, while any other unmarked directory is never touched.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { assertNativeExportAllowed } from "./agent-integration.js";

import {
  listPortableSkills,
  normalizePortableSkillName,
  readPortableSkillManifest,
} from "./portable-skills.js";
import { resolveCorpusRoot } from "./home-migration.js";
import type { SkillKind } from "./registry-types.js";

/**
 * The coding agents `skills sync` targets by default. These runtimes load a
 * `<home>/.<agent>/skills/<name>/SKILL.md` tree (OpenCode is the one path exception).
 * Gemini is retired; Windsurf/pi are addressable through installSkillForAgent but are
 * not in the default fan-out.
 */
export type SyncAgent = "claude" | "codewith" | "codex" | "opencode" | "cursor";
export const SYNC_AGENTS: readonly SyncAgent[] = ["claude", "codewith", "codex", "opencode", "cursor"] as const;

/**
 * Environment variable naming an explicit canonical-corpus source for sync. The CLI
 * `--source <path>` flag takes precedence; this is the ambient form, and it means the
 * same thing: the npm package ships no corpus, so a machine that has not pulled from an
 * instance (or that is not a checkout of the monorepo) must point sync at where the
 * corpus actually is.
 */
export const SKILLS_SOURCE_ENV = "SKILLS_SOURCE";

/**
 * Ownership marker written beside every SKILL.md this tool syncs. Its exact managedBy
 * value tells a re-sync which directories this tool owns; a foreign or malformed
 * marker grants no authority. A hidden sidecar rather than a frontmatter field so the SKILL.md the
 * agent loads stays exactly the adapted document and nothing else.
 */
export const SYNC_MARKER_FILE = ".hasna-skills.json";
export const SYNC_MARKER_MANAGED_BY = "@hasna/skills";

export interface SyncMarker {
  managedBy: string;
  skill: string;
  source: string;
  syncedAt: string;
}

/** Internal shared ownership predicate; not exported by the public package entrypoint. */
export function isSkillsOwnershipMarker(marker: unknown): marker is Record<string, unknown> {
  return typeof marker === "object" && marker !== null && Object.hasOwn(marker, "managedBy")
    && (marker as { managedBy: unknown }).managedBy === SYNC_MARKER_MANAGED_BY;
}

/** Read only a regular ownership sidecar. */
export function hasSkillsOwnershipMarker(dir: string): boolean {
  const path = join(dir, SYNC_MARKER_FILE);
  try {
    // Only parse a regular sidecar, rather than reading a directory or a pipe.
    if (!lstatSync(path).isFile()) return false;
    const marker: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isSkillsOwnershipMarker(marker);
  } catch {
    return false;
  }
}

export function isSyncAgent(value: string): value is SyncAgent {
  return (SYNC_AGENTS as readonly string[]).includes(value);
}

export function resolveSyncAgents(arg?: string): SyncAgent[] {
  if (!arg || arg === "all") return [...SYNC_AGENTS];
  if (!isSyncAgent(arg)) {
    throw new Error(`Unknown agent: ${arg}. Available: ${SYNC_AGENTS.join(", ")}, all`);
  }
  return [arg];
}

/** The global skills directory for an agent, honouring a test-supplied home. */
export function agentGlobalSkillsDir(agent: SyncAgent, homeDir: string = homedir()): string {
  switch (agent) {
    case "opencode":
      return join(homeDir, ".config", "opencode", "skills");
    default:
      return join(homeDir, `.${agent}`, "skills");
  }
}

/**
 * Adapt a SKILL.md for a target agent.
 *
 * `user_invocable` is a Claude-only frontmatter field (it controls Claude's slash menu).
 * The Claude copy carries it; every other agent's copy has it stripped, because the field
 * is meaningless there and skill-sync policy is that non-Claude copies must not carry
 * Claude-specific frontmatter. The body is left verbatim: automatically rewriting prose
 * would corrupt meaning, and corpus/instruction skills are authored tool-neutral.
 */
export function adaptSkillMdForAgent(skillMd: string, agent: string): string {
  const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return skillMd;
  const rawFrontmatter = match[1];
  const body = skillMd.slice(match[0].length);

  const lines = rawFrontmatter.split(/\r?\n/).filter((line) => !/^\s*user_invocable\s*:/i.test(line));
  if (agent === "claude") {
    // Insert user_invocable directly after the name line (or at the top) so Claude shows
    // the synced skill in its slash menu.
    const nameIndex = lines.findIndex((line) => /^\s*name\s*:/i.test(line));
    const insertAt = nameIndex === -1 ? 0 : nameIndex + 1;
    lines.splice(insertAt, 0, "user_invocable: true");
  }
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/**
 * The sentence every sync pointer stub carries in its body. It survives per-agent
 * adaptation (adaptSkillMdForAgent only touches `user_invocable`), so it is the stable
 * fingerprint for "this document is a pointer, not the skill's real content".
 */
export const POINTER_MARKER_PHRASE = "This is an executable skill from the @hasna/skills catalog";

/**
 * True when a SKILL.md is a sync pointer stub: frontmatter declares `kind: executable`
 * AND the body carries the canonical pointer sentence. A full content document is never
 * a stub even when it mentions the sentence, because it lacks the kind marker.
 */
export function isPointerSkillMd(markdown: string): boolean {
  return markdown.includes(POINTER_MARKER_PHRASE) && /^kind:\s*executable\b/m.test(markdown);
}

/** A pointer SKILL.md for an executable skill: what it is and how to actually run it. */
export function pointerSkillMd(name: string, description: string): string {
  const display = name.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "kind: executable",
    "---",
    "",
    `# ${display}`,
    "",
    description,
    "",
    "This is an executable skill from the @hasna/skills catalog. It is not run from this",
    "file: invoke it with `skills run " + name + "` or through the Skills API. The runnable",
    "source lives in the catalog, not in this agent folder.",
    "",
  ].join("\n");
}

export type SyncActionKind = "create" | "update" | "skip";

export interface AgentSyncAction {
  skill: string;
  agent: SyncAgent;
  path: string;
  action: SyncActionKind;
  reason?: string;
}

export interface SyncSkillsOptions {
  /** Specific skills to sync. When empty, every corpus skill is synced. */
  names?: string[];
  /** Explicit; the default when no names are given is already "all". */
  all?: boolean;
  /** Target agents. Defaults to SYNC_AGENTS. */
  agents?: SyncAgent[];
  /** Report intended actions without writing anything. */
  dryRun?: boolean;
  /** Adopt an unmanaged agent skill only when its directory already contains SKILL.md. */
  force?: boolean;
  /** Corpus root override. Tests only. */
  rootDir?: string;
  /**
   * Explicit canonical-corpus source: a directory of skill folders, or the monorepo
   * package root (which contains `skills/`). Takes precedence over
   * $SKILLS_SOURCE, which takes precedence over the installed corpus cache.
   * Agent-workflow skills are NOT part of the public repo corpus anymore — they
   * moved to the private per-station store (fleet-resources) and
   * reach sync through the installed cache — so a package root resolves to
   * `skills/` only.
   */
  sourceDir?: string;
  /** Home directory override for agent skill dirs. Tests only. */
  homeDir?: string;
}

export interface SyncSkillsResult {
  actions: AgentSyncAction[];
}

interface SyncSource {
  name: string;
  path: string;
  source: "source" | "corpus";
}

/**
 * Resolve where sync reads the canonical corpus from.
 *
 * The package ships no bundled corpus. Precedence is explicit-over-ambient:
 *   1. `options.sourceDir`   - an explicit source: a corpus dir, or a package root
 *                              containing `skills/`
 *   2. `$SKILLS_SOURCE`      - the ambient spelling of the same thing
 *   3. the installed cache   - `getPortableSkillsRoot()` (what `skills pull` writes),
 *      resolved through `resolveCorpusRoot` so a migrated owner layout
 *      (~/.hasna/skills/skills/) is read in preference to `installed/`. This cache is
 *      also where private agent-workflow skills arrive from the per-station store
 *      (fleet-resources) and get synced into agent folders.
 *
 * A missing explicit source is an error, not a fallback to "nothing": the whole point
 * of zero-corpus is that sync must not silently sync an empty corpus because the
 * package directory changed shape.
 */
export function resolveSyncCorpus(options: SyncSkillsOptions = {}): { roots: string[]; source: "source" | "corpus" } {
  const explicit = options.sourceDir?.trim() || process.env[SKILLS_SOURCE_ENV]?.trim() || "";
  if (explicit) {
    const roots = packageSourceRoots(explicit);
    if (roots.length === 0) {
      throw new Error(
        `SKILLS_SOURCE '${explicit}' contains no skills: expected a corpus directory or a package root with skills/`,
      );
    }
    return { roots, source: "source" };
  }
  return { roots: [resolveCorpusRoot({ rootDir: options.rootDir, homeDir: options.homeDir })], source: "corpus" };
}

/**
 * A source that names the monorepo package root (`skills/` below it) resolves to that
 * corpus root; a source that is itself a directory of skill folders resolves to itself.
 * Both spellings exist in the wild — the checkout is the canonical corpus, and a
 * CI-produced signed cache is a flat corpus dir — so both are accepted, and the dir is
 * returned only when it actually exists. `agent-skills/` is deliberately not a corpus
 * root: the fleet workflow skills moved to the private per-station store (owner ruling
 * 2026-08-15) and reach sync via the installed cache, not the repo.
 *
 * A directory that holds no skill folders is NOT a corpus: an explicit source that
 * resolves to nothing would make `skills sync` silently sync an empty set, which is the
 * exact failure zero-corpus exists to prevent. So an empty or file-shaped source
 * resolves to no roots and the caller errors.
 */
function packageSourceRoots(source: string): string[] {
  const roots: string[] = [];
  for (const sub of ["skills"]) {
    const candidate = join(source, sub);
    if (existsSync(candidate) && isDirectory(candidate)) roots.push(candidate);
  }
  if (roots.length > 0) return roots;
  return isDirectory(source) && containsSkillDirectories(source) ? [source] : [];
}

/** True when a directory holds at least one child that looks like a skill folder. */
function containsSkillDirectories(path: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return false;
  }
  return entries.some((entry) => {
    const candidate = join(path, entry);
    if (!isDirectory(candidate)) return false;
    return existsSync(join(candidate, "SKILL.md")) || existsSync(join(candidate, "skill.json")) || existsSync(join(candidate, "package.json"));
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function syncSkillsToAgents(options: SyncSkillsOptions = {}): SyncSkillsResult {
  assertNativeExportAllowed();
  const requested = normalizeRequested(options.names);
  const agents = options.agents?.length ? options.agents : [...SYNC_AGENTS];
  const homeDir = options.homeDir ?? homedir();
  const { roots, source } = resolveSyncCorpus(options);
  const corpus = listPortableSkillsAcrossRoots(roots);
  const byName = new Map(corpus.map((skill) => [skill.name, skill]));

  const actions: AgentSyncAction[] = [];

  let targets: SyncSource[] = corpus.map((skill) => ({
    name: skill.name,
    path: skill.path,
    source,
  }));
  if (requested) {
    const present: SyncSource[] = [];
    const missing: string[] = [];
    for (const name of requested) {
      const portable = byName.get(name);
      if (portable) {
        present.push({ name: portable.name, path: portable.path, source });
        continue;
      }
      missing.push(name);
    }
    for (const name of missing) {
      for (const agent of agents) {
        actions.push({
          skill: name,
          agent,
          path: join(agentGlobalSkillsDir(agent, homeDir), name, "SKILL.md"),
          action: "skip",
          reason: "not found in this machine's corpus",
        });
      }
    }
    targets = present;
  }

  for (const skill of targets) {
    const manifest = readPortableSkillManifest(skill.path, skill.name);
    // Absent `kind` is NOT a declaration of executability (task 568efaaa / P-01641):
    // coercing it to "executable" made corpus-mode sync distribute a pointer stub and
    // discard the full body. Only an explicit `kind: executable` may stub; an absent
    // kind is content, resolved inside sourceSkillMd.
    const kind = manifest.kind;
    const sourceMd = sourceSkillMd(
      skill.path,
      skill.name,
      manifest.description,
      kind,
      source === "source",
    );
    for (const agent of agents) {
      const adapted = adaptSkillMdForAgent(sourceMd, agent);
      actions.push(writeManagedAgentSkill({
        skill: skill.name,
        agent,
        skillMd: adapted,
        source,
        resourceDir: source === "source" ? skill.path : undefined,
        homeDir,
        dryRun: options.dryRun,
        force: options.force,
      }));
    }
  }

  return { actions };
}

export interface WriteManagedAgentSkillParams {
  skill: string;
  agent: SyncAgent;
  skillMd: string;
  source?: "source" | "corpus";
  resourceDir?: string;
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

/**
 * Write one skill into one agent's global folder, non-clobbering.
 *
 * A directory this tool has written before carries our exact ownership marker and is replaced with
 * an exact mirror — except that a managed home holding full content is never silently
 * replaced with an executable pointer stub (that would be data loss; it is refused
 * unless `force` is passed). A directory with a SKILL.md but no valid Skills marker is
 * skipped unless `force` explicitly adopts it. Any other pre-existing unmanaged
 * directory is always left untouched. A fresh directory is created.
 */
export function writeManagedAgentSkill(params: WriteManagedAgentSkillParams): AgentSyncAction {
  const homeDir = params.homeDir ?? homedir();
  const dir = join(agentGlobalSkillsDir(params.agent, homeDir), params.skill);
  const result = writeManagedSkillDir(dir, params.skillMd, {
    skill: params.skill,
    source: params.source,
    resourceDir: params.resourceDir,
    dryRun: params.dryRun,
    force: params.force,
  });
  return {
    skill: params.skill,
    agent: params.agent,
    path: result.path,
    action: result.action,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export interface ManagedDirWriteResult {
  action: SyncActionKind;
  path: string;
  reason?: string;
}

export interface ManagedDirWriteOptions {
  skill: string;
  source?: string;
  resourceDir?: string;
  dryRun?: boolean;
  force?: boolean;
  /** Test seam for exercising rollback after the original directory has moved. */
  renameDirectory?: typeof renameSync;
}

/**
 * The primitive both the fan-out sync and the single-skill installer share: replace one
 * owned skill directory with an exact staged mirror, non-clobbering, and stamp it as ours.
 * `dir` is the skill's own directory (…/skills/<name>), so callers control scope (global
 * vs project) by choosing the directory.
 */
export function writeManagedSkillDir(
  dir: string,
  skillMd: string,
  options: ManagedDirWriteOptions,
): ManagedDirWriteResult {
  const skillMdPath = join(dir, "SKILL.md");
  const markerPath = join(dir, SYNC_MARKER_FILE);
  const dirExists = existsSync(dir);
  const managed = hasSkillsOwnershipMarker(dir);
  const hasSkillMd = existsSync(skillMdPath);

  if (dirExists && !managed && !hasSkillMd) {
    return {
      action: "skip",
      path: skillMdPath,
      reason: "an unmanaged directory already exists here without SKILL.md; refusing to overwrite or adopt it",
    };
  }

  if (hasSkillMd && !managed && !options.force) {
    return {
      action: "skip",
      path: skillMdPath,
      reason: existsSync(markerPath)
        ? "an unmanaged SKILL.md already exists here (invalid or foreign ownership marker); pass --force to overwrite"
        : "an unmanaged SKILL.md already exists here (hand-authored); pass --force to overwrite",
    };
  }

  // Never silently replace content with a pointer stub (bug 60f2ab27): a managed home may
  // hold full adopted content while the corpus entry declares `kind: executable` and
  // renders as a pointer. Replacing it was silent data loss — rc=0, no warning — and the
  // drift census then validated the stub state, so the loss was invisible. Refuse unless
  // --force explicitly requests the replacement. (An absent kind no longer renders as a
  // pointer at all — task 568efaaa — so only a real declaration reaches this branch.)
  if (dirExists && managed && hasSkillMd && !options.force && isPointerSkillMd(skillMd)) {
    let existingIsStub = false;
    try {
      existingIsStub = isPointerSkillMd(readFileSync(skillMdPath, "utf-8"));
    } catch {
      existingIsStub = false; // unreadable content is treated as content; never replace it
    }
    if (!existingIsStub) {
      return {
        action: "skip",
        path: skillMdPath,
        reason: "refusing to replace a content-bearing managed home with an executable pointer stub (the corpus entry lacks kind: instruction); pass --force to overwrite",
      };
    }
  }

  const action: SyncActionKind = dirExists ? "update" : "create";
  if (options.dryRun) return { action, path: skillMdPath };

  const parentDir = dirname(dir);
  mkdirSync(parentDir, { recursive: true });
  const transactionDir = mkdtempSync(join(parentDir, `.hasna-skills-write-${basename(dir)}-`));
  const candidateDir = join(transactionDir, "candidate");
  const backupDir = join(transactionDir, "backup");
  const candidateSkillMdPath = join(candidateDir, "SKILL.md");
  const candidateMarkerPath = join(candidateDir, SYNC_MARKER_FILE);
  const marker: SyncMarker = {
    managedBy: SYNC_MARKER_MANAGED_BY,
    skill: options.skill,
    source: options.source ?? "corpus",
    syncedAt: new Date().toISOString(),
  };

  const renameDirectory = options.renameDirectory ?? renameSync;
  let originalMoved = false;
  let preserveTransaction = false;
  try {
    if (options.resourceDir) {
      cpSync(options.resourceDir, candidateDir, { recursive: true, force: true });
    } else {
      mkdirSync(candidateDir, { recursive: true });
    }
    writeFileSync(candidateSkillMdPath, skillMd.endsWith("\n") ? skillMd : `${skillMd}\n`);
    writeFileSync(candidateMarkerPath, `${JSON.stringify(marker, null, 2)}\n`);

    if (dirExists) {
      originalMoved = true;
      renameDirectory(dir, backupDir);
    }
    renameDirectory(candidateDir, dir);
  } catch (error) {
    if (originalMoved && existsSync(backupDir)) {
      try {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
        renameDirectory(backupDir, dir);
        originalMoved = false;
      } catch (rollbackError) {
        preserveTransaction = true;
        throw new AggregateError(
          [error, rollbackError],
          `failed to replace ${dir}; the original directory remains at ${backupDir}`,
        );
      }
    }
    throw error;
  } finally {
    if (!preserveTransaction) {
      try {
        rmSync(transactionDir, { recursive: true, force: true });
      } catch {
        // The target is already correct (or restored); a hidden staging directory
        // left behind is safer than turning cleanup into a failed sync.
      }
    }
  }
  return { action, path: skillMdPath };
}

/**
 * Remove a skill this tool synced from an agent folder. Refuses to delete a directory it
 * did not write (no valid Skills ownership marker). Foreign or malformed markers
 * grant no deletion authority, and removal has no force override.
 */
export function removeManagedAgentSkill(skill: string, agent: SyncAgent, homeDir: string = homedir()): boolean {
  const dir = join(agentGlobalSkillsDir(agent, homeDir), skill);
  if (!hasSkillsOwnershipMarker(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

function sourceSkillMd(
  skillPath: string,
  name: string,
  description: string,
  kind: SkillKind | undefined,
  preferBundledDocs = false,
): string {
  // Absent kind is content, never a pointer (task 568efaaa / P-01641): the corpus is
  // 691 of 700 skills kind-less, and coercing them to "executable" laundered two of
  // them into 15-line pointer stubs. Only an explicit `kind: executable` declaration
  // is stubbed; an instruction skill, a kind-less skill, and every source-mode skill
  // carry their full document.
  if (kind === undefined || kind === "instruction" || preferBundledDocs) {
    const skillMdPath = join(skillPath, "SKILL.md");
    if (existsSync(skillMdPath)) return readFileSync(skillMdPath, "utf-8");
  }
  // Declared executable skills (and instruction skills missing their SKILL.md) get a
  // pointer: the runnable bytes are not copied into an agent folder, only a description
  // of the skill and how to run it.
  return pointerSkillMd(name, description);
}

/**
 * List the corpus as the union of one or more skill-directory roots, deduplicated by
 * name. When the same name exists in several roots, the FIRST root wins: explicit roots
 * in the order given. (The old `agent-skills/` workflow root is gone — those skills are
 * private and arrive through the installed cache, so there is no repo root to shadow.)
 */
function listPortableSkillsAcrossRoots(roots: string[]): ReturnType<typeof listPortableSkills> {
  const seen = new Set<string>();
  const skills: ReturnType<typeof listPortableSkills> = [];
  for (const root of roots) {
    for (const skill of listPortableSkills({ rootDir: root })) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      skills.push(skill);
    }
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function normalizeRequested(names: string[] | undefined): string[] | null {
  if (!names || !names.length) return null;
  const normalized = names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => normalizePortableSkillName(name));
  return [...new Set(normalized)];
}
