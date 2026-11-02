#!/usr/bin/env bun
/**
 * Refuse a package tarball that carries @hasna/secrets SDK source.
 *
 * Usage: bun scripts/verify-no-secrets-sdk-in-tarball.ts <package.tgz>
 *
 * The whole gzip stream is decompressed and the complete tar bytes are searched, headers and member names
 * included, so a marker anywhere in what would be uploaded or published is found. The markers are the SDK's own
 * declarations (the same ones src/lib/secrets-sdk-external.test.ts uses), not call sites: Skills itself calls
 * `sdk.createSecretsClientFromEnv(...)`, which is not SDK source. On a hit it prints the marker's name only,
 * never the matched content. Exit 0: clean; 1: a marker was found; 2: the file could not be read as a gzipped tar.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export const SECRETS_SDK_MARKERS: readonly { name: string; pattern: RegExp }[] = [
  { name: "function createSecretsClientFromEnv(", pattern: /function\s+createSecretsClientFromEnv\s*\(/ },
  { name: "class SecretsClient", pattern: /class\s+SecretsClient\b/ },
];

/** The decompressed tar bytes of a .tgz; throws when the input is not a gzipped tar archive. */
export function tarBytes(gzipped: Uint8Array): Uint8Array {
  const tar = gunzipSync(gzipped);
  // A tar archive is whole 512-byte blocks, and its first header carries the ustar magic at offset 257.
  if (tar.length < 1024 || tar.length % 512 !== 0 || tar.subarray(257, 262).toString("latin1") !== "ustar") throw new Error("not a tar archive");
  return tar;
}

/** Names of the SDK markers found anywhere in the bytes, headers included. Latin-1 maps every byte to one character. */
export function secretsSdkMarkersIn(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  return SECRETS_SDK_MARKERS.filter(marker => marker.pattern.test(text)).map(marker => marker.name);
}

if (import.meta.main) {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) { console.error("Usage: verify-no-secrets-sdk-in-tarball <package.tgz>"); process.exit(2); }
  let tar: Uint8Array;
  try { tar = tarBytes(readFileSync(path)); }
  catch { console.error("verify-no-secrets-sdk-in-tarball: the file could not be read as a gzipped tar archive"); process.exit(2); }
  const found = secretsSdkMarkersIn(tar);
  if (found.length) {
    for (const name of found) console.error(`verify-no-secrets-sdk-in-tarball: @hasna/secrets SDK marker found: ${name}`);
    process.exit(1);
  }
  console.log(`verify-no-secrets-sdk-in-tarball: clean (${tar.length} tar bytes searched)`);
}
