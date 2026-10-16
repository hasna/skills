/** The one package-owned definition of the plugin-root locations Codex reads.
 *
 * The vendor-refresh guard (codex-vendor-refresh.ts), the semantic cache
 * witness (codex-semantic-cache-witness.ts) and the reviewed hook dependency
 * closure (codex-hook-mcp-dependencies.ts) all derive their capability rules
 * from these lists, so a location added here reaches every mode at once.
 */

/** Manifest locations in a plugin version root, in the order Codex 0.160.0 and
 * later look them up: the Agent Plugins root `plugin.json` first, then the
 * `.codex-plugin`, `.claude-plugin` and `.cursor-plugin` manifests. The first
 * one present is the plugin's manifest. */
export const CODEX_PLUGIN_MANIFEST_LOCATIONS: readonly string[] = Object.freeze([
  "plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json",
]);

/** The manifest directories among CODEX_PLUGIN_MANIFEST_LOCATIONS. */
export const CODEX_PLUGIN_MANIFEST_DIRECTORIES: readonly string[] = Object.freeze([".codex-plugin", ".claude-plugin", ".cursor-plugin"]);

/** Every direct entry of a plugin version root that carries a capability Codex
 * reads: each manifest location, the default hooks directory and a root hooks
 * file, the MCP and connector declarations, and the default command and agent
 * directories. Spelled in lowercase; compare names through
 * codexPluginRootCapabilityEntry so a case-insensitive file system cannot alias
 * one. */
export const CODEX_PLUGIN_ROOT_CAPABILITY_ENTRIES: readonly string[] = Object.freeze([
  "plugin.json", ".codex-plugin", ".claude-plugin", ".cursor-plugin", "hooks", "hooks.json", ".mcp.json", ".app.json", "commands", "agents",
]);

/** Case-insensitive comparison form. Upper- then lower-casing also folds the
 * Kelvin sign, long s and dotless i onto their ASCII letters, so a name a
 * case-insensitive file system could open as a capability entry folds onto it. */
export function foldCodexPluginEntryName(name: string): string {
  return name.toUpperCase().toLowerCase();
}

/** The lowercase CODEX_PLUGIN_ROOT_CAPABILITY_ENTRIES member a directory entry
 * name denotes, matched without regard to case, or null. */
export function codexPluginRootCapabilityEntry(name: string): string | null {
  const folded = foldCodexPluginEntryName(name);
  return CODEX_PLUGIN_ROOT_CAPABILITY_ENTRIES.includes(folded) ? folded : null;
}

/** Whether a directory entry name is a skill document (`SKILL.md`), matched
 * without regard to case. */
export function isCodexSkillDocumentName(name: string): boolean {
  return foldCodexPluginEntryName(name) === "skill.md";
}
