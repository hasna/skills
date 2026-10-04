import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const CONSUMER_EXPORTS = [".", "./admin-contract", "./sdk", "./storage"] as const;
export const CONSUMER_CHECKS = [
  "strict-types", "admin-list-runtime", "bundle-runtime", "content-hash-revision-runtime",
  "quote-error-runtime", "cli-polling", "cli-remote-routing",
] as const;

export type ArchiveDigest = { bytes: number; sha256: string; integrity: string };
export type ConsumerArchive = ArchiveDigest & { source: string; installedFrom: string };
export type ConsumerReceipt = ArchiveDigest & {
  schema: "hasna.skills.consumer-archive.v1";
  status: "passed";
  package: { name: "@hasna/skills"; version: string };
  exports: string[];
  checks: string[];
};

export function parseConsumerArguments(argv: string[]): { archive?: string; sha256?: string; receipt?: string } {
  const result: { archive?: string; sha256?: string; receipt?: string } = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (name !== "--archive" && name !== "--sha256" && name !== "--receipt") throw new Error("Unknown consumer archive argument");
    const key = name.slice(2) as keyof typeof result;
    if (!value || value.startsWith("--") || result[key] !== undefined) throw new Error("Missing or repeated consumer archive argument");
    result[key] = value;
  }
  if (Boolean(result.archive) !== Boolean(result.sha256)) throw new Error("--archive and --sha256 must be supplied together");
  if (result.archive && !isAbsolute(result.archive)) throw new Error("--archive must be an absolute local file path");
  if (result.receipt && !isAbsolute(result.receipt)) throw new Error("--receipt must be an absolute local file path");
  if (result.sha256 && !/^[a-f0-9]{64}$/.test(result.sha256)) throw new Error("--sha256 must be a lowercase SHA-256 digest");
  return result;
}

export function digestArchive(bytes: Uint8Array): ArchiveDigest {
  return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

export async function readArchive(path: string): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The selected archive must be a regular local file");
  return readFile(path);
}

export function assertArchiveDigest(actual: ArchiveDigest, expected: ArchiveDigest): void {
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 || actual.integrity !== expected.integrity) {
    throw new Error("The selected archive changed or differs from its acceptance receipt");
  }
}

export async function stageConsumerArchive(source: string, workspace: string, expectedSha256?: string): Promise<ConsumerArchive> {
  const bytes = await readArchive(source);
  const digest = digestArchive(bytes);
  if (expectedSha256 !== undefined && digest.sha256 !== expectedSha256) throw new Error("The selected archive does not match the reviewed SHA-256");
  const installedFrom = join(workspace, "accepted-package.tgz");
  await writeFile(installedFrom, bytes, { flag: "wx", mode: 0o600 });
  assertArchiveDigest(digestArchive(await readArchive(installedFrom)), digest);
  return { ...digest, source, installedFrom };
}

export function assertInstalledIdentity(value: unknown, expectedVersion: string): void {
  const installed = value as { name?: unknown; version?: unknown; exports?: unknown } | null;
  if (installed?.name !== "@hasna/skills" || installed.version !== expectedVersion) {
    throw new Error("The installed archive has the wrong package name or version");
  }
  if (!installed.exports || typeof installed.exports !== "object" || Array.isArray(installed.exports)
    || JSON.stringify(Object.keys(installed.exports).sort()) !== JSON.stringify(CONSUMER_EXPORTS)) {
    throw new Error("The installed archive must expose every checked public package export");
  }
}

// Call only after the complete installed consumer fixture succeeds. Read both
// copies again so an altered source or installed input cannot earn this receipt.
export async function completeConsumerArchive(archive: ConsumerArchive, version: string): Promise<ConsumerReceipt> {
  assertArchiveDigest(digestArchive(await readArchive(archive.source)), archive);
  assertArchiveDigest(digestArchive(await readArchive(archive.installedFrom)), archive);
  return { schema: "hasna.skills.consumer-archive.v1", status: "passed", package: { name: "@hasna/skills", version },
    bytes: archive.bytes, sha256: archive.sha256, integrity: archive.integrity,
    exports: [...CONSUMER_EXPORTS], checks: [...CONSUMER_CHECKS] };
}
