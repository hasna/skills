/**
 * Collision cases for the bundled + custom + remote merge.
 *
 * One test per collision rather than one test asserting a final list: a single "the merge
 * works" test passes just as happily when two of the three inputs are silently dropped, so
 * each pairing is named and asserted in both directions (input order must not matter).
 */
import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
import { SKILL_SOURCE_PRECEDENCE, mergeSkillRegistries, mergeSkillRegistryLists, skillSourceRank } from "./registry-merge.js";
import type { SkillMeta, SkillSource } from "./registry-types.js";

function skill(name: string, source: SkillSource | undefined, description = source ?? "untagged"): SkillMeta {
  return {
    name,
    displayName: name,
    description,
    category: "Development Tools",
    tags: [],
    ...(source ? { source } : {}),
  };
}

/** The winning entry's description names its source, so the winner is identifiable. */
function descriptionOf(skills: SkillMeta[], name: string): string | undefined {
  return skills.find((entry) => entry.name === name)?.description;
}

describe("skill source precedence", () => {
  test("the documented order holds, most local first", () => {
    const ordered: SkillSource[] = ["official", "upstream", "remote", "private-hosted", "private", "extension", "custom"];
    const ranks = ordered.map((source) => SKILL_SOURCE_PRECEDENCE[source]);
    // Strictly increasing: two sources sharing a rank would make their collision resolve
    // by input order, which is exactly the non-rule this table replaces.
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ordered.length);
  });

  test("every SkillSource has a rank", () => {
    // Guards against a source being added to the union without a precedence, which would
    // silently fall through to the official rank.
    const sources: SkillSource[] = ["official", "custom", "remote", "private", "private-hosted", "upstream", "extension"];
    for (const source of sources) expect(typeof SKILL_SOURCE_PRECEDENCE[source]).toBe("number");
    expect(Object.keys(SKILL_SOURCE_PRECEDENCE).sort()).toEqual([...sources].sort());
  });

  test("an untagged entry ranks as official, the lowest", () => {
    expect(skillSourceRank(skill("x", undefined))).toBe(SKILL_SOURCE_PRECEDENCE.official);
    expect(skillSourceRank({ source: "totally-unknown" as SkillSource })).toBe(SKILL_SOURCE_PRECEDENCE.official);
  });
});

describe("mergeSkillRegistries collisions", () => {
  test("official vs custom: custom wins, in either input order", () => {
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", "official")], [skill("a", "custom")]), "a")).toBe("custom");
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", "custom")], [skill("a", "official")]), "a")).toBe("custom");
  });

  test("official vs remote: remote wins, in either input order", () => {
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", "official")], [skill("a", "remote")]), "a")).toBe("remote");
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", "remote")], [skill("a", "official")]), "a")).toBe("remote");
  });

  test("custom vs remote: custom wins, in either input order", () => {
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", "remote")], [skill("a", "custom")]), "a")).toBe("custom");
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", "custom")], [skill("a", "remote")]), "a")).toBe("custom");
  });

  test("all three collide: custom wins and both losers are reported", () => {
    const merged = mergeSkillRegistries(
      [skill("a", "official")],
      [skill("a", "remote")],
      [skill("a", "custom")],
    );
    expect(merged.skills).toHaveLength(1);
    expect(merged.skills[0]!.description).toBe("custom");
    expect(merged.collisions).toEqual([{ name: "a", winner: "custom", shadowed: ["official", "remote"] }]);
  });

  test("all three collide in the reverse order: same winner, same losers", () => {
    const merged = mergeSkillRegistries(
      [skill("a", "custom")],
      [skill("a", "remote")],
      [skill("a", "official")],
    );
    expect(merged.skills[0]!.description).toBe("custom");
    expect(merged.collisions[0]!.winner).toBe("custom");
    expect([...merged.collisions[0]!.shadowed].sort()).toEqual(["official", "remote"]);
  });

  test("an untagged entry loses to any tagged one", () => {
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", undefined)], [skill("a", "remote")]), "a")).toBe("remote");
    expect(descriptionOf(mergeSkillRegistryLists([skill("a", "remote")], [skill("a", undefined)]), "a")).toBe("remote");
  });

  test("a tie inside one source resolves last-wins", () => {
    const merged = mergeSkillRegistryLists(
      [skill("a", "custom", "first")],
      [skill("a", "custom", "second")],
    );
    expect(merged[0]!.description).toBe("second");
  });

  test("no collision: everything survives and nothing is reported as shadowed", () => {
    const merged = mergeSkillRegistries(
      [skill("bundled-one", "official"), skill("bundled-two", "official")],
      [skill("mine", "custom")],
      [skill("published", "remote")],
    );
    expect(merged.skills.map((entry) => entry.name)).toEqual(["bundled-one", "bundled-two", "mine", "published"]);
    expect(merged.collisions).toEqual([]);
  });

  test("output is sorted by name regardless of input order", () => {
    const forwards = mergeSkillRegistryLists([skill("c", "official"), skill("a", "official")], [skill("b", "custom")]);
    const backwards = mergeSkillRegistryLists([skill("b", "custom")], [skill("a", "official"), skill("c", "official")]);
    expect(forwards.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(backwards.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
  });

  test("empty, undefined, and null groups are ignored rather than emptying the result", () => {
    // The failure this guards against is a merge that returns [] when one input is
    // missing - which for `skills list --remote` would render an empty registry as a
    // successful listing.
    const merged = mergeSkillRegistryLists([skill("a", "official")], undefined, null, []);
    expect(merged.map((entry) => entry.name)).toEqual(["a"]);
    expect(mergeSkillRegistryLists()).toEqual([]);
  });

  test("a losing entry is discarded whole, not field-merged with the winner", () => {
    // Half of one skill's metadata and half of another's would be a skill that never
    // existed anywhere.
    const official: SkillMeta = { ...skill("a", "official"), version: "1.0.0", tags: ["bundled"], category: "Media Processing" };
    const custom: SkillMeta = { ...skill("a", "custom"), tags: ["mine"], category: "Development Tools" };
    const [winner] = mergeSkillRegistryLists([official], [custom]);
    expect(winner).toEqual(custom);
    expect(winner!.version).toBeUndefined();
  });
});
