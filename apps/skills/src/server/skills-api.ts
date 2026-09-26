/**
 * Authenticated, organization-scoped skill publication and reads.
 * The server never merges its process-local CLI catalog into a tenant's data.
 */
import { createHash } from "node:crypto";
import { ownBytes, type OwnedBytes } from "../lib/skill-bundle.js";
import type { SkillMeta } from "../lib/registry-types.js";
import { REVISION_ID_PATTERN } from "../lib/revision.js";
import { isValidSkillVersion, SKILL_VERSION_RULE } from "../lib/skill-version.js";
import type { ArtifactStorage } from "./artifact-storage.js";
import type { SkillsServerConfig } from "./config.js";
import { SkillRevisionConflictError, SkillVersionExistsError, type ApiPrincipal, type PublishSkillInput, type ServerPin, type ServerSkillRecord, type ServerSkillVersion, type SkillLifecyclePatch, type SkillsProductStore } from "./types.js";

/**
 * Slug grammar, matching normalizePortableSkillName() in src/lib/portable-skills.ts.
 *
 * Anchored, and it excludes "/" and "." runs, so a slug can never climb out of a URL path
 * segment or a storage prefix. The bundle storage key is built from the digest rather
 * than the slug, so this is defence in depth rather than the only guard.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_SLUG_LENGTH = 128;
const MAX_SKILL_MD_BYTES = 512_000;
/**
 * Must stay above MAX_SKILL_MD_BYTES: `skills push` sends skillMd *inside* the manifest
 * part, so a manifest cap below it made the skillMd cap unreachable and produced an error
 * naming a limit the author had never heard of. The headroom covers the surrounding
 * fields.
 */
const MAX_MANIFEST_BYTES = MAX_SKILL_MD_BYTES + 64_000;
/** Multipart parts this endpoint understands. Anything else is refused unread-past. */
const ALLOWED_PUBLISH_PARTS = new Set(["manifest", "bundle"]);

/** Wire shape of a pin: the client-facing facts, without the storage columns. */
export function pinPayload(pin: ServerPin): Record<string, unknown> {
  return { slug: pin.slug, pinnedAt: pin.pinnedAt, metadata: pin.metadata };
}

/**
 * The metadata field of a pin body.
 *
 * Absent means an empty object (matching the schema default), present-and-not-an-
 * object is refused rather than coerced: a client that sends `metadata: "team"`
 * sent a bug, and storing it as `{}` would make the round-trip silently lose
 * what the caller wrote. The route calls this on the parsed JSON body before
 * touching the store, so a malformed body is a 400 and never a row.
 */
export function pinMetadataField(body: Record<string, unknown>): Record<string, unknown> {
  if (body.metadata === undefined) return {};
  if (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
    throw new SkillRequestError(400, "INVALID_METADATA", "`metadata` must be a JSON object");
  }
  return body.metadata as Record<string, unknown>;
}

export class SkillRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function skillLifecyclePatch(body: Record<string, unknown>): SkillLifecyclePatch {
  if (body.lifecycle !== "active" && body.lifecycle !== "archived") throw new SkillRequestError(400, "INVALID_LIFECYCLE", "lifecycle must be active or archived");
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 512)) throw new SkillRequestError(400, "INVALID_LIFECYCLE", "reason must be at most 512 characters");
  if (body.replacementSlug !== undefined && (typeof body.replacementSlug !== "string" || !SLUG_PATTERN.test(body.replacementSlug))) throw new SkillRequestError(400, "INVALID_LIFECYCLE", "replacementSlug must be a valid skill slug");
  return { lifecycle: body.lifecycle, ...(body.reason ? { reason: body.reason } : {}), ...(body.replacementSlug ? { replacementSlug: body.replacementSlug } : {}) };
}

/** SkillMeta shape for a published row, so a client can treat both kinds alike. */
export function publishedSkillMeta(record: ServerSkillRecord): SkillMeta {
  return {
    name: record.slug,
    displayName: record.displayName,
    description: record.description,
    category: record.category,
    tags: record.tags,
    ...(record.version ? { version: record.version } : {}),
    kind: record.kind,
    // "remote" from the client's point of view: it came off an instance over HTTP. The
    // row's own `source` column records how it got onto the instance and is surfaced
    // separately as `publishedSource` rather than overwriting this.
    source: "remote",
    availability: { status: "available" },
  };
}

/**
 * SkillMeta shape for a published row, plus a payload-level "alreadyPublished" flag:
 * true when the accepted publish found the version already recorded with the same
 * digest (an idempotent re-push), so the CLI can distinguish "published as X" from
 * "already published as X" (hasna/apps#1671).
 */
export function publishedPayload(record: ServerSkillRecord, opts: { alreadyPublished?: boolean } = {}): Record<string, unknown> {
  return {
    ...publishedSkillMeta(record),
    slug: record.slug,
    publishedSource: record.source,
    ...(opts.alreadyPublished ? { alreadyPublished: true } : {}),
    // The row's SKILL.md rides in the metadata so a client can recompute the
    // content-addressed revision id and prove the declared revision identifies what it
    // received (todos d061fcda). Without it the client cannot recompute and must refuse.
    ...(record.skillMd ? { skillMd: record.skillMd } : {}),
    ...(record.bundleSha256 ? { bundleSha256: record.bundleSha256, bundleByteSize: record.bundleByteSize } : {}),
    publishedAt: record.createdAt,
    updatedAt: record.updatedAt,
    // Revision identity (todos d061fcda): revisionId is the ETag value, revisionNumber
    // the per-slug write counter. A client that pushed or pulled the skill can prove
    // which revision it holds, and a guarded write names one of these.
    revisionId: record.revisionId,
    revisionNumber: record.revisionNumber,
    lifecycle: record.lifecycle,
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
    ...(record.archiveReason ? { archiveReason: record.archiveReason } : {}),
    ...(record.replacementSlug ? { replacementSlug: record.replacementSlug } : {}),
  };
}

/**
 * The HTTP ETag for a published row: the revision id, quoted exactly as RFC 9110 wants.
 * The quotes are load-bearing — a client that echoes the whole header value back as
 * If-Match must send the quotes too.
 */
export function revisionEtag(revisionId: string): string {
  return `"${revisionId}"`;
}

/**
 * Parse an If-Match header value into the revision id it names.
 *
 * Accepts the quoted form the server itself issues (RFC 9110) and a bare id for
 * tolerance. `*` is refused: "any revision" would license exactly the silent overwrite
 * the optimistic-concurrency guard exists to refuse. Malformed values are a 400
 * statement about the request, never a fallback to "no guard".
 */
export function parseIfMatch(value: string | null): string | undefined {
  if (value === null || value.trim() === "") return undefined;
  const trimmed = value.trim();
  if (trimmed === "*") {
    throw new SkillRequestError(400, "INVALID_IF_MATCH", "If-Match must name the exact revision id (the ETag of the current revision); '*' is not accepted");
  }
  const unquoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  if (!REVISION_ID_PATTERN.test(unquoted)) {
    throw new SkillRequestError(400, "INVALID_IF_MATCH", "If-Match must carry a revision id: a 64-character lowercase hex sha-256, quoted as the server's ETag");
  }
  return unquoted;
}

/**
 * Resolve a stored row that may be a tombstone (todos d061fcda).
 *
 * A tombstoned row answers 410 with the marker while its window is open, so a client's
 * pull can reconcile (remove the local copy). Once the window has passed the tombstone
 * is purged and the slug is simply gone (404). Returns "purged" when the caller should
 * answer 404, a tombstone payload when it should answer 410, or "live" for a live row.
 *
 * Purging drops the store's bundle row and, for every purged record, the S3 object
 * behind it — the same getSkillBundle-then-delete dance the publish/delete paths use,
 * so an object whose digest another row still references survives.
 */
export async function tombstoneStatus(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  record: ServerSkillRecord,
): Promise<"live" | "purged" | Record<string, unknown>> {
  if (!record.tombstonedAt) return "live";
  if (record.tombstonePurgeAfter && record.tombstonePurgeAfter <= new Date().toISOString()) {
    const purged = await store.purgeExpiredTombstones(principal);
    for (const removed of purged) {
      if (removed.bundleSha256) await discardCollectedObject(store, artifactStorage, principal, removed.bundleSha256);
    }
    return "purged";
  }
  return {
    slug: record.slug,
    deleted: true,
    code: "TOMBSTONED",
    tombstonedAt: record.tombstonedAt,
    tombstonePurgeAfter: record.tombstonePurgeAfter,
    revisionId: record.revisionId,
  };
}

/** List only records belonging to the authenticated organization. */
export async function listMergedSkills(store: SkillsProductStore, principal: ApiPrincipal): Promise<Record<string, unknown>[]> {
  return (await store.listSkills(principal))
    .filter((record) => record.lifecycle === "active")
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((record) => publishedPayload(record));
}

/**
 * What a read of one slug resolves to: the org's published row (live or tombstoned) or
 * nothing. Tombstones retain their 410 response until expiry; no machine-local
 * content can substitute for an absent or deleted organization record.
 */
export type SkillReadResolution =
  | { kind: "published"; record: ServerSkillRecord }
  | { kind: "tombstone"; payload: Record<string, unknown> }
  | { kind: "absent" };

export async function resolvePublishedSkill(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  slug: string,
): Promise<SkillReadResolution> {
  const record = await store.getSkill(principal, slug);
  if (!record) return { kind: "absent" };
  const status = await tombstoneStatus(store, artifactStorage, principal, record);
  if (status === "purged") return { kind: "absent" };
  if (status !== "live") return { kind: "tombstone", payload: status as Record<string, unknown> };
  return { kind: "published", record };
}

/** Distinct, non-empty tags in the authenticated organization's published catalog. */
export async function listOrgTags(store: SkillsProductStore, principal: ApiPrincipal): Promise<string[]> {
  return [...new Set((await store.listTags(principal)).filter((tag) => tag.trim()))].sort();
}

/** The same organization catalog filtered through the store's indexed tag query. */
export async function listMergedSkillsByTag(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  tag: string,
): Promise<Record<string, unknown>[]> {
  return (await store.listSkillsByTag(principal, tag))
    .filter((record) => record.lifecycle === "active")
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((record) => publishedPayload(record));
}

/**
 * The minimal per-skill wire row the tag/sync summary routes serve: the client's
 * RemoteSkillSummary contract ({ slug, name?, version?, updatedAt? }).
 */
export function skillSummary(skill: Record<string, unknown>): Record<string, unknown> {
  return {
    slug: String(skill.slug ?? skill.name),
    ...(typeof skill.name === "string" ? { name: skill.name } : {}),
    ...(typeof skill.version === "string" ? { version: skill.version } : {}),
    ...(typeof skill.updatedAt === "string" ? { updatedAt: skill.updatedAt } : {}),
  };
}

/** Only published skills in this organization can contribute tags to its pins. */
export async function listPinsByTag(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  tag: string,
): Promise<Record<string, unknown>[]> {
  return (await store.listPinsByTag(principal, tag))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map(pinPayload);
}

export async function getMergedSkill(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const resolved = await resolvePublishedSkill(store, artifactStorage, principal, slug);
  if (resolved.kind === "tombstone") return resolved.payload;
  if (resolved.kind === "published") return publishedPayload(resolved.record);
  return null;
}

/**
 * The SKILL.md document for one slug, or null when nothing is served under it.
 *
 * A tombstoned slug returns null here; the caller that needs the 410 marker resolves
 * the tombstone itself via resolvePublishedSkill before calling.
 */
export async function getMergedSkillMd(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  slug: string,
): Promise<string | null> {
  const resolved = await resolvePublishedSkill(store, artifactStorage, principal, slug);
  if (resolved.kind === "tombstone") return null;
  if (resolved.kind === "published") return resolved.record.skillMd ?? null;
  return null;
}

interface ParsedPublish {
  input: Omit<PublishSkillInput, "principal">;
  bundleBytes?: OwnedBytes;
}

/**
 * Read a publish request.
 *
 * Two accepted encodings, both deliberate:
 *   - multipart/form-data with a `manifest` JSON part and a `bundle` file part. This is
 *     the one `skills push` uses. The bundle never passes through readJson(), so the 1 MB
 *     JSON cap is neither raised nor bypassed - the bundle has its own, larger cap.
 *   - application/json for a metadata-only publish (an instruction skill with no files).
 *     Subject to the ordinary JSON cap, because it is an ordinary JSON body.
 *
 * On what the size checks here can and cannot do. Content-Length is a claim: a chunked
 * request need not send one, so the header check is an early-out, never the guarantee.
 * The real ceiling is Bun.serve's `maxRequestBodySize`, set from the same config value in
 * app.ts, which refuses at the socket before this function is reached. The checks below
 * are what remains meaningful once the body is in hand: the per-part limits, and the
 * refusal of any part this endpoint did not ask for - without which a request could carry
 * a compliant `manifest`, a compliant `bundle`, and unbounded extra parts that nothing
 * measured.
 */
export async function parsePublishRequest(request: Request, config: SkillsServerConfig): Promise<ParsedPublish> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    assertUnderLimit(request, config.skillBundleLimitBytes);
    let form: FormData;
    try {
      form = await request.formData();
    } catch (error) {
      throw new SkillRequestError(400, "MALFORMED_MULTIPART", `could not read the multipart body: ${(error as Error).message}`);
    }
    // Unknown parts are refused rather than ignored. Ignoring them means the only bytes
    // this endpoint bounds are the two it looks at, and a caller can put the rest
    // anywhere it likes.
    for (const name of new Set([...form.keys()])) {
      if (!ALLOWED_PUBLISH_PARTS.has(name)) {
        throw new SkillRequestError(400, "UNEXPECTED_PART", `unexpected multipart field '${name}'; only 'manifest' and 'bundle' are accepted`);
      }
    }
    if ([...form.getAll("bundle")].length > 1 || [...form.getAll("manifest")].length > 1) {
      throw new SkillRequestError(400, "DUPLICATE_PART", "'manifest' and 'bundle' may each appear at most once");
    }

    const manifestPart = form.get("manifest");
    if (typeof manifestPart !== "string") {
      throw new SkillRequestError(400, "MANIFEST_REQUIRED", "multipart publish requires a `manifest` field holding the skill metadata as JSON");
    }
    if (byteLength(manifestPart) > MAX_MANIFEST_BYTES) {
      throw new SkillRequestError(413, "MANIFEST_TOO_LARGE", `manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    const manifest = parseManifestJson(manifestPart);

    const bundlePart = form.get("bundle");
    if (bundlePart === null) return { input: buildPublishInput(manifest) };
    if (typeof bundlePart === "string") {
      throw new SkillRequestError(400, "BUNDLE_NOT_A_FILE", "the `bundle` field must be a file part, not a string");
    }
    const bundleBytes = ownBytes(await bundlePart.arrayBuffer());
    // Checked again after buffering: Content-Length is a claim, and a chunked upload
    // does not have to send one at all.
    if (bundleBytes.byteLength > config.skillBundleLimitBytes) {
      throw new SkillRequestError(413, "BUNDLE_TOO_LARGE", `bundle is ${bundleBytes.byteLength} bytes, over the ${config.skillBundleLimitBytes} byte limit`);
    }
    if (bundleBytes.byteLength === 0) {
      throw new SkillRequestError(400, "BUNDLE_EMPTY", "the uploaded bundle is empty");
    }

    const sha256 = createHash("sha256").update(bundleBytes).digest("hex");
    const claimed = optionalString(manifest.bundleSha256);
    // Shape before comparison, so `bundleSha256: "oops"` is reported as a malformed
    // digest rather than as a content mismatch - the two send the caller looking in
    // completely different places.
    if (claimed) assertSha256(claimed);
    if (claimed && claimed !== sha256) {
      throw new SkillRequestError(400, "BUNDLE_DIGEST_MISMATCH", `bundle digest ${sha256} does not match the declared ${claimed}`);
    }

    const input = buildPublishInput(manifest);
    return {
      input: {
        ...input,
        bundle: {
          sha256,
          byteSize: bundleBytes.byteLength,
          contentType: optionalString(manifest.bundleContentType) ?? "application/gzip",
          storageKind: "db",
        },
      },
      bundleBytes,
    };
  }

  assertUnderLimit(request, config.requestBodyLimitBytes);
  const text = await request.text();
  if (byteLength(text) > config.requestBodyLimitBytes) {
    throw new SkillRequestError(413, "BODY_TOO_LARGE", "request body too large");
  }
  return { input: buildPublishInput(parseManifestJson(text)) };
}

export async function storePublishedSkill(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  parsed: ParsedPublish,
  expectedRevisionId?: string,
): Promise<{ record: ServerSkillRecord; alreadyPublished: boolean }> {
  const current = await store.getSkill(principal, parsed.input.slug);
  const superseded = current?.bundleSha256;
  let input: PublishSkillInput = {
    ...parsed.input,
    principal,
    // Optimistic-concurrency guard (todos d061fcda): carried into the store so a publish
    // against an existing, live row is refused with a conflict unless it names the
    // row's current revision. First publishes and revives over a tombstone need no guard.
    ...(expectedRevisionId ? { expectedRevisionId } : {}),
  };
  if (input.seedBundledOnly && expectedRevisionId && !current) {
    throw new SkillRevisionConflictError(input.slug, expectedRevisionId, null);
  }
  if (input.seedBundledOnly && current && (current.tombstonedAt || current.source !== "bundled")) {
    throw new SkillRevisionConflictError(input.slug, expectedRevisionId, current.revisionId);
  }
  // The optimistic-concurrency guard is answered first, the way the stores answer it: a
  // writer that has not read the live row (no or stale If-Match) gets REVISION_CONFLICT
  // before anything is said about versions, so the two refusals keep their existing order.
  if (current && !current.tombstonedAt && expectedRevisionId !== current.revisionId) {
    throw new SkillRevisionConflictError(input.slug, expectedRevisionId, current.revisionId);
  }
  // Immutable versions (hasna/apps#1630): name@version with a different digest is refused
  // BEFORE any object is written, so a refused publish leaves nothing behind in the bucket.
  const versioned = Boolean(parsed.bundleBytes && input.bundle && input.version);
  const existingVersion = versioned ? await store.getSkillVersion(principal, input.slug, input.version!) : null;
  if (versioned && existingVersion && existingVersion.bundleSha256 !== input.bundle!.sha256) {
    throw new SkillVersionExistsError(input.slug, input.version!, existingVersion.bundleSha256, input.bundle!.sha256);
  }
  if (parsed.bundleBytes && input.bundle) {
    const placement = await artifactStorage.putBundle(
      principal.orgId,
      input.bundle.sha256,
      parsed.bundleBytes,
      input.bundle.contentType,
    );
    input = { ...input, bundle: { ...input.bundle, ...placement } };
  }
  // A versioned publish with bytes also gets a version-addressed copy plus manifest.json,
  // so the history is browsable and survives the content-addressed object being collected
  // by a later re-publish. The placement is recorded on the row now; the objects are
  // written only AFTER the row is committed, so a publish the store refuses (a writer that
  // raced the guard above) never touches a version key that belongs to someone else's
  // successful publish.
  //
  // A re-publish of the SAME digest re-writes them rather than skipping: the bytes are
  // identical by construction (the digest is checked above), so the PUT is idempotent, and
  // it is what heals a row whose first object write failed after the row was committed.
  // Without this the 502 below would be permanent - the retry would find the version row
  // and write nothing, leaving a row pointing at a key that does not exist.
  const writeVersionObjects = versioned && Boolean(parsed.bundleBytes) && Boolean(input.bundle);
  let versionManifest: Record<string, unknown> | undefined;
  if (writeVersionObjects) {
    versionManifest = existingVersion
      ? { ...(existingVersion.manifest ?? {}), slug: input.slug, version: input.version, bundleSha256: input.bundle!.sha256, bundleByteSize: input.bundle!.byteSize }
      : {
          ...(input.versionManifest ?? {}),
          slug: input.slug,
          version: input.version,
          bundleSha256: input.bundle!.sha256,
          bundleByteSize: input.bundle!.byteSize,
          publishedAt: new Date().toISOString(),
        };
    if (!existingVersion) {
      input = {
        ...input,
        versionManifest,
        versionStorage: artifactStorage.versionPlacement(principal.orgId, input.slug, input.version!),
      };
    }
  }
  let record: ServerSkillRecord;
  try {
    record = await store.publishSkill(input);
  } catch (error) {
    // The object was uploaded before the store could refuse the write - the designed
    // 409 for a stale/missing If-Match, or any other store error - and the digest-keyed
    // object now has no row referencing it (the bundle INSERT never ran, or rolled
    // back with the transaction). Discard it under the same reference guard the success
    // path uses, so content-addressed reuse is never deleted out from under a live
    // skill, then rethrow: the refusal is the caller's to report.
    if (input.bundle?.sha256) {
      await discardCollectedObject(store, artifactStorage, principal, input.bundle.sha256);
    }
    throw error;
  }
  if (superseded && superseded !== record.bundleSha256) {
    await discardCollectedObject(store, artifactStorage, principal, superseded);
  }
  if (writeVersionObjects && versionManifest && parsed.bundleBytes && input.bundle) {
    try {
      await artifactStorage.putVersionObjects(principal.orgId, input.slug, input.version!, parsed.bundleBytes, versionManifest, input.bundle.contentType);
    } catch (error) {
      // The row is committed and the content-addressed object serves reads; only the
      // browsable copy is missing. Say so rather than pretend — and because an identical
      // re-publish rewrites the objects, retrying the same push is what repairs it.
      throw new SkillRequestError(
        502,
        "VERSION_OBJECTS_WRITE_FAILED",
        `'${input.slug}@${input.version}' was recorded but its version-addressed objects could not be written: ${(error as Error).message}. Re-run the same push to write them.`,
      );
    }
  }
  // `alreadyPublished` is the server's word that this accepted publish found the version
  // already recorded with the same digest — an idempotent re-push, not a fresh one. The
  // client reports the distinction instead of claiming a publish that did not happen
  // (hasna/apps#1671).
  return { record, alreadyPublished: existingVersion !== null };
}

/**
 * Tombstone a published skill (todos d061fcda): the row survives with a tombstone
 * marker for `tombstoneWindowMs`, so reads answer 410 and a pulling client can
 * reconcile, and the bundle is retained until the purge. The stored object is NOT
 * discarded here — the tombstoned row still references it; the purge discards it.
 * Returns the tombstoned record, or null when the org has no row by that slug.
 */
export async function deletePublishedSkill(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  slug: string,
  tombstoneWindowMs: number,
): Promise<ServerSkillRecord | null> {
  return store.deleteSkill(principal, slug, tombstoneWindowMs);
}

/**
 * Drop the object for a digest the store has already decided to stop tracking.
 *
 * The reference-count decision belongs to the store - it is the one holding the rows and
 * the transaction - so this asks it for the outcome rather than re-deriving it: if the
 * bundle row is gone, the object should go too. Getting that ordering backwards would
 * delete the bytes of a digest another skill still points at.
 */
async function discardCollectedObject(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  sha256: string,
): Promise<void> {
  if (await store.getSkillBundle(principal, sha256)) return;
  await artifactStorage.deleteBundle(principal.orgId, sha256);
}

/**
 * Read a published bundle back, refusing to serve bytes that no longer hash to the digest
 * they were stored under.
 *
 * This is what the sha256 column buys. Storage drift - a truncated blob, an S3 object
 * replaced out of band, a bad restore - is otherwise completely silent: the client
 * receives a shorter tarball, extraction fails somewhere unrelated, and nothing points at
 * storage. Verifying on read turns that into one error naming the digest.
 */
export async function readPublishedBundle(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  slug: string,
): Promise<{ record: ServerSkillRecord; bytes: OwnedBytes }> {
  const record = await store.getSkill(principal, slug);
  if (!record) throw new SkillRequestError(404, "SKILL_NOT_FOUND", "skill not found");
  if (!record.bundleSha256) throw new SkillRequestError(404, "BUNDLE_NOT_FOUND", `skill '${slug}' was published without a bundle`);
  const bundle = await store.getSkillBundle(principal, record.bundleSha256);
  if (!bundle) throw new SkillRequestError(404, "BUNDLE_NOT_FOUND", `no stored bundle for digest ${record.bundleSha256}`);
  const bytes = await artifactStorage.readBundle(bundle);
  if (!bytes) {
    throw new SkillRequestError(503, "BUNDLE_BACKEND_UNAVAILABLE", "bundle storage backend unavailable");
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== record.bundleSha256) {
    throw new SkillRequestError(
      500,
      "BUNDLE_DIGEST_DRIFT",
      `stored bundle for '${slug}' hashes to ${actual} but was published as ${record.bundleSha256}`,
    );
  }
  return { record, bytes };
}

export function assertPublishableSlug(slug: string): void {
  if (slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new SkillRequestError(
      400,
      "INVALID_SLUG",
      `'${slug}' is not a valid skill slug: use lowercase letters, numbers, dots, underscores, or hyphens, starting with a letter or number`,
    );
  }
}

export function assertSha256(value: string): void {
  if (!SHA256_HEX.test(value)) throw new SkillRequestError(400, "INVALID_DIGEST", "digest must be a lowercase hex sha-256");
}

function assertUnderLimit(request: Request, limit: number): void {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    throw new SkillRequestError(413, "BODY_TOO_LARGE", `request body is ${declared} bytes, over the ${limit} byte limit`);
  }
}

function parseManifestJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SkillRequestError(400, "MALFORMED_JSON", `manifest is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SkillRequestError(400, "MALFORMED_JSON", "manifest must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function buildPublishInput(manifest: Record<string, unknown>): Omit<PublishSkillInput, "principal"> {
  const slug = optionalString(manifest.slug) ?? optionalString(manifest.name);
  if (!slug) throw new SkillRequestError(400, "SLUG_REQUIRED", "manifest must carry `slug` (or `name`)");
  assertPublishableSlug(slug);

  const description = optionalString(manifest.description);
  if (!description) throw new SkillRequestError(400, "DESCRIPTION_REQUIRED", "manifest must carry a non-empty `description`");

  const skillMd = optionalText(manifest.skillMd);
  if (skillMd && byteLength(skillMd) > MAX_SKILL_MD_BYTES) {
    throw new SkillRequestError(413, "SKILL_MD_TOO_LARGE", `skillMd exceeds ${MAX_SKILL_MD_BYTES} bytes`);
  }

  // Absent `kind` is a doc-only publish, never a claimed `executable` (task 568efaaa /
  // P-01641): the stored row's kind drives the pull->sync decision downstream, and
  // coercing an absent kind to "executable" laundered full-content skills into pointer
  // stubs. A publish that does not declare executability is consumed as prose, exactly
  // like the corpus-side default in writeCorpusSkill; runnable skills declare
  // `kind: executable` (declaration wins).
  const kindValue = optionalString(manifest.kind) ?? "instruction";
  if (kindValue !== "executable" && kindValue !== "instruction") {
    throw new SkillRequestError(400, "INVALID_KIND", "`kind` must be 'executable' or 'instruction'");
  }

  const claimedDigest = optionalString(manifest.bundleSha256);
  if (claimedDigest) assertSha256(claimedDigest);

  return {
    slug,
    displayName: optionalString(manifest.displayName) ?? titleize(slug),
    description,
    category: optionalString(manifest.category) ?? "Development Tools",
    tags: stringArray(manifest.tags),
    // Provenance of how the row got here. Constrained so a client cannot label its upload
    // "official" and have the CLI-side merge treat it as the bundled corpus.
    source: publishSource(optionalString(manifest.source)),
    kind: kindValue,
    ...(publishVersionOf(manifest) ? { version: publishVersionOf(manifest)! } : {}),
    ...(skillMd ? { skillMd } : {}),
    ...(versionManifestOf(manifest) ? { versionManifest: versionManifestOf(manifest)! } : {}),
  };
}

/**
 * The publisher's version manifest (hasna/apps#1630): file digests, byte counts, provenance.
 * Stored verbatim on the version row and written beside the bundle as manifest.json. Bounded
 * so a manifest cannot smuggle a second bundle through the metadata channel.
 */
const MAX_VERSION_MANIFEST_BYTES = 512 * 1024;
function versionManifestOf(manifest: Record<string, unknown>): Record<string, unknown> | null {
  const value = manifest.versionManifest;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = JSON.stringify(value);
  if (byteLength(text) > MAX_VERSION_MANIFEST_BYTES) {
    throw new SkillRequestError(413, "VERSION_MANIFEST_TOO_LARGE", `versionManifest exceeds ${MAX_VERSION_MANIFEST_BYTES} bytes`);
  }
  return value as Record<string, unknown>;
}

/**
 * What a client is allowed to claim about where its skill came from.
 *
 * "official" is not in the set. It is the lowest-precedence source in the CLI merge and
 * the label for the bundled corpus; letting an upload assert it would be a client
 * choosing its own position in someone else's precedence order.
 */
function publishSource(value: string | undefined): string {
  const allowed = new Set(["custom", "private", "private-hosted", "upstream", "extension"]);
  return value && allowed.has(value) ? value : "custom";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * A non-empty string kept exactly as sent.
 *
 * optionalString() trims, which is right for a slug or a display name and wrong for a
 * document. SKILL.md is served back verbatim to agents, and running every publish through
 * a trimming reader silently deleted the file's trailing newline - a diff between what
 * the author wrote and what every machine then read, introduced by the transport.
 */
function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function titleize(name: string): string {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Versions surface (hasna/apps#1630).
 *
 * GET /api/v1/skills/:slug/versions           -> { slug, current, versions: [...] }
 * GET /api/v1/skills/:slug/versions/:version  -> one version's manifest
 * GET /api/v1/skills/:slug/versions/:version/bundle -> the exact bytes of that version
 *
 * The registry row is the "current" pointer; a version's bytes come from the
 * content-addressed bundle store so db-mode instances serve history exactly like S3 ones.
 */
export function skillVersionPayload(version: ServerSkillVersion, currentSha?: string): Record<string, unknown> {
  return {
    slug: version.slug,
    version: version.version,
    bundleSha256: version.bundleSha256,
    bundleByteSize: version.bundleByteSize,
    storageKind: version.storageKind,
    ...(version.storageKey ? { storageKey: version.storageKey } : {}),
    manifest: version.manifest,
    ...(version.publishedByUserId ? { publishedByUserId: version.publishedByUserId } : {}),
    createdAt: version.createdAt,
    current: currentSha !== undefined && currentSha === version.bundleSha256,
  };
}

export async function listSkillVersionsPayload(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  slug: string,
): Promise<Record<string, unknown>> {
  assertPublishableSlug(slug);
  const record = await store.getSkill(principal, slug);
  const versions = await store.listSkillVersions(principal, slug);
  if (!record && !versions.length) throw new SkillRequestError(404, "SKILL_NOT_FOUND", "skill not found");
  const currentSha = record?.bundleSha256;
  return {
    slug,
    ...(record?.version ? { currentVersion: record.version } : {}),
    ...(currentSha ? { currentBundleSha256: currentSha } : {}),
    versions: versions.map((version) => skillVersionPayload(version, currentSha)),
  };
}

export async function readSkillVersion(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  slug: string,
  version: string,
): Promise<ServerSkillVersion> {
  assertPublishableSlug(slug);
  if (!isValidSkillVersion(version)) {
    throw new SkillRequestError(400, "INVALID_VERSION", `version '${version.slice(0, 40)}' is not a valid skill version (${SKILL_VERSION_RULE})`);
  }
  const found = await store.getSkillVersion(principal, slug, version);
  if (!found) throw new SkillRequestError(404, "SKILL_VERSION_NOT_FOUND", `no published version '${version}' of '${slug}'`);
  return found;
}

export async function readSkillVersionBundle(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  slug: string,
  version: string,
): Promise<{ version: ServerSkillVersion; bytes: OwnedBytes }> {
  const found = await readSkillVersion(store, principal, slug, version);
  // Deletion withholds content (todos d061fcda), historic versions included: a tombstoned
  // slug answers 410 here exactly as /bundle does, and a purged one 404. The version rows
  // themselves stay listable - they are the history, not the content.
  const resolved = await resolvePublishedSkill(store, artifactStorage, principal, slug);
  if (resolved.kind === "tombstone") throw new SkillRequestError(410, "SKILL_DELETED", `'${slug}' was deleted; its version bundles are withheld while the slug is deleted`);
  if (resolved.kind === "absent") throw new SkillRequestError(404, "SKILL_NOT_FOUND", `'${slug}' is not published`);
  const bundle = await store.getSkillBundle(principal, found.bundleSha256);
  if (!bundle) throw new SkillRequestError(404, "BUNDLE_NOT_FOUND", `no stored bundle for digest ${found.bundleSha256}`);
  const bytes = await artifactStorage.readBundle(bundle);
  if (!bytes) throw new SkillRequestError(503, "BUNDLE_BACKEND_UNAVAILABLE", "bundle storage backend unavailable");
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== found.bundleSha256) {
    throw new SkillRequestError(
      500,
      "BUNDLE_DIGEST_DRIFT",
      `stored bundle for '${slug}@${version}' hashes to ${actual} but was published as ${found.bundleSha256}`,
    );
  }
  return { version: found, bytes };
}

/** The manifest's version, validated as a path-safe version string (hasna/apps#1630). */
function publishVersionOf(manifest: Record<string, unknown>): string | undefined {
  const version = optionalString(manifest.version);
  if (version === undefined) return undefined;
  if (!isValidSkillVersion(version)) {
    throw new SkillRequestError(400, "INVALID_VERSION", `version '${version.slice(0, 40)}' is not a valid skill version (${SKILL_VERSION_RULE})`);
  }
  return version;
}
