/**
 * Core types for the cloud-run execution machinery.
 *
 * A run is admitted once under a stable `run_id`, with every input that must
 * not change between attempts frozen into the admission record: tenant, skill
 * id + version, canonical bundle digest, runtime-image digest, input digest,
 * and the policy + limits the run is executed under. Retries keep the run_id
 * and increment the attempt_id and lease_generation.
 */

import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../../lib/remote-run-contract.js";

/** Protocol version shared with the sibling sdk run protocol. */
export const EXECUTION_PROTOCOL_VERSION = REMOTE_SKILL_RUN_CONTRACT_VERSION;

/** Lifecycle states of the execution state machine. */
export type ExecutionRunStatus = "admitted" | "leased" | "running" | "succeeded" | "failed" | "cancelled";

/** Terminal states of the state machine. */
export type TerminalRunStatus = "succeeded" | "failed" | "cancelled";

/** States a run may still move out of. */
export type ActiveRunStatus = "admitted" | "leased" | "running";

/** RunTimes allowed by the image profile registry. */
export type RuntimeName = "bun" | "node" | "python3";

export interface RunPolicy {
  /** deny-by-default egress; "allowlist" opens a bounded broker route. */
  egress: "deny" | "allowlist";
  /** Hosts reachable when egress is "allowlist". */
  egressAllowlist: string[];
  /** Network byte cap applied on the allowlisted broker route. */
  networkByteCap: number;
}

export interface RunLimits {
  maxDurationMs: number;
  maxMemoryMb: number;
  /** ECS CPU units (256 = 0.25 vCPU). */
  maxCpuUnits: number;
  maxArtifactsBytes: number;
  maxConcurrency: number;
}

/** Trusted, versioned adapter identity. Absent only for legacy PDF admissions. */
export interface PureExecutionContract {
  id: "regex-test.v1";
  descriptorDigest: string;
  entrypoint: string;
  entrypointDigest: string;
}

/** Everything frozen at admission under one stable run_id. */
export interface FrozenAdmission {
  contractVersion: number;
  runId: string;
  tenantId: string;
  skillId: string;
  skillVersion: string;
  /** Canonical sha256 of the skill bundle, fetched by digest at run time. */
  bundleDigest: string;
  /** Pinned runtime-image digest resolved from the image profile registry. */
  runtimeImageDigest: string;
  /** Prebuilt dependency layer tag, when the manifest's system_deps are allowlisted. */
  dependencyLayerTag: string | null;
  executionContract?: PureExecutionContract;
  /** sha256 of the canonical serialization of the run input. */
  inputDigest: string;
  runtime: RuntimeName;
  policy: RunPolicy;
  limits: RunLimits;
  idempotencyKey: string;
  createdAt: string;
}

/** A claim attempt, with its fencing token. */
export interface AttemptRecord {
  runId: string;
  /** Stable per-attempt id; retries keep run_id and mint a new attempt id. */
  attemptId: string;
  attemptNumber: number;
  /** Fencing counter; every successful CAS claim increments it by one. */
  leaseGeneration: number;
  workerId: string | null;
  claimedAt: string | null;
  status: AttemptStatus;
  /** Deterministic ECS clientToken derived from (run_id, attempt_id). */
  clientToken: string | null;
  /** Immutable digest of the frozen request this attempt launches. */
  requestDigest: string | null;
  /** ECS task arn, once the launch is confirmed. */
  taskId: string | null;
  launchState: AttemptLaunchState;
  /** Started-by token used to reconcile an ambiguous launch. */
  startedBy: string | null;
}

export type AttemptStatus = "pending" | "leased" | "terminal";

export type AttemptLaunchState =
  | "unlaunched"
  | "launching"
  | "ambiguous"
  | "absent"
  | "launched"
  | "terminal";

/** Why a CAS claim was refused. */
export type ClaimFailure =
  | "NO_SUCH_ATTEMPT"
  | "STALE_GENERATION"
  | "ATTEMPT_TERMINAL"
  | "RUN_TERMINAL"
  | "RUN_CANCELLED";

export type ClaimResult =
  | { ok: true; attempt: AttemptRecord; leaseGeneration: number }
  | { ok: false; reason: ClaimFailure };

/** One recorded state transition, appended through the storage adapter. */
export interface RunTransitionRecord {
  runId: string;
  attemptId: string | null;
  from: ExecutionRunStatus;
  to: ExecutionRunStatus;
  at: string;
}

/** Immutable per-attempt receipt. Written once at launch, finalized once. */
export interface AttemptReceipt {
  runId: string;
  attemptId: string;
  leaseGeneration: number;
  clientToken: string;
  requestDigest: string;
  startedBy: string;
  taskId: string | null;
  launchedAt: string;
  completedAt: string | null;
  runtimeImageDigest: string;
  bundleDigest: string;
  dependencyLayerTag: string | null;
  executionContract?: PureExecutionContract;
  policy: RunPolicy;
  limits: RunLimits;
  exitCode: number | null;
  status: TerminalRunStatus | null;
  artifactPointers: string[];
  logPointers: string[];
  costCents: number | null;
}

export interface ExecutionRunRow {
  admission: FrozenAdmission;
  status: ExecutionRunStatus;
  currentAttemptId: string | null;
  terminalReceiptId: string | null;
  updatedAt: string;
}

export function isTerminalStatus(status: ExecutionRunStatus): status is TerminalRunStatus {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function isActiveStatus(status: ExecutionRunStatus): status is ActiveRunStatus {
  return status === "admitted" || status === "leased" || status === "running";
}

/** Canonical serialization: stable key order, stable separators, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // JSON keys are data, including __proto__; never invoke inherited setters.
    const sorted: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
