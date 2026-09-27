/**
 * `skills pull` — fetch skills from the configured Skills instance into this machine's
 * corpus (the canonical root: <app folder>/installed/<name>/ before the owner-layout
 * migration, <app folder>/skills/<name>/ after it).
 *
 * This is the read half of the dogfooding loop. `skills push` sends a corpus skill up to
 * an instance; `skills pull` brings instance skills back down. Because loadRegistry()
 * already merges the corpus (listPortableSkillMetas), a pulled skill is visible to both
 * the CLI (`skills list --all`) and the MCP (`list_skills`) with no other step and no
 * product change.
 *
 * Verification: when the instance serves a bundle, pull downloads it and verifies the
 * `X-Skill-Bundle-Sha256` digest header against the received bytes (rejecting any
 * mismatch — the digest is the skill's content address), and verifies the
 * `X-Skill-Bundle-Signature` HMAC header whenever both a signature and a local signing
 * key are present. A signature without a configured key cannot be checked; the pull
 * proceeds with a warning and records it in the marker, which is strictly more honest
 * than the pre-signature protocol that checked nothing. The verified bundle is
 * installed ATOMICALLY — written to a staging directory and renamed into place — and
 * version/hash/source-commit are recorded in the corpus skill's `.hasna-skills.json`
 * marker. Instances that serve no bundle fall back to the historical SKILL.md+metadata
 * path, which cannot be verified and records that fact in the marker.
 *
 * Fail-closed, in the shared ladder's two shapes: with NOTHING configured there is
 * no client and this refuses with an actionable PullSkillError; with an authority
 * configured but no credential the ladder itself throws, so a pull can never quietly
 * become a no-op against a local corpus.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createRemoteSkillsClient } from "./remote-client.js";
import { hasSkillsOwnershipMarker } from "./agent-sync.js";
import {
  getPortableSkillsRoot,
  installCorpusSkillAtomically,
  normalizePortableSkillName,
  type CorpusSkillMeta,
  type PortableSkillOptions,
} from "./portable-skills.js";
import { resolveCorpusRoot } from "./home-migration.js";
import { revisionIdOf } from "./revision.js";
import { sha256Hex, type SkillBundleEntry, unpackSkillBundle } from "./skill-bundle.js";
import { isValidSkillVersion, SKILL_VERSION_RULE } from "./skill-version.js";
import { resolveSigningKey, verifyBundleSignature } from "./skill-bundles.js";
import type { SkillKind } from "./registry-types.js";
import { REVISION_ID_PATTERN } from "./revision.js";

/** Header carrying the canonical content digest of the served bundle. */
export const BUNDLE_DIGEST_HEADER = "X-Skill-Bundle-Sha256";
/** Header carrying the HMAC signature of the served bundle, when the server can sign. */
export const BUNDLE_SIGNATURE_HEADER = "X-Skill-Bundle-Signature";
/** Header carrying the immutable revision identity of the served row (todos d061fcda). */
export const BUNDLE_REVISION_ID_HEADER = "X-Skill-Revision-Id";
/** Header carrying the per-slug write counter of the served row. */
export const BUNDLE_REVISION_NUMBER_HEADER = "X-Skill-Revision-Number";

/** Marker file written inside each corpus skill directory recording pull provenance. */
export const PULL_MARKER_FILE = ".hasna-skills.json";

/**
 * The slice of RemoteSkillsClient that `pullSkills` needs. Narrowed to an interface so a
 * test can inject a fake and the real HTTP client (which satisfies it structurally) is
 * only constructed on the production path.
 */
export interface SkillPullClient {
  listSkills(): Promise<unknown[]>;
  getSkill(slug: string): Promise<unknown>;
  getSkillMd(slug: string): Promise<string | null>;
  /**
   * The skill's bundle, headers intact, or null when the instance serves none.
   * `Response` is the natural transport type here: verification reads the
   * X-Skill-Bundle-Sha256 / X-Skill-Bundle-Signature headers off it.
   */
  getBundle(slug: string, version?: string): Promise<Response | null>;
  /**
   * The registry's record of one published version (hasna/apps#1630), or null. Optional:
   * an exact-version pull proves the received bytes against this digest; a client that
   * cannot answer it falls back to the bundle's own digest header.
   */
  getSkillVersion?(slug: string, version: string): Promise<{ bundleSha256?: string } | null>;
}

export interface PullSkillsOptions extends PortableSkillOptions {
  /** Explicit skill names to pull. Ignored when `all` is set. */
  names?: string[];
  /** Pull every skill the instance serves. */
  all?: boolean;
  /**
   * Client override. `undefined` (the default) resolves one from configuration;
   * `null` models "no credential available" so the null-handling path stays testable.
   */
  client?: SkillPullClient | null;
  /** HMAC signing key for bundle signature verification. Defaults to $SKILLS_SIGNING_KEY. */
  signingKey?: string;
}

export interface PulledSkillResult {
  name: string;
  success: boolean;
  path?: string;
  kind?: SkillKind;
  version?: string;
  /** Canonical content hash of the installed bundle, when one was verified. */
  contentHash?: string;
  /** Source commit recorded on the bundle, when the instance reported one. */
  sourceCommit?: string;
  /** True when the pull created the corpus entry, false when it updated an existing one. */
  created?: boolean;
  /**
   * The revision id (todos d061fcda) this pull installed, when the instance reported one.
   * Recorded in the marker so a later pull can detect that the remote moved on.
   */
  revisionId?: string;
  /** True when the instance answered 410: the slug was deleted and pull reconciled. */
  tombstoned?: boolean;
  /** With `tombstoned`: true when a local corpus entry existed and was removed. */
  removed?: boolean;
  /**
   * With `tombstoned`: true when the local corpus entry was NOT pull-managed (no pull
   * marker), so it was left in place — a remote 410 never deletes a user-created skill.
   */
  leftInPlace?: boolean;
  /**
   * True when the instance no longer serves a published revision under this slug (its
   * tombstone window expired) but the local copy is a revision-marked published install.
   * Reported instead of silently swapping in a bundled skill of the same name.
   */
  purged?: boolean;
  error?: string;
}

export interface PullSkillsResult {
  results: PulledSkillResult[];
}

export class PullSkillError extends Error {
  constructor(message: string, readonly detail?: string[]) {
    super(message);
    this.name = "PullSkillError";
  }
}

export interface VerifiedBundle {
  /** The received bundle bytes, owned by this process. */
  bytes: Uint8Array;
  /** Canonical sha256 of `bytes`. */
  contentHash: string;
  /** The server-declared digest, when the header was present. */
  serverHash?: string;
  /** The server-declared signature, when the header was present. */
  signature?: string;
  /** The server-declared revision id, when the header was present and well-formed. */
  revisionId?: string;
  /** The server-declared per-slug write counter, when the header was present. */
  revisionNumber?: number;
}

export async function pullSkills(options: PullSkillsOptions = {}): Promise<PullSkillsResult> {
  // createRemoteSkillsClient() returns null only when NOTHING is configured; a
  // configured authority with no credential throws from the shared ladder — so the
  // fail-closed behaviour is inherited here rather than re-implemented.
  const client = options.client !== undefined ? options.client : await createRemoteSkillsClient();
  if (!client) {
    throw new PullSkillError(
      "No API key configured, so there is no instance to pull from.",
      ["Run `skills auth login`, or set HASNA_SKILLS_API_KEY (and HASNA_SKILLS_API_URL for your own instance)."],
    );
  }

  const signingKey = options.signingKey ?? resolveSigningKey() ?? undefined;
  const targets = await resolveTargetSlugs(client, options);
  const corpusOptions = pickCorpusOptions(options);
  const results: PulledSkillResult[] = [];
  for (const name of targets) {
    results.push(await pullOne(client, name, corpusOptions, { signingKey }));
  }
  return { results };
}

async function resolveTargetSlugs(client: SkillPullClient, options: PullSkillsOptions): Promise<string[]> {
  if (options.all) {
    const listed = await client.listSkills();
    return dedupe(listed.map(extractSlug).filter((slug): slug is string => Boolean(slug)));
  }
  const explicit = dedupe((options.names ?? []).map((name) => name.trim()).filter(Boolean));
  if (!explicit.length) {
    throw new PullSkillError(
      "Nothing to pull: name at least one skill, or pass --all to pull every skill the instance serves.",
    );
  }
  return explicit;
}

async function pullOne(
  client: SkillPullClient,
  rawName: string,
  corpusOptions: PortableSkillOptions,
  verify: { signingKey?: string },
): Promise<PulledSkillResult> {
  // `name@version` pins the pull to one immutable published version (hasna/apps#1630);
  // a bare name pulls whatever the instance currently serves.
  const { name: bareName, version: requestedVersion } = splitNameVersion(rawName);
  let slug: string;
  try {
    slug = normalizePortableSkillName(bareName);
  } catch (error) {
    return { name: rawName, success: false, error: (error as Error).message };
  }
  if (requestedVersion !== undefined && !isValidSkillVersion(requestedVersion)) {
    return { name: rawName, success: false, error: `'${requestedVersion}' is not a valid skill version (${SKILL_VERSION_RULE}).` };
  }

  const meta = await safeMeta(client, slug);

  // Bundle path first: the verified, signed artifact. The metadata-only path is the
  // fallback for instances that serve no bundle, and cannot be verified by construction.
  let bundleResponse: Response | null;
  try {
    bundleResponse = await client.getBundle(slug, requestedVersion);
  } catch (error) {
    return { name: slug, success: false, error: `Failed to fetch '${slug}': ${(error as Error).message}` };
  }
  // An exact version either exists or it does not: the client reports a missing one as null
  // (or a 404 from a stand-in), and there is no metadata fallback that could satisfy it.
  if (requestedVersion && (!bundleResponse || bundleResponse.status === 404)) {
    return {
      name: rawName,
      success: false,
      error: `Version '${requestedVersion}' of '${slug}' is not published on the configured instance (run 'skills versions ${slug}' to list what exists).`,
    };
  }
  if (bundleResponse && !bundleResponse.ok) {
    // 410 is the tombstone contract (todos d061fcda): the slug was deleted within the
    // instance's tombstone window. The pull reconciles by removing the local copy —
    // that is the point of the window. Any other failure status stays an error.
    if (bundleResponse.status === 410) {
      return reconcileTombstone(slug, corpusOptions);
    }
    // 404 with a revision-marked local install: the published row's tombstone window has
    // expired and the slug is purged. The metadata fallback (if any) would serve a
    // DIFFERENT skill — the bundled one with the same name — so report the published
    // slug as purged/absent rather than silently swapping the local install. Either
    // proof marks a published install: the current revision id, or the recorded digest
    // of an exact-version install (a historic version has no revision of its own).
    if (bundleResponse.status === 404) {
      const marker = readPullMarker(join(getPortableSkillsRoot(corpusOptions), slug));
      if (isPublishedInstallMarker(marker)) {
        return { name: slug, success: true, purged: true, removed: false };
      }
    }
    return {
      name: slug,
      success: false,
      error: `Failed to fetch the bundle for '${slug}': HTTP ${bundleResponse.status}`,
    };
  }
  if (bundleResponse) {
    try {
      // Exact-version pull (hasna/apps#1630): the proof is the registry's recorded digest for
      // that version, fetched separately from the bytes, so a swapped body fails closed.
      let expectedSha256: string | undefined;
      if (requestedVersion && client.getSkillVersion) {
        const recorded = await client.getSkillVersion(slug, requestedVersion);
        if (!recorded) {
          return { name: rawName, success: false, error: `Version '${requestedVersion}' of '${slug}' is not published on the configured instance (run 'skills versions ${slug}' to list what exists).` };
        }
        expectedSha256 = typeof recorded.bundleSha256 === "string" ? recorded.bundleSha256 : undefined;
      }
      return await installVerifiedBundle(slug, bundleResponse, meta, corpusOptions, verify, requestedVersion ? { version: requestedVersion, expectedSha256 } : undefined);
    } catch (error) {
      if (error instanceof PullSkillError) {
        return { name: slug, success: false, error: error.message };
      }
      throw error;
    }
  }

  let skillMd: string | null;
  try {
    skillMd = await client.getSkillMd(slug);
  } catch (error) {
    return { name: slug, success: false, error: `Failed to fetch '${slug}': ${(error as Error).message}` };
  }
  if (skillMd === null) {
    return { name: slug, success: false, error: `Skill '${slug}' was not found on the configured Skills instance.` };
  }

  // Bundle-less instance, no declared revision on the served metadata: if the local
  // copy is a revision-marked or digest-marked published install, the published row is
  // gone (purged) and what the metadata serves is a different skill — report, do not swap.
  if (!meta?.revisionId) {
    const marker = readPullMarker(join(getPortableSkillsRoot(corpusOptions), slug));
    if (isPublishedInstallMarker(marker)) {
      return { name: slug, success: true, purged: true, removed: false };
    }
  }

  // A declared revision must be PROVEN against the content actually INSTALLED: the id is
  // content-addressed, so recomputing it over the served metadata + the exact SKILL.md
  // bytes being written and comparing is what "pull can prove which revision it
  // installed" means. The skillMd is fetched separately from the metadata, so the proof
  // runs over the fetched bytes (the ones installed), never over the metadata's copy —
  // if the row changed between the two requests, the recompute fails closed.
  let provenRevisionId: string | undefined;
  try {
    provenRevisionId = meta?.revisionId ? provenRevision({ ...meta, skillMd }, slug, {}) : undefined;
  } catch (error) {
    if (error instanceof PullSkillError) {
      return { name: slug, success: false, error: error.message };
    }
    throw error;
  }

  const written = installCorpusSkillAtomically({ name: slug, skillMd, meta }, corpusOptions);
  writePullMarker(written.path, {
    skill: slug,
    version: written.manifest.version,
    ...(provenRevisionId ? { revisionId: provenRevisionId } : {}),
  });
  return {
    name: slug,
    success: true,
    path: written.path,
    kind: written.manifest.kind,
    version: written.manifest.version,
    created: written.created,
    ...(provenRevisionId ? { revisionId: provenRevisionId } : {}),
  };
}

/**
 * Prove a declared revision id against the content a pull actually installs.
 *
 * The revision id is a sha-256 over a canonical serialisation of the row's published
 * content (src/lib/revision.ts). The client holds that content as the metadata payload
 * plus the exact bytes to be written (the verified bundle bytes, or — on the
 * metadata-only path — the separately fetched SKILL.md passed in via `meta.skillMd`),
 * so it can recompute the id and compare. Equality is the proof "the recorded revision
 * identifies the installed content"; a declared id that cannot be recomputed (missing
 * canonical fields) or that recomputes to a different value is a broken or lying
 * instance and fails closed.
 *
 * `bundle` carries the verified bytes' sha256 and length (or nothing on the
 * metadata-only path, where the row has no bundle).
 */
function provenRevision(meta: CorpusSkillMeta, slug: string, bundle: { sha256?: string; byteSize?: number }): string {
  const declared = meta.revisionId;
  if (!declared) return "";
  const source = meta.publishedSource;
  // Only publishedSource is always required: the metadata payload always carries it.
  // skillMd is OPTIONAL in the canonical hash (absent hashes as null) — a bundle-only
  // publish (valid: skill-validation warns, never blocks) hashes over the null form
  // and serves no document, so its revision is proven over the verified bundle bytes
  // with skillMd absent. Requiring skillMd here refused every valid bundle-only skill.
  if (typeof source !== "string" || source.length === 0) {
    throw new PullSkillError(
      `Revision proof failed for '${slug}': the instance declared revision '${declared.slice(0, 12)}…' but did not serve the content fields needed to recompute it (publishedSource). Nothing was installed.`,
    );
  }
  const recomputed = revisionIdOf({
    slug,
    displayName: meta.displayName ?? "",
    description: meta.description ?? "",
    category: meta.category ?? "",
    tags: meta.tags ?? [],
    source,
    kind: meta.kind ?? "instruction",
    ...(meta.version ? { version: meta.version } : {}),
    ...(typeof meta.skillMd === "string" && meta.skillMd.length > 0 ? { skillMd: meta.skillMd } : {}),
    ...(bundle.sha256 ? { bundleSha256: bundle.sha256 } : {}),
    ...(bundle.byteSize !== undefined && bundle.byteSize !== null ? { bundleByteSize: bundle.byteSize } : {}),
  });
  if (recomputed !== declared) {
    throw new PullSkillError(
      `Revision proof failed for '${slug}': the instance declared revision '${declared.slice(0, 12)}…' but the served content recomputes to '${recomputed.slice(0, 12)}…'. The declared revision does not identify the content that was received. Nothing was installed.`,
    );
  }
  return declared;
}

/**
 * The tombstone reconciliation (todos d061fcda): a 410 answers "this slug was deleted
 * and is still inside its tombstone window — remove the local copy". Success is the
 * reconcile happening, not an install; `removed` records whether anything was there.
 *
 * Only a Skills-owned entry is removed: the marker must name the exact Skills owner.
 * An unmanaged or user-created skill with the same slug is never
 * deleted by a remote 410 — it is reported as left in place instead.
 */
function reconcileTombstone(slug: string, corpusOptions: PortableSkillOptions): PulledSkillResult {
  const target = join(getPortableSkillsRoot(corpusOptions), slug);
  if (!hasSkillsOwnershipMarker(target)) {
    return { name: slug, success: true, tombstoned: true, removed: false, leftInPlace: true };
  }
  rmSync(target, { recursive: true, force: true });
  return { name: slug, success: true, tombstoned: true, removed: true };
}

/**
 * Read a pull marker from a corpus entry, or null when there is none (unmanaged).
 * The marker is the only proof a directory was installed by a pull.
 */
function readPullMarker(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, PULL_MARKER_FILE), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Does a marker prove the entry was installed from a published instance row?
 *
 * Two proofs are accepted (hasna/apps#1671): the revision id a current pull records,
 * or the content digest an exact-version pull records — a historic version has no
 * revision of its own, so its digest is the proof that this directory came from the
 * instance. Either marks the entry as a published install, which is what the purged
 * guards must not silently swap for a bundled skill of the same name.
 */
function isPublishedInstallMarker(marker: Record<string, unknown> | null): boolean {
  if (!marker) return false;
  const revisionId = typeof marker.revisionId === "string" ? marker.revisionId : "";
  const contentHash = typeof marker.contentHash === "string" ? marker.contentHash : "";
  return revisionId.length > 0 || contentHash.length > 0;
}

function installVerifiedBundle(
  slug: string,
  response: Response,
  meta: CorpusSkillMeta | null,
  corpusOptions: PortableSkillOptions,
  verify: { signingKey?: string },
  exact?: { version: string; expectedSha256?: string },
): Promise<PulledSkillResult> {
  return response.arrayBuffer().then((buffer) => {
    const verified = verifyBundleResponseBytes(buffer, response, verify);
    // Exact-version pull: the bytes must be the ones the registry recorded for that version.
    if (exact?.expectedSha256 && exact.expectedSha256 !== verified.contentHash) {
      throw new PullSkillError(
        `Digest proof failed for '${slug}@${exact.version}': the registry records bundle ${exact.expectedSha256.slice(0, 12)}… but the received bytes hash to ${verified.contentHash.slice(0, 12)}…. Nothing was installed.`,
      );
    }
    const served = str(response.headers.get("X-Skill-Version"));
    if (exact && served && served !== exact.version) {
      throw new PullSkillError(`Version proof failed for '${slug}': asked for '${exact.version}', the instance served '${served}'. Nothing was installed.`);
    }
    let entries: SkillBundleEntry[];
    try {
      entries = unpackSkillBundle(verified.bytes);
    } catch (error) {
      throw new PullSkillError(`Bundle for '${slug}' could not be unpacked: ${(error as Error).message}`);
    }
    const version = exact?.version ?? served ?? str(meta?.version) ?? versionFromEntries(entries) ?? "unknown";
    const sourceCommit = sourceCommitFromEntries(entries);
    // A declared revision must be PROVEN against the content actually received before it
    // is recorded: the id is content-addressed, so recomputing it over the served
    // metadata + the verified bundle bytes and comparing is what "pull can prove which
    // revision it installed" means. A mismatch (or an id that cannot be recomputed)
    // fails closed — nothing installed, nothing recorded.
    // A historic version has no revision of its own: the row's revision identifies the CURRENT
    // content, so for an exact-version pull the digest proof above is the proof, and no
    // revision is recorded in the marker (a later plain pull sees an unrevisioned install).
    const declaredRevision = exact ? undefined : verified.revisionId ?? meta?.revisionId;
    if (declaredRevision && meta?.revisionId && verified.revisionId && declaredRevision !== meta.revisionId) {
      throw new PullSkillError(
        `Revision proof failed for '${slug}': the bundle header declares '${verified.revisionId.slice(0, 12)}…' but the metadata declares '${meta.revisionId.slice(0, 12)}…'. The instance is inconsistent. Nothing was installed.`,
      );
    }
    const provenRevisionId = declaredRevision ? provenRevision(meta ?? {}, slug, { sha256: verified.contentHash, byteSize: verified.bytes.byteLength }) : undefined;
    const installed = installBundleAtomically(slug, entries, corpusOptions, {
      version,
      contentHash: verified.contentHash,
      ...(sourceCommit ? { sourceCommit } : {}),
      ...(verified.signature ? { signature: verified.signature } : {}),
      ...(provenRevisionId ? { revisionId: provenRevisionId } : {}),
    });
    return {
      name: slug,
      success: true,
      path: installed.path,
      kind: meta?.kind ?? kindFromEntries(entries),
      version,
      contentHash: verified.contentHash,
      ...(sourceCommit ? { sourceCommit } : {}),
      ...(provenRevisionId ? { revisionId: provenRevisionId } : {}),
      created: installed.created,
    };
  });
}

function versionFromEntries(entries: SkillBundleEntry[]): string | undefined {
  const skillJson = entries.find((entry) => entry.path === "skill.json");
  if (skillJson) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(skillJson.bytes)) as { version?: unknown };
      const version = str(parsed.version);
      if (version) return version;
    } catch {
      // Fall through to package.json.
    }
  }
  const pkg = entries.find((entry) => entry.path === "package.json");
  if (pkg) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(pkg.bytes)) as { version?: unknown };
      return str(parsed.version);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function kindFromEntries(entries: SkillBundleEntry[]): SkillKind | undefined {
  const skillJson = entries.find((entry) => entry.path === "skill.json");
  if (!skillJson) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(skillJson.bytes)) as { kind?: unknown };
    return parsed.kind === "instruction" || parsed.kind === "executable" ? parsed.kind : undefined;
  } catch {
    return undefined;
  }
}

function sourceCommitFromEntries(entries: SkillBundleEntry[]): string | undefined {
  const skillJson = entries.find((entry) => entry.path === "skill.json");
  if (!skillJson) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(skillJson.bytes)) as { source_commit?: unknown };
    return str(parsed.source_commit);
  } catch {
    return undefined;
  }
}

/**
 * The verification core, synchronous over already-buffered bytes: the digest header
 * (when present) must equal the canonical sha256 of the received bytes, and the
 * signature header (when present) must verify against the signing key when one is
 * available — otherwise it is recorded with a warning, because a pull cannot check a
 * signature it has no key for.
 */
export function verifyBundleResponseBytes(
  buffer: ArrayBuffer,
  response: Response,
  verify: { signingKey?: string } = {},
): VerifiedBundle {
  const serverHash = response.headers.get(BUNDLE_DIGEST_HEADER);
  const signature = response.headers.get(BUNDLE_SIGNATURE_HEADER);
  const revisionId = response.headers.get(BUNDLE_REVISION_ID_HEADER);
  const revisionNumberRaw = response.headers.get(BUNDLE_REVISION_NUMBER_HEADER);
  const bytes = new Uint8Array(buffer.slice(0));
  const contentHash = sha256Hex(bytes);

  if (serverHash && serverHash.toLowerCase() !== contentHash) {
    throw new PullSkillError(
      `Bundle digest mismatch: the instance declared ${serverHash} but the received bundle hashes to ${contentHash}.`,
      ["The bundle was tampered with or truncated in transit. Nothing was installed."],
    );
  }

  // Revision identity (todos d061fcda): the revision id is the same contract as the
  // digest. Present and malformed -> fail closed (nothing installed); absent -> an
  // older instance, proceed and record nothing, exactly like a missing digest header.
  if (revisionId && !REVISION_ID_PATTERN.test(revisionId)) {
    throw new PullSkillError(
      `Malformed revision id: the instance declared '${revisionId}', which is not a 64-character lowercase hex sha-256.`,
      ["The revision headers were tampered with or the instance is broken. Nothing was installed."],
    );
  }
  const revisionNumber = revisionNumberRaw === null ? undefined : Number(revisionNumberRaw);
  if (revisionNumberRaw !== null && (!Number.isInteger(revisionNumber) || (revisionNumber as number) < 0)) {
    throw new PullSkillError(
      `Malformed revision number: the instance declared '${revisionNumberRaw}', which is not a non-negative integer.`,
      ["The revision headers were tampered with or the instance is broken. Nothing was installed."],
    );
  }

  if (signature) {
    const key = verify.signingKey;
    if (!key) {
      console.warn(
        `The instance signed a bundle but no SKILLS_SIGNING_KEY is configured; the signature was recorded but could not be verified.`,
      );
    } else if (!verifyBundleSignature(bytes, signature, key)) {
      throw new PullSkillError(
        "Bundle signature mismatch: the received bundle does not match the signature the instance declared.",
        ["The bundle was not produced by a signer holding your key. Nothing was installed."],
      );
    }
  }

  return {
    bytes,
    contentHash,
    ...(serverHash ? { serverHash } : {}),
    ...(signature ? { signature } : {}),
    ...(revisionId ? { revisionId } : {}),
    ...(revisionNumberRaw === null || revisionNumber === undefined ? {} : { revisionNumber }),
  };
}

/**
 * Atomically replace the corpus entry for a verified bundle: stage every entry in a
 * sibling directory, then rename into place (the existing entry is moved aside first
 * and removed only after the staged tree is in position). A failure at any point leaves
 * either the old entry or nothing — never a partial skill.
 */
export function installBundleAtomically(
  name: string,
  entries: SkillBundleEntry[],
  options: PortableSkillOptions = {},
  marker: { version?: string; contentHash?: string; sourceCommit?: string; signature?: string; revisionId?: string } = {},
): { path: string; created: boolean } {
  const root = getPortableSkillsRoot(options);
  mkdirSync(root, { recursive: true });
  const target = join(root, name);
  const created = !existsSync(target);
  const staging = mkdtempSync(join(root, `.pull-${name}-`));

  let moved = false;
  let backup: string | null = null;
  try {
    for (const entry of entries) {
      const destination = join(staging, entry.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, entry.bytes, { mode: entry.mode });
    }
    writePullMarker(staging, {
      skill: name,
      ...(marker.version ? { version: marker.version } : {}),
      ...(marker.contentHash ? { contentHash: marker.contentHash } : {}),
      ...(marker.sourceCommit ? { sourceCommit: marker.sourceCommit } : {}),
      ...(marker.signature ? { signature: marker.signature } : {}),
      ...(marker.revisionId ? { revisionId: marker.revisionId } : {}),
    });
    if (existsSync(target)) {
      backup = mkdtempSync(join(root, `.pull-backup-${name}-`));
      renameSync(target, join(backup, name));
      moved = true;
    }
    renameSync(staging, target);
    if (moved && backup) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (moved && backup && existsSync(join(backup, name))) {
      try {
        renameSync(join(backup, name), target);
      } catch {
        // The original remains in the backup dir; the target is either absent or
        // partial, and the error below names the staging path that failed.
      }
    }
    throw error;
  }
  return { path: target, created };
}

/**
 * Record what a pull installed. Version/hash/source-commit are the provenance a later
 * `skills sync --check` or drift census needs; the signature is recorded when one was
 * present so an audit can tell "verified" from "declared".
 */
export function writePullMarker(
  dir: string,
  record: { skill: string; version?: string; contentHash?: string; sourceCommit?: string; signature?: string; revisionId?: string; source?: "pull" | "sync" },
): void {
  const marker = {
    managedBy: "@hasna/skills",
    skill: record.skill,
    source: record.source ?? "pull",
    ...(record.version ? { version: record.version } : {}),
    ...(record.contentHash ? { contentHash: record.contentHash } : {}),
    ...(record.sourceCommit ? { sourceCommit: record.sourceCommit } : {}),
    ...(record.signature ? { signature: record.signature } : {}),
    // The revision id this pull installed: a later pull (or the sync reconciliation
    // verb) can compare it against the instance's current revision and detect drift.
    ...(record.revisionId ? { revisionId: record.revisionId } : {}),
    syncedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, PULL_MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);
}

/**
 * Best-effort metadata. The SKILL.md carries its own frontmatter, so a missing or
 * malformed detail payload degrades to "use the frontmatter" rather than failing the pull.
 */
async function safeMeta(client: SkillPullClient, slug: string): Promise<CorpusSkillMeta | null> {
  let raw: unknown;
  try {
    raw = await client.getSkill(slug);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind === "instruction" || record.kind === "executable" ? record.kind : undefined;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;
  return {
    ...(str(record.displayName) ? { displayName: str(record.displayName) } : {}),
    ...(str(record.description) ? { description: str(record.description) } : {}),
    ...(str(record.category) ? { category: str(record.category) } : {}),
    ...(tags && tags.length ? { tags } : {}),
    ...(str(record.version) ? { version: str(record.version) } : {}),
    ...(kind ? { kind } : {}),
    // The revision id the instance serves, carried onto the metadata-only pull path so
    // the marker records it there too (todos d061fcda).
    ...(REVISION_ID_PATTERN.test(str(record.revisionId) ?? "") ? { revisionId: str(record.revisionId)! } : {}),
    // The canonical content fields a declared revision is computed over. A pull proves
    // the revision by recomputing the content-addressed id from what it received; both
    // fields are required for that proof (the payload's own `source` is the client view
    // "remote", the canonical hash uses the row's stored source).
    // skillMd is read VERBATIM, never trimmed: it is a document, and the canonical hash
    // is computed over the exact bytes the row stores (the same reason the server keeps
    // it verbatim through publish).
    ...(typeof record.skillMd === "string" && record.skillMd.length > 0 ? { skillMd: record.skillMd } : {}),
    ...(str(record.publishedSource) ? { publishedSource: str(record.publishedSource)! } : {}),
  };
}

function pickCorpusOptions(options: PullSkillsOptions): PortableSkillOptions {
  // Resolve the corpus root once, here, through the ONE canonical resolver
  // (resolveCorpusRoot()/getPortableSkillsRoot()): after the owner-layout
  // migration (PR #116) the corpus cache is <app folder>/skills and sync reads
  // from there. Passing the resolved root as rootDir makes installCorpusSkillAtomically()
  // and installBundleAtomically() write to the same root sync reads — a pulled
  // skill is invisible to sync if it lands anywhere else.
  return { rootDir: resolveCorpusRoot(options) };
}

function extractSlug(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  return str(record.slug) ?? str(record.name);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Split `name@version` into its parts. A name without `@` pulls the current revision; an
 * empty version (`name@`) is an error the caller reports. Scoped-looking names are not a
 * concern here: skill slugs never start with `@`.
 */
export function splitNameVersion(raw: string): { name: string; version?: string } {
  const trimmed = raw.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return { name: trimmed };
  const name = trimmed.slice(0, at);
  const version = trimmed.slice(at + 1);
  return version ? { name, version } : { name };
}
