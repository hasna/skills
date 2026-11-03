/**
 * SH-00057. Fetch the exact locked tarballs of the private packages the consumer
 * fixtures depend on, so each fixture installs them from a local file and never
 * needs the npm token.
 *
 * This runs inside the dependency install step, the only step that holds
 * NPM_READ_TOKEN (Andrei's full-access token). It is Node with node: builtins
 * only, so no third-party code runs while the token is in the environment. Each
 * tarball is checked against bun.lock's integrity before it is written; the
 * manifest it writes holds paths and integrities, never the token.
 *
 * usage: node scripts/fetch-locked-private.mjs --out <directory>   (from apps/skills)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The private packages the packed archive's consumers install. */
export const PRIVATE_PACKAGES = ["@hasna/secrets"];
export const MANIFEST_NAME = "private-tarballs.json";

/** The one top-level bun.lock entry for a package: its version, integrity and registry tarball URL. */
export function lockedTarball(lockText, name) {
  const key = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const entry = new RegExp(`^    "${key}": \\["${key}@([0-9][^"]*)", "", \\{.*\\}, "(sha512-[A-Za-z0-9+/]+={0,2})"\\],?$`, "gm");
  const found = [...lockText.matchAll(entry)];
  if (found.length !== 1) throw new Error(`expected exactly one locked ${name} entry in bun.lock, found ${found.length}`);
  const [, version, integrity] = found[0];
  const base = name.slice(name.indexOf("/") + 1);
  return { name, version, integrity, url: `https://registry.npmjs.org/${name}/-/${base}-${version}.tgz`, file: `${name.slice(1).replace("/", "-")}-${version}.tgz` };
}

export function integrityOf(bytes) {
  return "sha512-" + createHash("sha512").update(bytes).digest("base64");
}

async function main(argv) {
  const at = argv.indexOf("--out");
  if (at < 0 || !argv[at + 1]) throw new Error("usage: fetch-locked-private.mjs --out <directory>");
  const out = resolve(argv[at + 1]);
  const token = process.env.NPM_READ_TOKEN;
  if (!token) throw new Error("NPM_READ_TOKEN is not set");
  const lockText = readFileSync("bun.lock", "utf8");
  mkdirSync(out, { recursive: true, mode: 0o755 });
  const manifest = {};
  for (const name of PRIVATE_PACKAGES) {
    const locked = lockedTarball(lockText, name);
    const response = await fetch(locked.url, {
      headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`${name}@${locked.version}: registry answered HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const integrity = integrityOf(bytes);
    if (integrity !== locked.integrity) throw new Error(`${name}@${locked.version}: tarball integrity differs from bun.lock`);
    const path = join(out, locked.file);
    writeFileSync(path, bytes, { flag: "wx", mode: 0o644 });
    manifest[name] = { version: locked.version, integrity, path };
    console.log(`${name}@${locked.version} ${integrity} ${path}`);
  }
  writeFileSync(join(out, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o644 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`fetch-locked-private: ${error.message}`); process.exit(1); });
}
