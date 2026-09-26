/**
 * Cancellation service: fence the current generation, cancel, quarantine,
 * and commit a cancellation receipt.
 *
 * The fence is lease_generation on skills_runs. A claim bumps it, a
 * cancellation bumps it again, and every worker transition re-asserts it - so
 * a worker that keeps writing after the cancellation was issued is refused
 * (StaleLeaseGenerationError / a dropped transition) and the run stays
 * cancelled. Partial artifacts are quarantined before the run is marked
 * cancelled: moved to the quarantine object prefix when object-backed, and
 * recorded in an append-only receipt either way. Nothing about cancellation is
 * silent - the receipt is the record of what was fenced, what was quarantined,
 * and who asked.
 */
import { ArtifactStorage } from "../server/artifact-storage.js";
import type { ApiPrincipal, ServerArtifact, ServerRunRecord, SkillsProductStore } from "../server/types.js";
import {
  GOVERNANCE_ERROR_CODES,
  GovernanceError,
  runPointersOf,
  type RunPointers,
} from "./governance.js";
import type { GovernanceStore, LifecycleReceipt } from "./governance-store.js";
import type { RunObjectStore } from "./outputs.js";

export interface CancelOutcome {
  run: ServerRunRecord;
  /** The generation the cancellation fenced. */
  fencedGeneration: number;
  /** Artifacts moved to the quarantine prefix (or recorded for quarantine). */
  quarantined: ServerArtifact[];
  receipt: LifecycleReceipt;
  /** True when the run was already terminal and cancellation was a no-op. */
  alreadyTerminal: boolean;
}

export interface CancelServiceOptions {
  store: SkillsProductStore;
  governanceStore: GovernanceStore;
  storage?: RunObjectStore;
}

export interface CancelService {
  cancel(principal: ApiPrincipal, runId: string, requestedBy: string): Promise<CancelOutcome>;
}

/**
 * Build the cancel service.
 *
 * Requires a store that implements transitionRun (generation fencing). A store
 * without one cannot cancel safely - an unfenced cancel would let the worker's
 * late write move a cancelled run back to succeeded - so the service refuses
 * with FENCING_UNSUPPORTED rather than pretending.
 */
export function createCancelService(options: CancelServiceOptions): CancelService {
  const store = options.store;
  const governanceStore = options.governanceStore;
  const storage = options.storage ?? new ArtifactStorage();

  return {
    async cancel(principal, runId, requestedBy) {
      if (!store.transitionRun) {
        throw new GovernanceError(
          GOVERNANCE_ERROR_CODES.FENCING_UNSUPPORTED,
          `cannot cancel run ${runId}: the store has no transitionRun generation fencing`,
          { gate: "transitionRun" },
        );
      }

      const run = await store.getRun(principal, runId);
      if (!run) throw new GovernanceError(GOVERNANCE_ERROR_CODES.STALE_LEASE_GENERATION, `run ${runId} not found`, { gate: "run" });

      const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "expired", "refunded"]);
      if (terminalStatuses.has(run.status)) {
        const receipt = await governanceStore.appendReceipt({
          kind: "cancel",
          orgId: run.orgId,
          runId: run.id,
          requestedBy,
          metadata: { outcome: "already-terminal", status: run.status, ...runPointersOf(run) },
        });
        return { run, fencedGeneration: run.leaseGeneration, quarantined: [], receipt, alreadyTerminal: true };
      }

      // Fence the current worker: bump the generation in the same statement
      // that moves the run into the cancelling state, so there is no instant
      // where the status says cancelling and the old generation still admits
      // the worker's terminal write.
      const fencedGeneration = run.leaseGeneration + 1;
      const cancelling = await store.transitionRun(runId, { status: "cancel_requested", leaseGeneration: fencedGeneration }, run.leaseGeneration);
      if (!cancelling) {
        throw new GovernanceError(GOVERNANCE_ERROR_CODES.STALE_LEASE_GENERATION, `run ${runId} changed while cancelling`, { gate: "transition" });
      }

      const artifacts = await store.listArtifacts(principal, runId);
      const quarantined: ServerArtifact[] = [];
      for (const artifact of artifacts) {
        const quarantineKey = await storage.moveToQuarantine?.(artifact);
        if (quarantineKey) {
          await governanceStore.updateArtifactStorageKey(artifact.id, artifact.orgId, quarantineKey);
        }
        await governanceStore.appendReceipt({
          kind: "quarantine",
          orgId: artifact.orgId,
          runId: run.id,
          artifactId: artifact.id,
          requestedBy,
          metadata: { relativePath: artifact.relativePath, byteSize: artifact.byteSize, quarantineKey: quarantineKey ?? null },
        });
        quarantined.push({ ...artifact, ...(quarantineKey ? { storageKey: quarantineKey } : {}) });
      }

      const cancelled = await store.transitionRun(runId, { status: "cancelled", completedAt: new Date().toISOString() }, fencedGeneration);
      if (!cancelled) {
        throw new GovernanceError(GOVERNANCE_ERROR_CODES.STALE_LEASE_GENERATION, `run ${runId} moved on while finalising cancellation`, { gate: "transition" });
      }

      const receipt = await governanceStore.appendReceipt({
        kind: "cancel",
        orgId: run.orgId,
        runId: run.id,
        requestedBy,
        metadata: {
          fencedGeneration,
          artifactCount: quarantined.length,
          pointers: runPointersOf(cancelled) satisfies RunPointers,
        },
      });

      return { run: cancelled, fencedGeneration, quarantined, receipt, alreadyTerminal: false };
    },
  };
}
