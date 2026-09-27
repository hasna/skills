import { isDeepStrictEqual } from "node:util";
import { need } from "./codex-hook-trust-files.js";
import { parseManagedSkillPolicy } from "./managed-policy.js";
import { verifyAgentDiscovery } from "./agent-discovery.js";

export interface ClaudeDiscoveryRecovery {
  /** Authoritative review/evidence reference explaining this exact transition. */
  reason: string;
  /** Omit to preview; supply the reviewed preview digest to record a receipt. */
  reviewedPlanDigest?: string;
}

/** This admits one named transition, not a general "ignore other agents" mode.
 * Both full policy hashes and these exact values enter the recovery plan. */
export function reviewedClaudeDiscoveryChange(beforeText: string, currentText: string, options: ClaudeDiscoveryRecovery) {
  need(typeof options.reason === "string" && options.reason.trim().length > 0 && options.reason.length <= 512 && !/[\x00-\x1f\x7f]/.test(options.reason), "RECONCILE_RECOVERY_REASON_REQUIRED");
  need(options.reviewedPlanDigest === undefined || /^[a-f0-9]{64}$/.test(options.reviewedPlanDigest), "RECONCILE_RECOVERY_PLAN_CHANGED");
  const before = parseManagedSkillPolicy(beforeText), current = parseManagedSkillPolicy(currentText);
  const oldDiscovery = before.bridge?.discovery?.claude, newDiscovery = current.bridge?.discovery?.claude;
  need(oldDiscovery?.agent === "claude" && newDiscovery?.agent === "claude" && oldDiscovery.method === "reviewed" && newDiscovery.method === "reviewed", "RECONCILE_POLICY_CHANGED");
  const changes = (["roots", "sources"] as const).filter(key => !isDeepStrictEqual(oldDiscovery[key], newDiscovery[key]))
    .map(key => ({ path: `bridge.discovery.claude.${key}`, before: oldDiscovery[key], after: newDiscovery[key] }));
  need(changes.length > 0, "RECONCILE_POLICY_CHANGED");
  // Replace only the two explicit review surfaces, then compare every other
  // field, including discovery method, commands, profiles and root aliases.
  const compared = structuredClone(current);
  compared.bridge.discovery.claude.roots = oldDiscovery.roots;
  compared.bridge.discovery.claude.sources = oldDiscovery.sources;
  need(isDeepStrictEqual(before, compared), "RECONCILE_POLICY_CHANGED");
  verifyAgentDiscovery(newDiscovery);
  return { reason: options.reason, changes };
}
