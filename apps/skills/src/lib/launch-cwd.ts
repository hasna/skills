// Pinned launchers start Bun from a trusted directory (`--cwd=<runtime>`) so
// that no working-directory configuration is read at startup, and hand the
// caller's real directory over in HASNA_SKILLS_LAUNCH_CWD. Bun has finished
// reading bunfig.toml, .env and tsconfig.json by the time module code runs, so
// returning to the caller's directory here keeps relative paths working while
// that configuration stays unread. Entries call this before any other work.

export const LAUNCH_CWD_VARIABLE = "HASNA_SKILLS_LAUNCH_CWD";

export function restoreLaunchCwd(env: Record<string, string | undefined> = process.env): { restored: boolean; cwd: string } {
  const requested = env[LAUNCH_CWD_VARIABLE];
  delete env[LAUNCH_CWD_VARIABLE];
  if (!requested || !requested.startsWith("/")) return { restored: false, cwd: process.cwd() };
  try {
    process.chdir(requested);
    return { restored: true, cwd: process.cwd() };
  } catch {
    // The caller's directory vanished or is unreadable; stay in the trusted one.
    return { restored: false, cwd: process.cwd() };
  }
}
