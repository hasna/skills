/**
 * Run outputs governance: shared types, defaults, and errors.
 *
 * Every control here is FINITE and enforceable: a visibility flag persisted at
 * write time (never inferred at read), hard byte limits checked before
 * persistence, expiry timestamps computed from a configured TTL and swept by
 * the expiry service, and ceilings checked at admission. The defaults are the
 * sane starting point the plan calls for (10MB per output, 100MB per run,
 * 30-day TTLs, $50/month ceiling); an embedder overrides them explicitly and
 * every override is still a finite number.
 */
import type { ServerRunRecord } from "../server/types.js";

/** Output visibility. Runs' outputs are PRIVATE by default; "public" is an explicit opt-in. */
export type OutputVisibility = "private" | "public";

/** Resource envelope a run requests at admission, checked against ceilings. */
export interface RunQuota {
  /** vCPU, fractional allowed. */
  cpu: number;
  memoryMB: number;
  durationSeconds: number;
  networkMB: number;
  artifactBytes: number;
}

export interface OutputGovernanceConfig {
  /** Visibility stamped on every artifact at write time. Default "private". */
  defaultVisibility?: OutputVisibility;
  /**
   * Pre-persistence redaction patterns applied to run output before it is
   * stored. Configurable; the default is the shipped credential patterns.
   */
  redactPatterns?: RegExp[];
  /** Hard per-output byte cap. Default 10MB. */
  perOutputBytes?: number;
  /** Hard per-run total byte cap (all outputs of one run). Default 100MB. */
  perRunTotalBytes?: number;
  /**
   * Finite retention in seconds. Every artifact gets expiresAt =
   * createdAt + ttl at write time. Default 30 days.
   */
  artifactTtlSeconds?: number;
}

export interface SpendCeilings {
  /** Per-run resource envelope; any quota above it is refused at admission. */
  perRun: RunQuota;
  /** Max concurrently admitted (queued/running/cancelling) runs per org. */
  concurrency: number;
  /** Max estimated spend per org per calendar month, in cents. Default $50. */
  monthlyTotalCents: number;
}

export const DEFAULT_OUTPUT_GOVERNANCE: Required<OutputGovernanceConfig> = {
  defaultVisibility: "private",
  redactPatterns: [
    /\bsk-[A-Za-z0-9_-]{8,}\b/g,
    /\bsk_[A-Za-z0-9_-]{8,}\b/g,
    /\bgh[opsur]_[A-Za-z0-9_]{8,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
    /\bnpm_[A-Za-z0-9_]{8,}\b/g,
    /\bAKIA[A-Z0-9]{12,}\b/g,
    /\bAIza[A-Za-z0-9_-]{10,}\b/g,
    /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)[A-Z0-9_]*\s*[:=]\s*[^ \n\r\t]+/gi,
    /\bhttps?:\/\/[^ \n\r\t]+X-Amz-Signature=[^ \n\r\t]+/gi,
  ],
  perOutputBytes: 10 * 1024 * 1024,
  perRunTotalBytes: 100 * 1024 * 1024,
  artifactTtlSeconds: 30 * 24 * 60 * 60,
};

export const DEFAULT_RUN_QUOTA: RunQuota = {
  cpu: 1,
  memoryMB: 2048,
  durationSeconds: 3600,
  networkMB: 100,
  artifactBytes: 100 * 1024 * 1024,
};

export const DEFAULT_SPEND_CEILINGS: SpendCeilings = {
  perRun: DEFAULT_RUN_QUOTA,
  concurrency: 2,
  monthlyTotalCents: 5000,
};

/** Machine-readable governance failure codes. Tests assert on these exactly. */
export const GOVERNANCE_ERROR_CODES = {
  /** An output exceeded the per-output byte cap at write time. */
  ARTIFACT_LIMIT_EXCEEDED: "ARTIFACT_LIMIT_EXCEEDED",
  /** A run's accumulated outputs exceeded the per-run byte cap at write time. */
  RUN_ARTIFACT_TOTAL_EXCEEDED: "RUN_ARTIFACT_TOTAL_EXCEEDED",
  /** Admission refused: a spend ceiling (per-run, concurrency, or monthly) is exhausted. */
  RUN_BUDGET_EXHAUSTED: "RUN_BUDGET_EXHAUSTED",
  /** A fenced transition carried a stale lease_generation. */
  STALE_LEASE_GENERATION: "STALE_LEASE_GENERATION",
  /** Cancellation was requested on a store that cannot fence generations. */
  FENCING_UNSUPPORTED: "FENCING_UNSUPPORTED",
  /** An event payload carried content that must never enter @hasna/events. */
  EVENT_PAYLOAD_REJECTED: "EVENT_PAYLOAD_REJECTED",
  /** Offline local run refused: the skill is not in the verified cache. */
  SKILL_UNAVAILABLE_OFFLINE: "SKILL_UNAVAILABLE_OFFLINE",
  /** A remote run was attempted locally; the client never silently falls back. */
  REMOTE_REQUIRED: "REMOTE_REQUIRED",
} as const;

export type GovernanceErrorCode = (typeof GOVERNANCE_ERROR_CODES)[keyof typeof GOVERNANCE_ERROR_CODES];

/** Every governance failure is one typed error with a stable code. */
export class GovernanceError extends Error {
  readonly code: GovernanceErrorCode;
  /** The ceiling or gate that refused, e.g. "monthly", "cpu", "ARTIFACT_LIMIT_EXCEEDED". */
  readonly gate: string;
  /** Present when the code is RUN_BUDGET_EXHAUSTED: which ceiling exhausted. */
  readonly ceiling?: string;

  constructor(code: GovernanceErrorCode, message: string, options: { gate?: string; ceiling?: string } = {}) {
    super(message);
    this.name = "GovernanceError";
    this.code = code;
    this.gate = options.gate ?? code;
    this.ceiling = options.ceiling;
  }
}

/** Stable identity for a run's lifecycle: the pointers every receipt and event carries. */
export interface RunPointers {
  runId: string;
  attemptId: string;
  leaseGeneration: number;
  correlationId?: string;
}

export function runPointersOf(run: Pick<ServerRunRecord, "id" | "correlationId" | "leaseGeneration">): RunPointers {
  return {
    runId: run.id,
    attemptId: run.id,
    leaseGeneration: run.leaseGeneration,
    correlationId: run.correlationId,
  };
}
