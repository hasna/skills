/**
 * Run state machine: admitted → leased → running → terminal.
 *
 * Every transition is recorded through the storage adapter. Claims are CAS on
 * the attempt's lease_generation; a stale claim is rejected. Retries keep the
 * run_id and mint a new attempt_id with a fresh lease_generation counter.
 */

import type {
  AttemptRecord,
  ClaimAttemptInput,
  ClaimResult,
  ExecutionRunStatus,
  RunExecutionStore,
  RunTransitionRecord,
} from "./storage.js";
import type { TerminalRunStatus } from "./types.js";
import { isTerminalStatus } from "./types.js";

export type { ClaimResult };

/** The only legal edges of the state machine. */
export const LEGAL_TRANSITIONS: Record<ExecutionRunStatus, ExecutionRunStatus[]> = {
  admitted: ["leased", "cancelled"],
  leased: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["admitted"],
  cancelled: [],
};

export type TransitionFailure =
  | "NO_SUCH_RUN"
  | "NO_SUCH_ATTEMPT"
  | "INVALID_TRANSITION"
  | "ATTEMPT_TERMINAL"
  | "RUN_TERMINAL"
  | "RUN_CANCELLED";

export type TransitionResult =
  | { ok: true }
  | { ok: false; reason: TransitionFailure };

export interface RunStateMachine {
  /** CAS-claim an attempt: expectedLeaseGeneration must match. */
  claim(input: ClaimAttemptInput): Promise<ClaimResult>;
  /** admitted → leased (claim recorded as a transition). */
  lease(input: ClaimAttemptInput): Promise<ClaimResult>;
  /** leased → running. */
  start(runId: string, attemptId: string): Promise<TransitionResult>;
  /** running → terminal; finalizes the run row. */
  terminate(input: { runId: string; attemptId: string; status: TerminalRunStatus }): Promise<TransitionResult>;
  /** Cancel a run: fences the current generation and moves it to terminal. */
  cancel(runId: string): Promise<TransitionResult>;
  transition(runId: string, from: ExecutionRunStatus, to: ExecutionRunStatus, attemptId?: string | null): Promise<TransitionResult>;
  getStatus(runId: string): Promise<ExecutionRunStatus | null>;
}

export function createRunStateMachine(store: RunExecutionStore): RunStateMachine {
  async function transition(
    runId: string,
    from: ExecutionRunStatus,
    to: ExecutionRunStatus,
    attemptId: string | null = null,
  ): Promise<TransitionResult> {
    const run = await store.getRun(runId);
    if (!run) return { ok: false, reason: "NO_SUCH_RUN" };
    if (attemptId) {
      const attempt = await findAttempt(store, runId, attemptId);
      if (!attempt) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
    }
    if (run.status !== from) return { ok: false, reason: "INVALID_TRANSITION" };
    if (to === "cancelled" && run.status === "cancelled") {
      return { ok: true };
    }
    if (!LEGAL_TRANSITIONS[from].includes(to)) {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    const next = await store.setRunStatus(runId, to);
    if (!next) return { ok: false, reason: "NO_SUCH_RUN" };
    const record: RunTransitionRecord = {
      runId,
      attemptId,
      from,
      to,
      at: new Date().toISOString(),
    };
    await store.recordTransition(record);
    return { ok: true };
  }

  return {
    async claim(input) {
      const run = await store.getRun(input.runId);
      if (!run) return { ok: false, reason: "RUN_TERMINAL" };
      if (run.status === "cancelled") return { ok: false, reason: "RUN_CANCELLED" };
      if (isTerminalStatus(run.status)) return { ok: false, reason: "RUN_TERMINAL" };
      return store.claimAttempt(input);
    },

    async lease(input) {
      const claimed = await this.claim(input);
      if (!claimed.ok) return claimed;
      const run = await store.getRun(input.runId);
      if (run && run.status === "admitted") {
        await store.setRunStatus(input.runId, "leased");
      }
      await store.recordTransition({
        runId: input.runId,
        attemptId: input.attemptId,
        from: "admitted",
        to: "leased",
        at: new Date().toISOString(),
      });
      return claimed;
    },

    async start(runId, attemptId) {
      return transition(runId, "leased", "running", attemptId);
    },

    async terminate(input) {
      const run = await store.getRun(input.runId);
      if (!run) return { ok: false, reason: "NO_SUCH_RUN" };
      if (run.status === "cancelled" || run.status === input.status) {
        // A cancelled run stays cancelled; a terminal run is never re-terminated.
        return { ok: false, reason: run.status === "cancelled" ? "RUN_CANCELLED" : "RUN_TERMINAL" };
      }
      const attempt = await findAttempt(store, input.runId, input.attemptId);
      if (!attempt) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
      if (attempt.status === "terminal") return { ok: false, reason: "ATTEMPT_TERMINAL" };
      const transitioned = await transition(input.runId, "running", input.status, input.attemptId);
      if (!transitioned.ok) return transitioned;
      await store.markAttemptTerminal(input.runId, input.attemptId);
      return { ok: true };
    },

    async cancel(runId) {
      const run = await store.getRun(runId);
      if (!run) return { ok: false, reason: "NO_SUCH_RUN" };
      if (isTerminalStatus(run.status)) return { ok: false, reason: "RUN_TERMINAL" };
      const result = await transition(runId, run.status, "cancelled", run.currentAttemptId);
      if (!result.ok) return result;
      return { ok: true };
    },

    transition,
    async getStatus(runId) {
      const run = await store.getRun(runId);
      return run ? run.status : null;
    },
  };
}

async function findAttempt(store: RunExecutionStore, runId: string, attemptId: string): Promise<AttemptRecord | null> {
  const attempts = await store.listAttempts(runId);
  return attempts.find((attempt) => attempt.attemptId === attemptId) ?? null;
}
