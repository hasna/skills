#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * SH-00058. The build bundles third-party packages into bin/ and dist/, and
 * their licences (MIT, Apache-2.0, ISC, BSD-3-Clause) require their notices to
 * travel with every distribution. This writes THIRD_PARTY_NOTICES from the
 * bundle's own module markers (`// node_modules/<package>/<file>`, one per
 * bundled module), so it lists exactly what the build bundled, each package with
 * the licence and notice files it ships. Our own @hasna packages are not third
 * party. A package whose npm tarball ships no licence file takes the one a
 * bundled package from the same repository ships, or else its upstream licence
 * file, kept in scripts/third-party-licences/ with its source. Anything else
 * fails the build.
 *
 * usage: bun scripts/third-party-notices.ts [--out <file>]   (after the bun builds)
 */
export const NOTICES_FILE = "THIRD_PARTY_NOTICES";
export const OWN_SCOPE = "@hasna/";
const MARKER = /^\/\/ (.*node_modules\/(?:@[^/\s]+\/)?[^/\s]+)\//gm;
const LICENCE_FILE = /^(?:licen[cs]e|copying)(?:[-._][^/]*)?$/i;
const NOTICE_FILE = /^notice(?:\.(?:md|txt))?$/i;
/** Upstream licence files for bundled packages whose npm tarball ships none, fetched on 4 November 2026. */
export const UPSTREAM_LICENCES: Record<string, { file: string; source: string }> = {
  "@alcalzone/ansi-tokenize": { file: "alcalzone-ansi-tokenize.LICENSE", source: "https://github.com/AlCalzone/ansi-tokenize/blob/master/LICENSE" },
  "yoga-layout": { file: "yoga-layout.LICENSE", source: "https://github.com/facebook/yoga/blob/main/LICENSE" },
};

/** Every built JavaScript file under bin/ and dist/. */
export function builtModules(packageRoot: string): string[] {
  return ["bin", "dist"].flatMap(directory => existsSync(join(packageRoot, directory))
    ? (readdirSync(join(packageRoot, directory), { recursive: true }) as string[])
      .filter(entry => entry.endsWith(".js")).map(entry => join(packageRoot, directory, entry)).sort()
    : []);
}

/** The installed directory of each bundled package, relative to the build root, from the module markers. */
export function bundledPackageDirectories(packageRoot: string): string[] {
  const directories = new Set<string>();
  for (const file of builtModules(packageRoot))
    for (const match of readFileSync(file, "utf8").matchAll(MARKER)) directories.add(match[1]!);
  return [...directories].sort();
}

/** The package name a node_modules directory holds. */
export function packageNameOf(directory: string): string {
  return directory.slice(directory.lastIndexOf("node_modules/") + "node_modules/".length);
}

function licenceOf(manifest: Record<string, unknown>): string {
  const value = manifest.license ?? manifest.licenses;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(item => (item as { type?: string }).type ?? String(item)).join(" OR ");
  if (value && typeof value === "object") return String((value as { type?: unknown }).type ?? "UNKNOWN");
  return "UNKNOWN";
}

function repositoryOf(manifest: Record<string, unknown>): string | null {
  const value = manifest.repository;
  const url = typeof value === "string" ? value : (value as { url?: unknown } | undefined)?.url;
  return typeof url === "string" && url ? url.replace(/^git\+/, "") : null;
}

/** One spelling per repository: host/owner/name, lower case. */
function repositoryKey(url: string | null): string | null {
  if (!url) return null;
  const key = url.toLowerCase().replace(/^(?:git\+)?(?:[a-z]+:\/\/)?(?:git@)?/, "").replace(/^([^/:]+):/, "$1/").replace(/\.git$/, "").replace(/\/+$/, "");
  return /^[^/]+\/[^/]+\/[^/]+$/.test(key) ? key : null;
}

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n?/g, "\n").trim() + "\n";

export function renderNotices(packageRoot: string): string {
  const own = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { name: string; version: string };
  const packages = bundledPackageDirectories(packageRoot).filter(directory => !packageNameOf(directory).startsWith(OWN_SCOPE)).map(directory => {
    const absolute = join(packageRoot, directory);
    const manifest = JSON.parse(readFileSync(join(absolute, "package.json"), "utf8")) as Record<string, unknown>;
    const files = readdirSync(absolute).filter(name => statSync(join(absolute, name)).isFile()).sort();
    return { directory, absolute, manifest, name: String(manifest.name), version: String(manifest.version), repository: repositoryOf(manifest),
      licences: files.filter(name => LICENCE_FILE.test(name)), notices: files.filter(name => NOTICE_FILE.test(name)) };
  });
  const byRepository = new Map<string, (typeof packages)[number]>();
  for (const item of packages) {
    const key = repositoryKey(item.repository);
    if (key && item.licences.length && !byRepository.has(key)) byRepository.set(key, item);
  }
  const entries = new Map<string, string>();
  const missing: string[] = [];
  for (const item of packages) {
    let licence: string[], provenance: string | null = null;
    const sibling = byRepository.get(repositoryKey(item.repository) ?? "");
    const upstream = UPSTREAM_LICENCES[item.name];
    if (item.licences.length) licence = item.licences.map(name => read(join(item.absolute, name)));
    else if (sibling) {
      licence = sibling.licences.map(name => read(join(sibling.absolute, name)));
      provenance = `Licence text: its npm package ships none; this is the file ${sibling.name} ${sibling.version} ships from the same repository.`;
    } else if (upstream) {
      licence = [read(join(import.meta.dir, "third-party-licences", upstream.file))];
      provenance = `Licence text: its npm package ships none; this is the upstream file ${upstream.source}.`;
    } else { missing.push(`${item.name}@${item.version} (${item.directory})`); continue; }
    entries.set(`${item.name}\0${item.version}`, [
      `${item.name} ${item.version}`,
      `License: ${licenceOf(item.manifest)}`,
      ...(item.repository ? [`Source: ${item.repository}`] : []),
      ...(provenance ? [provenance] : []),
      "",
      ...licence, ...item.notices.map(name => read(join(item.absolute, name))),
    ].join("\n"));
  }
  if (missing.length) throw new Error(`Bundled packages ship no licence text and have no recorded upstream licence: ${missing.join(", ")}`);
  const keys = [...entries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rule = "=".repeat(80);
  return [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    `${own.name} ${own.version} bundles the ${keys.length} third-party packages below into its bin/ and dist/ files.`,
    "Each is listed with its licence and the licence and notice text it ships with.",
    "",
    ...keys.flatMap(key => [rule, entries.get(key)!]),
  ].join("\n");
}

if (import.meta.main) {
  const packageRoot = resolve(import.meta.dir, "..");
  const at = process.argv.indexOf("--out");
  const out = at > 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]!) : join(packageRoot, NOTICES_FILE);
  const text = renderNotices(packageRoot);
  writeFileSync(out, text);
  console.log(`${relative(process.cwd(), out) || out}: ${text.split("\n").filter(line => line === "=".repeat(80)).length} bundled third-party packages`);
}
