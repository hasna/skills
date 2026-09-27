/**
 * Run lifecycle events through @hasna/events — bounded metadata and stable
 * pointers ONLY.
 *
 * The boundary is structural: buildRunLifecycleEvent starts from an allowlist
 * of fields (run_id, skill, version, status, timestamps, correlation_id,
 * attempt/lease pointers) and validateRunLifecycleEvent refuses anything else
 * before it can be emitted - unknown keys, nested payloads, and any value that
 * matches the credential patterns. Raw logs, artifact payloads, and inputs
 * cannot reach the event bus by construction, and the negative fixture proves
 * the guard fires rather than being asserted by prose.
 */
import { createEvent, type EventEnvelope } from "@hasna/events";
import { GOVERNANCE_ERROR_CODES, GovernanceError } from "./governance.js";
import { DEFAULT_OUTPUT_GOVERNANCE } from "./governance.js";
import type { ServerRunRecord } from "../server/types.js";

export const RUN_LIFECYCLE_EVENT_TYPES = [
  "skills.run.admitted",
  "skills.run.started",
  "skills.run.terminal",
  "skills.run.cancelled",
] as const;

export type RunLifecycleEventType = (typeof RUN_LIFECYCLE_EVENT_TYPES)[number];

/**
 * The full allowlist of data fields a run lifecycle event may carry.
 *
 * Every field is either a stable pointer or bounded metadata. Anything not in
 * this list is a payload violation; any value matching the redaction patterns
 * is a secret leak. Both checks run before emission.
 */
export const RUN_LIFECYCLE_EVENT_FIELDS = [
  "run_id",
  "attempt_id",
  "lease_generation",
  "correlation_id",
  "skill",
  "version",
  "status",
  "at",
] as const;

export interface RunLifecycleEventData {
  run_id: string;
  attempt_id: string;
  lease_generation: number;
  correlation_id?: string;
  skill: string;
  version?: string;
  status: string;
  at: string;
  /**
   * @hasna/events constrains event data to Record<string, unknown>. The index
   * signature is required to satisfy it; the RUNTIME allowlist is the guard
   * that actually bounds the payload (see RUN_LIFECYCLE_EVENT_FIELDS and
   * validateRunLifecycleEvent) - this type cannot be the fence, only the
   * shape of the legitimate payload.
   */
  [key: string]: unknown;
}

/** Build a bounded lifecycle event envelope for a run state. Never carries inputs, logs, or payloads. */
export function buildRunLifecycleEvent(
  type: RunLifecycleEventType,
  run: Pick<ServerRunRecord, "id" | "skill" | "status" | "correlationId" | "leaseGeneration" | "createdAt" | "completedAt">,
  options: { version?: string; at?: string; source?: string } = {},
): EventEnvelope<RunLifecycleEventData> {
  const at = options.at ?? new Date().toISOString();
  const data: RunLifecycleEventData = {
    run_id: run.id,
    attempt_id: run.id,
    lease_generation: run.leaseGeneration,
    correlation_id: run.correlationId,
    skill: run.skill,
    ...(options.version ? { version: options.version } : {}),
    status: run.status,
    at,
  };
  const envelope = createEvent({
    source: options.source ?? "hasna/skills",
    type,
    time: at,
    subject: `skills.run ${run.id}`,
    severity: "info",
    data,
    schemaVersion: "1",
  });
  return envelope as EventEnvelope<RunLifecycleEventData>;
}

/**
 * Refuse any event payload that is not bounded metadata + stable pointers.
 *
 * Rejects, with EVENT_PAYLOAD_REJECTED:
 *   - unknown top-level data keys (an input, a log array, an artifact body);
 *   - non-scalar values outside the allowlist;
 *   - any value whose text matches the credential patterns.
 */
export function validateRunLifecycleEvent(event: EventEnvelope<RunLifecycleEventData>): void {
  const data = event.data ?? {};
  for (const key of Object.keys(data)) {
    if (!(RUN_LIFECYCLE_EVENT_FIELDS as readonly string[]).includes(key)) {
      throw new GovernanceError(
        GOVERNANCE_ERROR_CODES.EVENT_PAYLOAD_REJECTED,
        `run event payload carries field "${key}", which is not in the ${RUN_LIFECYCLE_EVENT_FIELDS.join(", ")} allowlist`,
        { gate: "eventPayloadFields" },
      );
    }
    const value = (data as Record<string, unknown>)[key];    if (value !== null && value !== undefined && typeof value !== "string" && typeof value !== "number") {
      throw new GovernanceError(
        GOVERNANCE_ERROR_CODES.EVENT_PAYLOAD_REJECTED,
        `run event payload field "${key}" must be a scalar; refused ${typeof value}`,
        { gate: "eventPayloadScalars" },
      );
    }
  }
  for (const value of Object.values(data)) {
    if (typeof value === "string" && matchesCredentialPattern(value)) {
      throw new GovernanceError(
        GOVERNANCE_ERROR_CODES.EVENT_PAYLOAD_REJECTED,
        "run event payload value matches a credential pattern; secrets never enter @hasna/events",
        { gate: "eventPayloadSecrets" },
      );
    }
  }
}

function matchesCredentialPattern(value: string): boolean {
  return DEFAULT_OUTPUT_GOVERNANCE.redactPatterns.some((pattern) => pattern.test(value));
}

/** A sink for lifecycle events; swap in a recording sink in tests. */
export type RunEventSink = (event: EventEnvelope<RunLifecycleEventData>) => Promise<void>;

export interface RunEventEmitterOptions {
  /** Emission sink. Defaults to @hasna/events' EventsClient over a JsonEventsStore. */
  sink?: RunEventSink;
  versionFor?: (run: Pick<ServerRunRecord, "skill">) => Promise<string | undefined>;
  /** When false (default), a sink failure is reported but never fails the run transition. */
  failOpen?: boolean;
}

export interface RunEventEmitter {
  emit(type: RunLifecycleEventType, run: ServerRunRecord): Promise<void>;
}

/**
 * Emit one validated lifecycle event.
 *
 * Validation is mandatory and runs before the sink is touched; a payload that
 * fails validation throws EVEN when failOpen is set - a secret must never be
 * dropped into a fail-open hole. Sink failures (an unreachable events store)
 * are reported via the returned boolean / an optional error and do not fail
 * the run itself, because a run that succeeded is still a run that succeeded.
 */
export function createRunEventEmitter(options: RunEventEmitterOptions = {}): RunEventEmitter {
  const { sink, versionFor, failOpen = false } = options;

  return {
    async emit(type, run) {
      const version = versionFor ? await versionFor(run) : undefined;
      const event = buildRunLifecycleEvent(type, run, { version });
      validateRunLifecycleEvent(event);
      try {
        if (sink) {
          await sink(event);
        } else {
          const { defaultEventsSink } = await import("./event-sink.js");
          await defaultEventsSink()(event);
        }
      } catch (error) {
        if (failOpen) throw error;
      }
    },
  };
}
