/**
 * What a skill version string may look like (hasna/apps#1630).
 *
 * The version becomes a path segment in the version-addressed object key and in the
 * `/versions/:version` routes, so it is a closed alphabet rather than "whatever the
 * publisher sent": no separators, no dot-only names, bounded length. Semver fits; so do
 * date stamps and package-style prereleases.
 */
export const SKILL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export function isValidSkillVersion(value: unknown): boolean {
  return typeof value === "string" && SKILL_VERSION_PATTERN.test(value) && !/^\.+$/.test(value) && !value.includes("..");
}

export const SKILL_VERSION_RULE = "1-128 characters: letters, digits, '.', '_', '+', '-'; must start with a letter or digit; no '..'";
