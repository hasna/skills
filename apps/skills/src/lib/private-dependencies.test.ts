import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SH-00058. The public registry refuses an anonymous read of a private package,
// so a required dependency on one fails every anonymous install of the published
// archive. npm pack ships this package.json as the packed manifest; each private
// package may appear in it only as an optional dependency. The packed archive
// itself is checked by scripts/consumer-anonymous.ts.
const root = join(import.meta.dir, "../..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;

test("each private package is only an optional dependency of the published manifest", async () => {
  const { PRIVATE_PACKAGES } = await import(join(root, "scripts/fetch-locked-private.mjs")) as { PRIVATE_PACKAGES: string[] };
  expect(PRIVATE_PACKAGES).toContain("@hasna/secrets");
  for (const name of PRIVATE_PACKAGES) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
      const value = manifest[field] as Record<string, string> | string[] | undefined;
      expect(Array.isArray(value) ? value.includes(name) : Boolean(value && name in value), `${name} in ${field}`).toBe(false);
    }
    expect((manifest.optionalDependencies as Record<string, string> | undefined)?.[name], `${name} in optionalDependencies`).toMatch(/^\d+\.\d+\.\d+$/);
  }
});

test("every bun build in the package scripts keeps @hasna/secrets external", () => {
  const builds = Object.values(manifest.scripts as Record<string, string>)
    .flatMap(script => script.split("&&").map(step => step.trim()).filter(step => step.startsWith("bun build ")));
  expect(builds.length).toBeGreaterThanOrEqual(8);
  for (const step of builds) expect(step, step).toContain("--external @hasna/secrets ");
});
