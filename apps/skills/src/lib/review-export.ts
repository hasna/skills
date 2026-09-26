import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { readBoundedResponse } from "./remote-files.js";
import { sha256Hex } from "./skill-bundle.js";
import { isValidSkillVersion } from "./skill-version.js";
import { NATIVE_SKILL_ROOTS } from "./native-discovery-roots.js";

const MAX_REVIEW_BUNDLE_BYTES = 32 * 1024 * 1024;
const SLUG = /^[a-z0-9][a-z0-9._-]*$/;
const NATIVE_CONTAINERS = new Set<string>(NATIVE_SKILL_ROOTS.map(([, root]) => root.split("/")[0]!).filter(root => root !== ".config"));

export interface ReviewExportClient {
  getSkillVersion(slug: string, version: string): Promise<{ bundleSha256: string; bundleByteSize: number } | null>;
  getBundle(slug: string, version: string): Promise<Response | null>;
}

export interface ReviewExportReceipt {
  slug: string;
  version: string;
  bundleSha256: string;
  bundleByteSize: number;
  output: string;
}

function exactVersion(spec: string): { slug: string; version: string } {
  const at = spec.indexOf("@");
  const slug = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (at < 1 || slug.length > 128 || !SLUG.test(slug) || !isValidSkillVersion(version)) {
    throw new Error("Review export requires an exact valid slug@version.");
  }
  return { slug, version };
}

function assertPrivateDestination(output: string): string {
  if (!isAbsolute(output) || resolve(output) !== output || !basename(output).endsWith(".tar.gz")) {
    throw new Error("Review output must be an absolute, normalized .tar.gz path.");
  }
  const parent = dirname(output);
  if (realpathSync(parent) !== parent || lstatSync(parent).isSymbolicLink()) {
    throw new Error("Review output parent must be a real directory, not a symlink.");
  }
  const parentStat = statSync(parent);
  if (!parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0 ||
      (process.getuid && parentStat.uid !== process.getuid())) {
    throw new Error("Review output parent must be an owner-only directory (mode 0700).");
  }
  const segments = parent.toLowerCase().split(sep);
  if (segments.some(segment => NATIVE_CONTAINERS.has(segment)) ||
      segments.some((segment, index) => segment === ".config" && segments[index + 1] === "opencode") ||
      segments.some((segment, index) => segment === ".hasna" && segments[index + 1] === "skills")) {
    throw new Error("Review output cannot be placed in agent-native discovery or Skills installation paths.");
  }
  for (let current = parent; ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) {
      throw new Error("Review output cannot be placed inside a Git worktree.");
    }
    if (current === parse(current).root) break;
  }
  return output;
}

/** Export for human review only. This never changes corpus, cache, profiles, or native discovery. */
export async function exportSkillVersionForReview(
  spec: string,
  output: string,
  client: ReviewExportClient,
): Promise<ReviewExportReceipt> {
  const { slug, version } = exactVersion(spec);
  const target = assertPrivateDestination(output);
  if (existsSync(target)) throw new Error("Review output already exists; choose a new filename.");
  const metadata = await client.getSkillVersion(slug, version);
  if (!metadata) throw new Error(`Published skill version ${slug}@${version} was not found.`);
  if (!/^[a-f0-9]{64}$/i.test(metadata.bundleSha256) || !Number.isSafeInteger(metadata.bundleByteSize) ||
      metadata.bundleByteSize < 1 || metadata.bundleByteSize > MAX_REVIEW_BUNDLE_BYTES) {
    throw new Error("Published bundle metadata is invalid or exceeds the review size limit.");
  }
  const response = await client.getBundle(slug, version);
  if (!response) throw new Error(`Published bundle for ${slug}@${version} is unavailable.`);
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`Published bundle request failed: HTTP ${response.status}.`);
  }
  const headerSha = response.headers.get("X-Skill-Bundle-Sha256");
  const headerVersion = response.headers.get("X-Skill-Version");
  if (!headerSha || headerSha.toLowerCase() !== metadata.bundleSha256.toLowerCase() || headerVersion !== version) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Published bundle headers do not match the exact version metadata.");
  }
  const bytes = await readBoundedResponse(response, Math.min(metadata.bundleByteSize, MAX_REVIEW_BUNDLE_BYTES));
  if (bytes.byteLength !== metadata.bundleByteSize || sha256Hex(bytes) !== metadata.bundleSha256.toLowerCase()) {
    throw new Error("Published bundle bytes do not match the exact version metadata.");
  }
  // O_EXCL and O_NOFOLLOW make the final write refuse an existing path or symlink,
  // including one that appears after the initial check. Never overwrite review data.
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    if (fstatSync(fd).size !== bytes.byteLength) throw new Error("Incomplete review output write.");
  } catch (error) {
    // A failed write may have created a private partial artifact. Preserve it for
    // recovery; never silently delete or overwrite local files.
    throw new Error(`Review output write failed. A private partial file may remain at ${target}; use Trash to remove it before reusing this path.`, { cause: error });
  }
  finally { closeSync(fd); }
  return { slug, version, bundleSha256: metadata.bundleSha256.toLowerCase(), bundleByteSize: bytes.byteLength, output: target };
}
