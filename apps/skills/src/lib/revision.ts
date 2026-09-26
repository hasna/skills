/**
 * Revision identity for the hosted registry (todos d061fcda, plan 8022d27f).
 *
 * A revision is a sha-256 over a canonical serialisation of the row's published content.
 * Two facts follow from hashing content rather than minting an id:
 *
 *   - the id is IMMUTABLE for identical content: pushing the same bytes twice produces
 *     the same revision_id (revision_number still advances — it counts writes, and a
 *     write happened);
 *   - the id is PROVABLE: a client that holds a bundle and a revision id can recompute
 *     the id from the content it received, which is what "pull can prove which revision
 *     it installed" means at the client boundary.
 *
 * The serialisation is a fixed-key-order JSON string. Key order is load-bearing: the
 * same object serialised by two machines must hash identically, and JSON.stringify
 * preserves insertion order, so the keys are written in a fixed order here and never
 * alphabetised or re-ordered. Tags keep the order they were published in — a reordered
 * tag list is a content change and rightly mints a new revision.
 */
import { createHash } from "node:crypto";

/** The row's content-addressed revision identity: a lowercase hex sha-256. */
export const REVISION_ID_PATTERN = /^[0-9a-f]{64}$/;

export interface RevisionContent {
  slug: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  source: string;
  kind: "executable" | "instruction";
  version?: string;
  skillMd?: string;
  bundleSha256?: string;
  bundleByteSize?: number;
  lifecycle?: "active" | "archived";
  archiveReason?: string;
  replacementSlug?: string;
}

export function revisionIdOf(content: RevisionContent): string {
  const canonicalContent = {
    slug: content.slug,
    displayName: content.displayName,
    description: content.description,
    category: content.category,
    tags: content.tags,
    source: content.source,
    kind: content.kind,
    version: content.version ?? null,
    skillMd: content.skillMd ?? null,
    bundleSha256: content.bundleSha256 ?? null,
    bundleByteSize: content.bundleByteSize ?? null,
  } as Record<string, unknown>;
  // Keep the legacy active-row hash byte-compatible. Archived state is a
  // deliberate revision-bearing transition; active rows with no archive
  // metadata retain the pre-lifecycle canonical form for old clients and
  // migration backfills.
  if (content.lifecycle === "archived" || content.archiveReason !== undefined || content.replacementSlug !== undefined) {
    canonicalContent.lifecycle = content.lifecycle ?? "active";
    canonicalContent.archiveReason = content.archiveReason ?? null;
    canonicalContent.replacementSlug = content.replacementSlug ?? null;
  }
  const canonical = JSON.stringify(canonicalContent);
  return createHash("sha256").update(canonical).digest("hex");
}

export function revisionIdOfRecord(record: RevisionContent): string {
  return revisionIdOf(record);
}

/**
 * The legacy-row marker the 0004 migration leaves behind.
 *
 * Migration 0004 adds revision_id with DEFAULT '', so rows written before the migration
 * carry an empty id. An empty id would make the If-Match guard vacuous for those rows:
 * two clients that both read '' would both "match" and both land, silently overwriting
 * each other. The stores replace the marker with a real content sha on first open
 * (idempotent: new code always writes a full id, so the marker never reappears).
 */
export const LEGACY_REVISION_ID = "";

/** True when a revision id is the empty legacy marker (needs backfill). */
export function isLegacyRevisionId(value: string): boolean {
  return value === LEGACY_REVISION_ID;
}
