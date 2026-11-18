/** Non-blocking native discovery drift (owner request 2026-10-20).
 *
 * A live lifecycle hook that finds NATIVE_SKILL_DRIFT no longer blocks the
 * prompt, the session or the tool call. It omits the Skills context for that
 * turn, shows one bounded warning, and records a durable local receipt here so
 * an operator or monitor can see the drift without reading transcripts. The
 * guard itself still throws: install, trust, migrate, sync and upgrades keep
 * refusing drift exactly as before. Tool-policy refusals (a native payload
 * skill instead of the skills-cli bridge) are not drift and keep blocking.
 *
 * A bridge that cannot be verified (missing, modified, a binding that no
 * longer names it, or a native copy that can resolve under its name) is a
 * NativeBridgeIntegrityRefusal. The tool call that would load the bridge keeps
 * being refused for it, because a payload written under the bridge's own name
 * would otherwise load. The prompt, session, subagent and every other tool
 * call still proceed, and the notice tells the agent not to invoke the bridge.
 *
 * Owner report (HC-01432): when the station configures a report target, the
 * hook also starts one detached worker that files a single Todos task per
 * station, agent and drift reason (native-drift-report.ts). The receipt
 * records that report's state, and the agent notice says what really happened
 * as of this prompt: filed (with the task id), being filed, or recorded on this
 * station only.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driftReasonKeySha256, parseNativeDriftReport, planNativeDriftReport, runDriftReportWorker, type DriftReportOptions, type DriftReportRun, type DriftReportWorkerOptions, type NativeDriftReport } from "./native-drift-report.js";

export type { NativeDriftReport, NativeDriftReportStatus } from "./native-drift-report.js";

export const NATIVE_DRIFT_RECEIPT_SCHEMA = "hasna.skills.native-drift-receipt.v1";
export const NATIVE_DRIFT_RECEIPT_DIRECTORY = "native-drift";
const MAX_REASON = 4000, MAX_WARNING_REASON = 700, MAX_RECEIPT_BYTES = 64 * 1024;
const AGENT = /^[a-z][a-z0-9-]{0,31}$/;

/** A native tool-policy refusal: denying a native payload skill is the
 * protection that keeps a drifted station safe, so it is never failed open. */
export class NativeSkillPolicyRefusal extends Error {}

/** The skills-cli bridge itself could not be verified: it is missing or
 * modified, or the managed binding that names it is missing, incompatible or
 * no longer resolves. A tool call that would load the bridge is refused; a
 * prompt, session or subagent event fails open with NATIVE_DRIFT_BRIDGE_NOTICE. */
export class NativeBridgeIntegrityRefusal extends NativeSkillPolicyRefusal {}

export function isNativeSkillDrift(error: unknown): error is Error {
  return error instanceof Error && !(error instanceof NativeSkillPolicyRefusal) && error.message.startsWith("NATIVE_SKILL_DRIFT:");
}

export function isNativeBridgeIntegrityRefusal(error: unknown): error is NativeBridgeIntegrityRefusal {
  return error instanceof NativeBridgeIntegrityRefusal;
}

/** Escape controls, format characters and line separators as \uXXXX so a path
 * from the file system cannot hide or reorder warning text, then bound it. */
export function boundedDriftReason(message: string, limit = MAX_REASON): string {
  const escaped = message.replace(/^NATIVE_SKILL_DRIFT:\s*/, "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    character => Array.from({ length: character.length }, (_, index) => `\\u${character.charCodeAt(index).toString(16).padStart(4, "0")}`).join(""));
  return escaped.length <= limit ? escaped : `${escaped.slice(0, limit - 1)}…`;
}

export function nativeDriftRepair(agent: string): string {
  return `skills hook install --agent ${agent} --apply, with --discovery-inputs <reviewed-file> for a reviewed binding`;
}

/** One visible line: what happened, the bounded drift reason (it names the
 * changed path or copies), the repair command and the receipt path. */
export function nativeDriftWarning(agent: string, message: string, receiptPath: string | null): string {
  return `Skills warning: native discovery changed; this prompt was not blocked and Skills context was omitted. ${boundedDriftReason(message, MAX_WARNING_REASON)} Review the change, then repair with ${nativeDriftRepair(agent)}.${receiptPath ? ` Receipt: ${receiptPath}` : " The drift receipt could not be recorded."}`;
}

/**
 * What the station did with the drift, as of this prompt. Fixed text per case;
 * it claims an owner was told only when a Todos task id exists.
 */
export function nativeDriftReportClause(report: NativeDriftReport | null | undefined, receiptRecorded = true): string {
  if (!receiptRecorded) return "this station could not record it and filed no owner report";
  if ((report?.status === "filed" || report?.status === "existing") && report.taskId) return `this station recorded it and filed one task for the Skills owner (Todos ${report.taskId})`;
  if (report?.status === "pending") return "this station recorded it locally and is filing one task for the Skills owner";
  if (report?.status === "failed") return "this station recorded it locally only (the owner report failed); an operator can list it with `skills hook drift`";
  return "this station recorded it locally only (no owner report is configured); an operator can list it with `skills hook drift`";
}

/** Agent-facing notice for the turn whose Skills context was omitted. */
export function nativeDriftAgentNotice(report: NativeDriftReport | null | undefined, receiptRecorded = true): string {
  return `Skills context is unavailable for this turn because the station's native skill discovery changed; ${nativeDriftReportClause(report, receiptRecorded)}. Continue the user's task. Load a selected skill explicitly with \`skills load <slug>\` if one is needed, and do not load native skill copies.`;
}

/** Agent-facing notice when the skills-cli bridge itself is unverified: the
 * bridge tool is refused this turn, so the agent uses the CLI instead. */
export function nativeDriftBridgeNotice(report: NativeDriftReport | null | undefined, receiptRecorded = true): string {
  return `Skills context is unavailable for this turn because the station's skills-cli bridge could not be verified; ${nativeDriftReportClause(report, receiptRecorded)}. Continue the user's task, but do not invoke the skills-cli native skill until it is repaired. Run the \`skills\` command directly (for example \`skills load <slug>\`) if a skill is needed, and do not load native skill copies.`;
}

export interface NativeDriftReceipt {
  schema: typeof NATIVE_DRIFT_RECEIPT_SCHEMA;
  agent: string;
  status: "active" | "cleared";
  code: "NATIVE_SKILL_DRIFT";
  event: string;
  promptBlocked: false;
  skillsContext: "omitted";
  reason: string;
  reasonSha256: string;
  repair: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  clearedAt?: string;
  /** The owner report for this drift episode; absent in receipts written before 0.10.98. */
  report?: NativeDriftReport;
}

export function nativeDriftReceiptPath(dataDir: string, agent: string): string {
  if (!AGENT.test(agent)) throw new Error("Invalid native drift receipt agent");
  return join(dataDir, NATIVE_DRIFT_RECEIPT_DIRECTORY, `${agent}.json`);
}

function readReceipt(path: string): NativeDriftReceipt | null {
  const initial = lstatSync(path, { throwIfNoEntry: false });
  if (!initial || !initial.isFile() || initial.size > MAX_RECEIPT_BYTES) return null;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) return null;
    const bytes = Buffer.alloc(MAX_RECEIPT_BYTES + 1); let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > MAX_RECEIPT_BYTES) return null;
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
    if (value?.schema !== NATIVE_DRIFT_RECEIPT_SCHEMA || typeof value.agent !== "string" || !["active", "cleared"].includes(value.status)) return null;
    // A receipt written before the owner report has no `report`; one that has
    // it must hold exactly a valid report, which replaces the parsed field.
    if (value.report === undefined) return value as NativeDriftReceipt;
    const report = parseNativeDriftReport(value.report);
    return report ? { ...value, report } as NativeDriftReceipt : null;
  } catch { return null; } finally { closeSync(fd); }
}

/** The receipt directory, created as a leaf only under an existing real app home. */
function receiptDirectory(dataDir: string): string | null {
  const root = lstatSync(dataDir, { throwIfNoEntry: false });
  // Never create the app home or follow a substituted link from a hook.
  if (!root?.isDirectory() || root.isSymbolicLink()) return null;
  const directory = join(dataDir, NATIVE_DRIFT_RECEIPT_DIRECTORY);
  const existing = lstatSync(directory, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) return null;
  // The parent exists, so this creates only the leaf; a concurrent hook may win.
  if (!existing) mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function writeReceipt(dataDir: string, agent: string, receipt: NativeDriftReceipt): string | null {
  const directory = receiptDirectory(dataDir);
  if (!directory) return null;
  const path = nativeDriftReceiptPath(dataDir, agent);
  const current = lstatSync(path, { throwIfNoEntry: false });
  if (current && (!current.isFile() || current.isSymbolicLink())) return null;
  const temporary = join(directory, `.${agent}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    return path;
  } catch {
    try { if (lstatSync(temporary, { throwIfNoEntry: false })?.isFile()) unlinkSync(temporary); } catch { /* left for the operator */ }
    return null;
  }
}

/** The refreshed active receipt for this drift (not yet written). The same
 * reason continues its episode and keeps its report; a new reason starts one. */
function nextReceipt(dataDir: string, agent: string, event: string, message: string, now: Date): NativeDriftReceipt {
  const path = nativeDriftReceiptPath(dataDir, agent);
  const reason = boundedDriftReason(message), reasonSha256 = createHash("sha256").update(reason).digest("hex");
  const previous = readReceipt(path), at = now.toISOString();
  const same = previous?.status === "active" && previous.reasonSha256 === reasonSha256;
  return {
    schema: NATIVE_DRIFT_RECEIPT_SCHEMA, agent, status: "active", code: "NATIVE_SKILL_DRIFT", event: boundedDriftReason(event, 64),
    promptBlocked: false, skillsContext: "omitted", reason, reasonSha256, repair: nativeDriftRepair(agent),
    firstSeenAt: same ? previous.firstSeenAt : at, lastSeenAt: at, occurrences: same ? previous.occurrences + 1 : 1,
    ...(same && previous.report ? { report: previous.report } : {}),
  };
}

/** Record or refresh the active receipt for this agent. Never throws: the
 * warning says when the receipt could not be recorded. */
export function recordNativeDriftReceipt(dataDir: string, agent: string, event: string, message: string, now = new Date()): string | null {
  try { return writeReceipt(dataDir, agent, nextReceipt(dataDir, agent, event, message, now)); }
  catch { return null; }
}

/**
 * Record the receipt and decide its owner report, starting at most one
 * detached report worker. Never throws and never waits for the worker.
 */
export function recordNativeDriftReceiptWithReport(dataDir: string, agent: string, event: string, message: string, options: DriftReportOptions = {}): { path: string | null; report: NativeDriftReport | null } {
  let path: string | null = null, report: NativeDriftReport | null = null;
  try {
    const now = new Date((options.now ?? Date.now)());
    const receipt = nextReceipt(dataDir, agent, event, message, now);
    // The report's lock and state live beside the receipt; the directory must
    // exist before the plan takes the lock.
    const plan = receiptDirectory(dataDir) ? planNativeDriftReport(dataDir, agent, { reasonSha256: receipt.reasonSha256, firstSeenAt: receipt.firstSeenAt, reasonKeySha256: driftReasonKeySha256(receipt.reason) }, options) : null;
    report = plan?.report ?? null;
    path = writeReceipt(dataDir, agent, report ? { ...receipt, report } : receipt);
    if (plan?.start && path) {
      // The worker reads the receipt, so it starts only after the write.
      const started = plan.start();
      if (started.status !== report?.status) { report = started; try { writeReceipt(dataDir, agent, { ...receipt, report }); } catch { /* the state file still records it */ } }
    } else if (plan?.cancel) plan.cancel();
  } catch { /* the warning and notice say what was recorded */ }
  return { path, report: path ? report : null };
}

/**
 * The detached report worker (`skills hook drift-report`): file or find the
 * one owner task for this agent's active drift, then record the outcome in the
 * receipt when it still describes the same episode.
 */
export async function runNativeDriftReport(dataDir: string, agent: string, operationId: string, options: DriftReportWorkerOptions = {}): Promise<DriftReportRun> {
  const path = nativeDriftReceiptPath(dataDir, agent);
  const result = await runDriftReportWorker(dataDir, agent, operationId, () => {
    const receipt = readReceipt(path);
    return receipt ? { ...receipt, path } : null;
  }, { boundReason: reason => boundedDriftReason(reason, MAX_WARNING_REASON), ...options });
  if (result.report && result.episode) {
    try {
      const current = readReceipt(path);
      if (current?.status === "active" && current.reasonSha256 === result.episode.reasonSha256 && current.firstSeenAt === result.episode.firstSeenAt) {
        writeReceipt(dataDir, agent, { ...current, report: result.report });
      }
    } catch { /* the next prompt copies the outcome from the report state */ }
  }
  return result;
}

/** After a clean verification: mark an active receipt cleared, keeping its
 * history. Absent or already cleared receipts are left untouched. */
export function clearNativeDriftReceipt(dataDir: string, agent: string, now = new Date()): void {
  try {
    const path = nativeDriftReceiptPath(dataDir, agent);
    if (!lstatSync(path, { throwIfNoEntry: false })) return;
    const previous = readReceipt(path);
    if (previous?.status !== "active") return;
    writeReceipt(dataDir, agent, { ...previous, status: "cleared", clearedAt: now.toISOString() });
  } catch { /* the next clean prompt tries again */ }
}

/** Every readable receipt, for operators and monitors. */
export function readNativeDriftReceipts(dataDir: string): NativeDriftReceipt[] {
  const directory = join(dataDir, NATIVE_DRIFT_RECEIPT_DIRECTORY);
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return [];
  return readdirSync(directory).filter(name => /^[a-z][a-z0-9-]{0,31}\.json$/.test(name)).sort()
    .flatMap(name => { const receipt = readReceipt(join(directory, name)); return receipt ? [receipt] : []; });
}

/** The non-blocking envelope for drift, in each native adapter's own shape. */
export function nativeDriftFailOpen(dataDir: string, agent: string, event: string, nativeEvent: string, message: string, options: { bridgeUnverified?: boolean; report?: DriftReportOptions } = {}): Record<string, unknown> {
  const recorded = recordNativeDriftReceiptWithReport(dataDir, agent, event, message, options.report);
  const warning = nativeDriftWarning(agent, message, recorded.path);
  const notice = (options.bridgeUnverified === true ? nativeDriftBridgeNotice : nativeDriftAgentNotice)(recorded.report, recorded.path !== null);
  // Hermes accepts exactly {action: "continue"} on a tool call; its prompt hook
  // has a context channel only. The Sumi and OpenCode plugins read
  // additionalContext only, so the warning travels there: those hosts show it
  // to the model, not in a separate user-visible channel (the receipt and
  // `skills hook drift` remain the operator's record).
  if (agent === "hermes") return event === "pre_tool_call" ? { action: "continue" } : { context: `${warning}\n\n${notice}` };
  if (agent === "sumi" || agent === "opencode") return { hookSpecificOutput: { hookEventName: event, additionalContext: `${warning}\n\n${notice}` } };
  if (agent === "cursor") return { continue: true, user_message: warning };
  // A tool call proceeds through the agent's normal permission flow: no
  // decision is made for it either way. An unverified or shadowed bridge never
  // reaches here on the tool call that would load it: the hook refuses that
  // call instead. Any other tool (Hermes runs this hook for every tool) proceeds.
  if (event === "PreToolUse" || event === "BeforeTool") return { systemMessage: warning };
  return { systemMessage: warning, hookSpecificOutput: { hookEventName: agent === "gemini" ? nativeEvent : event, additionalContext: notice } };
}
