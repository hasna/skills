/**
 * Home drift census — `skills sync --check`.
 *
 * Compares each configured agent home against the canonical corpus cache and
 * reports three drift classes:
 *
 *   missing-from-home  canonical corpus skill absent from a home that exists
 *   stray-in-home      marked home dir with no canonical corpus entry
 *   diverged           marked home dir whose SKILL.md hash differs from canonical
 *
 * Unmarked home dirs are counted, never reported as drift: they are adoption
 * candidates, not managed state. A home that does not exist is not checked.
 * `clean` is false whenever any drift entry exists; the CLI maps that to a
 * non-zero exit code.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  SYNC_AGENTS,
  SYNC_MARKER_FILE,
  agentGlobalSkillsDir,
  isPointerSkillMd,
  type SyncAgent,
} from "./agent-sync.js";
import { indexCanonicalCorpus, type AdoptionOptions } from "./home-adoption.js";
import { resolveCorpusRoot } from "./home-migration.js";
import { hashSkillMarkdownFile } from "./skill-hash.js";
import { normalizePortableSkillName } from "./portable-skills.js";

export type DriftKind = "missing-from-home" | "stray-in-home" | "diverged";

export interface DriftEntry {
  agent: SyncAgent;
  skill: string;
  kind: DriftKind;
  path: string;
  homeHash?: string;
  canonicalHash?: string;
  /** True when the home's SKILL.md is a sync pointer stub rather than real content. */
  homeStub?: boolean;
  /** True when the canonical corpus entry renders as a pointer stub (executable skill). */
  canonicalStub?: boolean;
}

export interface DriftCensus {
  entries: DriftEntry[];
  /** Homes that exist and were checked. */
  homesChecked: number;
  /** Unmarked home skill dirs (adoption candidates, not drift). */
  unmarked: number;
  /** Marked home skill dirs. */
  managed: number;
  clean: boolean;
}

function sortEntries(entries: DriftEntry[]): DriftEntry[] {
  return entries.sort((a, b) => {
    const left = `${a.agent}/${a.skill}/${a.kind}`;
    const right = `${b.agent}/${b.skill}/${b.kind}`;
    return left.localeCompare(right);
  });
}

export function censusHomeDrift(options: AdoptionOptions & { names?: string[] } = {}): DriftCensus {
  const homeDir = options.homeDir ?? homedir();
  const corpusRoot = resolveCorpusRoot(options);
  const index = indexCanonicalCorpus(corpusRoot);
  const agents = options.agents?.length ? options.agents : [...SYNC_AGENTS];
  const requested = options.names?.length
    ? new Set(options.names.map(name => name.trim()).filter(Boolean).map(normalizePortableSkillName)) : undefined;
  if (requested) {
    // An unknown explicit selection must not silently report a clean census,
    // including when the selected agent home does not exist yet.
    for (const name of requested) {
      if (!index.has(name)) throw new Error(`Skill '${name}' not found in this machine's corpus`);
    }
  }

  const entries: DriftEntry[] = [];
  let unmarked = 0;
  let managed = 0;
  let homesChecked = 0;

  for (const agent of agents) {
    const home = agentGlobalSkillsDir(agent, homeDir);
    if (!existsSync(home)) continue;
    homesChecked += 1;

    const present = new Set<string>();
    let dirEntries: string[] = [];
    try {
      dirEntries = readdirSync(home);
    } catch {
      continue;
    }
    for (const skill of dirEntries.sort()) {
      if (skill.startsWith(".")) continue;
      if (requested && !requested.has(skill)) continue;
      const dir = join(home, skill);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      present.add(skill);

      const markerPath = join(dir, SYNC_MARKER_FILE);
      if (!existsSync(markerPath)) {
        unmarked += 1;
        continue;
      }
      managed += 1;

      const canonicalHash = index.get(skill);
      if (canonicalHash === undefined) {
        entries.push({ agent, skill, kind: "stray-in-home", path: dir });
        continue;
      }
      const skillMdPath = join(dir, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        entries.push({ agent, skill, kind: "diverged", path: dir, canonicalHash });
        continue;
      }
      const homeHash = hashSkillMarkdownFile(skillMdPath);
      if (homeHash !== canonicalHash) {
        // Label which side is a pointer stub so content-vs-stub divergence is readable
        // (bug 60f2ab27): a stub home under a content canonical is a content-loss
        // signature; a content home under a stub canonical is an adopted-content home
        // that the next sync refuses to replace.
        let homeStub: boolean | undefined;
        try {
          homeStub = isPointerSkillMd(readFileSync(skillMdPath, "utf-8"));
        } catch {
          homeStub = undefined;
        }
        let canonicalStub: boolean | undefined;
        const canonicalSkillMd = join(corpusRoot, skill, "SKILL.md");
        try {
          canonicalStub = isPointerSkillMd(readFileSync(canonicalSkillMd, "utf-8"));
        } catch {
          canonicalStub = undefined;
        }
        entries.push({ agent, skill, kind: "diverged", path: dir, homeHash, canonicalHash, homeStub, canonicalStub });
      }
    }

    for (const [name, canonicalHash] of index) {
      if (requested && !requested.has(name)) continue;
      if (!present.has(name)) {
        entries.push({
          agent,
          skill: name,
          kind: "missing-from-home",
          path: join(home, name),
          canonicalHash,
        });
      }
    }
  }

  return {
    entries: sortEntries(entries),
    homesChecked,
    unmarked,
    managed,
    clean: entries.length === 0,
  };
}
