/**
 * `skills sync` — the last mile: write skills from this machine's corpus
 * (~/.hasna/skills/installed/<name>/) into each coding agent's global skills directory,
 * per-tool adapted, so an agent auto-loads them.
 *
 * This is the deliberate reversal of the old "pins, not installs" stub: agent skill
 * folders used to be left entirely unmanaged and every write path returned success:false.
 * They are now written — but only the ones this tool owns. A hand-authored skill the user
 * wrote themselves is never clobbered: ownership is tracked with a marker file, and a
 * directory without that marker is treated as the user's and skipped.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { listPortableSkills, normalizePortableSkillName, readPortableSkillManifest } from "./portable-skills.js";
import type { SkillKind } from "./registry-types.js";

/**
 * The coding agents `skills sync` targets by default. Claude Code, Codex, OpenCode, and
 * Cursor — the four that load a `<dir>/<name>/SKILL.md`. (Gemini is retired; Windsurf/pi
 * are addressable through installSkillForAgent but are not in the default fan-out.)
 */
export type SyncAgent = "claude" | "codex" | "opencode" | "cursor";
export const SYNC_AGENTS: readonly SyncAgent[] = ["claude", "codex", "opencode", "cursor"] as const;

/**
 * Ownership marker written beside every SKILL.md this tool syncs. Its presence is how a
 * re-sync tells "a skill I wrote, safe to update" from "a skill the user hand-authored,
 * do not touch". A hidden sidecar rather than a frontmatter field so the SKILL.md the
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
  /** Overwrite even a hand-authored (unmanaged) agent skill. Off by default. */
  force?: boolean;
  /** Corpus root override. Tests only. */
  rootDir?: string;
  /** Home directory override for agent skill dirs. Tests only. */
  homeDir?: string;
}

export interface SyncSkillsResult {
  actions: AgentSyncAction[];
}

export function syncSkillsToAgents(options: SyncSkillsOptions = {}): SyncSkillsResult {
  const agents = options.agents?.length ? options.agents : [...SYNC_AGENTS];
  const homeDir = options.homeDir ?? homedir();
  const corpusOptions = corpusLocation(options);
  const corpus = listPortableSkills(corpusOptions);
  const byName = new Map(corpus.map((skill) => [skill.name, skill]));

  const actions: AgentSyncAction[] = [];
  const requested = normalizeRequested(options.names);

  let targets = corpus;
  if (requested) {
    const present: string[] = [];
    const missing: string[] = [];
    for (const name of requested) (byName.has(name) ? present : missing).push(name);
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
    targets = present.map((name) => byName.get(name)!).filter(Boolean);
  }

  for (const skill of targets) {
    const manifest = readPortableSkillManifest(skill.path, skill.name);
    const kind: SkillKind = manifest.kind ?? "executable";
    const source = sourceSkillMd(skill.path, skill.name, manifest.description, kind);
    for (const agent of agents) {
      const adapted = adaptSkillMdForAgent(source, agent);
      actions.push(writeManagedAgentSkill({
        skill: skill.name,
        agent,
        skillMd: adapted,
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
  homeDir?: string;
  dryRun?: boolean;
  force?: boolean;
}

/**
 * Write one skill into one agent's global folder, non-clobbering.
 *
 * A directory this tool has written before carries the marker file and is updated in
 * place. A directory with a SKILL.md but no marker is the user's own skill and is skipped
 * unless `force` is set. A fresh directory is created.
 */
export function writeManagedAgentSkill(params: WriteManagedAgentSkillParams): AgentSyncAction {
  const homeDir = params.homeDir ?? homedir();
  const dir = join(agentGlobalSkillsDir(params.agent, homeDir), params.skill);
  const result = writeManagedSkillDir(dir, params.skillMd, {
    skill: params.skill,
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

/**
 * The primitive both the fan-out sync and the single-skill installer share: write one
 * SKILL.md into one skill directory, non-clobbering, and stamp it as ours. `dir` is the
 * skill's own directory (…/skills/<name>), so callers control scope (global vs project)
 * by choosing the directory.
 */
export function writeManagedSkillDir(
  dir: string,
  skillMd: string,
  options: { skill: string; source?: string; dryRun?: boolean; force?: boolean },
): ManagedDirWriteResult {
  const skillMdPath = join(dir, "SKILL.md");
  const markerPath = join(dir, SYNC_MARKER_FILE);
  const managed = existsSync(markerPath);
  const hasSkillMd = existsSync(skillMdPath);

  if (hasSkillMd && !managed && !options.force) {
    return {
      action: "skip",
      path: skillMdPath,
      reason: "an unmanaged SKILL.md already exists here (hand-authored); pass --force to overwrite",
    };
  }

  const action: SyncActionKind = hasSkillMd ? "update" : "create";
  if (options.dryRun) return { action, path: skillMdPath };

  mkdirSync(dir, { recursive: true });
  writeFileSync(skillMdPath, skillMd.endsWith("\n") ? skillMd : `${skillMd}\n`);
  const marker: SyncMarker = {
    managedBy: SYNC_MARKER_MANAGED_BY,
    skill: options.skill,
    source: options.source ?? "corpus",
    syncedAt: new Date().toISOString(),
  };
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  return { action, path: skillMdPath };
}

/**
 * Remove a skill this tool synced from an agent folder. Refuses to delete a directory it
 * did not write (no marker), so it can never remove a user's hand-authored skill.
 */
export function removeManagedAgentSkill(skill: string, agent: SyncAgent, homeDir: string = homedir()): boolean {
  const dir = join(agentGlobalSkillsDir(agent, homeDir), skill);
  if (!existsSync(join(dir, SYNC_MARKER_FILE))) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

function sourceSkillMd(skillPath: string, name: string, description: string, kind: SkillKind): string {
  if (kind === "instruction") {
    const skillMdPath = join(skillPath, "SKILL.md");
    if (existsSync(skillMdPath)) return readFileSync(skillMdPath, "utf-8");
  }
  // Executable skills (and instruction skills missing their SKILL.md) get a pointer: the
  // runnable bytes are not copied into an agent folder, only a description of the skill
  // and how to run it.
  return pointerSkillMd(name, description);
}

function corpusLocation(options: SyncSkillsOptions): { rootDir?: string; homeDir?: string } {
  const out: { rootDir?: string; homeDir?: string } = {};
  if (options.rootDir) out.rootDir = options.rootDir;
  else if (options.homeDir) out.homeDir = options.homeDir;
  return out;
}

function normalizeRequested(names: string[] | undefined): string[] | null {
  if (!names || !names.length) return null;
  const normalized = names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      try {
        return normalizePortableSkillName(name);
      } catch {
        return name;
      }
    });
  return [...new Set(normalized)];
}
