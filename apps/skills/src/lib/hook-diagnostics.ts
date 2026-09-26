/** Only owned codes and fixed advice may cross the child-process hook boundary. */
const CONTEXT_ERROR_CODES = new Set([
  "SKILLS_CONTEXT_FAILED", "SKILLS_STORAGE_FULL", "PROFILE_LOCK_MISMATCH", "PROFILE_IDENTITY_MISMATCH",
  "PROFILE_APPLIED_REPORT_FAILED", "CACHED_AUTHORITY_REQUIRED", "CACHED_PROFILE_EXPIRED",
  "CACHED_PROFILE_MISSING", "CACHED_BUNDLE_MISSING", "INVALID_CONTEXT_INPUT",
  "CONTEXT_INPUT_TOO_LARGE", "INVALID_CONTEXT_BUDGET", "INVALID_SELECTION",
  "INVALID_SELECTION_ALIASES", "INVALID_RECEIPT", "INVALID_CACHE_FILE", "UNSAFE_CACHE_PATH",
  "RECEIPT_TOO_LARGE", "BUNDLE_DIGEST_MISMATCH", "BUNDLE_IDENTITY_MISMATCH",
  "BUNDLE_UNAVAILABLE", "BUNDLE_TOO_LARGE", "SKILL_NOT_SELECTED", "INVALID_SESSION",
  "SESSION_PARENT_NOT_FOUND", "SESSION_NOT_FOUND", "SESSION_GENERATION_CHANGED",
  "SESSION_GENERATION_EXHAUSTED", "SESSION_PARENT_CHANGED", "SESSION_RECEIPT_CHANGED",
  "SESSION_RECONCILIATION_REQUIRED",
  "SESSION_RECONCILIATION_INCOMPLETE", "SESSION_WRITE_LOCKED", "SESSION_WRITE_LOCK_CHANGED", "SESSION_LOCK_RECOVERY_INCOMPLETE",
]);

export class HookDiagnosticError extends Error {
  constructor(readonly code: string, readonly stage: "context" | "sync") {
    super("Skills hook operation failed");
  }
}

export function hookChildError(stdout: string, stage: "context" | "sync"): HookDiagnosticError {
  // Never propagate messages, stderr, paths or foreign response bodies. The
  // failure envelope is small even when successful sync receipts are large.
  let code: unknown;
  if (stdout.length <= 16 * 1024) {
    try { code = JSON.parse(stdout)?.error?.code; } catch { /* fixed fallback below */ }
  }
  return new HookDiagnosticError(typeof code === "string" && CONTEXT_ERROR_CODES.has(code) ? code : "SKILLS_CONTEXT_FAILED", stage);
}

export function hookFailureReason(error: unknown, profileId?: string): string {
  const owned = error instanceof HookDiagnosticError;
  const code = owned && (CONTEXT_ERROR_CODES.has(error.code) || ["SKILLS_HOOK_TIMEOUT", "SKILLS_HOOK_INVALID_RESPONSE"].includes(error.code)) ? error.code : "SKILLS_HOOK_FAILED";
  const profile = typeof profileId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profileId) && !profileId.includes("..") ? profileId : undefined;
  const identity = [profile ? `profile=${profile}` : undefined, owned ? `stage=${error.stage}` : undefined].filter(Boolean).join(", ");
  const prefix = `Skills context is unavailable [${code}]${identity ? ` (${identity})` : ""}.`;
  if (code === "SKILLS_STORAGE_FULL") {
    return `${prefix} The filesystem is full or its quota is exhausted. Free space through your approved recoverable cleanup process, then retry the same session. Do not delete session receipts or change credentials to bypass this failure.`;
  }
  if (code === "PROFILE_LOCK_MISMATCH") {
    return `${prefix} This session or project is pinned to a different profile. Inspect the session with skills sessions show <session-id> --json; review skills sessions reconcile for an intentional session change, or explicit project sync for a project change. Sync alone does not change that pin.`;
  }
  if (code === "SESSION_RECONCILIATION_REQUIRED") {
    return `${prefix} A loaded skill changed or was removed. Inspect this session with skills sessions show <session-id> --json, then review skills sessions reconcile for an intentional change. Sync alone does not change this pin.`;
  }
  if (code.startsWith("SESSION_")) {
    return `${prefix} Inspect the session with skills sessions show <session-id> --json and review its parent or concurrent writer before retrying. Do not remove or rewrite its receipt to bypass this refusal.`;
  }
  if (["PROFILE_IDENTITY_MISMATCH", "BUNDLE_DIGEST_MISMATCH", "BUNDLE_IDENTITY_MISMATCH", "INVALID_RECEIPT", "INVALID_CACHE_FILE", "UNSAFE_CACHE_PATH"].includes(code)) {
    return `${prefix} Verify the selected authority and receipt integrity before repairing the profile; do not bypass verification or substitute another cache.`;
  }
  const selected = profile ?? "<id>";
  return `${prefix} Run skills sync --selection-profile ${selected} --json, then diagnose with skills context --stdin --json --cached --selection-profile ${selected} using the same hook session and working-directory fields. Do not include credentials in diagnostic input.`;
}
