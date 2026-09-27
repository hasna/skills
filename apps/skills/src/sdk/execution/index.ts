/**
 * Cloud-run execution machinery, exported through the sdk surface.
 *
 * Idempotent admission, the run state machine (admitted → leased → running →
 * terminal), the immutable image-profile registry, per-attempt receipts, and
 * the dispatcher adapters (ECS with atomic-launch reconciliation, E2B stub).
 */

export * from "./types.js";
export * from "./storage.js";
export * from "./admission.js";
export * from "./state-machine.js";
export * from "./image-profile.js";
export * from "./receipts.js";
export * from "./dispatchers/ecs.js";
export * from "./dispatchers/e2b.js";
