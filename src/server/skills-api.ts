/**
 * The published-skill half of /api/v1/skills.
 *
 * GET was already served entirely from the bundled corpus (src/server/registry.ts). This
 * module adds the rows an organization publishes to its own instance and merges the two
 * for every read, so one endpoint answers "what skills does this instance have" rather
 * than making a client ask twice and reconcile.
 *
 * Every read here takes the authenticated principal and is scoped to its org. That is not
 * a convention to be maintained by care: `store.listSkills`/`getSkill`/`getSkillBundle`
 * take a principal and have no unscoped variant, so there is no shape this module could
 * be written in that reads another tenant's rows.
 */
import { createHash } from "node:crypto";
import { ownBytes, type OwnedBytes } from "../lib/skill-bundle.js";
import type { SkillMeta } from "../lib/registry-types.js";
import { mergeSkillRegistryLists } from "../lib/registry-merge.js";
import { getPublicSkillPricing } from "../lib/pricing.js";
import type { ArtifactStorage } from "./artifact-storage.js";
import type { SkillsServerConfig } from "./config.js";
import { getServerSkill, getServerSkillMd, listServerSkills } from "./registry.js";
import type { ApiPrincipal, PublishSkillInput, ServerSkillRecord, SkillsProductStore } from "./types.js";

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

export class SkillRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
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
    // Straight from the pricing table, like every other skill. The hand-written object
    // this replaced put a deployment-variant name in `tier`, which is not a BillingTier
    // value at all - it answered "where does this run" in the field that answers "what
    // does a run cost". src/lib/public-package-boundary.test.ts bans that spelling from
    // emitted values, and this comment is deliberately written not to reintroduce it.
    pricing: getPublicSkillPricing(record.slug),
  };
}

export function publishedPayload(record: ServerSkillRecord): Record<string, unknown> {
  return {
    ...publishedSkillMeta(record),
    slug: record.slug,
    publishedSource: record.source,
    ...(record.bundleSha256 ? { bundleSha256: record.bundleSha256, bundleByteSize: record.bundleByteSize } : {}),
    publishedAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Bundled corpus plus this org's published skills, published winning on a slug collision.
 *
 * Same rule as the CLI-side merge in src/lib/registry-merge.ts and for the same reason: an
 * organization that published `deploy-notes` on their own instance meant to override the
 * bundled `deploy-notes` there.
 */
export async function listMergedSkills(store: SkillsProductStore, principal: ApiPrincipal): Promise<Record<string, unknown>[]> {
  const published = await store.listSkills(principal);
  const publishedBySlug = new Map(published.map((record) => [record.slug, record]));
  // The bundled list is handed over WHOLE, colliding slugs included, so the precedence
  // table is what resolves them. Pre-filtering the collisions out first made the merge
  // call a no-op over two disjoint sets - the right answer, produced by the filter rather
  // than by the rule any test was aiming at.
  const merged = mergeSkillRegistryLists(
    listServerSkills() as SkillMeta[],
    published.map(publishedSkillMeta),
  );
  return merged.map((skill) => {
    const record = publishedBySlug.get(skill.name);
    return record ? publishedPayload(record) : (skill as unknown as Record<string, unknown>);
  });
}

export async function getMergedSkill(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const record = await store.getSkill(principal, slug);
  if (record) return publishedPayload(record);
  const bundled = getServerSkill(slug);
  return bundled ? (bundled as unknown as Record<string, unknown>) : null;
}

export async function getMergedSkillMd(
  store: SkillsProductStore,
  principal: ApiPrincipal,
  slug: string,
): Promise<string | null> {
  const record = await store.getSkill(principal, slug);
  if (record?.skillMd) return record.skillMd;
  // A published skill with no SKILL.md must not fall through to a bundled skill of the
  // same name: the caller asked for the document belonging to the skill this instance
  // serves under that slug, and answering with a different skill's instructions is worse
  // than answering with nothing.
  if (record) return null;
  return getServerSkillMd(slug);
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
): Promise<ServerSkillRecord> {
  const superseded = (await store.getSkill(principal, parsed.input.slug))?.bundleSha256;
  let input: PublishSkillInput = { ...parsed.input, principal };
  if (parsed.bundleBytes && input.bundle) {
    const placement = await artifactStorage.putBundle(
      principal.orgId,
      input.bundle.sha256,
      parsed.bundleBytes,
      input.bundle.contentType,
    );
    input = { ...input, bundle: { ...input.bundle, ...placement } };
  }
  const record = await store.publishSkill(input);
  if (superseded && superseded !== record.bundleSha256) {
    await discardCollectedObject(store, artifactStorage, principal, superseded);
  }
  return record;
}

/**
 * Delete a published skill, and the stored object behind it when nothing else needs it.
 */
export async function deletePublishedSkill(
  store: SkillsProductStore,
  artifactStorage: ArtifactStorage,
  principal: ApiPrincipal,
  slug: string,
): Promise<boolean> {
  const record = await store.getSkill(principal, slug);
  if (!record) return false;
  const deleted = await store.deleteSkill(principal, slug);
  if (deleted && record.bundleSha256) {
    await discardCollectedObject(store, artifactStorage, principal, record.bundleSha256);
  }
  return deleted;
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

  const kindValue = optionalString(manifest.kind) ?? "executable";
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
    ...(optionalString(manifest.version) ? { version: optionalString(manifest.version)! } : {}),
    ...(skillMd ? { skillMd } : {}),
  };
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
