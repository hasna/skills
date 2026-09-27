/**
 * The profile the ENVIRONMENT selected independently of `--profile`.
 *
 * `skills --profile a logout` signs out profile `a`, but a shell that exports
 * `HASNA_PROFILE=b` still selects `b` for the next plain command. Logout has to
 * name that (Instructions rule global-cli-logout-semantics, points 3 and 7), so
 * The two selections stay separate so Secrets can use the ambient profile.
 */
let environmentProfile: string | undefined;

/** Called once by the program's preAction hook. */
export function recordEnvironmentProfile(value: string | undefined): void {
  environmentProfile = value;
}

export function getEnvironmentProfile(): string | undefined {
  return environmentProfile;
}
