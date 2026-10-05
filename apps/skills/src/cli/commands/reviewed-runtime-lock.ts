import { createHash } from "node:crypto";

type Row = Record<string, unknown>;
export interface ReviewedRuntimeLockContext {
  version: string;
  archiveIntegrity: string;
  packageManifest: Row;
  registryOrigin: string;
  minReleaseAge: number;
  minReleaseAgeExclude: string[];
  fetcher?: typeof fetch;
  now?: number;
}

const PACKAGE = "@hasna/skills";
const NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;
const MAX_BYTES = 8 * 1024 * 1024;

function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("REVIEWED_LOCK_SHAPE_INVALID");
  return value as Row;
}

function same(a: unknown, b: unknown): boolean {
  const entries = (v: unknown) => Object.entries(row(v ?? {})).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries(a)) === JSON.stringify(entries(b));
}

function packageName(path: string): string {
  // Every ancestor is an actual npm installation location; no traversal,
  // links, platform separators, absolute paths or sibling content is allowed.
  const parts = path.split("/node_modules/");
  if (!parts[0].startsWith("node_modules/")) throw new Error("REVIEWED_LOCK_LOCATION_INVALID");
  parts[0] = parts[0].slice("node_modules/".length);
  if (parts.some(name => !NAME.test(name) || name.split("/").some(part => part === "." || part === ".."))) throw new Error("REVIEWED_LOCK_LOCATION_INVALID");
  return parts.at(-1)!;
}

function excluded(name: string, patterns: string[]): boolean {
  return patterns.some(pattern => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(name));
}

async function metadata(name: string, context: ReviewedRuntimeLockContext): Promise<Row> {
  const url = new URL(encodeURIComponent(name), `${context.registryOrigin}/`);
  const response = await (context.fetcher ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error("REVIEWED_LOCK_METADATA_UNAVAILABLE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("REVIEWED_LOCK_METADATA_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return row(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { throw new Error("REVIEWED_LOCK_METADATA_INVALID"); }
}

/** Validate the immutable install input without resolving any version ranges.
 * npm ci subsequently verifies archive bytes and package/root range agreement;
 * npm ls validates the real installed required closure, including optional peers.
 */
export async function validateReviewedRuntimeLock(bytes: Uint8Array, sha256: string, context: ReviewedRuntimeLockContext): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("REVIEWED_LOCK_SHA256_INVALID");
  if (bytes.byteLength > MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("REVIEWED_LOCK_HASH_MISMATCH");
  if (!Number.isSafeInteger(context.minReleaseAge) || context.minReleaseAge < 1) throw new Error("REVIEWED_LOCK_RELEASE_AGE_REQUIRED");
  let lock: Row;
  try { lock = row(JSON.parse(Buffer.from(bytes).toString("utf8"))); }
  catch { throw new Error("REVIEWED_LOCK_SHAPE_INVALID"); }
  if (lock.lockfileVersion !== 3 || lock.requires !== true) throw new Error("REVIEWED_LOCK_FORMAT_UNSUPPORTED");
  const packages = row(lock.packages);
  if (Object.keys(packages).length > 5000) throw new Error("REVIEWED_LOCK_POPULATION_TOO_LARGE");
  const root = row(packages[""]);
  if (!same(root.dependencies, { [PACKAGE]: "file:./verified.tgz" }) || Object.keys(row(root.devDependencies ?? {})).length || Object.keys(row(root.optionalDependencies ?? {})).length) throw new Error("REVIEWED_LOCK_ROOT_MISMATCH");
  const target = row(packages[`node_modules/${PACKAGE}`]);
  if (target.version !== context.version || target.resolved !== "file:verified.tgz" || target.integrity !== context.archiveIntegrity || (target.name !== undefined && target.name !== PACKAGE)) throw new Error("REVIEWED_LOCK_ARCHIVE_MISMATCH");
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (!same(target[field], context.packageManifest[field])) throw new Error("REVIEWED_LOCK_MANIFEST_MISMATCH");
  }
  const registry = new URL(context.registryOrigin);
  const identities = new Map<string, { name: string; version: string; resolved: string; integrity: string }[]>();
  for (const [location, value] of Object.entries(packages)) {
    if (!location) continue;
    const name = packageName(location), entry = row(value);
    if (entry.link || entry.dev || (entry.name !== undefined && entry.name !== name)) throw new Error("REVIEWED_LOCK_LOCATION_INVALID");
    if (location === `node_modules/${PACKAGE}`) continue;
    if (typeof entry.version !== "string" || !VERSION.test(entry.version) || typeof entry.resolved !== "string" || typeof entry.integrity !== "string" || !INTEGRITY.test(entry.integrity)) throw new Error("REVIEWED_LOCK_PACKAGE_INVALID");
    let url: URL;
    try { url = new URL(entry.resolved); } catch { throw new Error("REVIEWED_LOCK_REGISTRY_INVALID"); }
    if (url.origin !== registry.origin || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".tgz")) throw new Error("REVIEWED_LOCK_REGISTRY_INVALID");
    const entries = identities.get(name) ?? [];
    entries.push({ name, version: entry.version, resolved: entry.resolved, integrity: entry.integrity });
    identities.set(name, entries);
  }
  const names = [...identities.keys()];
  const now = context.now ?? Date.now();
  // Bound network concurrency and inspect the exact version, not dist-tags.
  for (let offset = 0; offset < names.length; offset += 6) {
    await Promise.all(names.slice(offset, offset + 6).map(async name => {
      const data = await metadata(name, context), versions = row(data.versions), times = row(data.time);
      if (data.name !== name) throw new Error("REVIEWED_LOCK_METADATA_IDENTITY_MISMATCH");
      for (const entry of identities.get(name)!) {
        const version = row(versions[entry.version]), dist = row(version.dist);
        if (version.name !== name || version.version !== entry.version || dist.integrity !== entry.integrity || dist.tarball !== entry.resolved) throw new Error("REVIEWED_LOCK_METADATA_IDENTITY_MISMATCH");
        const published = typeof times[entry.version] === "string" ? Date.parse(times[entry.version] as string) : NaN;
        if (!Number.isFinite(published) || published > now || (!excluded(name, context.minReleaseAgeExclude) && now - published < context.minReleaseAge * 86_400_000)) throw new Error("REVIEWED_LOCK_RELEASE_AGE_REFUSED");
      }
    }));
  }
}
