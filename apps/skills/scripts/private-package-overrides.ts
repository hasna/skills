import { readFileSync } from "node:fs";

import { integrityOf, MANIFEST_NAME } from "./fetch-locked-private.mjs";

/**
 * SH-00057. In CI the dependency install step fetches the locked private
 * tarballs (scripts/fetch-locked-private.mjs) and names their manifest in
 * SKILLS_PRIVATE_TARBALLS. A consumer fixture adds these `overrides` to its
 * package.json, so bun and npm install each private package from that local,
 * integrity-checked file and no fixture needs the npm token. Without the
 * variable, as on a developer machine, there are no overrides and the install
 * resolves from the registry as before.
 */
export const PRIVATE_TARBALLS_ENV = "SKILLS_PRIVATE_TARBALLS";

export function privatePackageOverrides(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const manifestPath = source[PRIVATE_TARBALLS_ENV];
  if (!manifestPath) return {};
  if (!manifestPath.endsWith(`/${MANIFEST_NAME}`)) throw new Error(`${PRIVATE_TARBALLS_ENV} must name a ${MANIFEST_NAME}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, { integrity: string; path: string }>;
  const overrides: Record<string, string> = {};
  for (const [name, { integrity, path }] of Object.entries(manifest)) {
    // Re-check the bytes: steps between the install and the fixture run tests and builds.
    if (integrityOf(readFileSync(path)) !== integrity) throw new Error(`${name}: the private tarball changed after it was fetched`);
    overrides[name] = `file:${path}`;
  }
  return overrides;
}
