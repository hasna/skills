import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Install the dedicated Sumi path-plan contract for one synthetic test home.
 * Keep this opt-in: tests for a particular non-Sumi adapter must not inherit a
 * fake provider and accidentally conceal an eager Sumi lookup.
 */
export function installSumiPathsFixture(home: string): string {
  const bin = join(home, ".test-sumi-bin");
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const executable = join(bin, "sumi-paths");
  const source = `#!${process.execPath}
import { resolve, join, isAbsolute } from "node:path";
const args = process.argv.slice(2);
const home = resolve(args[args.indexOf("--home") + 1] ?? "");
const cwd = resolve(args[args.indexOf("--cwd") + 1] ?? "");
if (!isAbsolute(home) || !isAbsolute(cwd)) process.exit(2);
if (process.env.SUMI_CONFIG !== undefined || process.env.SUMI_CONFIG_CONTENT !== undefined) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, kind: "sumi-paths-error", code: "SUMI_PATH_CONFIG_UNSUPPORTED" }));
  process.exit(2);
}
const selected = value => value?.trim() ? value : undefined;
const expand = value => resolve(cwd, value === "~" ? home : value.startsWith("~/") || value.startsWith("~\\\\") ? resolve(home, value.slice(2)) : value);
const custom = selected(process.env.SUMI_HOME);
const root = expand(custom ?? resolve(home, ".hasna-internal", "sumi"));
const old = { data: ".local/share", cache: ".cache", config: ".config", state: ".local/state" };
const locations = Object.fromEntries(["data", "cache", "config", "state"].map(kind => {
  const explicit = kind === "config" ? selected(process.env.SUMI_CONFIG_DIR) : undefined;
  const xdg = selected(process.env["XDG_" + kind.toUpperCase() + "_HOME"]);
  return [kind, { canonical: explicit ? expand(explicit) : xdg ? join(expand(xdg), "sumi") : join(root, kind), legacy: explicit || xdg || custom ? null : join(home, old[kind], "sumi") }];
}));
const roots = Object.fromEntries(Object.entries(locations).map(([key, value]) => [key, value.canonical]));
const legacyRoots = Object.fromEntries(Object.entries(locations).map(([key, value]) => [key, value.legacy]));
const plan = { schemaVersion: 1, kind: "sumi-paths", home, cwd, roots, legacyRoots,
  configFiles: { canonical: join(roots.config, "sumi.json"), legacy: legacyRoots.config === null ? null : join(legacyRoots.config, "sumi.json") },
  skillRoots: { canonical: join(roots.config, "skills"), legacy: legacyRoots.config === null ? null : join(legacyRoots.config, "skills") } };
process.stdout.write(JSON.stringify(plan));
`;
  writeFileSync(executable, source, { mode: 0o700 });
  chmodSync(executable, 0o700);
  return bin;
}
