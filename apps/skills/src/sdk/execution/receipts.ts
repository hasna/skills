/**
 * Per-attempt receipts.
 *
 * Every attempt gets an immutable receipt: run_id, attempt_id,
 * lease_generation, launch token (clientToken + startedBy), task id,
 * timestamps, image + bundle digests, the frozen policy, and — once the
 * attempt reaches a terminal outcome — exit code and artifact/log pointers.
 * Receipts are written through the storage adapter; the terminal receipt
 * finalizes the run row.
 */

import type { RunExecutionStore } from "./storage.js";
import type { AttemptReceipt, AttemptRecord, FrozenAdmission, TerminalRunStatus } from "./types.js";

export type { AttemptReceipt };

export interface CreateAttemptReceiptInput {
  admission: FrozenAdmission;
  attempt: AttemptRecord;
  /** ECS task arn, when the launch is confirmed. */
  taskId: string | null;
  launchedAt: string;
  artifactPointers?: string[];
  logPointers?: string[];
}

export interface FinalizeAttemptReceiptInput {
  runId: string;
  attemptId: string;
  status: TerminalRunStatus;
  exitCode: number | null;
  completedAt: string;
  artifactPointers?: string[];
  logPointers?: string[];
  costCents?: number | null;
}

export interface ReceiptService {
  /** Persist the launch-time receipt before (or right after) the launch call. */
  recordLaunch(input: CreateAttemptReceiptInput): Promise<AttemptReceipt>;
  /** Finalize the attempt's receipt; also finalizes the run row. */
  finalize(input: FinalizeAttemptReceiptInput): Promise<{ receipt: AttemptReceipt | null; runId: string; status: TerminalRunStatus }>;
  get(runId: string, attemptId: string): Promise<AttemptReceipt | null>;
}

export function createReceiptService(store: RunExecutionStore): ReceiptService {
  return {
    async recordLaunch(input) {
      const receipt: AttemptReceipt = {
        runId: input.admission.runId,
        attemptId: input.attempt.attemptId,
        leaseGeneration: input.attempt.leaseGeneration,
        clientToken: input.attempt.clientToken ?? "",
        requestDigest: input.attempt.requestDigest ?? "",
        startedBy: input.attempt.startedBy ?? "",
        taskId: input.taskId,
        launchedAt: input.launchedAt,
        completedAt: null,
        runtimeImageDigest: input.admission.runtimeImageDigest,
        bundleDigest: input.admission.bundleDigest,
        dependencyLayerTag: input.admission.dependencyLayerTag,
        ...(input.admission.executionContract ? { executionContract: { ...input.admission.executionContract } } : {}),
        policy: input.admission.policy,
        limits: input.admission.limits,
        exitCode: null,
        status: null,
        artifactPointers: input.artifactPointers ?? [],
        logPointers: input.logPointers ?? [],
        costCents: null,
      };
      return store.writeReceipt(receipt);
    },

    async finalize(input) {
      const existing = await store.getReceipt(input.runId, input.attemptId);
      if (!existing) {
        throw new Error(`receipt finalize: no launch receipt for ${input.runId} ${input.attemptId}`);
      }
      const receipt: AttemptReceipt = {
        ...existing,
        completedAt: input.completedAt,
        exitCode: input.exitCode,
        status: input.status,
        artifactPointers: input.artifactPointers ?? existing.artifactPointers,
        logPointers: input.logPointers ?? existing.logPointers,
        ...(input.costCents === undefined ? {} : { costCents: input.costCents }),
      };
      const written = await store.writeReceipt(receipt);
      await store.finalizeRun(input.runId, input.status, input.attemptId);
      return { receipt: written, runId: input.runId, status: input.status };
    },

    get: (runId, attemptId) => store.getReceipt(runId, attemptId),
  };
}
