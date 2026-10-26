import { dirname, resolve } from "node:path";

/** Shared default discovery roots for inventory and authoring exclusion. */
export const NATIVE_SKILL_ROOTS = [
  ["claude", ".claude/skills"], ["codex", ".codex/skills"], ["codex", ".agents/skills"],
  ["gemini", ".gemini/skills"],
  ["sumi", ".sumi/skills"], ["sumi", ".sumi/skill"],
  ["codewith", ".codewith/skills"], ["opencode", ".config/opencode/skills"], ["opencode", ".opencode/skills"], ["cursor", ".cursor/skills"],
  ["hermes", ".hermes/skills"], ["windsurf", ".windsurf/skills"], ["pi", ".pi/agent/skills"], ["amp", ".amp/skills"], ["cline", ".cline/skills"], ["roo", ".roo/skills"], ["copilot", ".github/skills"],
] as const;

/** Native project discovery includes every ancestor. Keep inventory and
 * authoring on this same bounded context enumeration. */
export function nativeProjectAncestorDirectories(projects: readonly string[], canonical: (path: string) => string = resolve): string[] {
  const directories = new Set<string>();
  for (const project of projects) {
    for (let path = canonical(project), depth = 0; ; depth++) {
      if (depth >= 100) throw new Error("NATIVE_SKILL_DRIFT: project ancestor discovery limit exceeded");
      directories.add(path);
      const parent = dirname(path); if (parent === path) break; path = parent;
    }
  }
  return [...directories];
}
