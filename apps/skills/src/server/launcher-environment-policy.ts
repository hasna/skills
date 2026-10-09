// The server owns storage environment policy, including the exact historical
// V1 launcher format needed to restore installed fleet launchers and receipts.
// V1 is frozen; new client launchers use V2 and exclude every storage locator.
export const LEGACY_PINNED_LAUNCHER_SCHEMA = "hasna-skills-pinned-launcher-v1";

/** The variable the launcher uses to hand the caller's directory to the CLI. */
const LAUNCH_CWD_VARIABLE = "HASNA_SKILLS_LAUNCH_CWD";

/** Bun runtime flags that remove every working-directory configuration source. */
const PINNED_LAUNCHER_BUN_FLAGS = ["--config=/dev/null", "--no-env-file", "--no-macros", "--no-install"] as const;

/**
 * Environment names passed through `env -i`, by exact name. Everything else,
 * including `BUN_*`, `NODE_OPTIONS`, `DYLD_*`, `LD_*` and proxy settings, is
 * dropped. The handling is total on purpose: a name is either listed here,
 * matches a prefix below, or never reaches the runtime.
 */
const LEGACY_ENV_NAMES = [
  "HOME", "PATH", "TMPDIR", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORTERM", "LANG", "USER", "LOGNAME", "SHELL", "TZ",
  "NO_COLOR", "FORCE_COLOR", "CI", "COLUMNS", "LINES", "EDITOR", "VISUAL", "PAGER", "SSH_AUTH_SOCK", "DATABASE_URL",
  "TERMINAL_CWD", "CODEX_HOME", "HERMES_HOME", "HERMES_ENABLE_PROJECT_PLUGINS",
  // Settings the pinned server, worker and publish entries read by these bare names
  // (src/server/config.ts, src/server/runtime-worker.ts, src/cli/commands/publish.ts).
  "HOST", "PORT", "NODE_ENV", "AGENT_ID", "ECS_CONTAINER_METADATA_URI_V4",
] as const;

/** Environment name prefixes passed through, for the app's own documented overrides. */
const LEGACY_ENV_PREFIXES = ["HASNA", "SKILLS", "SKILL", "MCP", "XDG", "LC", "AWS"] as const;

export function renderLegacyPinnedLauncher(binding: { runtime: string; cwd: string; entry: string }): string {
  const names = LEGACY_ENV_NAMES.join(" ");
  const prefixes = LEGACY_ENV_PREFIXES.join("|");
  return [
    "#!/bin/sh -p",
    `# ${LEGACY_PINNED_LAUNCHER_SCHEMA}`,
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

export const SERVER_LAUNCHER_ENV_NAMES = ["DATABASE_URL"] as const;
export const STORAGE_LOCATOR_ENV_NAMES = ["DATABASE_URL", "HASNA_SKILLS_DATABASE_URL", "SKILLS_DATABASE_URL"] as const;
const storageLocators = new Set<string>(STORAGE_LOCATOR_ENV_NAMES);
export function isStorageLocatorEnvironmentName(name: string): boolean {
  return storageLocators.has(name);
}
/** The same deny rule used in V2 client's JS projection and shell projection. */
export const CLIENT_LAUNCHER_STORAGE_DENY_AWK = `    if (name == "DATABASE_URL" || name == "HASNA_SKILLS_DATABASE_URL" || name == "SKILLS_DATABASE_URL") continue`;
