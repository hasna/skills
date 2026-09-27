import type { ArtifactStorage } from "./artifact-storage.js";
import type { ServerRunRecord, SkillsProductStore } from "./types.js";

export const LEGACY_EXECUTION_RETIRED = "LEGACY_EXECUTION_RETIRED";
export const LEGACY_EXECUTION_GUIDANCE = "Unversioned runs have been retired. Publish and select a versioned executable, then use skills run <name>@<version> --target cloud.";

/** Drain old unversioned records without executing embedded skill implementations. */
export async function executeRun(store: SkillsProductStore, run: ServerRunRecord, _storage?: ArtifactStorage): Promise<ServerRunRecord> {
  // Historical outputs remain available. A stale SDK caller cannot rewrite a
  // completed run or interrupt a cancellation already in progress.
  if (["succeeded", "failed", "cancel_requested", "cancelled", "expired", "refunded"].includes(run.status)) return run;
  try {
    await store.appendLog(run.id, run.orgId, "warn", LEGACY_EXECUTION_GUIDANCE);
  } catch {
    // A logging outage must not strand the legacy queue.
  }
  return await failRun(store, run, LEGACY_EXECUTION_RETIRED, LEGACY_EXECUTION_GUIDANCE);
}

async function failRun(
  store: SkillsProductStore,
  run: ServerRunRecord,
  code: string,
  message: string,
): Promise<ServerRunRecord> {
  // Logging is best-effort. A SQLite lock or Postgres log-sequence conflict
  // must not prevent retirement and strand a claimed row in 'running': the
  // queue only claims queued/retrying rows.
  try {
    await store.appendLog(run.id, run.orgId, "error", message);
  } catch {
    // The run's terminal state is the invariant; the log line is not.
  }
  const next = await fencedTransition(store, run, {
    status: "failed",
    errorCode: code,
    errorMessage: message,
    completedAt: new Date().toISOString(),
  });
  return next ?? run;
}

/**
 * The worker's terminal transition, fenced by the claimed lease generation.
 *
 * A cancellation bumps lease_generation, so a worker that finishes after the
 * cancel was issued no longer matches and its terminal write is refused - the
 * run stays cancelled instead of being moved to failed by a worker
 * that no longer owns it. The refusal is visible: the run is logged as a late
 * write rather than silently dropped.
 */
async function fencedTransition(
  store: SkillsProductStore,
  run: ServerRunRecord,
  patch: Parameters<NonNullable<SkillsProductStore["transitionRun"]>>[1],
): Promise<ServerRunRecord | null> {
  if (!store.transitionRun) return store.updateRun(run.id, patch);
  const next = await store.transitionRun(run.id, patch, run.leaseGeneration);
  if (!next) {
    try {
      await store.appendLog(run.id, run.orgId, "warn", `late write rejected: run no longer owned at lease_generation ${run.leaseGeneration}`);
    } catch {
      // Best-effort, same class as failRun: the refusal is already the terminal
      // fact, and a failing warning log must not turn it into a rejection that
      // escapes failRun.
    }
  }
  return next;
}
