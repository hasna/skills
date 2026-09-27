/**
 * Settings that used to select a deployment mode, and the refusal they now produce.
 *
 * Skills once declared a three-way deployment axis as a label: running on this
 * machine, running against a server somebody operates, running against a
 * vendor-operated one. That axis is gone. Two facts replaced it, and both are read
 * from the configuration itself rather than from a declaration about it:
 *
 *   - a server keeps its data in SQLite or in PostgreSQL, decided by the database
 *     string it is given (see server/database-url.ts);
 *   - a client either has an API origin configured or it does not (see
 *     lib/api-url.ts).
 *
 * Deleting the label was not sufficient on its own, and this module is the half
 * that was left. A retired setting which is merely *unread* is the worse of the
 * two failures: an operator who exports a storage-mode variable gets a process on
 * the default SQLite database with no indication that the thing they configured
 * was discarded, and silence there is indistinguishable from success. That is how
 * a deployment ends up writing to a file nobody is backing up. So a retired
 * setting is refused, and the refusal names what replaced it.
 *
 * MATCHED BY SHAPE, NOT BY A LIST OF NAMES. The retired axis was spelled several
 * ways at once across the estate - two prefixes, and both `storage` and
 * `deployment` as the middle word - so enumerating the spellings we happen to
 * remember would let the next one through silently, which is the failure being
 * fixed. A suffix match catches every prefix variant, including ones this repo
 * never used itself.
 *
 * Two discriminations keep that shape from doing damage:
 *
 *   - The suffixes are narrow. `*_MODE` alone would swallow live, unrelated
 *     settings - SKILLS_TEST_MODE gates self-update in the suite, and SQLite's
 *     journal mode is a mode - so only the three that named the removed
 *     deployment axis appear below. Anything else called mode is a different axis
 *     and none of this module's business.
 *   - The match is scoped to this application's variables. Sibling Hasna apps are
 *     mid-removal on the same axis and their variables are present in the same
 *     shell; refusing to start because a *different* app still exports one would
 *     turn this fix into an outage. The caller supplies the token that identifies
 *     its own namespace.
 */

/** Suffix of every environment variable that named the removed deployment axis. */
const RETIRED_ENV_SUFFIXES = ["_STORAGE_MODE", "_DEPLOYMENT_MODE", "_CLOUD_MODE"] as const;

/**
 * Configuration-file keys that named the removed deployment axis, and the key
 * that replaces each one.
 *
 * A key is retired whatever its value: the fault is asking for a deployment label
 * at all, not asking for a particular one. Listing values instead would accept
 * `mode: "onprem"` while rejecting `mode: "cloud"`, which teaches the reader that
 * the concept survived and only some spellings of it are wrong.
 */
export const RETIRED_CONFIG_KEYS: Readonly<Record<string, string>> = {
  mode: "a configured API origin",
  apiUrl: "skills setup --api-url <origin>",
};

/**
 * What each retired key's replacement means, so the refusal explains the change
 * instead of only naming a successor.
 *
 * `apiUrl` is retired for a different reason than `mode`: it was not a label
 * about the deployment, it was a SIXTH place to keep the service address, in a
 * file only this app reads. The fleet ladder (owner ruling 2026-09-04,
 * hasna/apps#1720) is `HASNA_SKILLS_API_URL`, the macOS Keychain `api-url` item,
 * `~/.hasna/skills/config/credentials`, then the fleet gateway — shared with
 * every other Hasna CLI through @hasna/contracts. `skills setup --api-url`
 * still exists and writes the credentials file.
 */
const RETIRED_CONFIG_KEY_REASONS: Readonly<Record<string, string>> = {
  mode:
    "Deployment modes were removed: a Skills client either resolves a credential " +
    "or it does not, and that is the whole of it.",
  apiUrl:
    "The service address is no longer kept in this app's config file: it is read from " +
    "HASNA_SKILLS_API_URL, then the macOS Keychain item hasna.credentials.skills.api-url, " +
    "then ~/.hasna/skills/config/credentials, then the fleet gateway.",
};

/** Thrown when configuration names a setting the deployment-mode removal deleted. */
export class RetiredSettingError extends Error {
  readonly code = "RETIRED_SETTING";

  /** The retired setting, spelled as the operator wrote it. */
  readonly setting: string;

  constructor(setting: string, message: string) {
    super(message);
    this.name = "RetiredSettingError";
    this.setting = setting;
  }
}

/**
 * Whether an environment variable names the removed deployment axis for `app`.
 *
 * @param app token identifying the calling application's variable namespace, so
 * a sibling app's not-yet-removed variable is left alone.
 */
export function isRetiredModeEnvVar(name: string, app: string): boolean {
  const upper = name.toUpperCase();
  if (!upper.includes(app.toUpperCase())) return false;
  return RETIRED_ENV_SUFFIXES.some((suffix) => upper.endsWith(suffix));
}

/**
 * Every retired deployment-axis variable for `app` that is actually set.
 *
 * An empty string counts as unset. `export FOO="$BAR"` with BAR unset is what
 * collapses to that, and refusing it would fail a deployment over a value nobody
 * chose.
 */
export function findRetiredModeEnvVars(
  env: Record<string, string | undefined>,
  app: string,
): { name: string; value: string }[] {
  const found: { name: string; value: string }[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue;
    if (isRetiredModeEnvVar(name, app)) found.push({ name, value });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Refuse if the environment names the removed deployment axis.
 *
 * `replacement` is supplied by the caller rather than hardcoded here so the name
 * stays owned by the module that reads it, and so this module needs no imports
 * and can be called from anywhere without an import cycle.
 *
 * @throws RetiredSettingError naming the retired variables, their replacement,
 * and the fix.
 */
export function assertNoRetiredModeEnvVars(
  env: Record<string, string | undefined>,
  options: { app: string; replacement: string },
): void {
  const found = findRetiredModeEnvVars(env, options.app);
  if (found.length === 0) return;

  const names = found.map((entry) => entry.name);
  throw new RetiredSettingError(
    names[0] as string,
    `${names.join(", ")} ${names.length === 1 ? "is" : "are"} no longer read. ` +
      "Deployment modes were removed: where a server keeps its data is decided by the " +
      `database it is given, not by a declared label. Set ${options.replacement} to a ` +
      "postgres:// URL to use PostgreSQL, or leave it unset for the on-box SQLite database. " +
      `Then unset ${names.join(" and ")}. ` +
      "Refused rather than ignored, because a discarded setting looks exactly like a " +
      "working one until something needs the data.",
  );
}

/**
 * Refuse if a configuration object carries a retired deployment-axis key.
 *
 * @param source where the object came from - a file path, or the command that
 * supplied it - so the message points at the thing the operator has to change
 * rather than at "your configuration".
 *
 * @throws RetiredSettingError naming the retired key, its replacement, and the fix.
 */
export function assertNoRetiredConfigKeys(
  config: Record<string, unknown>,
  source: string,
): void {
  for (const [key, replacement] of Object.entries(RETIRED_CONFIG_KEYS)) {
    if (!(key in config)) continue;
    throw new RetiredSettingError(
      key,
      `${source}: "${key}" is no longer a configuration key. ` +
        `${RETIRED_CONFIG_KEY_REASONS[key] ?? ""} ` +
        `Use ${replacement} instead, and remove the old key with: skills config unset ${key}. ` +
        "Refused rather than ignored, because silently dropping it would leave an " +
        "operator believing they had pointed this install at a server.",
    );
  }
}
