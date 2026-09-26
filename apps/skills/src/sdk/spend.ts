import { assertCents, assertReservationCents } from "./amounts.js";
/**
 * Spend governance: credit reservations and org ceilings, enforced at admission.
 *
 * The flow: admit() checks every ceiling BEFORE a run enters the queue
 * (per-run resource envelope, org concurrency, org monthly total) and refuses
 * with RUN_BUDGET_EXHAUSTED when one is exhausted - the exact error the
 * negative fixture asserts. reserve() then sets aside the estimate, keyed to
 * the run, before dispatch. reconcile() runs once at terminal state: the
 * actual cost is charged (status "charged") or, when nothing was used, the
 * reservation is released ("released") - the unused half never lingers.
 *
 * Each reservation or charge uses integer cents from 0 through 2147483647,
 * matching the supported PostgreSQL and SQLite schema. Monthly ceilings and
 * aggregates may exceed that per-row limit but must remain JavaScript-safe
 * nonnegative integers. Invalid amounts throw RangeError before store access.
 */
import type { ApiPrincipal } from "../server/types.js";
import { DEFAULT_SPEND_CEILINGS, GOVERNANCE_ERROR_CODES, GovernanceError, type RunQuota, type SpendCeilings } from "./governance.js";
import type { CreditReservation, GovernanceStore } from "./governance-store.js";

export interface SpendAdmissionInput {
  principal: ApiPrincipal;
  slug: string;
  quota?: RunQuota;
  /** Integer cents from 0 through 2147483647; omission estimates zero. */
  estimatedCents?: number;
  now?: Date;
}

export interface SpendService {
  /** Enforce the org's ceilings; throw RUN_BUDGET_EXHAUSTED with the exact ceiling named. */
  admit(input: SpendAdmissionInput): Promise<void>;
  /** Reserve credits for a run before dispatch. Returns the reservation id. */
  reserve(tenantId: string, runId: string, estimatedCents: number): Promise<CreditReservation>;
  /** Reconcile at terminal state: charge the actual cost, or release the unused reservation. */
  reconcile(tenantId: string, runId: string, actualCents: number): Promise<CreditReservation | null>;
}

export function createSpendService(options: { governanceStore: GovernanceStore; ceilings?: SpendCeilings }): SpendService {
  const store = options.governanceStore;
  const ceilings: SpendCeilings = { ...DEFAULT_SPEND_CEILINGS, ...options.ceilings, perRun: { ...DEFAULT_SPEND_CEILINGS.perRun, ...options.ceilings?.perRun } };

  assertCents(ceilings.monthlyTotalCents, "monthlyTotalCents");

  function exhaust(ceiling: string, detail: string): never {
    throw new GovernanceError(
      GOVERNANCE_ERROR_CODES.RUN_BUDGET_EXHAUSTED,
      `admission refused for run: ${detail}`,
      { gate: "spend", ceiling },
    );
  }

  return {
    async admit(input) {
      const estimated = input.estimatedCents === undefined ? 0 : input.estimatedCents;
      assertReservationCents(estimated, "estimatedCents");
      const quota = input.quota ?? ceilings.perRun;
      const perRun = ceilings.perRun;
      const over = (label: keyof RunQuota, requested: number, allowed: number): boolean => requested > allowed;
      if (over("cpu", quota.cpu, perRun.cpu)) exhaust("cpu", `requested ${quota.cpu} cpu; ceiling is ${perRun.cpu}`);
      if (over("memoryMB", quota.memoryMB, perRun.memoryMB)) exhaust("memoryMB", `requested ${quota.memoryMB} MB; ceiling is ${perRun.memoryMB}`);
      if (over("durationSeconds", quota.durationSeconds, perRun.durationSeconds)) exhaust("durationSeconds", `requested ${quota.durationSeconds}s; ceiling is ${perRun.durationSeconds}`);
      if (over("networkMB", quota.networkMB, perRun.networkMB)) exhaust("networkMB", `requested ${quota.networkMB} MB; ceiling is ${perRun.networkMB}`);
      if (over("artifactBytes", quota.artifactBytes, perRun.artifactBytes)) exhaust("artifactBytes", `requested ${quota.artifactBytes} bytes; ceiling is ${perRun.artifactBytes}`);

      const active = await store.activeRunCount(input.principal.orgId);
      if (active >= ceilings.concurrency) {
        exhaust("concurrency", `org already has ${active} admitted runs; ceiling is ${ceilings.concurrency}`);
      }

      const now = input.now ?? new Date();
      const monthPrefix = now.toISOString().slice(0, 7);
      const monthly = await store.monthlySpendCents(input.principal.orgId, monthPrefix);
      assertCents(monthly, "monthlySpendCents");
      if (estimated > ceilings.monthlyTotalCents - monthly) {
        exhaust("monthly", `org spend for ${monthPrefix} is ${monthly} cents and this run estimates ${estimated}; monthly ceiling is ${ceilings.monthlyTotalCents} cents`);
      }
    },

    async reserve(tenantId, runId, estimatedCents) {
      assertReservationCents(estimatedCents, "estimatedCents");
      return store.createReservation({ orgId: tenantId, runId, estimatedCents });
    },

    async reconcile(tenantId, runId, actualCents) {
      assertReservationCents(actualCents, "actualCents");
      const reservations = await store.reservationsForRun(tenantId, runId);
      const open = reservations.find((reservation) => reservation.status === "reserved");
      if (!open) return null;
      return store.reconcileReservation(open.id, actualCents, actualCents > 0 ? "charged" : "released");
    },
  };
}
