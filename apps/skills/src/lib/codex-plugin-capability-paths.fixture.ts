/** Synthetic capability-path changes for Codex plugin version roots, shared by
 * the semantic cache witness and guard-time verification tests. Every command,
 * URL and server below is a never-executed fixture value. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const skillDocument = (name: string) => `---\nname: ${name}\ndescription: Synthetic unreviewed skill\n---\nNever loaded`;
const hooksDeclaration = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "synthetic-never-executed" }] }] } });

export interface CodexCapabilityPathMutation {
  label: string;
  /** False when the path is the plugin's own reviewed location (the hooks
   * directory of a reviewed hook parent), so it is not a new capability there. */
  appliesToHookParent: boolean;
  apply(root: string, namespace: string): void;
}

/** One entry per capability location Codex reads in a plugin version root,
 * plus case variants, nested manifest directories and capability-named
 * materializations directly below the plugin parent. Each must refuse. */
export const CODEX_CAPABILITY_PATH_MUTATIONS: readonly CodexCapabilityPathMutation[] = Object.freeze([
  { label: "Agent Plugins root plugin.json with an HTTPS MCP server and a command hook", appliesToHookParent: true, apply: (root, namespace) => put(join(root, "plugin.json"), JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/plugin.json", name: namespace, version: basename(root),
    mcpServers: { remote: { type: "http", url: "https://mcp.example.com/mcp" } }, hooks: JSON.parse(hooksDeclaration).hooks,
  })) },
  { label: "agents/ directory", appliesToHookParent: true, apply: root => put(join(root, "agents", "reviewer.md"), "Synthetic agent definition") },
  { label: "commands/ directory", appliesToHookParent: true, apply: root => put(join(root, "commands", "deploy.md"), "Synthetic command definition") },
  { label: ".claude-plugin/plugin.json", appliesToHookParent: true, apply: (root, namespace) => put(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: namespace, version: basename(root), hooks: "./hooks/hooks.json" })) },
  { label: ".cursor-plugin/plugin.json", appliesToHookParent: true, apply: (root, namespace) => put(join(root, ".cursor-plugin", "plugin.json"), JSON.stringify({ name: namespace, version: basename(root) })) },
  { label: "lowercase skill.md", appliesToHookParent: true, apply: root => put(join(root, "skills", "extra", "skill.md"), skillDocument("extra")) },
  { label: "mixed-case Skill.md", appliesToHookParent: true, apply: root => put(join(root, "skills", "extra", "Skill.md"), skillDocument("extra")) },
  { label: "root hooks.json", appliesToHookParent: true, apply: root => put(join(root, "hooks.json"), hooksDeclaration) },
  { label: "hooks/hooks.json without a reviewed hook role", appliesToHookParent: false, apply: root => put(join(root, "hooks", "hooks.json"), hooksDeclaration) },
  { label: ".mcp.json", appliesToHookParent: true, apply: root => put(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { added: { command: "synthetic-never-executed", args: [] } } })) },
  // Case variants a case-insensitive file system opens as the lowercase location.
  { label: "Plugin.json case variant", appliesToHookParent: true, apply: (root, namespace) => put(join(root, "Plugin.json"), JSON.stringify({ name: namespace })) },
  { label: "AGENTS/ case variant", appliesToHookParent: true, apply: root => put(join(root, "AGENTS", "reviewer.md"), "Synthetic agent definition") },
  { label: "Commands/ case variant", appliesToHookParent: true, apply: root => put(join(root, "Commands", "deploy.md"), "Synthetic command definition") },
  { label: ".Claude-Plugin/plugin.json case variant", appliesToHookParent: true, apply: (root, namespace) => put(join(root, ".Claude-Plugin", "plugin.json"), JSON.stringify({ name: namespace })) },
  { label: ".CURSOR-PLUGIN/plugin.json case variant", appliesToHookParent: true, apply: (root, namespace) => put(join(root, ".CURSOR-PLUGIN", "plugin.json"), JSON.stringify({ name: namespace })) },
  { label: ".Codex-Plugin/plugin.json beside the bound manifest", appliesToHookParent: true, apply: (root, namespace) => put(join(root, ".Codex-Plugin", "plugin.json"), JSON.stringify({ name: namespace, version: basename(root) })) },
  { label: "Hooks/hooks.json case variant", appliesToHookParent: true, apply: root => put(join(root, "Hooks", "hooks.json"), hooksDeclaration) },
  { label: "HOOKS.JSON case variant", appliesToHookParent: true, apply: root => put(join(root, "HOOKS.JSON"), hooksDeclaration) },
  { label: "Kelvin-sign hooks.json fold", appliesToHookParent: true, apply: root => put(join(root, "hoo\u212As.json"), hooksDeclaration) },
  { label: ".MCP.json case variant", appliesToHookParent: true, apply: root => put(join(root, ".MCP.json"), JSON.stringify({ mcpServers: {} })) },
  { label: ".App.json case variant", appliesToHookParent: true, apply: root => put(join(root, ".App.json"), JSON.stringify({ apps: {} })) },
  { label: "long-s \u017Fkill.md fold", appliesToHookParent: true, apply: root => put(join(root, "skills", "extra", "\u017Fkill.md"), skillDocument("extra")) },
  // Hook, MCP and connector declarations stay controls at any depth, in any case.
  { label: "nested Hooks.json case variant", appliesToHookParent: true, apply: root => put(join(root, "assets", "starter", "Hooks.json"), hooksDeclaration) },
  { label: "nested .MCP.json case variant", appliesToHookParent: true, apply: root => put(join(root, "assets", "starter", ".MCP.json"), JSON.stringify({ mcpServers: {} })) },
  { label: "nested .App.json case variant", appliesToHookParent: true, apply: root => put(join(root, "assets", "starter", ".App.json"), JSON.stringify({ apps: {} })) },
  // Manifest directories are admitted only as the bound .codex-plugin/plugin.json.
  { label: "nested .claude-plugin/plugin.json", appliesToHookParent: true, apply: (root, namespace) => put(join(root, "assets", "starter", ".claude-plugin", "plugin.json"), JSON.stringify({ name: namespace })) },
  { label: "nested .cursor-plugin/plugin.json", appliesToHookParent: true, apply: (root, namespace) => put(join(root, "assets", "starter", ".cursor-plugin", "plugin.json"), JSON.stringify({ name: namespace })) },
  // A capability-named directory beside the versions is never a materialization,
  // even when it is a complete copy whose manifest version matches its name.
  ...["agents", "commands", "hooks", "plugin.json"].map((name): CodexCapabilityPathMutation => ({
    label: `capability-named ${name} materialization beside the versions`, appliesToHookParent: true,
    apply: root => copyMaterialization(root, join(dirname(root), name)),
  })),
]);

/** Nested names that are capability locations only at a version root. They
 * remain inert assets deeper in a plugin and must keep passing. */
export const CODEX_INERT_NESTED_NAMES: readonly string[] = Object.freeze([
  "assets/agents/readme.txt", "assets/commands/run.ts", "assets/plugin.json", "assets/starter/hooks/use-mobile.ts",
]);

/** Copy a complete version root to `target`, renaming its manifest version to
 * the target directory name, as a refresh writing an equivalent version would. */
export function copyMaterialization(root: string, target: string): void {
  cpSync(root, target, { recursive: true });
  const manifest = join(target, ".codex-plugin", "plugin.json");
  const value = JSON.parse(readFileSync(manifest, "utf8"));
  value.version = basename(target);
  writeFileSync(manifest, JSON.stringify(value));
}
