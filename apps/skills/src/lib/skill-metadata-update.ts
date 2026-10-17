import { revisionIdOf, REVISION_ID_PATTERN, type RevisionContent } from "./revision.js";

export interface SkillMetadataPatch { category?: string; tags?: string[] }
/** Private preservation snapshot: includes the original instruction body. */
export interface SkillMetadataUpdatePlan {
  schemaVersion: 1;
  authority: string;
  organizationId: string;
  expectedRevisionId: string;
  originalDocument: string;
  before: RevisionContent;
  patch: SkillMetadataPatch;
}
export class SkillMetadataUpdateError extends Error {
  constructor(readonly code: "METADATA_AUTH_REQUIRED" | "INVALID_METADATA_PATCH" | "INVALID_METADATA_SNAPSHOT" | "INVALID_METADATA_PLAN" | "METADATA_REVISION_CONFLICT" | "METADATA_UPDATE_UNCONFIRMED") {
    super({
      METADATA_AUTH_REQUIRED: "Metadata updates require a signed-in Skills connection; use skills login.",
      INVALID_METADATA_PATCH: "Metadata patch accepts only category (a nonempty string) and tags (an array of unique nonempty strings).",
      INVALID_METADATA_SNAPSHOT: "The current skill must carry a matching quoted revision ETag and complete verifiable metadata, body and bundle identity.",
      INVALID_METADATA_PLAN: "The saved metadata plan must name its original revision, authority, organization, complete original content and category/tags-only patch.",
      METADATA_REVISION_CONFLICT: "The skill revision changed after preview; inspect it and prepare a new plan.",
      METADATA_UPDATE_UNCONFIRMED: "Metadata update could not be confirmed by authoritative readback; inspect the current revision before preparing another write.",
    }[code]);
  }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
export function metadataPatch(value: unknown): SkillMetadataPatch {
  if (!object(value) || !Object.keys(value).length || Object.keys(value).some(key => !["category", "tags"].includes(key))) throw new SkillMetadataUpdateError("INVALID_METADATA_PATCH");
  if (Object.hasOwn(value, "category") && !text(value.category)) throw new SkillMetadataUpdateError("INVALID_METADATA_PATCH");
  if (Object.hasOwn(value, "tags") && (!Array.isArray(value.tags) || value.tags.length > 100 || value.tags.some(tag => !text(tag)) || new Set(value.tags).size !== value.tags.length)) throw new SkillMetadataUpdateError("INVALID_METADATA_PATCH");
  return structuredClone(value) as SkillMetadataPatch;
}
/** Normalize exactly the owning registry's revision fields, never arbitrary extras. */
export function metadataSnapshot(value: unknown, etag: string | null): { content: RevisionContent; revisionId: string } {
  if (!object(value) || !text(value.slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)
    || ![value.displayName, value.description, value.category, value.publishedSource].every(field => typeof field === "string")
    || !Array.isArray(value.tags) || value.tags.some(tag => typeof tag !== "string")
    || !["instruction", "executable"].includes(String(value.kind))
    || typeof value.revisionId !== "string" || !REVISION_ID_PATTERN.test(value.revisionId)
    || etag !== `"${value.revisionId}"`) throw new SkillMetadataUpdateError("INVALID_METADATA_SNAPSHOT");
  const content: RevisionContent = { slug: value.slug, displayName: value.displayName as string, description: value.description as string,
    category: value.category as string, tags: [...value.tags] as string[], source: value.publishedSource as string, kind: value.kind as RevisionContent["kind"] };
  for (const key of ["version", "skillMd", "bundleSha256", "archiveReason", "replacementSlug"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string") throw new SkillMetadataUpdateError("INVALID_METADATA_SNAPSHOT");
      content[key] = value[key];
    }
  }
  if (value.bundleByteSize !== undefined) {
    if (!Number.isSafeInteger(value.bundleByteSize) || (value.bundleByteSize as number) < 0) throw new SkillMetadataUpdateError("INVALID_METADATA_SNAPSHOT");
    content.bundleByteSize = value.bundleByteSize as number;
  }
  if (value.lifecycle !== undefined) {
    if (value.lifecycle !== "active" && value.lifecycle !== "archived") throw new SkillMetadataUpdateError("INVALID_METADATA_SNAPSHOT");
    content.lifecycle = value.lifecycle;
  }
  if (revisionIdOf(content) !== value.revisionId) throw new SkillMetadataUpdateError("INVALID_METADATA_SNAPSHOT");
  return { content, revisionId: value.revisionId };
}
export function metadataPlan(value: unknown): SkillMetadataUpdatePlan {
  if (!object(value) || Object.keys(value).sort().join(",") !== "authority,before,expectedRevisionId,organizationId,originalDocument,patch,schemaVersion"
    || value.schemaVersion !== 1 || !text(value.authority) || !text(value.organizationId) || !object(value.before)
    || typeof value.originalDocument !== "string" || Buffer.byteLength(value.originalDocument) > 2 * 1024 * 1024
    || typeof value.expectedRevisionId !== "string" || !REVISION_ID_PATTERN.test(value.expectedRevisionId)) throw new SkillMetadataUpdateError("INVALID_METADATA_PLAN");
  const before = metadataSnapshot({ ...value.before, publishedSource: value.before.source, revisionId: value.expectedRevisionId }, `"${value.expectedRevisionId}"`).content;
  let original: unknown;
  try { original = JSON.parse(value.originalDocument); }
  catch { throw new SkillMetadataUpdateError("INVALID_METADATA_PLAN"); }
  const preserved = metadataSnapshot(original, `"${value.expectedRevisionId}"`);
  if (preserved.revisionId !== value.expectedRevisionId) throw new SkillMetadataUpdateError("INVALID_METADATA_PLAN");
  return { schemaVersion: 1, authority: value.authority, organizationId: value.organizationId, expectedRevisionId: value.expectedRevisionId,
    originalDocument: value.originalDocument, before, patch: metadataPatch(value.patch) };
}
export function metadataPlanSummary(plan: SkillMetadataUpdatePlan) {
  return { slug: plan.before.slug, authority: plan.authority, organizationId: plan.organizationId, expectedRevisionId: plan.expectedRevisionId,
    before: { category: plan.before.category, tags: plan.before.tags }, after: { category: plan.patch.category ?? plan.before.category, tags: plan.patch.tags ?? plan.before.tags },
    preserved: { version: plan.before.version, bundleSha256: plan.before.bundleSha256, instructionBody: "preserved" } };
}
