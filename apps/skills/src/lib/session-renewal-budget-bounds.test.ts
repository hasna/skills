import { expect, test } from "bun:test";
import { hermesHookDefinitions, renderHermesSupervisor } from "./agent-hermes.js";
import {
  MANAGED_HOOK_DEADLINE_MS, MANAGED_HOOK_EXIT_RESERVE_MS, managedContextChildLimits, SESSION_CONTEXT_CHILD_CEILING_MS,
  SESSION_CONTEXT_CHILD_RESERVE_MS, SESSION_RENEWAL_TIMEOUT_MS,
} from "./session-reconciliation.js";

// These bounds are anchored outside the renewal budget, so a change to the
// budget alone cannot keep them green. Re-verify a source before changing it.

// Source: the live 831-selection fleet profile, a pin carrying 807 selections
// of which 85 had changed; the exact-version reads alone took about 6.1 s cold
// (I6-00270, 2026-10-18). Below this a healthy renewal expires.
const MEASURED_COLD_RENEWAL_READS_MS = 6_100;

// Source: the generated Hermes supervisor kills its `skills hook user-prompt`
// child on this timer, and Hermes kills the supervisor at the hook timeout it
// is installed with (seconds).
const supervisor = renderHermesSupervisor("/opt/skills/bin/skills", "fleet");
const hermesKill = /reason = "timeout"; stop\(\); finish\(2\); \}, (\d+)\);/.exec(supervisor);
const hermesHookTimeoutMs = hermesHookDefinitions({ runtime: "/opt/bun/bin/bun", path: "/opt/hermes/supervisor.mjs" }).pre_llm_call.timeout * 1000;

test("the renewal budget covers the measured cold renewal reads", () => {
  expect(SESSION_RENEWAL_TIMEOUT_MS).toBeGreaterThanOrEqual(MEASURED_COLD_RENEWAL_READS_MS);
});

test("each managed-hook timeout sits inside the one that encloses it, with its reserve", () => {
  expect(hermesKill).not.toBeNull();
  const hermesKillMs = Number(hermesKill![1]);
  // Each layer keeps the reserve it needs to report before the next one acts.
  expect(SESSION_RENEWAL_TIMEOUT_MS + SESSION_CONTEXT_CHILD_RESERVE_MS).toBeLessThanOrEqual(SESSION_CONTEXT_CHILD_CEILING_MS);
  expect(SESSION_CONTEXT_CHILD_CEILING_MS + MANAGED_HOOK_EXIT_RESERVE_MS).toBeLessThanOrEqual(MANAGED_HOOK_DEADLINE_MS);
  // The hook deadline and the supervisor kill are currently equal (12 s each),
  // and the supervisor's timer starts at spawn, before the hook sets its own
  // deadline. The hook stops its child MANAGED_HOOK_EXIT_RESERVE_MS before its
  // deadline, so it reports first only while its startup is shorter than that
  // reserve. Raising the supervisor timer changes installed bytes on stations
  // (PLA8-00559).
  expect(MANAGED_HOOK_DEADLINE_MS).toBeLessThanOrEqual(hermesKillMs);
  expect(MANAGED_HOOK_DEADLINE_MS - MANAGED_HOOK_EXIT_RESERVE_MS).toBeLessThan(hermesKillMs);
  expect(hermesKillMs).toBeLessThan(hermesHookTimeoutMs);
  expect(SESSION_RENEWAL_TIMEOUT_MS).toBeLessThan(hermesKillMs);
});

// Every remaining time falls in exactly one band, and each band has its own
// outcome, so the sweep checks the low end instead of stopping there.
// - no child: childMs <= 0; the hook reports SKILLS_HOOK_TIMEOUT without
//   spawning the context child;
// - no renewal: 0 < childMs <= the child reserve; the child is told a zero
//   budget, so a stale pin reports SESSION_RENEWAL_TIMEOUT without an authority
//   read, and a fresh pin still delivers cached context within childMs;
// - renewal: the budget is positive and the child reserve fits inside childMs.
test("context child limits keep every layer inside the time the hook has left", () => {
  // A full prompt window, after the hook's own startup, keeps the whole budget.
  expect(managedContextChildLimits(MANAGED_HOOK_DEADLINE_MS - 500).renewalBudgetMs).toBe(SESSION_RENEWAL_TIMEOUT_MS);
  const bands = { noChild: 0, noRenewal: 0, renewal: 0 };
  for (let remaining = -1_000; remaining <= MANAGED_HOOK_DEADLINE_MS; remaining += 50) {
    const { childMs, renewalBudgetMs } = managedContextChildLimits(remaining);
    expect(childMs).toBeLessThanOrEqual(SESSION_CONTEXT_CHILD_CEILING_MS);
    expect(childMs + MANAGED_HOOK_EXIT_RESERVE_MS).toBeLessThanOrEqual(remaining);
    expect(renewalBudgetMs).toBeLessThanOrEqual(SESSION_RENEWAL_TIMEOUT_MS);
    if (childMs <= 0) {
      bands.noChild++;
      expect(renewalBudgetMs).toBe(0);
    } else if (childMs <= SESSION_CONTEXT_CHILD_RESERVE_MS) {
      bands.noRenewal++;
      expect(renewalBudgetMs).toBe(0);
    } else {
      bands.renewal++;
      expect(renewalBudgetMs).toBeGreaterThan(0);
      expect(renewalBudgetMs + SESSION_CONTEXT_CHILD_RESERVE_MS).toBeLessThanOrEqual(childMs);
    }
  }
  // The sweep really reaches each band.
  expect(bands.noChild).toBeGreaterThan(0);
  expect(bands.noRenewal).toBeGreaterThan(0);
  expect(bands.renewal).toBeGreaterThan(0);
});
