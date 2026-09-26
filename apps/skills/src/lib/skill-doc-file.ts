import type { SkillDocs } from "./skillinfo.js";

export class SkillDocFileError extends Error {
  constructor(readonly code: "SKILL_DOC_FILE_INVALID" | "SKILL_DOC_FILE_MISSING", message: string) {
    super(message);
    this.name = "SkillDocFileError";
  }
}

/** The docs command's aliases are not arbitrary bundle paths (skills load supports those). */
export function resolveSkillDocFile(file?: string): "SKILL.md" | "README.md" | "CLAUDE.md" | undefined {
  switch (file) {
    case undefined: case "": return undefined;
    case "skill": return "SKILL.md";
    case "readme": return "README.md";
    case "claude": return "CLAUDE.md";
    default: throw new SkillDocFileError("SKILL_DOC_FILE_INVALID", "Unsupported documentation file. Choose skill, readme, or claude.");
  }
}

/** Fall back only when no file was requested, identically for text, JSON and SDK reads. */
export function selectSkillDoc(docs: SkillDocs, file?: string): string | null {
  const path = resolveSkillDocFile(file);
  if (path === undefined) return docs.skillMd || docs.readme || docs.claudeMd || null;
  const content = path === "SKILL.md" ? docs.skillMd : path === "README.md" ? docs.readme : docs.claudeMd;
  if (content === null) throw new SkillDocFileError("SKILL_DOC_FILE_MISSING", `Documentation file ${path} was not found.`);
  return content;
}
