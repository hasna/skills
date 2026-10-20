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
 * A bridge that cannot be verified (missing, modified, or a binding that no
 * longer names it) is a NativeBridgeIntegrityRefusal. A tool call that would
 * load the bridge keeps being refused for it, because a payload written under
 * the bridge's own name would otherwise load. The prompt, session or subagent
 * still proceeds, and its notice tells the agent not to invoke the bridge.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/** Fixed agent-facing notice for the turn whose Skills context was omitted. */
export const NATIVE_DRIFT_AGENT_NOTICE = "Skills context is unavailable for this turn because the station's native skill discovery changed; the change was reported to the operator. Continue the user's task. Load a selected skill explicitly with `skills load <slug>` if one is needed, and do not load native skill copies.";

/** Fixed agent-facing notice when the skills-cli bridge itself is unverified:
 * the bridge tool is refused this turn, so the agent uses the CLI instead. */
export const NATIVE_DRIFT_BRIDGE_NOTICE = "Skills context is unavailable for this turn because the station's skills-cli bridge could not be verified; the change was reported to the operator. Continue the user's task, but do not invoke the skills-cli native skill until it is repaired. Run the `skills` command directly (for example `skills load <slug>`) if a skill is needed, and do not load native skill copies.";

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
    return value?.schema === NATIVE_DRIFT_RECEIPT_SCHEMA && typeof value.agent === "string" && ["active", "cleared"].includes(value.status) ? value as NativeDriftReceipt : null;
  } catch { return null; } finally { closeSync(fd); }
}

function writeReceipt(dataDir: string, agent: string, receipt: NativeDriftReceipt): string | null {
  const root = lstatSync(dataDir, { throwIfNoEntry: false });
  // Never create the app home or follow a substituted link from a hook.
  if (!root?.isDirectory() || root.isSymbolicLink()) return null;
  const directory = join(dataDir, NATIVE_DRIFT_RECEIPT_DIRECTORY);
  const existing = lstatSync(directory, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) return null;
  // The parent exists, so this creates only the leaf; a concurrent hook may win.
  if (!existing) mkdirSync(directory, { recursive: true, mode: 0o700 });
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

/** Record or refresh the active receipt for this agent. Never throws: the
 * warning says when the receipt could not be recorded. */
export function recordNativeDriftReceipt(dataDir: string, agent: string, event: string, message: string, now = new Date()): string | null {
  try {
    const path = nativeDriftReceiptPath(dataDir, agent);
    const reason = boundedDriftReason(message), reasonSha256 = createHash("sha256").update(reason).digest("hex");
    const previous = readReceipt(path), at = now.toISOString();
    const same = previous?.status === "active" && previous.reasonSha256 === reasonSha256;
    return writeReceipt(dataDir, agent, {
      schema: NATIVE_DRIFT_RECEIPT_SCHEMA, agent, status: "active", code: "NATIVE_SKILL_DRIFT", event: boundedDriftReason(event, 64),
      promptBlocked: false, skillsContext: "omitted", reason, reasonSha256, repair: nativeDriftRepair(agent),
      firstSeenAt: same ? previous.firstSeenAt : at, lastSeenAt: at, occurrences: same ? previous.occurrences + 1 : 1,
    });
  } catch { return null; }
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
export function nativeDriftFailOpen(dataDir: string, agent: string, event: string, nativeEvent: string, message: string, options: { bridgeUnverified?: boolean } = {}): Record<string, unknown> {
  const receipt = recordNativeDriftReceipt(dataDir, agent, event, message);
  const warning = nativeDriftWarning(agent, message, receipt);
  const notice = options.bridgeUnverified === true ? NATIVE_DRIFT_BRIDGE_NOTICE : NATIVE_DRIFT_AGENT_NOTICE;
  // Hermes accepts exactly {action: "continue"} on a tool call; its prompt hook
  // has a context channel only. The Sumi and OpenCode plugins read
  // additionalContext only, so the warning travels there: those hosts show it
  // to the model, not in a separate user-visible channel (the receipt and
  // `skills hook drift` remain the operator's record).
  if (agent === "hermes") return event === "pre_tool_call" ? { action: "continue" } : { context: `${warning}\n\n${notice}` };
  if (agent === "sumi" || agent === "opencode") return { hookSpecificOutput: { hookEventName: event, additionalContext: `${warning}\n\n${notice}` } };
  if (agent === "cursor") return { continue: true, user_message: warning };
  // A tool call proceeds through the agent's normal permission flow: no
  // decision is made for it either way. An unverified bridge never reaches
  // here on a tool call: the hook refuses that call instead.
  if (event === "PreToolUse" || event === "BeforeTool") return { systemMessage: warning };
  return { systemMessage: warning, hookSpecificOutput: { hookEventName: agent === "gemini" ? nativeEvent : event, additionalContext: notice } };
}
