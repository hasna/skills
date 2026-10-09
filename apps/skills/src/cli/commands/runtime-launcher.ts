// Pinned launcher shape for the copyfile runtime updater.
//
// A bare symlink to `bin/index.js` runs `#!/usr/bin/env bun`, so whatever Bun
// is first on PATH starts with the caller's working directory as its config
// root: a hostile `bunfig.toml` preload, a `.env`, a `tsconfig.json` paths
// hijack, or a `BUN_OPTIONS` value in the environment all run before the CLI
// does. The updater therefore writes every launcher it manages as a small
// POSIX sh file that execs one exact Bun binary on one exact entry, from one
// trusted working directory, with no working-directory configuration and a
// total environment allowlist. The shell itself runs with `-p` (privileged
// mode): bash, which is /bin/sh on macOS, then ignores SHELLOPTS, BASHOPTS,
// CDPATH, GLOBIGNORE and every exported function in the caller's environment,
// so nothing the caller exports runs before `env -i`. dash ignores those names
// already and accepts `-p` from 0.5.11; the updater refuses to write launchers
// on a station whose /bin/sh does not run `-p`. This is the shape the fleet's native MCP and
// hook launchers use (`env -i HOME= PATH= <bun> --config=/dev/null
// --no-env-file --no-macros --no-install --cwd=<trusted> <entry>`); the CLI
// restores the caller's directory itself from HASNA_SKILLS_LAUNCH_CWD.
//
// Two launcher shapes exist on a station: the legacy `symlink` and `pinned`.
// Receipts record both the old and the new state of each launcher, so a
// rollback restores the exact prior shape whichever it was.
import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CLIENT_LAUNCHER_STORAGE_DENY_AWK, LEGACY_PINNED_LAUNCHER_SCHEMA, SERVER_LAUNCHER_ENV_NAMES, isStorageLocatorEnvironmentName, renderLegacyPinnedLauncher } from "../../server/launcher-environment-policy.js";

export const PINNED_LAUNCHER_SCHEMA = "hasna-skills-pinned-launcher-v2";

/** The variable the launcher uses to hand the caller's directory to the CLI. */
export const LAUNCH_CWD_VARIABLE = "HASNA_SKILLS_LAUNCH_CWD";

/** Bun runtime flags that remove every working-directory configuration source. */
export const PINNED_LAUNCHER_BUN_FLAGS = ["--config=/dev/null", "--no-env-file", "--no-macros", "--no-install"] as const;

/**
 * Environment names passed through `env -i`, by exact name. Everything else,
 * including `BUN_*`, `NODE_OPTIONS`, `DYLD_*`, `LD_*` and proxy settings, is
 * dropped. The handling is total on purpose: a name is either listed here,
 * matches a prefix below, and passes the server-owned profile policy.
 */
export const PINNED_LAUNCHER_ENV_NAMES = [
  "HOME", "PATH", "TMPDIR", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORTERM", "LANG", "USER", "LOGNAME", "SHELL", "TZ",
  "NO_COLOR", "FORCE_COLOR", "CI", "COLUMNS", "LINES", "EDITOR", "VISUAL", "PAGER", "SSH_AUTH_SOCK",
  "TERMINAL_CWD", "CODEX_HOME", "HERMES_HOME", "HERMES_ENABLE_PROJECT_PLUGINS",
  // Settings the pinned server, worker and publish entries read by these bare names
  // (src/server/config.ts, src/server/runtime-worker.ts, src/cli/commands/publish.ts).
  "HOST", "PORT", "NODE_ENV", "AGENT_ID", "ECS_CONTAINER_METADATA_URI_V4",
] as const;

/** Environment name prefixes passed through, for the app's own documented overrides. */
export const PINNED_LAUNCHER_ENV_PREFIXES = ["HASNA", "SKILLS", "SKILL", "MCP", "XDG", "LC", "AWS"] as const;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_PREFIX = new RegExp(`^(${PINNED_LAUNCHER_ENV_PREFIXES.join("|")})_`);
const ENV_EXACT = new Set<string>(PINNED_LAUNCHER_ENV_NAMES);

/** The allowlisted subset of an environment, by the same rule the launcher applies. */
export function pinnedLauncherEnvironment(env: Record<string, string | undefined>, profile: LauncherProfile = "client"): Record<string, string> {
  assertLauncherProfile(profile);
  const result: Record<string, string> = {};
  for (const name of Object.keys(env)) {
    if (!ENV_NAME.test(name)) continue;
    const storageLocator = isStorageLocatorEnvironmentName(name);
    if (storageLocator && profile === "client") continue;
    if (!storageLocator && !ENV_EXACT.has(name) && !ENV_PREFIX.test(name)) continue;
    const value = env[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

export type LauncherShape = "symlink" | "pinned";

export type LauncherFormat = "v1" | "v2";
export type LauncherProfile = "client" | "server";
export interface LauncherMetadata { format?: LauncherFormat; profile?: LauncherProfile }
export interface PinnedLauncherBinding extends LauncherMetadata { runtime: string; cwd: string; entry: string }

function assertLauncherProfile(profile: unknown): asserts profile is LauncherProfile {
  if (profile !== "client" && profile !== "server") throw new Error("LAUNCHER_PROFILE_INVALID");
}

/** Role follows the package's public bin/entry contract, never a path substring. */
export function launcherProfileForBin(name: string, entry: string): LauncherProfile {
  const bins: Record<string, readonly [string, LauncherProfile]> = {
    skills: ["bin/index.js", "client"], "skills-mcp": ["bin/mcp.js", "client"],
    "skills-serve": ["bin/server.js", "server"], "skills-server": ["bin/server.js", "server"],
    "skills-worker": ["bin/worker.js", "server"], "skills-maintenance": ["bin/maintenance.js", "server"],
    "skills-migrate": ["bin/migrate.js", "server"],
  };
  const contract = bins[name];
  if (!contract || entry !== contract[0]) throw new Error("LAUNCHER_BIN_CONTRACT_INVALID");
  return contract[1];
}

export type LauncherState =
  | { shape: "symlink"; linkTarget: string; target: string }
  | ({ shape: "pinned"; runtime: string; cwd: string; target: string; sha256: string } & LauncherMetadata);

export type InspectedLauncher =
  | { kind: "symlink"; linkTarget: string; target: string }
  | ({ kind: "pinned"; runtime: string; cwd: string; target: string; sha256: string; text: string } & LauncherMetadata)
  | { kind: "foreign" };

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Paths are embedded inside single quotes on one line of the launcher, so a
// quote or a control character cannot be represented and is refused.
function assertLauncherPath(value: string, code: string): void {
  if (typeof value !== "string" || !isAbsolute(value) || /['\x00-\x1f\x7f]/.test(value)) throw new Error(code);
}

/** The exact launcher text for one Bun binary, trusted directory and entry. Deterministic. */
export function renderPinnedLauncher(binding: PinnedLauncherBinding): string {
  assertLauncherPath(binding.runtime, "LAUNCHER_RUNTIME_PATH_INVALID");
  assertLauncherPath(binding.cwd, "LAUNCHER_CWD_PATH_INVALID");
  assertLauncherPath(binding.entry, "LAUNCHER_ENTRY_PATH_INVALID");
  if (binding.format === "v1") {
    if (binding.profile !== undefined) throw new Error("LAUNCHER_PROFILE_INVALID");
    return renderLegacyPinnedLauncher(binding);
  }
  if (binding.format !== undefined && binding.format !== "v2") throw new Error("LAUNCHER_FORMAT_INVALID");
  const profile = binding.profile === undefined ? "client" : binding.profile;
  assertLauncherProfile(profile);
  const names = [...PINNED_LAUNCHER_ENV_NAMES, ...(profile === "server" ? SERVER_LAUNCHER_ENV_NAMES : [])].join(" ");
  const prefixes = PINNED_LAUNCHER_ENV_PREFIXES.join("|");
  return [
    "#!/bin/sh -p",
    `# ${PINNED_LAUNCHER_SCHEMA}`,
    `# environment-profile: ${profile}`,
    "# Written by `skills self-update`; rewrite it with `skills self-update`, do not edit by hand.",
    "# Runs the exact Skills entry below under one exact Bun from one trusted directory with",
    "# no working-directory configuration (no bunfig.toml, no .env, no macros, no auto-install)",
    "# and only the environment names allowed here. Everything else, BUN_* and NODE_OPTIONS",
    "# included, never reaches the runtime. The CLI returns to the caller's directory itself.",
    "# `-p` keeps the caller's exported functions and shell options out of this shell.",
    "set -eu",
    `${LAUNCH_CWD_VARIABLE}=$(pwd -P 2>/dev/null || :)`,
    `export ${LAUNCH_CWD_VARIABLE}`,
    `set -- '${binding.runtime}' ${PINNED_LAUNCHER_BUN_FLAGS.join(" ")} '--cwd=${binding.cwd}' '${binding.entry}' "$@"`,
    "hasna_skills_env=$(LC_ALL=C /usr/bin/awk 'BEGIN {",
    `  n = split("${names}", exact, " ")`,
    "  for (i = 1; i <= n; i++) allow[exact[i]] = 1",
    "  for (name in ENVIRON) {",
    "    if (name !~ /^[A-Za-z_][A-Za-z0-9_]*$/) continue",
    `    if (name == "LC_ALL" || (!(name in allow) && name !~ /^(${prefixes})_/)) continue`,
    ...(profile === "client" ? [CLIENT_LAUNCHER_STORAGE_DENY_AWK] : []),
    "    value = ENVIRON[name]; quoted = \"\"",
    "    while ((k = index(value, \"\\047\")) > 0) { quoted = quoted substr(value, 1, k - 1) \"\\047\\\\\\047\\047\"; value = substr(value, k + 1) }",
    "    printf \"\\047%s=%s\\047 \", name, quoted value",
    "  }",
    "}')",
    "eval \"set -- $hasna_skills_env \\\"\\$@\\\"\"",
    "if [ \"${LC_ALL+x}\" = x ]; then set -- \"LC_ALL=$LC_ALL\" \"$@\"; fi",
    "exec /usr/bin/env -i \"$@\"",
    "",
  ].join("\n");
}

const COMMAND_LINE = new RegExp(`^set -- '([^']+)' ${PINNED_LAUNCHER_BUN_FLAGS.join(" ")} '--cwd=([^']+)' '([^']+)' "\\$@"$`, "m");

/** Parse launcher text; only the exact rendered shape is accepted. */
export function parsePinnedLauncher(text: string): PinnedLauncherBinding | null {
  const match = COMMAND_LINE.exec(text);
  if (!match) return null;
  let metadata: LauncherMetadata;
  if (text.split("\n")[1] === `# ${LEGACY_PINNED_LAUNCHER_SCHEMA}`) metadata = { format: "v1" };
  else if (text.split("\n")[1] === `# ${PINNED_LAUNCHER_SCHEMA}`) {
    const profile = /^# environment-profile: (client|server)$/m.exec(text)?.[1] as LauncherProfile | undefined;
    if (!profile) return null;
    metadata = { format: "v2", profile };
  } else return null;
  const binding = { runtime: match[1]!, cwd: match[2]!, entry: match[3]!, ...metadata };
  try { if (renderPinnedLauncher(binding) !== text) return null; } catch { return null; }
  return binding;
}

/** Upper bound for a file read to test whether it is a pinned launcher. */
const PINNED_LAUNCHER_MAX_BYTES = 16 * 1024;

/**
 * Resolve a command path the way the symlink checks used to: the physical file
 * it reaches and, when that file is a managed pinned launcher (its exact
 * rendered text), the entry the launcher runs. `entry` equals `physical` for a
 * symlink or a plain executable. A pinned entry must itself be a physical path.
 */
export function resolveLauncherCommand(path: string): { physical: string; entry: string; pinned: (PinnedLauncherBinding & { sha256: string }) | null } {
  const physical = realpathSync(path);
  const stat = lstatSync(physical);
  if (stat.isFile() && stat.size <= PINNED_LAUNCHER_MAX_BYTES) {
    const text = readFileSync(physical, "utf8");
    const binding = parsePinnedLauncher(text);
    if (binding) {
      let entry: string;
      try { entry = realpathSync(binding.entry); } catch { throw new Error("LAUNCHER_ENTRY_UNREADABLE"); }
      if (entry !== binding.entry) throw new Error("LAUNCHER_ENTRY_NOT_PHYSICAL");
      return { physical, entry, pinned: { ...binding, sha256: sha256(text) } };
    }
  }
  return { physical, entry: physical, pinned: null };
}

/** Classify the launcher at `path` without following anything but its own symlink. */
export function inspectLauncher(path: string): InspectedLauncher {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    const linkTarget = readlinkSync(path);
    let target: string;
    try { target = realpathSync(path); } catch { throw new Error("LAUNCHER_TARGET_UNREADABLE"); }
    return { kind: "symlink", linkTarget, target };
  }
  if (!stat.isFile()) return { kind: "foreign" };
  const text = readFileSync(path, "utf8");
  const binding = parsePinnedLauncher(text);
  if (!binding) return { kind: "foreign" };
  return { kind: "pinned", format: binding.format, profile: binding.profile, runtime: binding.runtime, cwd: binding.cwd, target: binding.entry, sha256: sha256(text), text };
}

/** The entry a managed launcher runs, whichever shape it has. */
export function launcherTarget(path: string): string {
  const inspected = inspectLauncher(path);
  if (inspected.kind === "foreign") throw new Error("LAUNCHER_SHAPE_UNSUPPORTED");
  return inspected.target;
}

/** The "link text" of a managed launcher: the symlink text, or the pinned entry path. */
export function launcherLinkText(path: string): string {
  const inspected = inspectLauncher(path);
  if (inspected.kind === "foreign") throw new Error("LAUNCHER_SHAPE_UNSUPPORTED");
  return inspected.kind === "symlink" ? inspected.linkTarget : inspected.target;
}

/** Whether the launcher at `path` is exactly `state`: same shape, text and target. */
export function launcherIs(path: string, state: LauncherState): boolean {
  let inspected: InspectedLauncher;
  try { inspected = inspectLauncher(path); } catch { return false; }
  if (state.shape === "symlink") return inspected.kind === "symlink" && inspected.linkTarget === state.linkTarget && inspected.target === state.target;
  return inspected.kind === "pinned" && inspected.sha256 === state.sha256 && inspected.runtime === state.runtime
    && inspected.cwd === state.cwd && inspected.target === state.target
    && inspected.format === (state.format ?? "v1") && inspected.profile === state.profile;
}

/** The pinned launcher text for a state, verified against the recorded digest. */
export function pinnedLauncherText(state: { runtime: string; cwd: string; target: string; sha256: string } & LauncherMetadata): string {
  if (state.format === "v2") assertLauncherProfile(state.profile);
  const text = renderPinnedLauncher({ runtime: state.runtime, cwd: state.cwd, entry: state.target, format: state.format === undefined ? "v1" : state.format, profile: state.profile });
  if (sha256(text) !== state.sha256) throw new Error("LAUNCHER_TEXT_DIGEST_MISMATCH");
  return text;
}

/** Build the pinned state for an entry under the given Bun binary and trusted directory. */
export function pinnedLauncherState(runtime: string, cwd: string, target: string, metadata: LauncherMetadata = { format: "v2", profile: "client" }): Extract<LauncherState, { shape: "pinned" }> {
  const format = metadata.format === undefined ? "v1" : metadata.format, profile = metadata.profile;
  if (format === "v2") assertLauncherProfile(profile);
  const text = renderPinnedLauncher({ runtime, cwd, entry: target, format, profile });
  return { shape: "pinned", runtime, cwd, target, sha256: sha256(text), format, ...(profile ? { profile } : {}) };
}

/**
 * Create a launcher in `state` at a path that must not exist yet, and read it
 * back. Symlinks are created as-is; pinned launchers are regular 0755 files.
 */
export function materializeLauncher(path: string, state: LauncherState): void {
  if (state.shape === "symlink") {
    symlinkSync(state.linkTarget, path);
    if (readlinkSync(path) !== state.linkTarget || realpathSync(path) !== state.target) throw new Error("LAUNCHER_READBACK_MISMATCH");
    return;
  }
  const text = pinnedLauncherText(state);
  // Create exclusively without following a link, then set the mode on the open
  // descriptor (the umask may have narrowed it) so no other file is touched.
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o755);
  try {
    const bytes = Buffer.from(text, "utf8");
    let written = 0;
    while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
    fchmodSync(fd, 0o755);
    fsyncSync(fd);
    if ((fstatSync(fd).mode & 0o777) !== 0o755) throw new Error("LAUNCHER_READBACK_MISMATCH");
  } finally { closeSync(fd); }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(path, "utf8") !== text) throw new Error("LAUNCHER_READBACK_MISMATCH");
}

/**
 * The Bun binary launchers are pinned to: the exact runtime running the
 * updater, resolved physically and required to be owned by root or the
 * current user, executable, and not writable by group or others.
 */
export function pinnedLauncherRuntime(): string {
  let runtime: string;
  try { runtime = realpathSync(process.execPath); } catch { throw new Error("LAUNCHER_RUNTIME_UNREADABLE"); }
  assertPinnedLauncherRuntimeSafe(runtime);
  assertPinnedLauncherShell();
  return runtime;
}

/** A pinned runtime is a physical, executable regular file owned by root or the current user and not group/world-writable. */
export function assertPinnedLauncherRuntimeSafe(runtime: string): void {
  assertLauncherPath(runtime, "LAUNCHER_RUNTIME_PATH_INVALID");
  let stat;
  try { stat = lstatSync(runtime); } catch { throw new Error("LAUNCHER_RUNTIME_UNSAFE"); }
  const uid = process.getuid?.() ?? -1;
  if (!stat.isFile() || stat.isSymbolicLink() || ![0, uid].includes(stat.uid) || (stat.mode & 0o022) !== 0 || (stat.mode & 0o100) === 0) {
    throw new Error("LAUNCHER_RUNTIME_UNSAFE");
  }
}

/**
 * The launcher depends on `/bin/sh -p`, `/usr/bin/awk` and `/usr/bin/env`.
 * Refuse before any launcher is written when this station's shell rejects
 * `-p` (for example dash before 0.5.11), so no launcher is left unusable.
 */
export function assertPinnedLauncherShell(): void {
  for (const tool of ["/bin/sh", "/usr/bin/awk", "/usr/bin/env"]) {
    let stat;
    try { stat = lstatSync(realpathSync(tool)); } catch { throw new Error("LAUNCHER_SHELL_UNSUPPORTED"); }
    if (!stat.isFile() || (stat.mode & 0o111) === 0) throw new Error("LAUNCHER_SHELL_UNSUPPORTED");
  }
  const probe = Bun.spawnSync(["/bin/sh", "-p", "-c", "exit 0"], { env: {}, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  if (probe.exitCode !== 0) throw new Error("LAUNCHER_SHELL_UNSUPPORTED");
}
