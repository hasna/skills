/**
 * Dispatcher adapter seam: how admitted runs leave this process.
 *
 * The interface is the contract — submit a run, cancel a run. The ECS adapter
 * is the real implementation (execution/dispatchers/ecs.ts): CAS-claimed
 * attempts, persisted launch intents, deterministic RunTask clientTokens, and
 * lost-response reconciliation. The E2B lane is a typed stub pending the
 * infinity integration.
 *
 * submit() takes the EXECUTION-domain admission (`FrozenAdmission`), whose
 * `runId` (`run_<ts>_<hex>`) is the execution store's own key — NOT the
 * server run record (`ServerRunRecord.id`, a UUID), which the execution store
 * cannot resolve and would silently no-admit. Intended wiring: the
 * POST /api/v1/runs handler creates a server run through `store.createRun`
 * (billing/audit record, UUID id); the execution lane bridges it to this seam
 * through `createSubmitRunService` (idempotent admission), which mints or
 * returns the `FrozenAdmission`; then `dispatcher.submit(admission)` launches
 * it. The bridge is mandatory — passing a server record here is a type error.
 */
import type { FrozenAdmission } from "./execution/types.js";

import { EcsDispatcher, E2bDispatcher } from "./execution/index.js";

export { EcsDispatcher, E2bDispatcher };
export type { EcsDispatcherConfig, EcsDispatcherOptions, EcsRunTaskClient, EcsRunTaskInput, EcsRunTaskResult, EcsTaskState, LaunchOutcome } from "./execution/dispatchers/ecs.js";

/** Outcome of a dispatch attempt. */
export interface DispatchResult {
  accepted: boolean;
  /** Where the run was dispatched to, when known. */
  target?: string;
  /** Human-readable detail, credential-free. */
  detail?: string;
}

/** A dispatcher takes admitted execution runs and puts them in front of an executor. */
export interface Dispatcher {
  submit(run: FrozenAdmission): Promise<DispatchResult>;
  cancel(runId: string): Promise<DispatchResult>;
}

/** Raised by adapters whose launch machinery is not implemented yet. */
export class DispatcherNotImplementedError extends Error {
  constructor(adapter: string, capability: string) {
    super(
      `${adapter} does not implement ${capability} yet — the launch machinery is built by the sibling dispatcher task.`,
    );
    this.name = "DispatcherNotImplementedError";
  }
}
