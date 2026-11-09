import { join } from "node:path";

/**
 * The one native skill copy Skills supports beside its owned skills-cli bridge:
 * the Cua Driver GUI-automation skill the Cua app installs into Claude's user
 * skills folder. The owner decided to keep that copy and accept it explicitly
 * instead of retiring it, without relaxing the general unmanaged-copy or
 * symlink refusals.
 *
 * Identity is deliberately not a path allowlist. A copy is accepted only when
 * all of these hold:
 *   - it is the exact canonical Claude user skill directory below;
 *   - it is a real directory tree with no link anywhere in it;
 *   - its bytes are identical to the Cua app's own install target;
 *   - its SKILL.md declares the Cua driver name;
 *   - the bytes equal the content digest reviewed and pinned in the policy.
 * The content digest is recorded on first review and pinned afterwards. A Cua
 * update that changes the bytes is visible drift until an operator explicitly
 * re-reviews it; it is never adopted silently.
 */
export const CUA_DRIVER_NATIVE_ALLOWANCE = Object.freeze({
  id: "cua-driver" as const,
  agent: "claude" as const,
  name: "cua-driver",
  relativePath: [".claude", "skills", "cua-driver"] as const,
  relativeSource: [".cua-driver", "skills", "cua-driver"] as const,
});

/** One reviewed, explicitly recorded native skill allowance. */
export interface NativeSkillAllowance {
  /** Reviewed allowance identity. Only the shipped Cua driver identity is understood. */
  id: "cua-driver";
  agent: "claude";
  name: "cua-driver";
  /** Canonical Claude-side skill directory. */
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

/** The two canonical directories for this home: the Claude-side copy and the
 * Cua app install target it must equal. */
export function cuaDriverNativePaths(context: { home: string; canonical: (path: string) => string }): { path: string; source: string } {
  return {
    path: context.canonical(join(context.home, ...CUA_DRIVER_NATIVE_ALLOWANCE.relativePath)),
    source: context.canonical(join(context.home, ...CUA_DRIVER_NATIVE_ALLOWANCE.relativeSource)),
  };
}

/** A reviewable allowance row for the exact Cua driver tree that was observed. */
export function buildCuaDriverNativeAllowance(context: { home: string; canonical: (path: string) => string }, treeSha256: string): NativeSkillAllowance {
  const { path, source } = cuaDriverNativePaths(context);
  return { id: CUA_DRIVER_NATIVE_ALLOWANCE.id, agent: CUA_DRIVER_NATIVE_ALLOWANCE.agent, name: CUA_DRIVER_NATIVE_ALLOWANCE.name, path, treeSha256, source, sourceTreeSha256: treeSha256 };
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
 * Normalize only the exact reviewed Cua driver identity for this home. A policy
 * row that names any other agent, path, source or digest shape is ignored, so a
 * hand-edited or extended policy cannot turn the allowance into a path list.
 * Rows are bounded and deduplicated by canonical path.
 */
export function normalizeNativeSkillAllowances(value: unknown, context: { home: string; canonical: (path: string) => string }): NativeSkillAllowance[] {
  if (!Array.isArray(value)) return [];
  const { path, source } = cuaDriverNativePaths(context);
  const keys = [...ALLOWANCE_KEYS].sort().join(","), paths = new Set<string>(), normalized: NativeSkillAllowance[] = [];
  for (const row of value.slice(0, MAX_ALLOWANCES)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== keys) continue;
    if (item.id !== CUA_DRIVER_NATIVE_ALLOWANCE.id || item.agent !== CUA_DRIVER_NATIVE_ALLOWANCE.agent || item.name !== CUA_DRIVER_NATIVE_ALLOWANCE.name) continue;
    if (item.path !== path || item.source !== source) continue;
    if (typeof item.treeSha256 !== "string" || !SHA256.test(item.treeSha256)) continue;
    if (item.sourceTreeSha256 !== item.treeSha256) continue;
    // Exactly one reviewed identity exists. A second row for the canonical
    // path is ambiguous, so it grants nothing rather than choosing a digest.
    if (paths.has(path)) return [];
    paths.add(path);
    normalized.push({ id: CUA_DRIVER_NATIVE_ALLOWANCE.id, agent: CUA_DRIVER_NATIVE_ALLOWANCE.agent, name: CUA_DRIVER_NATIVE_ALLOWANCE.name, path, treeSha256: item.treeSha256, source, sourceTreeSha256: item.treeSha256 });
  }
  return normalized;
}

/** The reviewed allowance an inventoried copy matches exactly, or undefined. */
export function matchingNativeSkillAllowance(
  entry: { agent: string; path: string; hash: string; managed: boolean; vendor: boolean; bridge?: boolean },
  allowances: readonly NativeSkillAllowance[],
): NativeSkillAllowance | undefined {
  if (entry.bridge || entry.vendor || entry.managed) return undefined;
  return allowances.find(allowance => allowance.agent === entry.agent && allowance.path === entry.path && allowance.treeSha256 === entry.hash);
}
