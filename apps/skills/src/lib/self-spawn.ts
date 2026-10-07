// Every place the CLI or MCP server starts another copy of itself goes through
// this helper. A pinned launcher starts Bun with no working-directory
// configuration, from a trusted directory and with an allowlisted environment;
// a child started as `[process.execPath, process.argv[1], ...]` from the
// caller's directory would undo that, because Bun would read the caller's
// bunfig.toml, .env and BUN_OPTIONS again for the child. The child receives
// the same flags, the same environment allowlist, the runtime version root as
// its trusted directory, and the caller's directory in HASNA_SKILLS_LAUNCH_CWD,
// which its entry restores before any other module evaluates.
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, sep } from "node:path";
import { LAUNCH_CWD_VARIABLE } from "./launch-cwd.js";
import { PINNED_LAUNCHER_BUN_FLAGS, pinnedLauncherEnvironment } from "../cli/commands/runtime-launcher.js";

const INSTALLED_PACKAGE = `${sep}node_modules${sep}@hasna${sep}skills${sep}`;

/**
 * The trusted directory for a child of `entry`: the copyfile runtime version
 * root that holds `node_modules/@hasna/skills` (what the pinned launcher uses),
 * or the entry's own directory for a build or source checkout.
 */
export function selfSpawnRoot(entry: string): string {
  const index = entry.indexOf(INSTALLED_PACKAGE);
  const root = index > 0 ? entry.slice(0, index) : dirname(entry);
  try { return realpathSync(root); } catch { return root; }
}

export interface SelfSpawnCommand { command: string[]; cwd: string; env: Record<string, string> }

/**
 * Argv, working directory and environment to run this Skills entry again with
 * `args`. Pass the result to Bun.spawn as `cmd`, `cwd` and `env`.
 */
export function selfSpawnCommand(args: readonly string[], options: {
  entry?: string; runtime?: string; env?: Record<string, string | undefined>; callerCwd?: string;
} = {}): SelfSpawnCommand {
  const runtime = options.runtime ?? process.execPath;
  const entry = options.entry ?? process.argv[1];
  if (!runtime || !isAbsolute(runtime) || !entry || !isAbsolute(entry)) throw new Error("SKILLS_SELF_SPAWN_ENTRY_UNRESOLVED");
  const root = selfSpawnRoot(entry);
  const env = pinnedLauncherEnvironment(options.env ?? process.env);
  env[LAUNCH_CWD_VARIABLE] = options.callerCwd ?? process.cwd();
  return { command: [runtime, ...PINNED_LAUNCHER_BUN_FLAGS, `--cwd=${root}`, entry, ...args], cwd: root, env };
}
