import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { hashNativeJsonControls } from "./claude-settings-witness.js";

/* Measured with native Codex 0.162.1 (app-server skills/list, offline, synthetic
 * HOME and CODEX_HOME): Codex loads SKILL.md files below `node_modules` inside
 * each of its skill roots (`$CODEX_HOME/skills`, `~/.agents/skills`, a project's
 * `.codex/skills` and `.agents/skills`, and a plugin's skill roots), nested
 * packages included, to six directory levels below the root. It skips only
 * dot-named entries, so `node_modules/.pnpm` stays hidden, and it does not load
 * a `node_modules` outside a skill root, such as a plugin version's own
 * dependencies. Native inventory therefore walks `node_modules` in Codex skill
 * roots and, within the plugin cache, only where it can lie in a skill root. */

/** Manifest locations Codex 0.162.1 reads in a plugin version root (see
 * codex-hook-mcp-dependencies.ts). Every one present is consulted. */
const PLUGIN_MANIFESTS: readonly string[] = Object.freeze(["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"]);
/** `<cache>/<marketplace>/<plugin>/<version>` is the plugin root depth Codex uses. */
const PLUGIN_ROOT_DEPTH = 3;

/** Whether Codex can load a skill below `path`, a `node_modules` directory
 * `depth` levels below its plugin cache. A marketplace, plugin or version
 * directory is an identity, so one named `node_modules` is always walked.
 * Inside a version, the directory is walked when it lies in, or leads to, a
 * manifest-declared skills path or the default `skills` root. Codex replaces
 * the default with a declared path; Skills keeps walking it, as it walks every
 * other visible directory in the cache. A manifest that cannot be read exactly
 * (a link or special file, oversized, invalid UTF-8 or JSON, duplicate keys, an
 * unsupported skills shape or an escaping path) walks it too, so an unreadable
 * declaration never hides a loaded skill. */
export function codexPluginCacheSkillTree(path: string, depth: number): boolean {
  if (depth <= PLUGIN_ROOT_DEPTH) return true;
  let root = path;
  for (let level = depth; level > PLUGIN_ROOT_DEPTH; level--) root = dirname(root);
  try {
    const skillRoots = [join(root, "skills")];
    for (const name of PLUGIN_MANIFESTS) {
      const manifest = join(root, name), stat = lstatSync(manifest, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isFile() || stat.size > 1024 * 1024) return true;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(manifest));
      hashNativeJsonControls(text);
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) return true;
      const declared = (value as Record<string, unknown>).skills;
      if (declared === undefined) continue;
      const paths = typeof declared === "string" ? [declared] : declared;
      if (!Array.isArray(paths) || paths.some(item => typeof item !== "string")) return true;
      for (const item of paths as string[]) {
        const target = resolve(root, item);
        if (target !== root && !target.startsWith(root + sep)) return true;
        skillRoots.push(target.endsWith(`${sep}SKILL.md`) ? dirname(target) : target);
      }
    }
    return skillRoots.some(skillRoot => path === skillRoot || path.startsWith(skillRoot + sep) || skillRoot.startsWith(path + sep));
  } catch { return true; }
}
