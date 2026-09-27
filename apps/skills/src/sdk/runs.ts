import { assertReservationCents } from "./amounts.js";
/**
 * Run protocol + atomic run services seam.
 *
 * The protocol declares the wire contract for skill runs: the lifecycle states
 * (admitted / leased / running / terminal), run_id, attempt_id, and lease_generation.
 * The zod schemas validate both admission and terminal payloads against
 * contractVersion 1 — the same version the shipped server emits on /api/v1/runs.
 *
 * The run services half is the atomic engine: admission, claim/lease, and transition.
 * The current implementation wraps the store's own atomic transitions (Postgres
 * `FOR UPDATE SKIP LOCKED`, SQLite `BEGIN IMMEDIATE` plus a conditional claim) — no
 * business logic is duplicated here.
 */
// The monorepo builds with Zod 3 while consumers may install Zod 4. Both
// expose this stable subpath; emitted declarations must name their real API.
import { z } from "zod/v3";
import {
  REMOTE_SKILL_RUN_CONTRACT_VERSION,
  normalizeRemoteSkillRunContract,
  type RemoteSkillRunContract,
} from "../lib/remote-run-contract.js";
import type {
  ApiPrincipal,
  ClaimRunInput,
  CreateRunInput,
  ServerRunRecord,
  ServerRunStatus,
  SkillsProductStore,
} from "../server/types.js";
import type { OfflineGate } from "./offline.js";
import type { RunEventEmitter } from "./events.js";
import type { SpendService } from "./spend.js";
import type { RunQuota } from "./governance.js";

/** Wire version shared by every run payload this SDK produces or consumes. */
export const RUN_PROTOCOL_VERSION = REMOTE_SKILL_RUN_CONTRACT_VERSION;

/** Lifecycle states of the run protocol (admitted → leased → running → terminal). */
export const RUN_PROTOCOL_STATES = ["admitted", "leased", "running", "terminal"] as const;
export type RunProtocolState = (typeof RUN_PROTOCOL_STATES)[number];

/** Stable run identifier (`run_id`). */
export type RunId = string;
/** Attempt identifier (`attempt_id`). */
export type AttemptId = string;
/** Fencing token for a claim (`lease_generation`). */
export type LeaseGeneration = number;

/** Admission: a run is accepted into the queue. */
export const runAdmissionSchema = z.object({
  contractVersion: z.literal(RUN_PROTOCOL_VERSION),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  leaseGeneration: z.number().int().nonnegative(),
  skill: z.string().min(1),
  status: z.literal("admitted"),
  createdAt: z.string().min(1),
});
export type RunAdmission = z.infer<typeof runAdmissionSchema>;

/** Lease: a worker has claimed the run. */
export const runLeaseSchema = z.object({
  contractVersion: z.literal(RUN_PROTOCOL_VERSION),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  leaseGeneration: z.number().int().nonnegative(),
  workerId: z.string().min(1),
  status: z.literal("leased"),
});
export type RunLease = z.infer<typeof runLeaseSchema>;

/** Terminal: the run reached a final state. */
export const runTerminalSchema = z.object({
  contractVersion: z.literal(RUN_PROTOCOL_VERSION),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  leaseGeneration: z.number().int().nonnegative(),
  skill: z.string().min(1),
  status: z.enum(["succeeded", "failed", "cancelled", "expired"]),
  completedAt: z.string().min(1),
});
export type RunTerminal = z.infer<typeof runTerminalSchema>;

/** Any single protocol message, discriminated by `status`. */
export const runProtocolSchema = z.discriminatedUnion("status", [
  runAdmissionSchema,
  runLeaseSchema,
  runTerminalSchema,
]);
export type RunProtocolMessage = z.infer<typeof runProtocolSchema>;

/** Map the store's status vocabulary onto the protocol lifecycle. */
export function protocolStateOf(status: ServerRunStatus): RunProtocolState {
  switch (status) {
    case "queued":
    case "waiting_for_approval":
    case "retrying":
      return "admitted";
    case "running":
    case "cancel_requested":
      return "leased";
    case "succeeded":
    case "failed":
    case "cancelled":
    case "expired":
    case "refunded":
      return "terminal";
  }
}

/** The current engine is single-attempt: the attempt id is the run id. */
export function attemptIdOf(run: Pick<ServerRunRecord, "id">): AttemptId {
  return run.id;
}

/** The current engine keeps the generation the claim actually stamped. */
export function leaseGenerationOf(run: Pick<ServerRunRecord, "leaseGeneration">): LeaseGeneration {
  return run.leaseGeneration;
}

/** One atomic status transition on a run. */
export type RunTransition = Partial<
  Pick<ServerRunRecord, "status" | "outputType" | "outputPreview" | "errorCode" | "errorMessage" | "startedAt" | "completedAt">
>;

/** Atomic run services: admission, lease/claim, transition, and read. */
export interface RunService {
  admit(input: CreateRunInput): Promise<ServerRunRecord>;
  leaseNext(workerId: string): Promise<ServerRunRecord | null>;
  transition(runId: string, patch: RunTransition): Promise<ServerRunRecord | null>;
  get(principal: ApiPrincipal, runId: string): Promise<ServerRunRecord | null>;
}

export interface RunServiceOptions {
  store: SkillsProductStore;
  /**
   * Optional governance wiring. When present, admit() runs the full admission
   * chain before a run enters the queue: the offline gate first (fail closed),
   * then the spend ceilings (RUN_BUDGET_EXHAUSTED on refusal), then the run is
   * created, reserved against, and announced. Absent, admit() is exactly what
   * it always was - the embedder opts in to the controls.
   */
  governance?: RunServiceGovernance;
}

export interface RunServiceGovernance {
  offline?: OfflineGate;
  spend?: SpendService;
  events?: RunEventEmitter;
  /** Resource envelope this run requests, checked against the org ceilings. */
  quota?: RunQuota;
  /** Estimated integer cents (0..2147483647), reserved before dispatch. */
  estimatedCents?: number;
}

/** Current implementation: the store's own atomic transitions, plus the optional admission chain. */
export function createRunService({ store, governance }: RunServiceOptions): RunService {
  return {
    async admit(input) {
      // Own the validated amount before an offline/store callback can yield.
      const estimatedCents = governance?.estimatedCents;
      if (estimatedCents !== undefined) assertReservationCents(estimatedCents, "estimatedCents");
      if (governance) {
        await governance.offline?.assertCanRunLocal(input.slug);
        await governance.spend?.admit({
          principal: input.principal,
          slug: input.slug,
          quota: governance.quota,
          estimatedCents,
        });
      }
      const run = await store.createRun(input);
      if (governance) {
        if (governance.spend && estimatedCents !== undefined) {
          await governance.spend.reserve(run.orgId, run.id, estimatedCents);
        }
        await governance.events?.emit("skills.run.admitted", run);
      }
      return run;
    },
    leaseNext: (workerId) => store.claimNextRun({ workerId } satisfies ClaimRunInput),
    transition: (runId, patch) => store.updateRun(runId, patch),
    get: (principal, runId) => store.getRun(principal, runId),
  };
}

/**
 * Settle a terminal run: reconcile its credit reservation against the actual
 * cost and emit the terminal lifecycle event. The reservation is released
 * (actual 0) or charged (actual > 0); unused reservations never linger.
 */
export async function settleRun(
  store: SkillsProductStore,
  options: { spend?: SpendService; events?: RunEventEmitter },
  run: ServerRunRecord,
  actualCents?: number,
): Promise<void> {
  const amount = actualCents === undefined ? run.costCents : actualCents;
  assertReservationCents(amount, "actualCents");
  if (options.spend) {
    await options.spend.reconcile(run.orgId, run.id, amount);
  }
  if (options.events) {
    const type = run.status === "cancelled" ? "skills.run.cancelled" : "skills.run.terminal";
    await options.events.emit(type, run);
  }
}

export { REMOTE_SKILL_RUN_CONTRACT_VERSION, normalizeRemoteSkillRunContract };
export type { RemoteSkillRunContract };
