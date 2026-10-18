/**
 * `skills hook codex-reconcile`: the package-owned reconcile for Codex plugin
 * skill names. One invocation captures the native catalog once, plans once and,
 * with apply, writes once: the deny rows through Codex's own versioned config
 * writer, then the managed policy through the reviewed transaction. It never retries, never
 * disables a guard and never enables a skill; every outcome is one bounded
 * result object, so an unattended caller cannot mistake silence for success.
 */
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyCodexPluginReconcile, CodexPluginReconcileRefusal, planCodexPluginNameReconcile, type CodexReconcileApplyOptions } from "./agent-integration.js";
import { captureCodexNativeSkillCatalog, captureCodexRemoteReceiptSnapshot, type CodexNativeSkillCatalog } from "./codex-native-skill-catalog.js";
import { CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, CODEX_REMOTE_RECEIPT_MISMATCH, CODEX_REMOTE_RECEIPT_MISSING, CODEX_REMOTE_RECEIPT_SNAPSHOT_REQUIRED } from "./codex-plugin-skill-controls.js";
import { getDataDirReadOnly } from "./config.js";

export const CODEX_RECONCILE_RESULT_SCHEMA = "hasna.skills-codex-reconcile.v1" as const;
export type CodexReconcileOutcome = "applied" | "unchanged" | "planned" | "refused" | "error";
export interface CodexReconcileResult {
  schema: typeof CODEX_RECONCILE_RESULT_SCHEMA;
  mode: "preview" | "apply";
  outcome: CodexReconcileOutcome;
  /** Present exactly when the outcome is refused or error. */
  code?: string;
  message?: string;
  codexVersion: string | null;
  counts: { enrolled: number; alreadyEnrolled: number; denied: number; pathDenied: number; skipped: number; allowed: number };
  /** Plugin-cache names added to the reviewed controls and denied by name. */
  enrolled: string[];
  /** Runtime-cache skills denied by their stable qualified name (no plugin control exists for them). */
  denied: string[];
  /** Skills denied by exact path, each with why no stable qualified name covers it. */
  pathDenied: Array<{ name: string; path: string; reason: "plugin-disabled" | "no-qualified-name" }>;
  /** Inactive plugins (config disables them and Codex reports them disabled from a config-controlled source): neither enrolled nor refused. */
  inactive: string[];
  /** Plugins classified skills-only, each citing the manifest paths that were read. */
  classified: Array<{ pluginId: string; capabilities: string[]; manifests: string[] }>;
  /** Reviewed cache witnesses re-captured after a skills-only version change. */
  rebasedWitnesses: number;
  /** Enrolled remote plugins whose controls, stored without the install receipt, gain the verified one. */
  bound: string[];
  /** Native skills Codex loads afterwards; exactly the bridge, or the result is refused. */
  allowed: string[];
  /** Plugins whose capability kinds need a review, with the manifests read (refused only). */
  refusals?: Array<{ pluginId: string; reasons: string[]; manifests?: string[] }>;
  /** Files written (applied) or that apply would write (planned). */
  changes: string[];
  receipt?: string;
  backups?: string[];
}

/** Refusal codes: a gate decided, nothing was written, the guard keeps blocking. */
const REFUSAL_CODES = new Set([
  CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED, "NATIVE_SKILL_DRIFT", "DISCOVERY_ROOT_UNRESOLVED", "CODEX_NATIVE_SKILL_NAME_CONFLICT",
  "CODEX_NATIVE_SKILL_IDENTITY_UNSUPPORTED", "CODEX_NATIVE_SKILL_ALLOWED_SET_INVALID", "CODEX_NATIVE_SKILL_CATALOG_UNSUPPORTED_VERSION",
  "CODEX_NATIVE_SKILL_CATALOG_INVALID", "CODEX_HOOK_TRUST_NATIVE_UNSUPPORTED_VERSION", "CODEX_RECONCILE_SCOPE_EXCEEDED",
  "CODEX_RECONCILE_SEMANTIC_CACHE_UNSUPPORTED", "CODEX_RECONCILE_CODEX_HOME_UNSUPPORTED", "CODEX_RECONCILE_PLAN_CHANGED",
  "CODEX_RECONCILE_SYMLINK_REFUSED", "CODEX_RECONCILE_NATIVE_WRITER_UNAVAILABLE", "CODEX_RECONCILE_NATIVE_CONFIG_MISMATCH",
  "CODEX_RECONCILE_NATIVE_WRITE_REFUSED",
  CODEX_REMOTE_RECEIPT_MISSING, CODEX_REMOTE_RECEIPT_MISMATCH, CODEX_REMOTE_RECEIPT_SNAPSHOT_REQUIRED,
]);

/** Bounded, single-line diagnostic text. Errors here carry codes and paths,
 * never configuration or payload bytes. */
function boundedMessage(text: string): string {
  const line = text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, " ").trim();
  return line.length > 800 ? `${line.slice(0, 797)}...` : line;
}

export function classifyCodexReconcileError(error: unknown): Pick<CodexReconcileResult, "outcome" | "code" | "message" | "refusals"> {
  if (error instanceof CodexPluginReconcileRefusal) return { outcome: "refused", code: error.code, message: boundedMessage(error.message), ...(error.refusals.length ? { refusals: error.refusals } : {}) };
  const text = error instanceof Error ? error.message : String(error);
  // The guard keeps its NATIVE_SKILL_DRIFT prefix for native hooks; a named
  // code directly after it is the more precise reason.
  const outer = /^([A-Z][A-Z0-9_]{2,80})(?::|$)/.exec(text)?.[1], inner = /^NATIVE_SKILL_DRIFT: ([A-Z][A-Z0-9_]{2,80}):/.exec(text)?.[1];
  // Link refusals from the native path checks carry no code of their own.
  const code = inner && REFUSAL_CODES.has(inner) ? inner : outer ?? (/\bsymlink\b/i.test(text) ? "CODEX_RECONCILE_SYMLINK_REFUSED" : "CODEX_RECONCILE_FAILED");
  return { outcome: REFUSAL_CODES.has(code) ? "refused" : "error", code, message: boundedMessage(text) };
}

function emptyResult(mode: CodexReconcileResult["mode"]): Omit<CodexReconcileResult, "outcome"> {
  return { schema: CODEX_RECONCILE_RESULT_SCHEMA, mode, codexVersion: null, counts: { enrolled: 0, alreadyEnrolled: 0, denied: 0, pathDenied: 0, skipped: 0, allowed: 0 },
    enrolled: [], denied: [], pathDenied: [], inactive: [], classified: [], rebasedWitnesses: 0, bound: [], allowed: [], changes: [] };
}

export interface CodexReconcileOptions {
  apply: boolean;
  home: string;
  projectDir: string;
  dataDir?: string;
  codexCommand?: string;
  codexHome?: string;
  /** Test seam for the native catalog read; production uses the Codex app-server. */
  captureCatalog?: (options: { command: string; home: string; codexHome?: string; cwd: string }) => Promise<CodexNativeSkillCatalog>;
  /** Test seam for Codex's own config writer; production starts `codex app-server`. */
  connect?: CodexReconcileApplyOptions["connect"];
}

export async function runCodexPluginReconcile(options: CodexReconcileOptions): Promise<CodexReconcileResult> {
  const mode = options.apply ? "apply" : "preview";
  const base = emptyResult(mode);
  try {
    const home = resolve(options.home), projectDir = resolve(options.projectDir), dataDir = options.dataDir ?? getDataDirReadOnly();
    // The reviewed binding covers ~/.codex; another CODEX_HOME is another consumer.
    if (options.codexHome !== undefined) {
      const canonical = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
      if (canonical(options.codexHome) !== canonical(join(home, ".codex"))) throw new CodexPluginReconcileRefusal("CODEX_RECONCILE_CODEX_HOME_UNSUPPORTED", "CODEX_HOME names a Codex home other than the one the Skills binding reviews");
    }
    const capture = options.captureCatalog ?? captureCodexNativeSkillCatalog;
    // Read remote install receipts before the capture starts Codex: its
    // app-server rewrites them on start, and the review decides on this state.
    const remoteReceipts = captureCodexRemoteReceiptSnapshot(join(home, ".codex/plugins/cache"));
    // The catalog read holds and releases its own corpus lease before any write.
    const captured = await capture({ command: options.codexCommand ?? "codex", home, ...(options.codexHome === undefined ? {} : { codexHome: options.codexHome }), cwd: projectDir });
    const catalog: CodexNativeSkillCatalog = captured && typeof captured === "object" ? { ...captured, remoteReceipts } : captured;
    base.codexVersion = typeof catalog?.version === "string" ? catalog.version : null;
    const { plan, report } = planCodexPluginNameReconcile({ home, dataDir, projectDir, catalog });
    const counts = { enrolled: report.enrolled.length, alreadyEnrolled: report.alreadyEnrolled, denied: report.denied.length, pathDenied: report.pathDenied.length, skipped: report.skipped, allowed: report.allowed.length };
    const reported = { ...base, codexVersion: report.codexVersion, counts, enrolled: report.enrolled, denied: report.denied, pathDenied: report.pathDenied,
      inactive: report.inactive, classified: report.classified, rebasedWitnesses: report.rebasedWitnesses, bound: report.bound, allowed: report.allowed };
    if (!plan) return { ...reported, outcome: "unchanged" };
    const changes = plan.changes.map(change => change.path);
    if (!options.apply) return { ...reported, outcome: "planned", changes };
    // Deny rows go through Codex's own versioned writer; never a direct file write.
    const applied = await applyCodexPluginReconcile(plan, { ...(options.codexCommand === undefined ? {} : { codexCommand: options.codexCommand }), ...(options.codexHome === undefined ? {} : { codexHome: options.codexHome }), ...(options.connect ? { connect: options.connect } : {}) });
    return { ...reported, outcome: "applied", changes: applied.changed, ...(applied.receipt ? { receipt: resolve(applied.receipt) } : {}), backups: applied.backups };
  } catch (error) {
    return { ...base, ...classifyCodexReconcileError(error) } as CodexReconcileResult;
  }
}
