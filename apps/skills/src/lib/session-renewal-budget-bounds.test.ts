import { expect, test } from "bun:test";
import { hermesHookDefinitions, renderHermesSupervisor } from "./agent-hermes.js";
import { MANAGED_HOOK_DEADLINE_MS, SESSION_CONTEXT_CHILD_CEILING_MS, SESSION_RENEWAL_TIMEOUT_MS } from "./session-reconciliation.js";

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

test("each managed-hook timeout sits inside the one that encloses it", () => {
  expect(hermesKill).not.toBeNull();
  const hermesKillMs = Number(hermesKill![1]);
  expect(SESSION_RENEWAL_TIMEOUT_MS).toBeLessThan(SESSION_CONTEXT_CHILD_CEILING_MS);
  expect(SESSION_CONTEXT_CHILD_CEILING_MS).toBeLessThan(MANAGED_HOOK_DEADLINE_MS);
  // Currently equal (12 s each): zero headroom, not a margin. The supervisor's
  // timer starts at spawn, before the hook sets its own deadline, so at the
  // limit the supervisor kills the hook first, early by the hook's startup
  // time, and no deadline diagnostic is written. Raising the supervisor timer
  // changes installed bytes on stations (PLA8-00559); until then this only
  // stops the gap from getting worse.
  expect(MANAGED_HOOK_DEADLINE_MS).toBeLessThanOrEqual(hermesKillMs);
  expect(hermesKillMs).toBeLessThan(hermesHookTimeoutMs);
  expect(SESSION_RENEWAL_TIMEOUT_MS).toBeLessThan(hermesKillMs);
});
