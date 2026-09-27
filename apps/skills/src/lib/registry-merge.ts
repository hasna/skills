/**
 * Merging the several registries a `skills` install can see into one list.
 *
 * Before this, `--remote` REPLACED the local registry: `skills list --remote` showed the
 * instance's skills and nothing else, so the bundled corpus and anything the operator had
 * written locally vanished from the listing the moment they pointed the CLI at their own
 * server. Since the whole point of publishing is that a machine sees bundled, local, and
 * published skills together, the lists are merged and collisions are resolved by an
 * explicit rule rather than by which list happened to be concatenated last.
 *
 * PRECEDENCE, most local wins:
 *
 *     custom  >  extension  >  private  >  private-hosted  >  remote  >  upstream  >  official
 *
 * The rule is "whichever copy this machine would actually use, wins the listing". A skill
 * present in ~/.hasna/skills/installed is the one `skills run` executes, so a listing that
 * described the server's copy instead would be describing something that is not going to
 * run. `remote` beats `official` for the mirror-image reason: an organization that
 * published a skill under a bundled name did so to override the bundled one on their
 * instance, and silently preferring the bundled copy would make publishing an override
 * impossible.
 *
 * Ties inside one source are resolved last-wins, so a caller can order its own inputs.
 */
import type { SkillMeta, SkillSource } from "./registry-types.js";

/** Higher wins. Every SkillSource has an entry; adding a source without one is a type error. */
export const SKILL_SOURCE_PRECEDENCE: Record<SkillSource, number> = {
  official: 0,
  upstream: 1,
  remote: 2,
  "private-hosted": 3,
  private: 4,
  extension: 5,
  custom: 6,
};

/**
 * An entry with no `source` at all is treated as `official`.
 *
 * Deliberately the *lowest* rank rather than the highest. Untagged entries come from
 * older payloads and hand-built fixtures, and an unknown provenance losing a collision
 * fails towards the bundled corpus - the copy that is known to exist - instead of letting
 * an unlabelled remote entry silently displace a local skill.
 */
export function skillSourceRank(skill: Pick<SkillMeta, "source">): number {
  const source = skill.source;
  if (!source) return SKILL_SOURCE_PRECEDENCE.official;
  return SKILL_SOURCE_PRECEDENCE[source] ?? SKILL_SOURCE_PRECEDENCE.official;
}

export interface MergedSkillCollision {
  name: string;
  /** The source that won. */
  winner: SkillSource;
  /** Every source that lost, in the order they were supplied. */
  shadowed: SkillSource[];
}

export interface MergeSkillRegistriesResult {
  skills: SkillMeta[];
  collisions: MergedSkillCollision[];
}

/**
 * Merge registries by name, keeping the highest-precedence entry for each.
 *
 * Groups are supplied in whatever order the caller likes: the result does not depend on
 * it except for ties within a single source, which resolve last-wins. Output is sorted by
 * name so two callers merging the same inputs print the same list.
 */
export function mergeSkillRegistries(...groups: Array<SkillMeta[] | undefined | null>): MergeSkillRegistriesResult {
  const winners = new Map<string, SkillMeta>();
  const losers = new Map<string, SkillSource[]>();

  for (const group of groups) {
    for (const skill of group ?? []) {
      const current = winners.get(skill.name);
      if (!current) {
        winners.set(skill.name, skill);
        continue;
      }
      const incomingRank = skillSourceRank(skill);
      const currentRank = skillSourceRank(current);
      // >= so that a tie inside one source resolves last-wins.
      const incomingWins = incomingRank >= currentRank;
      const shadowed = losers.get(skill.name) ?? [];
      shadowed.push((incomingWins ? current.source : skill.source) ?? "official");
      losers.set(skill.name, shadowed);
      if (incomingWins) winners.set(skill.name, skill);
    }
  }

  // Codepoint order, not localeCompare: ICU treats hyphens as ignorable at primary
  // strength and varies with the runtime locale, so `localeCompare` would make "two
  // callers merging the same inputs print the same list" false across machines. Same
  // reasoning as collectSkillBundleEntries().
  const skills = Array.from(winners.values()).sort((a, b) => compareCodepoints(a.name, b.name));
  const collisions: MergedSkillCollision[] = Array.from(losers.entries())
    .map(([name, shadowed]) => ({ name, winner: winners.get(name)!.source ?? "official", shadowed }))
    .sort((a, b) => compareCodepoints(a.name, b.name));
  return { skills, collisions };
}

function compareCodepoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The merged list on its own, for callers that do not care which entries collided. */
export function mergeSkillRegistryLists(...groups: Array<SkillMeta[] | undefined | null>): SkillMeta[] {
  return mergeSkillRegistries(...groups).skills;
}
