import type { SkillSelection } from "../types/skill-selection.js";

/** Aliases are direct names of one pinned selection, never a second registry. */
export function selectionAliasError(selections: readonly Pick<SkillSelection, "slug" | "aliases">[]): string | undefined {
  const names = new Set(selections.map(selection => selection.slug));
  for (const selection of selections) {
    if (selection.aliases === undefined) continue;
    if (!Array.isArray(selection.aliases) || selection.aliases.length > 32) return "Selection aliases must be an array of at most 32 names.";
    for (const alias of selection.aliases) {
      if (typeof alias !== "string" || alias.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(alias)) return "Selection aliases must be bounded kebab-case names.";
      if (names.has(alias)) return "Selection aliases must be unique and cannot shadow a selected canonical name.";
      names.add(alias);
    }
  }
}

export function selectionMatchesName(selection: Pick<SkillSelection, "slug" | "aliases">, name: string): boolean {
  return selection.slug === name || Boolean(selection.aliases?.includes(name));
}

/** Ignore resolved authority fields and JSON key ordering, not contract data. */
export function selectionSnapshotsEqual(left: readonly SkillSelection[], right: readonly SkillSelection[]): boolean {
  const snapshot = (selections: readonly SkillSelection[]) => selections.map(selection => [
    selection.slug, selection.version, selection.bundleDigest, selection.aliases ?? [],
    selection.triggers?.keywords ?? [], selection.triggers?.paths ?? [], selection.triggers?.always ?? null,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify(snapshot(left)) === JSON.stringify(snapshot(right));
}
