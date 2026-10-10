/** Target-owned, read-only activation contract. Never import native runtimes. */
import { isAbsolute } from "node:path";
import { version } from "../package.json";
import { detectedIntegrationAgents } from "./lib/agent-install-selection.js";
import { sumiConfigDirectory, SumiPathResolverError } from "./lib/agent-sumi.js";

export const RUNTIME_PREREQUISITES_SCHEMA = "skills.runtime-prerequisites.v1";
export const RUNTIME_PREREQUISITE_CODES = [
  "RUNTIME_CONSUMER_DISCOVERY_REFUSED", "RUNTIME_PREREQUISITE_INPUT_REFUSED",
  "SUMI_PATH_INPUT_REFUSED", "SUMI_PATH_CONFIG_UNSUPPORTED", "SUMI_PATH_RESOLVER_UNAVAILABLE",
  "SUMI_PATH_RESOLVER_INVALID_RESPONSE", "SUMI_PATH_DISCOVERY_REFUSED",
] as const;

export function runtimePrerequisites(home: string, cwd: string) {
  const result = { schema: RUNTIME_PREREQUISITES_SCHEMA, targetVersion: version,
    ok: false, checked: [] as string[], code: null as string | null };
  if (!isAbsolute(home) || !isAbsolute(cwd)) return { ...result, code: "RUNTIME_PREREQUISITE_INPUT_REFUSED" };
  let agents;
  try { agents = detectedIntegrationAgents({ home, cwd, allowEmpty: true }); }
  catch { return { ...result, code: "RUNTIME_CONSUMER_DISCOVERY_REFUSED" }; }
  if (agents.includes("sumi")) {
    try {
      // Exercise the same schema, selector and conflict/alias checks as the
      // integrated consumer. This only inspects roots; it never reads settings.
      sumiConfigDirectory(home, process.env, cwd);
      result.checked.push("sumi-paths");
    } catch (error) {
      const code = error instanceof SumiPathResolverError && RUNTIME_PREREQUISITE_CODES.includes(error.code as typeof RUNTIME_PREREQUISITE_CODES[number])
        ? error.code : "SUMI_PATH_DISCOVERY_REFUSED";
      return { ...result, code };
    }
  }
  return { ...result, ok: true };
}

if (import.meta.main) {
  const [home, cwd, ...extra] = process.argv.slice(2);
  const result = !home || !cwd || extra.length
    ? { schema: RUNTIME_PREREQUISITES_SCHEMA, targetVersion: version, ok: false, checked: [], code: "RUNTIME_PREREQUISITE_INPUT_REFUSED" }
    : runtimePrerequisites(home, cwd);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
