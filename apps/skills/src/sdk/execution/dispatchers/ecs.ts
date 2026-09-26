/**
 * ECS dispatcher adapter.
 *
 * Implements the sdk `Dispatcher` interface (submit/cancel) with the launch
 * machinery the interface seam leaves to this module:
 *
 *  1. generation-check the attempt's `attempt_id` + `lease_generation`
 *     (stale generation rejected),
 *  2. persist the launch intent (clientToken, startedBy, request digest)
 *     BEFORE calling ECS,
 *  3. call RunTask with a deterministic clientToken derived from
 *     (run_id, attempt_id) and an immutable request digest,
 *  4. on a lost RunTask response, reconcile the SAME token — list tasks by
 *     startedBy, describe them — before any new attempt; a new attempt is
 *     forbidden while the existing attempt remains unresolved.
 *
 * The AWS SDK is never called from tests: the `EcsRunTaskClient` interface is
 * the seam, `createAwsEcsClient` is the only place the real SDK is imported,
 * and every test injects a mock client.
 *
 * Cross-process fencing requires a store with atomic transactional claims and
 * transitions. The generic state machine's separate reads and writes alone do
 * not establish that guarantee.
 *
 * Nothing here names a concrete cluster, task definition, subnet, or account:
 * all infrastructure identifiers come from configuration (R4).
 */

import { createHash } from "node:crypto";
import type { DispatchResult, Dispatcher } from "../../dispatcher.js";
import type { RunExecutionStore } from "../storage.js";
import type { AttemptReceipt, AttemptRecord, FrozenAdmission } from "../types.js";
import { canonicalJson } from "../types.js";
import { createRunStateMachine, type RunStateMachine } from "../state-machine.js";
import { createReceiptService, type ReceiptService } from "../receipts.js";
import { ECSClient, DescribeTasksCommand, ListTasksCommand, RunTaskCommand, StopTaskCommand } from "@aws-sdk/client-ecs";

/** ClientToken bound: ECS RunTask accepts up to 32 ASCII characters. */
export const CLIENT_TOKEN_BYTES = 16;

export interface EcsTaskState {
  taskArn: string;
  lastStatus: string;
  /** Set when the task reached a terminal status. */
  stopCode?: string | null;
  exitCode?: number | null;
}

export interface EcsRunTaskInput {
  cluster: string;
  taskDefinition: string;
  containerName: string;
  clientToken: string;
  startedBy: string;
  launchType: "FARGATE";
  cpu: string;
  memory: string;
  subnets: string[];
  securityGroups: string[];
  environment: { name: string; value: string }[];
}

export interface EcsRunTaskResult {
  taskArn: string;
}

/** The seam every test mocks; the real implementation lives in createAwsEcsClient. */
export interface EcsRunTaskClient {
  runTask(input: EcsRunTaskInput): Promise<EcsRunTaskResult>;
  /** Task arns launched with a given startedBy token. */
  listTasksByStartedBy(startedBy: string): Promise<string[]>;
  describeTasks(taskArns: string[]): Promise<EcsTaskState[]>;
  stopTask(taskArn: string): Promise<void>;
}

export interface EcsDispatcherConfig {
  cluster: string;
  taskDefinition: string;
  containerName: string;
  subnets: string[];
  securityGroups: string[];
  region: string;
}

export interface EcsDispatcherOptions {
  store: RunExecutionStore;
  stateMachine?: RunStateMachine;
  receipts?: ReceiptService;
  /** Claim identity; defaults to "dispatcher". */
  workerId?: string;
  now?: () => Date;
  /** Trusted per-attempt supervisor transport. Must be deterministic for the frozen
   * admission: a replay keeps the identical ECS clientToken and request. Never
   * inherited by the skill process. */
  supervisorEnvironment?: (admission: FrozenAdmission, attempt: AttemptRecord) => { name: string; value: string }[];
}

/** Terminal ECS task statuses, per the ECS task lifecycle. */
const LIVE_TASK_STATUSES = new Set(["PROVISIONING", "PENDING", "ACTIVATING", "RUNNING", "DEACTIVATING", "STOPPING", "DEPROVISIONING"]);

/** Missing, partial, unexpected, or unknown observations are never stop proof. */
function observedTask(states: EcsTaskState[], taskArn: string): EcsTaskState | undefined {
  if (states.length !== 1 || states[0]?.taskArn !== taskArn) return undefined;
  const state = states[0];
  return state.lastStatus === "STOPPED" || LIVE_TASK_STATUSES.has(state.lastStatus) ? state : undefined;
}

export type LaunchOutcome =
  | { kind: "launched"; attemptId: string; taskId: string }
  | { kind: "already-launched"; attemptId: string; taskId: string }
  | { kind: "previous-terminal"; attemptId: string }
  | { kind: "ambiguous"; attemptId: string }
  | { kind: "launch-failed-absent"; attemptId: string }
  | { kind: "claim-refused"; attemptId: string; reason: string }
  | { kind: "no-admission" }
  | { kind: "run-terminal"; status: string };

/**
 * Deterministic ECS clientToken derived from (run_id, attempt_id). Same input
 * always yields the same token, so a retried or reconciled launch is
 * idempotent from ECS's point of view.
 */
export function clientTokenFor(runId: string, attemptId: string): string {
  return createHash("sha256").update(`${runId}\u0000${attemptId}`).digest("hex").slice(0, CLIENT_TOKEN_BYTES * 2);
}

/** startedBy token, the durable handle reconciliation lists tasks by. */
export function startedByFor(runId: string, attemptNumber: number): string {
  return `skills-exec/${runId}/a${attemptNumber}`;
}

/** Immutable digest of the frozen request this attempt launches. */
export function requestDigestFor(admission: FrozenAdmission, attemptId: string): string {
  return createHash("sha256")
    .update(canonicalJson({ admission, attemptId }))
    .digest("hex");
}

export class EcsDispatcher implements Dispatcher {
  private readonly store: RunExecutionStore;
  private readonly stateMachine: RunStateMachine;
  private readonly receipts: ReceiptService;
  private readonly workerId: string;
  private readonly now: () => Date;
  private readonly supervisorEnvironment: NonNullable<EcsDispatcherOptions["supervisorEnvironment"]>;

  constructor(
    private readonly config: EcsDispatcherConfig,
    private readonly client: EcsRunTaskClient,
    options: EcsDispatcherOptions,
  ) {
    this.store = options.store;
    this.stateMachine = options.stateMachine ?? createRunStateMachine(options.store);
    this.receipts = options.receipts ?? createReceiptService(options.store);
    this.workerId = options.workerId ?? "dispatcher";
    this.now = options.now ?? (() => new Date());
    this.supervisorEnvironment = options.supervisorEnvironment ?? (() => []);
  }

  /** sdk Dispatcher surface: submit an ADMITTED run (execution domain) to the launch machinery. */
  async submit(run: FrozenAdmission): Promise<DispatchResult> {
    const outcome = await this.launchAttempt(run.runId);
    switch (outcome.kind) {
      case "launched":
      case "already-launched":
        return { accepted: true, target: outcome.taskId, detail: outcome.kind };
      case "previous-terminal":
        return { accepted: true, detail: `previous launch ${outcome.attemptId} already terminal` };
      case "ambiguous":
        return { accepted: false, detail: `launch response lost for ${outcome.attemptId}; reconcile before retrying` };
      case "launch-failed-absent":
        return { accepted: false, detail: `launch failed for ${outcome.attemptId}; reconciled absent, retry permitted` };
      case "claim-refused":
        return { accepted: false, detail: `claim refused for ${outcome.attemptId}: ${outcome.reason}` };
      case "no-admission":
        return { accepted: false, detail: `no admission record for run` };
      case "run-terminal":
        return { accepted: false, detail: `run already ${outcome.status}` };
    }
  }

  /** Confirm the task stopped before recording cancellation and its receipt. */
  async cancel(runId: string): Promise<DispatchResult> {
    const run = await this.store.getRun(runId);
    if (!run) return { accepted: false, detail: "no such run" };
    if (run.status === "succeeded" || run.status === "failed") {
      return { accepted: false, detail: `run already ${run.status}` };
    }
    const attempts = await this.store.listAttempts(runId);
    const current = attempts[attempts.length - 1];
    if (!current) {
      if (run.status === "cancelled") return { accepted: true, detail: "already cancelled (no attempt launched)" };
      const cancelled = await this.stateMachine.cancel(runId);
      return cancelled.ok ? { accepted: true, detail: "cancelled (no attempt launched)" } : { accepted: false, detail: cancelled.reason };
    }
    if (!this.cancellationReceipt(await this.receipts.get(runId, current.attemptId), run.admission, current)) {
      return { accepted: false, detail: "matching cancellation receipt is unavailable or contradictory" };
    }
    const observation = await this.reconcile(run.admission, current);
    if (observation.kind !== "already-launched" && observation.kind !== "previous-terminal") {
      return { accepted: false, detail: "task state unknown; cancellation is not yet confirmed" };
    }
    const taskArn = observation.kind === "already-launched" ? observation.taskId
      : (await this.store.listAttempts(runId)).find(row => row.attemptId === current.attemptId)?.taskId ?? null;
    if (!taskArn) return { accepted: false, detail: "stopped task identity is not confirmed" };
    if (observation.kind === "already-launched") {
      try { await this.client.stopTask(observation.taskId); } catch { /* The subsequent exact observation is authoritative. */ }
      const stopped = await this.reconcile(run.admission, { ...current, taskId: observation.taskId });
      if (stopped.kind !== "previous-terminal") {
        return { accepted: false, target: observation.taskId, detail: "task stop is not yet confirmed; reconcile before retrying cancellation" };
      }
    }
    if (run.status !== "cancelled") {
      const cancelled = await this.stateMachine.cancel(runId);
      if (!cancelled.ok) return { accepted: false, detail: cancelled.reason };
    }
    try {
      await this.writeCancellationReceipt(run.admission, current, taskArn);
    } catch {
      return { accepted: false, target: taskArn, detail: "task stopped; cancellation receipt is not yet confirmed" };
    }
    return { accepted: true, target: taskArn, detail: "cancelled after confirmed task stop and receipt" };
  }

  /**
   * Launch the next attempt of a run.
   *
   * A previous attempt whose launch outcome is unknown (launching / ambiguous /
   * launched) is reconciled FIRST. Missing observations remain ambiguous;
   * terminal observations return to the owner without minting another attempt.
   */
  async launchAttempt(runId: string): Promise<LaunchOutcome> {
    const run = await this.store.getRun(runId);
    if (!run) return { kind: "no-admission" };
    if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
      return { kind: "run-terminal", status: run.status };
    }

    const attempts = await this.store.listAttempts(runId);
    const previous = attempts[attempts.length - 1];
    if (previous) {
      // An existing attempt is never replaced based on an eventually consistent
      // empty listing. A terminal observation is returned to the run owner.
      return this.reconcile(run.admission, previous);
    }

    const attemptNumber = 1;
    const attempt = await this.store.createAttempt({ runId, attemptNumber });
    const claimed = await this.stateMachine.claim({
      runId,
      attemptId: attempt.attemptId,
      workerId: this.workerId,
      expectedLeaseGeneration: 0,
    });
    if (!claimed.ok) {
      return { kind: "claim-refused", attemptId: attempt.attemptId, reason: claimed.reason };
    }

    const clientToken = clientTokenFor(runId, attempt.attemptId);
    const startedBy = startedByFor(runId, attemptNumber);
    const requestDigest = requestDigestFor(run.admission, attempt.attemptId);

    const intent = await this.store.recordLaunchIntent({
      runId,
      attemptId: attempt.attemptId,
      clientToken,
      requestDigest,
      startedBy,
    });
    if (!intent.ok) return { kind: "claim-refused", attemptId: attempt.attemptId, reason: intent.reason };

    await this.receipts.recordLaunch({
      admission: run.admission,
      attempt: intent.attempt,
      taskId: null,
      launchedAt: this.now().toISOString(),
    });

    let result: EcsRunTaskResult;
    try {
      result = await this.client.runTask(this.runTaskInput(run.admission, intent.attempt, clientToken, startedBy, requestDigest));
    } catch {
      await this.store.recordLaunchState({ runId, attemptId: attempt.attemptId, launchState: "ambiguous" });
      const reconciled = await this.reconcile(run.admission, intent.attempt);
      return reconciled;
    }

    await this.store.recordLaunchState({ runId, attemptId: attempt.attemptId, launchState: "launched", taskId: result.taskArn });
    return { kind: "launched", attemptId: attempt.attemptId, taskId: result.taskArn };
  }

  /** ECS is eventually consistent: empty lists and missing descriptions cannot
   * prove absence. Only an exact recognized observation can change launch state. */
  async reconcile(admission: FrozenAdmission, attempt: AttemptRecord): Promise<LaunchOutcome> {
    const ambiguous = (): LaunchOutcome => ({ kind: "ambiguous", attemptId: attempt.attemptId });
    let taskArn = attempt.taskId;
    if (!taskArn) {
      if (!attempt.startedBy) return ambiguous();
      let taskArns: string[];
      try { taskArns = await this.client.listTasksByStartedBy(attempt.startedBy); } catch { return ambiguous(); }
      // RunTask requests one task. Multiple matches need operator reconciliation,
      // not an arbitrary first task or a partially described terminal result.
      if (taskArns.length !== 1 || !taskArns[0]) return ambiguous();
      taskArn = taskArns[0];
    }
    let states: EcsTaskState[];
    try { states = await this.client.describeTasks([taskArn]); } catch { return ambiguous(); }
    const state = observedTask(states, taskArn);
    if (!state) return ambiguous();
    if (state.lastStatus !== "STOPPED") {
      await this.store.recordLaunchState({ runId: admission.runId, attemptId: attempt.attemptId, launchState: "launched", taskId: taskArn });
      return { kind: "already-launched", attemptId: attempt.attemptId, taskId: taskArn };
    }
    await this.store.recordLaunchState({ runId: admission.runId, attemptId: attempt.attemptId, launchState: "terminal", taskId: taskArn });
    return { kind: "previous-terminal", attemptId: attempt.attemptId };
  }

  private runTaskInput(
    admission: FrozenAdmission,
    attempt: AttemptRecord,
    clientToken: string,
    startedBy: string,
    requestDigest: string,
  ): EcsRunTaskInput {
    const limits = admission.limits;
    const cpuUnits = Math.max(256, Math.round(limits.maxCpuUnits / 256) * 256);
    return {
      cluster: this.config.cluster,
      taskDefinition: this.config.taskDefinition,
      containerName: this.config.containerName,
      clientToken,
      startedBy,
      launchType: "FARGATE",
      cpu: String(cpuUnits),
      memory: String(Math.max(512, limits.maxMemoryMb)),
      subnets: this.config.subnets,
      securityGroups: this.config.securityGroups,
      environment: [
        ...this.supervisorEnvironment(admission, attempt),
        { name: "SKILLS_RUN_ID", value: admission.runId },
        { name: "SKILLS_ATTEMPT_ID", value: attempt.attemptId },
        { name: "SKILLS_BUNDLE_DIGEST", value: admission.bundleDigest },
        { name: "SKILLS_INPUT_DIGEST", value: admission.inputDigest },
        { name: "SKILLS_REQUEST_DIGEST", value: requestDigest },
        { name: "SKILLS_RUNTIME_IMAGE_DIGEST", value: admission.runtimeImageDigest },
      ],
    };
  }

  private cancellationReceipt(receipt: AttemptReceipt | null, admission: FrozenAdmission, attempt: AttemptRecord): receipt is AttemptReceipt {
    try { return !!receipt && receipt.runId === admission.runId && receipt.attemptId === attempt.attemptId
      && !!attempt.clientToken && receipt.clientToken === attempt.clientToken
      && !!attempt.requestDigest && receipt.requestDigest === attempt.requestDigest
      && !!attempt.startedBy && receipt.startedBy === attempt.startedBy
      && receipt.bundleDigest === admission.bundleDigest && receipt.runtimeImageDigest === admission.runtimeImageDigest
      && receipt.dependencyLayerTag === admission.dependencyLayerTag
      && canonicalJson(receipt.executionContract ?? null) === canonicalJson(admission.executionContract ?? null)
      && canonicalJson(receipt.policy) === canonicalJson(admission.policy) && canonicalJson(receipt.limits) === canonicalJson(admission.limits)
      && (receipt.taskId === null || receipt.taskId === attempt.taskId)
      && ((receipt.status === null && receipt.completedAt === null)
        || (receipt.status === "cancelled" && typeof receipt.completedAt === "string" && Number.isFinite(Date.parse(receipt.completedAt)))); } catch { return false; }
  }

  private async writeCancellationReceipt(admission: FrozenAdmission, attempt: AttemptRecord, taskArn: string): Promise<void> {
    const existing = await this.receipts.get(admission.runId, attempt.attemptId);
    if (!this.cancellationReceipt(existing, admission, { ...attempt, taskId: taskArn })) throw Error("Cancellation receipt authority unavailable");
    // A missing launch receipt cannot be reconstructed with an invented launch
    // time. An existing terminal receipt must retain all its immutable fields.
    const completedAt = existing.completedAt ?? this.now().toISOString();
    const expected = { ...existing, status: "cancelled" as const, completedAt, exitCode: existing.status === "cancelled" ? existing.exitCode : null };
    const run = await this.store.getRun(admission.runId);
    if (existing.status !== "cancelled" || run?.status !== "cancelled" || run.terminalReceiptId !== attempt.attemptId) {
      await this.receipts.finalize({ runId: admission.runId, attemptId: attempt.attemptId, status: "cancelled", exitCode: expected.exitCode, completedAt });
    }
    const persisted = await this.receipts.get(admission.runId, attempt.attemptId);
    const finalized = await this.store.getRun(admission.runId);
    if (!persisted || canonicalJson(persisted) !== canonicalJson(expected) || finalized?.status !== "cancelled" || finalized.terminalReceiptId !== attempt.attemptId) {
      throw Error("Cancellation receipt persistence is unconfirmed");
    }
  }
}

/** Injectable command transport exercises the actual AWS command adapter without network. */
export interface EcsCommandTransport {
  send(command: RunTaskCommand | ListTasksCommand | DescribeTasksCommand | StopTaskCommand): Promise<unknown>;
}
export interface AwsEcsClientOptions { cluster?: string; transport?: EcsCommandTransport }

/** Pass an explicit cluster when restoring an existing named-cluster attempt.
 * The legacy one-argument factory binds to the first operation's cluster; read
 * operations before RunTask retain AWS's default-cluster behavior. */
export function createAwsEcsClient(region: string, options: AwsEcsClientOptions = {}): EcsRunTaskClient {
  if (options.cluster !== undefined && !validText(options.cluster)) throw Error("An explicit nonempty ECS cluster is required");
  const client: EcsCommandTransport = options.transport ?? new ECSClient({ region });
  let boundCluster = options.cluster;
  const cluster = (requested?: string): string => {
    const next = requested ?? boundCluster ?? "default";
    if (!validText(next) || (boundCluster !== undefined && next !== boundCluster)) throw Error("ECS client cluster binding changed");
    return boundCluster ??= next;
  };
  const response = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Incomplete ECS response");
    const result = value as Record<string, any>;
    if (result.failures !== undefined && (!Array.isArray(result.failures) || result.failures.length > 0)) throw Error("ECS response contains failures");
    return result;
  };
  return {
    async runTask(input) {
      const result = response(await client.send(new RunTaskCommand({
        cluster: cluster(input.cluster), taskDefinition: input.taskDefinition, launchType: input.launchType,
        clientToken: input.clientToken, startedBy: input.startedBy,
        networkConfiguration: { awsvpcConfiguration: { subnets: input.subnets, securityGroups: input.securityGroups, assignPublicIp: "DISABLED" } },
        overrides: { containerOverrides: [{ name: input.containerName, environment: input.environment, cpu: Number(input.cpu), memory: Number(input.memory) }] },
      })));
      if (!Array.isArray(result.tasks) || result.tasks.length !== 1 || !validText(result.tasks[0]?.taskArn)) throw Error("RunTask did not return one exact task");
      return { taskArn: result.tasks[0].taskArn };
    },
    async listTasksByStartedBy(startedBy) {
      const configuredCluster = cluster(), arns: string[] = [], tokens = new Set<string>();
      let nextToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = response(await client.send(new ListTasksCommand({ cluster: configuredCluster, startedBy, ...(nextToken ? { nextToken } : {}) })));
        if (!Array.isArray(result.taskArns) || result.taskArns.length > 100 || !result.taskArns.every(validText)) throw Error("Incomplete ECS task listing");
        arns.push(...result.taskArns);
        if (new Set(arns).size !== arns.length) throw Error("Repeated ECS task identity in listing");
        if (result.nextToken === undefined) return arns;
        if (!validText(result.nextToken) || tokens.has(result.nextToken)) throw Error("Invalid ECS pagination cursor");
        tokens.add(result.nextToken); nextToken = result.nextToken;
      }
      throw Error("ECS task listing exceeded the bounded page limit");
    },
    async describeTasks(taskArns) {
      if (!taskArns.length || taskArns.length > 100 || !taskArns.every(validText) || new Set(taskArns).size !== taskArns.length) throw Error("Invalid ECS task identities");
      const result = response(await client.send(new DescribeTasksCommand({ cluster: cluster(), tasks: taskArns })));
      if (!Array.isArray(result.tasks) || result.tasks.length !== taskArns.length || new Set(result.tasks.map((task: any) => task?.taskArn)).size !== taskArns.length
        || result.tasks.some((task: any) => !taskArns.includes(task?.taskArn) || !validText(task?.lastStatus))) throw Error("Incomplete ECS task descriptions");
      return result.tasks.map((task: any) => ({ taskArn: task.taskArn, lastStatus: task.lastStatus, stopCode: task.stopCode ?? null, exitCode: task.containers?.[0]?.exitCode ?? null }));
    },
    async stopTask(taskArn) {
      if (!validText(taskArn)) throw Error("Invalid ECS task identity");
      const result = response(await client.send(new StopTaskCommand({ cluster: cluster(), task: taskArn })));
      if (result.task?.taskArn !== taskArn || !validText(result.task?.lastStatus)) throw Error("Incomplete ECS stop response");
      // An acknowledged stop is not terminal proof. The dispatcher re-describes.
    },
  };
}
function validText(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.trim() === value && value.length <= 2048; }
