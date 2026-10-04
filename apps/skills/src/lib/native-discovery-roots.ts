/** Shared default discovery roots for inventory and authoring exclusion. */
export const NATIVE_SKILL_ROOTS = [
  ["claude", ".claude/skills"], ["codex", ".codex/skills"], ["codex", ".agents/skills"],
  ["gemini", ".gemini/skills"],
  ["sumi", ".sumi/skills"], ["sumi", ".sumi/skill"],
  ["codewith", ".codewith/skills"], ["opencode", ".config/opencode/skills"], ["opencode", ".opencode/skills"], ["cursor", ".cursor/skills"],
  ["hermes", ".hermes/skills"], ["windsurf", ".windsurf/skills"], ["pi", ".pi/agent/skills"], ["amp", ".amp/skills"], ["cline", ".cline/skills"], ["roo", ".roo/skills"], ["copilot", ".github/skills"],
] as const;
