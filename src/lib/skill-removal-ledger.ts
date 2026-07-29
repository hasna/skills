import { SKILL_ALIASES } from "./skill-aliases.js";

export interface SkillRemovalLedgerEntry {
  kind: "rename" | "removal";
  replacement?: string;
}

/**
 * Names that a renderer may remove from an agent home.
 *
 * Renames are derived from the canonical alias table so lookup compatibility and
 * removal authorization cannot drift apart. Permanent removals belong in the
 * explicit table below, with the release that authorized them documented beside
 * the entry. An absent name is deliberately a refusal, not an implicit deletion.
 */
export const SKILL_REMOVAL_LEDGER: Readonly<Record<string, SkillRemovalLedgerEntry>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(SKILL_ALIASES).map(([name, replacement]) => [
      name,
      { kind: "rename" as const, replacement },
    ]),
  ),
  // Permanent removals are added here only after the corpus migration policy is
  // satisfied. There are no such entries in the current registry generation.
});

export function getSkillRemovalLedgerEntry(name: string): SkillRemovalLedgerEntry | undefined {
  return SKILL_REMOVAL_LEDGER[name];
}
