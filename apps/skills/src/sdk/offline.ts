/**
 * Offline gate: local runs fail closed when the skill cannot run offline.
 *
 * Two failures, both silent in the past, are made explicit:
 *
 *   - With an API origin configured, a run is a remote submission. The client
 *     NEVER silently falls back to local execution, cached or not - that is
 *     how a stale local copy quietly diverges from the hosted truth. The gate
 *     throws REMOTE_REQUIRED before anything executes.
 *   - Without an API origin, a run is local - but only from the verified
 *     cache. A skill that is not cached, or whose contract requires network
 *     it does not have, fails with SKILL_UNAVAILABLE_OFFLINE rather than
 *     running partially or pretending.
 */
import { GOVERNANCE_ERROR_CODES, GovernanceError } from "./governance.js";

export interface OfflineGateOptions {
  /** The configured API origin; present means "this client is hosted". */
  apiUrl?: string;
  /** True when the skill is present in the verified local cache. */
  isCached: (skill: string) => boolean | Promise<boolean>;
  /** True when the skill's contract requires network. */
  isNetworkRequired?: (skill: string) => boolean | Promise<boolean>;
}

export interface OfflineGate {
  /**
   * Decide whether a run may execute locally. Throws GovernanceError with the
   * exact code (REMOTE_REQUIRED | SKILL_UNAVAILABLE_OFFLINE) when it may not.
   */
  assertCanRunLocal(skill: string): Promise<void>;
}

export function createOfflineGate(options: OfflineGateOptions): OfflineGate {
  return {
    async assertCanRunLocal(skill) {
      if (options.apiUrl && options.apiUrl.trim()) {
        throw new GovernanceError(
          GOVERNANCE_ERROR_CODES.REMOTE_REQUIRED,
          `skill ${skill} must run through the configured API origin; refusing a silent local fallback`,
          { gate: "apiUrl" },
        );
      }
      const cached = await options.isCached(skill);
      if (!cached) {
        throw new GovernanceError(
          GOVERNANCE_ERROR_CODES.SKILL_UNAVAILABLE_OFFLINE,
          `skill ${skill} is not in the verified local cache and no API origin is configured; the run fails closed offline`,
          { gate: "offlineCache" },
        );
      }
      if (options.isNetworkRequired && (await options.isNetworkRequired(skill))) {
        throw new GovernanceError(
          GOVERNANCE_ERROR_CODES.SKILL_UNAVAILABLE_OFFLINE,
          `skill ${skill} requires network, which is unavailable with no API origin; the run fails closed offline`,
          { gate: "offlineNetwork" },
        );
      }
    },
  };
}
