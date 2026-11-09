import { join } from "node:path";

/**
 * The one native skill copy Skills supports beside its owned skills-cli bridge:
 * the Cua Driver GUI-automation skill the Cua app installs into an agent's
 * user skills folder. The owner decided to keep that copy and accept it
 * explicitly instead of retiring it, without relaxing the general
 * unmanaged-copy or symlink refusals.
 *
 * The Cua app installs the same reviewed tree at two native roots:
 *   - `~/.claude/skills/cua-driver`, a real link-free directory tree;
 *   - `~/.agents/skills/cua-driver`, which the app may materialize as a
 *     one-hop symlink to its own target at `~/.cua-driver/skills/cua-driver`.
 * Both roots are native discovery, so both are covered by the same reviewed
 * identity. The link form is accepted only for that exact pair: the lexical
 * target must be the canonical Cua source, the target must be a real link-free
 * tree, and its content digest must equal the digest pinned in the policy.
 * Every other symlink keeps refusing.
 *
 * Identity is deliberately not a path allowlist. A copy is accepted only when
 * all of these hold:
 *   - it is one of the exact canonical Cua driver roots below;
 *   - it is either a real directory tree with no link anywhere in it, or (at
 *     the `.agents` root) a one-hop symlink to the canonical Cua target;
 *   - its bytes (and POSIX types/modes, for a real tree) are identical to the
 *     Cua app's own install target at review time;
 *   - its SKILL.md declares the Cua driver name;
 *   - the bytes equal the content digest reviewed and pinned in the policy.
 * The first plan that observes the exact pair is the review: it records the
 * digest in the plan/policy rather than skipping the copy silently. The digest
 * then binds the ongoing identity; the Cua source comparison is review-time
 * provenance, not a per-hook re-check, and POSIX modes are not part of the
 * digest. A Cua update that changes the bytes is visible drift until an
 * operator explicitly re-reviews it; it is never adopted silently.
 */
export const CUA_DRIVER_NATIVE_ALLOWANCE = Object.freeze({
  id: "cua-driver" as const,
  /** Primary reviewed identity (the link-free Claude user-skill directory). */
  agent: "claude" as const,
  name: "cua-driver",
  relativePath: [".claude", "skills", "cua-driver"] as const,
  /** The Codex native root the same reviewed tree may be linked into. */
  relativeAgentsPath: [".agents", "skills", "cua-driver"] as const,
  relativeSource: [".cua-driver", "skills", "cua-driver"] as const,
});

/** One reviewed, explicitly recorded native skill allowance. */
export interface NativeSkillAllowance {
  /** Reviewed allowance identity. Only the shipped Cua driver identity is understood. */
  id: "cua-driver";
  /** Which native root carries the reviewed copy. */
  agent: "claude" | "codex";
  name: "cua-driver";
  /** Canonical native skill directory. */
  path: string;
  /** Pinned content identity of the allowed copy (tree hash). */
  treeSha256: string;
  /** Canonical Cua app install target the reviewed copy equals. */
  source: string;
  /** The Cua source tree hash recorded at review; must equal treeSha256. */
  sourceTreeSha256: string;
}

const ALLOWANCE_KEYS = ["agent", "id", "name", "path", "source", "sourceTreeSha256", "treeSha256"] as const;
const MAX_ALLOWANCES = 8;
const SHA256 = /^[0-9a-f]{64}$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** The canonical directories for this home: the Claude-side copy, the Codex
 * `.agents` root and the Cua app install target they must equal. `path` and
 * `source` keep their original Claude meaning for existing callers. */
export function cuaDriverNativePaths(context: { home: string; canonical: (path: string) => string }): { path: string; agents: string; source: string } {
  return {
    path: context.canonical(join(context.home, ...CUA_DRIVER_NATIVE_ALLOWANCE.relativePath)),
    agents: context.canonical(join(context.home, ...CUA_DRIVER_NATIVE_ALLOWANCE.relativeAgentsPath)),
    source: context.canonical(join(context.home, ...CUA_DRIVER_NATIVE_ALLOWANCE.relativeSource)),
  };
}

/** Every native root the one reviewed Cua driver identity may appear at. */
export function cuaDriverNativeTargets(context: { home: string; canonical: (path: string) => string }): Array<{ agent: "claude" | "codex"; path: string; source: string }> {
  const { path, agents, source } = cuaDriverNativePaths(context);
  return [{ agent: "claude", path, source }, { agent: "codex", path: agents, source }];
}

/** A reviewable allowance row for the exact Cua driver tree that was observed. */
export function buildCuaDriverNativeAllowance(context: { home: string; canonical: (path: string) => string }, treeSha256: string, agent: "claude" | "codex" = "claude"): NativeSkillAllowance {
  const target = cuaDriverNativeTargets(context).find(item => item.agent === agent);
  if (!target) throw new Error(`Unsupported Cua driver allowance agent: ${agent}`);
  return { id: CUA_DRIVER_NATIVE_ALLOWANCE.id, agent: target.agent, name: CUA_DRIVER_NATIVE_ALLOWANCE.name, path: target.path, treeSha256, source: target.source, sourceTreeSha256: treeSha256 };
}

/** A Cua driver document carries the shipped frontmatter name. The vendor
 * marker is checked in addition to, never instead of, the content identity. */
export function isCuaDriverSkillDocument(text: string): boolean {
  const match = FRONTMATTER.exec(text);
  if (!match) return false;
  try {
    const front = Bun.YAML.parse(match[1]!) as { name?: unknown } | null;
    return Boolean(front) && front!.name === CUA_DRIVER_NATIVE_ALLOWANCE.name;
  } catch { return false; }
}

/**
 * Normalize only the exact reviewed Cua driver identities for this home. A
 * policy row that names any other agent, path, source or digest shape is
 * ignored, so a hand-edited or extended policy cannot turn the allowance into a
 * path list. Rows are bounded and deduplicated by canonical agent+path.
 */
export function normalizeNativeSkillAllowances(value: unknown, context: { home: string; canonical: (path: string) => string }): NativeSkillAllowance[] {
  if (!Array.isArray(value)) return [];
  const targets = cuaDriverNativeTargets(context);
  const keys = [...ALLOWANCE_KEYS].sort().join(","), byPath = new Map<string, NativeSkillAllowance>();
  for (const row of value.slice(0, MAX_ALLOWANCES)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== keys) continue;
    if (item.id !== CUA_DRIVER_NATIVE_ALLOWANCE.id || item.name !== CUA_DRIVER_NATIVE_ALLOWANCE.name) continue;
    if (typeof item.agent !== "string") continue;
    const target = targets.find(candidate => candidate.agent === item.agent && candidate.path === item.path && candidate.source === item.source);
    if (!target) continue;
    if (typeof item.treeSha256 !== "string" || !SHA256.test(item.treeSha256)) continue;
    if (item.sourceTreeSha256 !== item.treeSha256) continue;
    const key = `${target.agent}\0${target.path}`;
    const existing = byPath.get(key);
    // An exact repeated row (for example the policy row also supplied by the
    // installing plan) is the same review, so it is harmless and deduplicated.
    // Two different digests for the canonical path are ambiguous and grant
    // nothing rather than choosing one.
    if (existing) { if (existing.treeSha256 !== item.treeSha256) return []; continue; }
    byPath.set(key, { id: CUA_DRIVER_NATIVE_ALLOWANCE.id, agent: target.agent, name: CUA_DRIVER_NATIVE_ALLOWANCE.name, path: target.path, treeSha256: item.treeSha256, source: target.source, sourceTreeSha256: item.treeSha256 });
  }
  return [...byPath.values()];
}

/** The reviewed allowance an inventoried copy matches exactly, or undefined. */
export function matchingNativeSkillAllowance(
  entry: { agent: string; path: string; hash: string; managed: boolean; vendor: boolean; bridge?: boolean },
  allowances: readonly NativeSkillAllowance[],
): NativeSkillAllowance | undefined {
  if (entry.bridge || entry.vendor || entry.managed) return undefined;
  return allowances.find(allowance => allowance.agent === entry.agent && allowance.path === entry.path && allowance.treeSha256 === entry.hash);
}
