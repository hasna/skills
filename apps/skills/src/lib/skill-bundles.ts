/**
 * Signed, versioned skill bundle manifests — the CI-side distribution format.
 *
 * A "bundle" is the canonical tar.gz produced by packSkillBundle(): deterministic
 * bytes whose sha256 IS the skill's content address (mtime 0, uid/gid 0, sorted
 * entries, blanked gzip header — see skill-bundle.ts). This module adds the envelope
 * around those bytes:
 *
 *   {name, version, source_commit, content_hash, signature?, published_at}
 *
 * `content_hash` is the canonical sha256 of the bundle bytes (what push uploads as
 * bundleSha256, what the server echoes back in X-Skill-Bundle-Sha256). `signature` is
 * an HMAC-SHA256 of the bundle bytes, keyed from the SKILLS_SIGNING_KEY environment
 * variable, so a client holding the key can tell a CI-built bundle from anything else
 * even when the digest is delivered out of band.
 *
 * The signing key is read from process.env ONLY and is never logged, printed, or
 * persisted here. With no key the bundle is unsigned (signature omitted) — building
 * must still work, because CI without the secret must not block corpus pushes; it
 * just must not claim authenticity.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { packSkillBundle, type PackedSkillBundle } from "./skill-bundle.js";

/** Environment variable holding the HMAC signing key. Never logged, never printed. */
export const SKILLS_SIGNING_KEY_ENV = "SKILLS_SIGNING_KEY";

/** Environment variable naming the source commit the bundle was built from. */
export const SKILLS_SOURCE_COMMIT_ENV = "SKILLS_SOURCE_COMMIT";

/** Prefix of the signature string. The remainder is lowercase hex. */
export const SIGNATURE_PREFIX = "hmac-sha256:";

export interface SkillBundleManifest {
  name: string;
  version: string;
  source_commit: string;
  /** Canonical sha256 of the bundle bytes (the skill's content address). */
  content_hash: string;
  /** `hmac-sha256:<hex>` over the bundle bytes. Omitted when no key is available. */
  signature?: string;
  published_at: string;
}

export interface BuildSkillBundleOptions {
  name: string;
  /** The skill directory to pack. */
  dir: string;
  version: string;
  /** Source commit the skill came from. `unknown` when the provenance is unavailable. */
  sourceCommit: string;
  /** Signing key. Defaults to reading process.env[SKILLS_SIGNING_KEY_ENV]. */
  signingKey?: string;
  /** Explicit published_at. Defaults to now. Tests only. */
  publishedAt?: string;
}

export interface BuiltSkillBundle {
  bundle: PackedSkillBundle;
  manifest: SkillBundleManifest;
}

/**
 * Resolve the signing key from the environment. Returns null when unset, and the
 * caller decides how to behave (omit the signature, warn, or refuse) — this function
 * never touches stdout, so nothing about the key can leak through it.
 */
export function resolveSigningKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env[SKILLS_SIGNING_KEY_ENV];
  return key && key.length > 0 ? key : null;
}

/** Sign canonical bundle bytes with an HMAC key. Returns `hmac-sha256:<hex>`. */
export function signBundleBytes(bytes: Uint8Array, key: string): string {
  return `${SIGNATURE_PREFIX}${createHmac("sha256", key).update(bytes).digest("hex")}`;
}

/**
 * Verify a signature string against bundle bytes and a key. Returns true only for a
 * well-formed `hmac-sha256:<hex>` signature computed over exactly these bytes.
 * timingSafeEqual keeps the comparison from leaking a byte-at-a-time signal; the
 * length check is a format check (a hex digest is a fixed length), not a leak.
 */
export function verifyBundleSignature(bytes: Uint8Array, signature: string, key: string): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX)) return false;
  const hex = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = createHmac("sha256", key).update(bytes).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Pack a skill directory and build its signed manifest in one call — the unit the CI
 * bundle script, push, and pull all share, so a bundle built by CI and one pushed by
 * a machine agree on the canonical content_hash by construction.
 */
export function buildSkillBundle(options: BuildSkillBundleOptions): BuiltSkillBundle {
  const bundle = packSkillBundle(options.dir);
  const manifest: SkillBundleManifest = {
    name: options.name,
    version: options.version,
    source_commit: options.sourceCommit,
    content_hash: bundle.sha256,
    published_at: options.publishedAt ?? new Date().toISOString(),
  };
  const key = options.signingKey ?? resolveSigningKey();
  if (key) manifest.signature = signBundleBytes(bundle.bytes, key);
  return { bundle, manifest };
}
