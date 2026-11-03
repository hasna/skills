/**
 * Read access to the private Hasna packages (@hasna/secrets) for CI installs.
 *
 * The workflows set NPM_READ_TOKEN only on the steps that install. A consumer
 * fixture's install command gets the variable in its own environment and an npm
 * config holding only the literal `${NPM_READ_TOKEN}` reference, which bun and
 * npm expand themselves; the value is never written to disk, and nothing else a
 * fixture runs (the installed MCP, floating third-party packages) sees it.
 * Without the variable, as on a developer machine or a pull request from a
 * fork, nothing changes and the install stays anonymous.
 */
export const READ_TOKEN_ENV = "NPM_READ_TOKEN";

/** The npm config line that authenticates registry.npmjs.org through the variable, never its value. */
export const READ_TOKEN_NPMRC = "//registry.npmjs.org/:_authToken=${NPM_READ_TOKEN}\n";

/**
 * What an install command needs: `env` with the variable added when the CI step
 * provides it, and `npmrc` text to append to that install's own npm config
 * (empty when there is no token).
 */
export function installReadAuth(env: Record<string, string>, source: Record<string, string | undefined> = process.env): { env: Record<string, string>; npmrc: string } {
  const token = source[READ_TOKEN_ENV];
  return token ? { env: { ...env, [READ_TOKEN_ENV]: token }, npmrc: READ_TOKEN_NPMRC } : { env, npmrc: "" };
}
