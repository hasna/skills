import type { SkillBundleEntry } from "./skill-bundle.js";
import { parseSkillFrontmatter } from "./skill-validation.js";
import { SkillSelectionError } from "./selection-cache.js";

function jsonEntry(
  entries: SkillBundleEntry[],
  path: string
): Record<string, any> {
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) return {};
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes)
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new SkillSelectionError(
      "INVALID_SKILL_MANIFEST",
      "The selected skill has an invalid execution manifest."
    );
  }
}
export function describeEntries(entries: SkillBundleEntry[]) {
  const manifest = jsonEntry(entries, "skill.json"),
    packageJson = jsonEntry(entries, "package.json");
  const docs = entries.find((entry) => entry.path === "SKILL.md");
  const frontmatter = docs
    ? parseSkillFrontmatter(new TextDecoder().decode(docs.bytes))
    : null;
  const kind =
    frontmatter?.kind === "instruction" ||
    manifest.kind === "instruction" ||
    packageJson.skills?.kind === "instruction"
      ? ("instruction" as const)
      : ("executable" as const);
  return { kind, manifest, packageJson };
}
