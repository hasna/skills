// Pinned launcher shape for the copyfile runtime updater.
//
// A bare symlink to `bin/index.js` runs `#!/usr/bin/env bun`, so whatever Bun
// is first on PATH starts with the caller's working directory as its config
// root: a hostile `bunfig.toml` preload, a `.env`, a `tsconfig.json` paths
// hijack, or a `BUN_OPTIONS` value in the environment all run before the CLI
// does. The updater therefore writes every launcher it manages as a small
// POSIX sh file that execs one exact Bun binary on one exact entry, from one
// trusted working directory, with no working-directory configuration and a
// total environment allowlist. This is the shape the fleet's native MCP and
// hook launchers use (`env -i HOME= PATH= <bun> --config=/dev/null
// --no-env-file --no-macros --no-install --cwd=<trusted> <entry>`); the CLI
// restores the caller's directory itself from HASNA_SKILLS_LAUNCH_CWD.
//
// Two launcher shapes exist on a station: the legacy `symlink` and `pinned`.
// Receipts record both the old and the new state of each launcher, so a
// rollback restores the exact prior shape whichever it was.
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const PINNED_LAUNCHER_SCHEMA = "hasna-skills-pinned-launcher-v1";

/** The variable the launcher uses to hand the caller's directory to the CLI. */
export const LAUNCH_CWD_VARIABLE = "HASNA_SKILLS_LAUNCH_CWD";

/** Bun runtime flags that remove every working-directory configuration source. */
export const PINNED_LAUNCHER_BUN_FLAGS = ["--config=/dev/null", "--no-env-file", "--no-macros", "--no-install"] as const;

/**
 * Environment names passed through `env -i`, by exact name. Everything else,
 * including `BUN_*`, `NODE_OPTIONS`, `DYLD_*`, `LD_*` and proxy settings, is
 * dropped. The handling is total on purpose: a name is either listed here,
 * matches a prefix below, or never reaches the runtime.
 */
export const PINNED_LAUNCHER_ENV_NAMES = [
  "HOME", "PATH", "TMPDIR", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORTERM", "LANG", "USER", "LOGNAME", "SHELL", "TZ",
  "NO_COLOR", "FORCE_COLOR", "CI", "COLUMNS", "LINES", "EDITOR", "VISUAL", "PAGER", "SSH_AUTH_SOCK", "DATABASE_URL",
  "TERMINAL_CWD", "CODEX_HOME", "HERMES_HOME", "HERMES_ENABLE_PROJECT_PLUGINS",
] as const;

/** Environment name prefixes passed through, for the app's own documented overrides. */
export const PINNED_LAUNCHER_ENV_PREFIXES = ["HASNA", "SKILLS", "SKILL", "MCP", "XDG", "LC", "AWS"] as const;

export type LauncherShape = "symlink" | "pinned";

export interface PinnedLauncherBinding { runtime: string; cwd: string; entry: string }

export type LauncherState =
  | { shape: "symlink"; linkTarget: string; target: string }
  | { shape: "pinned"; runtime: string; cwd: string; target: string; sha256: string };

export type InspectedLauncher =
  | { kind: "symlink"; linkTarget: string; target: string }
  | { kind: "pinned"; runtime: string; cwd: string; target: string; sha256: string; text: string }
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
  const names = PINNED_LAUNCHER_ENV_NAMES.join(" ");
  const prefixes = PINNED_LAUNCHER_ENV_PREFIXES.join("|");
  return [
    "#!/bin/sh",
    `# ${PINNED_LAUNCHER_SCHEMA}`,
    "# Written by `skills self-update`; rewrite it with `skills self-update`, do not edit by hand.",
    "# Runs the exact Skills entry below under one exact Bun from one trusted directory with",
    "# no working-directory configuration (no bunfig.toml, no .env, no macros, no auto-install)",
    "# and only the environment names allowed here. Everything else, BUN_* and NODE_OPTIONS",
    "# included, never reaches the runtime. The CLI returns to the caller's directory itself.",
    "set -eu",
    `${LAUNCH_CWD_VARIABLE}=$(pwd -P 2>/dev/null || :)`,
    `export ${LAUNCH_CWD_VARIABLE}`,
    `set -- '${binding.runtime}' ${PINNED_LAUNCHER_BUN_FLAGS.join(" ")} '--cwd=${binding.cwd}' '${binding.entry}' "$@"`,
    "hasna_skills_env=$(LC_ALL=C /usr/bin/awk 'BEGIN {",
    `  n = split("${names}", exact, " ")`,
    "  for (i = 1; i <= n; i++) allow[exact[i]] = 1",
    "  for (name in ENVIRON) {",
    "    if (name !~ /^[A-Za-z_][A-Za-z0-9_]*$/) continue",
    `    if (!(name in allow) && name !~ /^(${prefixes})_/) continue`,
    "    value = ENVIRON[name]; quoted = \"\"",
    "    while ((k = index(value, \"\\047\")) > 0) { quoted = quoted substr(value, 1, k - 1) \"\\047\\\\\\047\\047\"; value = substr(value, k + 1) }",
    "    printf \"\\047%s=%s\\047 \", name, quoted value",
    "  }",
    "}')",
    "eval \"set -- $hasna_skills_env \\\"\\$@\\\"\"",
    "exec /usr/bin/env -i \"$@\"",
    "",
  ].join("\n");
}

const COMMAND_LINE = new RegExp(`^set -- '([^']+)' ${PINNED_LAUNCHER_BUN_FLAGS.join(" ")} '--cwd=([^']+)' '([^']+)' "\\$@"$`, "m");

/** Parse launcher text; only the exact rendered shape is accepted. */
export function parsePinnedLauncher(text: string): PinnedLauncherBinding | null {
  const match = COMMAND_LINE.exec(text);
  if (!match) return null;
  const binding = { runtime: match[1]!, cwd: match[2]!, entry: match[3]! };
  try { if (renderPinnedLauncher(binding) !== text) return null; } catch { return null; }
  return binding;
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
  return { kind: "pinned", runtime: binding.runtime, cwd: binding.cwd, target: binding.entry, sha256: sha256(text), text };
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
    && inspected.cwd === state.cwd && inspected.target === state.target;
}

/** The pinned launcher text for a state, verified against the recorded digest. */
export function pinnedLauncherText(state: { runtime: string; cwd: string; target: string; sha256: string }): string {
  const text = renderPinnedLauncher({ runtime: state.runtime, cwd: state.cwd, entry: state.target });
  if (sha256(text) !== state.sha256) throw new Error("LAUNCHER_TEXT_DIGEST_MISMATCH");
  return text;
}

/** Build the pinned state for an entry under the given Bun binary and trusted directory. */
export function pinnedLauncherState(runtime: string, cwd: string, target: string): Extract<LauncherState, { shape: "pinned" }> {
  const text = renderPinnedLauncher({ runtime, cwd, entry: target });
  return { shape: "pinned", runtime, cwd, target, sha256: sha256(text) };
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
  writeFileSync(path, text, { flag: "wx", mode: 0o755 });
  chmodSync(path, 0o755);
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
  assertLauncherPath(runtime, "LAUNCHER_RUNTIME_PATH_INVALID");
  const stat = lstatSync(runtime);
  const uid = process.getuid?.() ?? -1;
  if (!stat.isFile() || stat.isSymbolicLink() || ![0, uid].includes(stat.uid) || (stat.mode & 0o022) !== 0 || (stat.mode & 0o100) === 0) {
    throw new Error("LAUNCHER_RUNTIME_UNSAFE");
  }
  return runtime;
}
