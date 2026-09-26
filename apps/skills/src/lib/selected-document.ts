/** Documentation comes only from the already verified selected bundle. */
import type { SkillBundleEntry } from "./skill-bundle.js";
import { SkillSelectionError } from "./selection-cache.js";

// Match getSkillBestDoc's established priority, including empty-file fallback.
const DOCUMENT_PATHS = ["SKILL.md", "README.md", "CLAUDE.md"] as const;

export function readSelectedDocument(entries: SkillBundleEntry[], file?: string): { file: string; content: string } {
  const entry = file !== undefined
    ? entries.find((candidate) => candidate.path === file)
    : DOCUMENT_PATHS.map((path) => entries.find((candidate) => candidate.path === path && candidate.bytes.length > 0)).find(Boolean);
  if (!entry) {
    if (file !== undefined) throw new SkillSelectionError("SKILL_FILE_MISSING", "The selected skill bundle does not contain that file.");
    throw new SkillSelectionError("SKILL_DOCS_MISSING", "The selected bundle has no nonempty SKILL.md, README.md, or CLAUDE.md. Use skills load <slug>@<version> --file <path> to read an exact bundle file; loading context never runs the skill.");
  }
  try { return { file: entry.path, content: new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes) }; }
  catch { throw new SkillSelectionError("SKILL_FILE_NOT_TEXT", "The selected bundle file is not valid UTF-8 text; choose a documentation file with --file."); }
}
