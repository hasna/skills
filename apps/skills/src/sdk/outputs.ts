/**
 * Outputs governance: default-private visibility, pre-persistence redaction,
 * hard size limits, finite TTLs, and immutable deletion receipts.
 *
 * The writer is the one gate every artifact passes at write time: visibility is
 * stamped from the governance default, redaction runs BEFORE the bytes are
 * stored, the per-output and per-run-total caps are checked before the row is
 * written, and expiresAt is computed from the configured TTL. The expiry sweep
 * is the retention half: artifacts whose expiresAt is in the past are deleted
 * (row + object) and every deletion lands one append-only receipt.
 */
import { createHash } from "node:crypto";
import type { ArtifactBody, ObjectStore } from "./storage.js";
import { publicPrincipal } from "../server/auth.js";
import type { GovernanceStore, LifecycleReceipt } from "./governance-store.js";
import {
  DEFAULT_OUTPUT_GOVERNANCE,
  GOVERNANCE_ERROR_CODES,
  GovernanceError,
  type OutputGovernanceConfig,
} from "./governance.js";
import type { ServerArtifact, ServerRunRecord, SkillsProductStore } from "../server/types.js";

/**
 * The object half of the artifact lifecycle: the storage seam's read/write
 * surface plus the two operations governance needs and the base seam does not
 * declare - object deletion (expiry sweep) and the quarantine move
 * (cancellation). ArtifactStorage implements all of them; a db-only embedder
 * omits the optional ones and rows-only governance still works.
 */
export interface RunObjectStore extends ObjectStore {
  deleteObject?(artifact: ServerArtifact): Promise<void>;
  moveToQuarantine?(artifact: ServerArtifact): Promise<string | null>;
  quarantineKeyFor(tenantId: string, runId: string, artifactId: string): string;
}

export interface GovernedArtifactWriter {
  write(run: ServerRunRecord, meta: Omit<ServerArtifact, "createdAt" | "storageKind" | "storageKey" | "bodyText">, body: ArtifactBody): Promise<ServerArtifact>;
}

export interface OutputGovernanceOptions {
  store: SkillsProductStore;
  governanceStore: GovernanceStore;
  storage?: RunObjectStore;
  config?: OutputGovernanceConfig;
  /** Explicit override of the default visibility for this writer. */
  visibility?: "private" | "public";
}

/** A db-only object store: materializes into the body column, never touches objects. */
class DatabaseOnlyObjectStore implements RunObjectStore {
  readonly usesS3 = false;
  async materialize(
    run: ServerRunRecord,
    artifact: Omit<ServerArtifact, "createdAt" | "storageKind" | "storageKey" | "bodyText">,
    body: ArtifactBody,
  ): Promise<Omit<ServerArtifact, "createdAt">> {
    return { ...artifact, storageKind: "db", bodyText: body.bodyText };
  }
  async readText(): Promise<string | null> {
    return null;
  }
  async deleteBundle(): Promise<void> {}
  quarantineKeyFor(tenantId: string, runId: string, artifactId: string): string {
    return `${tenantId}/${runId}/quarantine/${artifactId}`;
  }
}

/**
 * Apply the configured redaction patterns to run output before it is stored.
 *
 * The hook is pure and exported so the same patterns can guard logs and run
 * records that never pass through the artifact writer.
 */
export function redactRunOutput(value: unknown, patterns: RegExp[] = DEFAULT_OUTPUT_GOVERNANCE.redactPatterns): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return patterns.reduce((current, pattern) => current.replace(pattern, "credential"), text);
}

/** Expiry timestamp for an artifact written now under the given TTL. Absent only when the TTL is undefined. */
export function expiresAtFor(createdAt: string, ttlSeconds: number | undefined): string | undefined {
  if (ttlSeconds === undefined) return undefined;
  return new Date(Date.parse(createdAt) + ttlSeconds * 1000).toISOString();
}

/**
 * The write-time gate. Every enforcement happens before the row exists:
 *
 *   1. redact the body text (before storage),
 *   2. refuse an output above the per-output cap,
 *   3. refuse a run whose accumulated outputs would exceed the per-run cap,
 *   4. stamp visibility (private by default) and expiresAt (createdAt + TTL),
 *   5. materialize (db column or S3 object) and persist.
 */
export function createGovernedArtifactWriter(options: OutputGovernanceOptions): GovernedArtifactWriter {
  const config: Required<OutputGovernanceConfig> = { ...DEFAULT_OUTPUT_GOVERNANCE, ...options.config };
  const storage = options.storage ?? new DatabaseOnlyObjectStore();

  return {
    async write(run, meta, body) {
      if (typeof body?.bodyText !== "string") {
        throw new TypeError("Governed artifacts require a text body before persistence");
      }
      const redacted = redactRunOutput(body.bodyText, config.redactPatterns);
      const redactedBody = { ...body, bodyText: redacted };

      const persistedBytes = new TextEncoder().encode(redacted);
      const outputBytes = persistedBytes.byteLength;
      if (outputBytes > config.perOutputBytes) {
        throw new GovernanceError(
          GOVERNANCE_ERROR_CODES.ARTIFACT_LIMIT_EXCEEDED,
          `output ${meta.relativePath} for run ${run.id} is ${outputBytes} bytes; the per-output limit is ${config.perOutputBytes}`,
          { gate: "perOutputBytes" },
        );
      }

      const existing = await options.store.listArtifacts(publicPrincipal({ orgId: run.orgId }), run.id);
      const totalBytes = existing.reduce((sum, artifact) => sum + artifact.byteSize, 0) + outputBytes;
      if (totalBytes > config.perRunTotalBytes) {
        throw new GovernanceError(
          GOVERNANCE_ERROR_CODES.RUN_ARTIFACT_TOTAL_EXCEEDED,
          `run ${run.id} outputs would total ${totalBytes} bytes; the per-run limit is ${config.perRunTotalBytes}`,
          { gate: "perRunTotalBytes" },
        );
      }

      const createdAt = new Date().toISOString();
      const stamped: Omit<ServerArtifact, "createdAt" | "storageKind" | "storageKey" | "bodyText"> = {
        ...meta,
        // The writer owns the text transformation. Its metadata must describe
        // the bytes handed to either storage adapter, not the caller's input.
        byteSize: outputBytes,
        sha256: createHash("sha256").update(persistedBytes).digest("hex"),
        visibility: options.visibility ?? config.defaultVisibility,
        ...(config.artifactTtlSeconds !== undefined ? { expiresAt: expiresAtFor(createdAt, config.artifactTtlSeconds) } : {}),
      };
      const materialized = await storage.materialize(run, stamped, redactedBody);
      return options.store.addArtifact(materialized);
    },
  };
}

/**
 * The retention sweep: delete every artifact whose expiresAt is in the past.
 *
 * Row deletion and object deletion both happen; the object is removed first so
 * an object with no row cannot outlive the row (a row with no object is only a
 * metadata entry, the safe direction). One append-only receipt records what was
 * deleted, when, and on whose request. Receipts have no update or delete path.
 */
export async function expireArtifacts(
  options: {
    governanceStore: GovernanceStore;
    storage?: RunObjectStore;
    requestedBy: string;
    now?: string;
  },
): Promise<LifecycleReceipt[]> {
  const at = options.now ?? new Date().toISOString();
  const expired = await options.governanceStore.listExpiredArtifacts(at);
  const receipts: LifecycleReceipt[] = [];
  for (const artifact of expired) {
    await options.storage?.deleteObject?.(artifact);
    await options.governanceStore.deleteArtifactRow(artifact.id, artifact.orgId);
    receipts.push(
      await options.governanceStore.appendReceipt({
        kind: "delete",
        orgId: artifact.orgId,
        runId: artifact.runId,
        artifactId: artifact.id,
        requestedBy: options.requestedBy,
        metadata: { artifactId: artifact.id, sha256: artifact.sha256, byteSize: artifact.byteSize, expiresAt: artifact.expiresAt },
      }),
    );
  }
  return receipts;
}
