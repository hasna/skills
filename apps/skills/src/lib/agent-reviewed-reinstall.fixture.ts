import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { captureDiscoveryByteSources, captureDiscoveryDirectories, type ReviewedDiscoveryInputs } from "./agent-discovery.js";

/** Synthetic plugin with an explicitly reviewed hook; never executes plugin code. */
export function reviewedReinstallFixture(home: string, claudeRoot = join(home, ".claude"), plugin = join(home, "reviewed-plugin")) {
  const put = (path: string, body: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
  const settings = join(claudeRoot, "settings.json");
  const registry = join(claudeRoot, "plugins/installed_plugins.json"), manifest = join(plugin, ".claude-plugin/plugin.json");
  const hook = join(plugin, "hooks/hooks.json"), source = join(plugin, "scripts/stop.js");
  put(settings, JSON.stringify({ enabledPlugins: { "reviewed@fixture": true } }));
  put(registry, JSON.stringify({ version: 2, plugins: { "reviewed@fixture": [{ scope: "user", installPath: plugin }] } }));
  put(manifest, JSON.stringify({ name: "reviewed" }));
  put(hook, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "fixture-stop" }] }] } }));
  put(source, "// Synthetic reviewed hook implementation.\n");
  mkdirSync(join(plugin, "skills"));
  return { plugin, settings, registry, manifest, hook, source, put,
    review: (): ReviewedDiscoveryInputs => ({ version: 1, agents: [{ agent: "claude", roots: [join(plugin, "skills")], pluginHooks: "reviewed-no-skill-injection", sources: captureDiscoveryByteSources([settings, registry, manifest, hook, source]), directories: captureDiscoveryDirectories([plugin]) }] }),
  };
}
