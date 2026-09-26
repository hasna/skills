/**
 * E2B-lane dispatcher stub.
 *
 * Implements the sdk `Dispatcher` interface with submit/cancel typed and
 * present, but the launch machinery is NOT built: the latency-sensitive E2B
 * lane is a TODO for the infinity integration (plan P5: "Fargate RunTask
 * first, E2B second"). Every call fails closed with `accepted: false` — a
 * run is never reported as dispatched by a lane that cannot dispatch it.
 */

import type { DispatchResult, Dispatcher } from "../../dispatcher.js";
import type { FrozenAdmission } from "../types.js";

/** Marker so callers and tests can detect the unimplemented lane by type. */
export const E2B_LANE_STATUS = "e2b-lane-todo-infinity" as const;

export class E2bDispatcher implements Dispatcher {
  async submit(_run: FrozenAdmission): Promise<DispatchResult> {
    return {
      accepted: false,
      detail: `${E2B_LANE_STATUS}: E2B submit is not implemented — the infinity lane is a follow-up`,
    };
  }

  async cancel(_runId: string): Promise<DispatchResult> {
    return {
      accepted: false,
      detail: `${E2B_LANE_STATUS}: E2B cancel is not implemented — the infinity lane is a follow-up`,
    };
  }
}
