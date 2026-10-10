import { lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { AGENT_ADAPTERS, INTEGRATION_AGENTS, type IntegrationAgent } from "./agent-adapters.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";
import { readManagedSkillPolicySnapshot } from "./managed-policy.js";
import { getDataDirReadOnly } from "./config.js";

/** Presence selects adapters; it does not resolve native paths or approve
 * their configuration. The existing planner still verifies every selected
 * provider. Never execute a native CLI to detect it, particularly Sumi. */
export function detectedIntegrationAgents(options: { home?: string; dataDir?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}): IntegrationAgent[] {
  const home = options.home ?? homedir(), env = options.env ?? process.env;
  const policy = readManagedSkillPolicySnapshot(options.dataDir ?? getDataDirReadOnly())?.value;
  const bridge = policy?.bridge;
  if (bridge !== undefined && (!bridge || typeof bridge !== "object" || Array.isArray(bridge))) throw new Error("Invalid existing Skills bridge policy");
  const configured = bridge === undefined ? [] : bridge.agents;
  if (!Array.isArray(configured) || configured.some((agent: unknown) => !INTEGRATION_AGENTS.includes(agent as IntegrationAgent))) throw new Error("Invalid existing bridge agent inventory");
  const present = (path: string): boolean => {
    try { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }
    catch { throw new Error("Agent presence cannot be inspected; review native configuration before hook installation"); }
  };
  const selected = INTEGRATION_AGENTS.filter(agent => {
    if (configured.includes(agent) || Bun.which(agent, { PATH: env.PATH ?? "" })) return true;
    if (agent === "sumi") {
      // The owning Sumi v1 path planner publishes this legacy config candidate
      // and XDG's provider subdirectory, including relative/home expansion.
      // This is presence only; actual discovery still requires sumi-paths.
      const xdg = env.XDG_CONFIG_HOME;
      const xdgSumi = xdg?.trim() ? resolve(options.cwd ?? process.cwd(), xdg === "~" ? home
        : xdg.startsWith("~/") || xdg.startsWith("~\\") ? resolve(home, xdg.slice(2)) : xdg, "sumi") : null;
      // Generic XDG configuration without a Sumi child and Claude/shared
      // skill roots do not establish Sumi presence.
      return ["SUMI_HOME", "SUMI_CONFIG_DIR", "SUMI_CONFIG", "SUMI_CONFIG_CONTENT"].some(key => env[key] !== undefined)
        || Bun.which("sumi-paths", { PATH: env.PATH ?? "" }) !== null
        || NATIVE_SKILL_ROOTS.some(([provider, root]) => provider === "sumi" && present(join(home, dirname(root))))
        || present(join(home, ".config", "sumi"))
        || (xdgSumi !== null && present(xdgSumi));
    }
    if (agent === "hermes" && env.HERMES_HOME !== undefined) return true;
    const adapter = AGENT_ADAPTERS[agent];
    return present(join(home, dirname(adapter.config)))
      || NATIVE_SKILL_ROOTS.some(([provider, root]) => provider === agent && dirname(root) === `.${agent}` && present(join(home, dirname(root))));
  });
  if (!selected.length) throw new Error(`No configured or detected agents; select --agent <agent> explicitly (${INTEGRATION_AGENTS.join(", ")}).`);
  return selected;
}
