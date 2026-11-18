/** Owner report for native discovery drift (HC-01432).
 *
 * A drift receipt alone sits on the station where nobody reads it. When the
 * station configures a report target (a Todos project id and an assignee
 * address), the managed hook starts at most one detached worker,
 * `skills hook drift-report`, which files ONE Todos task per station, agent and
 * drift reason through the station's own `todos` CLI. That CLI carries its own
 * identity and credentials; this package never handles a Todos credential or
 * address.
 *
 * The hook never waits for the worker and makes no network call itself. An
 * exclusive lock file keeps concurrent prompts to one worker, and a small state
 * file records what the last attempt did, so the next prompt's notice can say
 * what really happened. Before creating a task the worker searches for an open
 * task that carries the same stable key in its title, so restarts, other
 * sessions and retries reuse it instead of filing again.
 *
 * Nothing here throws into the hook path: each step's failure only changes the
 * recorded status.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { DRIFT_REPORT_ASSIGNEE_PATTERN, DRIFT_REPORT_PROJECT_PATTERN } from "./config.js";
import { selfSpawnCommand } from "./self-spawn.js";

export const DRIFT_REPORT_PROJECT_ENV = "HASNA_SKILLS_DRIFT_REPORT_PROJECT";
export const DRIFT_REPORT_ASSIGNEE_ENV = "HASNA_SKILLS_DRIFT_REPORT_ASSIGNEE";
export const DRIFT_REPORT_TODOS_BIN_ENV = "HASNA_SKILLS_DRIFT_REPORT_TODOS_BIN";
/** The tag every drift report task carries; the dedupe search is narrowed to it. */
export const DRIFT_REPORT_TAG = "skills-drift";
/** A report that is not filed is attempted again after this long. */
export const DRIFT_REPORT_RETRY_MS = 6 * 60 * 60 * 1000;
/** One `todos` invocation's limit. */
export const DRIFT_REPORT_TODOS_TIMEOUT_MS = 20_000;
/** A lock older than this belongs to no live worker (two bounded todos calls plus margin). */
export const DRIFT_REPORT_LOCK_TTL_MS = 3 * 60 * 1000;
const SPAWN_GRACE_MS = 15_000;
const SEARCH_PAGES = 5, SEARCH_PAGE_SIZE = 50;
const MAX_STATE_BYTES = 16 * 1024, MAX_TODOS_OUTPUT_BYTES = 8 * 1024 * 1024;
const REPORT_DIRECTORY = "native-drift";
const STATE_SCHEMA = "hasna.skills.native-drift-report.v1";
const LOCK_SCHEMA = "hasna.skills.native-drift-report-lock.v1";
const AGENT = /^[a-z][a-z0-9-]{0,31}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OPERATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const OPEN_TASK_STATUSES = new Set(["pending", "in_progress"]);

export type NativeDriftReportStatus = "filed" | "existing" | "not-configured" | "failed" | "pending";
/** The owner report's outcome, as the drift receipt records it. */
export interface NativeDriftReport {
  status: NativeDriftReportStatus;
  /** The Todos task id; always present for "filed" and "existing". */
  taskId?: string;
  attemptedAt: string;
  /** A short fixed error code, never command output. */
  code?: string;
}

function exactTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

/** A report object with exactly the validated fields, or null. */
export function parseNativeDriftReport(value: unknown): NativeDriftReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const report = value as Record<string, unknown>;
  if (!["filed", "existing", "not-configured", "failed", "pending"].includes(report.status as string) || !exactTimestamp(report.attemptedAt)
    || (report.taskId !== undefined && (typeof report.taskId !== "string" || !TASK_ID.test(report.taskId)))
    || (report.code !== undefined && (typeof report.code !== "string" || !CODE.test(report.code)))
    || ((report.status === "filed" || report.status === "existing") && report.taskId === undefined)) return null;
  return {
    status: report.status as NativeDriftReportStatus, attemptedAt: report.attemptedAt,
    ...(report.taskId !== undefined ? { taskId: report.taskId as string } : {}), ...(report.code !== undefined ? { code: report.code as string } : {}),
  };
}

export class DriftReportError extends Error {
  constructor(readonly code: string) { super(code); }
}

// ---------------------------------------------------------------- target

export type DriftReportTarget =
  | { configured: true; project: string; assignee: string; todosBin?: string }
  | { configured: false; code?: string };

/** The station's global Skills configuration only: a hook never reads a project-controlled file for this. */
function readGlobalDriftReportConfig(dataDir: string): Record<string, unknown> {
  const path = join(dataDir, "config.json");
  try {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (!entry?.isFile() || entry.size > 64 * 1024) return {};
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) return {};
      const bytes = readBounded(fd, 64 * 1024);
      if (!bytes) return {};
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } finally { closeSync(fd); }
  } catch { return {}; }
}

/**
 * The configured report target. Each setting is read from its environment
 * variable first, then from the global Skills configuration
 * (`skills config set driftReportProject <uuid> --global`, and
 * driftReportAssignee, driftReportTodosBin). Without a project and an assignee
 * nothing is reported; an invalid value is reported as not configured.
 */
export function resolveDriftReportTarget(dataDir: string, env: Record<string, string | undefined> = process.env): DriftReportTarget {
  const file = readGlobalDriftReportConfig(dataDir);
  const pick = (name: string, key: string): string | undefined => {
    const fromEnv = env[name]?.trim();
    if (fromEnv) return fromEnv;
    const fromFile = file[key];
    return typeof fromFile === "string" && fromFile.trim() ? fromFile.trim() : undefined;
  };
  const project = pick(DRIFT_REPORT_PROJECT_ENV, "driftReportProject");
  const assignee = pick(DRIFT_REPORT_ASSIGNEE_ENV, "driftReportAssignee");
  const todosBin = pick(DRIFT_REPORT_TODOS_BIN_ENV, "driftReportTodosBin");
  if (project === undefined && assignee === undefined) return { configured: false };
  if (project === undefined || assignee === undefined || !DRIFT_REPORT_PROJECT_PATTERN.test(project) || !DRIFT_REPORT_ASSIGNEE_PATTERN.test(assignee)
    || (todosBin !== undefined && (!isAbsolute(todosBin) || todosBin.includes("\0")))) return { configured: false, code: "DRIFT_REPORT_CONFIG_INVALID" };
  return { configured: true, project: project.toLowerCase(), assignee, ...(todosBin !== undefined ? { todosBin } : {}) };
}

/** The station identity the package already uses (HASNA_STATION, then the host name), made safe for a title. */
export function driftReportStation(env: Record<string, string | undefined> = process.env): string {
  let raw = env.HASNA_STATION || "";
  if (!raw) { try { raw = hostname(); } catch { raw = ""; } }
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return safe || "unknown-station";
}

/** The stable key a report task carries in its title. */
export function driftReportKey(station: string, agent: string, reasonSha256: string): string {
  return `[skills-drift ${station}:${agent}:${reasonSha256.slice(0, 12)}]`;
}

// ---------------------------------------------------------------- todos binary

function validateTodosBinary(path: string): string {
  let real: string;
  try { real = realpathSync(path); }
  catch { throw new DriftReportError("DRIFT_REPORT_TODOS_MISSING"); }
  let stat;
  try { stat = statSync(real); } catch { throw new DriftReportError("DRIFT_REPORT_TODOS_MISSING"); }
  const uid = process.getuid?.();
  if (!stat.isFile() || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0 || (uid !== undefined && stat.uid !== uid && stat.uid !== 0)) {
    throw new DriftReportError("DRIFT_REPORT_TODOS_UNSAFE");
  }
  return real;
}

/**
 * The real path of the todos executable to run: the explicit absolute path
 * when configured, otherwise the first `todos` on PATH (absolute entries only).
 * Accepted only as a regular, executable file, after resolving links, owned by
 * this user or root and not writable by group or others. A relative path is
 * never run.
 */
export function resolveTodosBinary(explicit: string | undefined, env: Record<string, string | undefined> = process.env): string {
  if (explicit !== undefined) {
    if (!isAbsolute(explicit) || explicit.includes("\0")) throw new DriftReportError("DRIFT_REPORT_TODOS_RELATIVE");
    return validateTodosBinary(explicit);
  }
  for (const directory of (env.PATH ?? "").split(":")) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, "todos");
    if (!lstatSync(candidate, { throwIfNoEntry: false })) continue;
    return validateTodosBinary(candidate);
  }
  throw new DriftReportError("DRIFT_REPORT_TODOS_NOT_FOUND");
}

const TODOS_ENV_EXACT = ["HOME", "PATH", "USER", "LOGNAME", "LANG", "TMPDIR"] as const;
const TODOS_ENV_DROPPED = new Set(["HASNA_TODOS_LOCAL", "TODOS_LOCAL"]);
/**
 * The explicit environment for the todos child: the basic process names and
 * the HASNA_ and TODOS_ names its own identity and authority read. The Skills
 * package's own HASNA_SKILLS_ settings are not passed, and neither is a local
 * store opt-in, so a report never lands in a private local database.
 */
export function todosChildEnvironment(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of TODOS_ENV_EXACT) { const value = env[name]; if (value !== undefined) result[name] = value; }
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !/^(HASNA|TODOS)_[A-Z0-9_]+$/.test(name) || name.startsWith("HASNA_SKILLS_") || TODOS_ENV_DROPPED.has(name)) continue;
    result[name] = value;
  }
  result.NO_COLOR = "1";
  return result;
}

export interface TodosRun { exitCode: number | null; stdout: string; timedOut: boolean }
export type TodosRunner = (command: string, args: string[], input: string | undefined, env: Record<string, string>, timeoutMs: number) => Promise<TodosRun>;

const runTodosChild: TodosRunner = async (command, args, input, env, timeoutMs) => {
  const child = Bun.spawn([command, ...args], { cwd: env.HOME && isAbsolute(env.HOME) ? env.HOME : "/", env, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
  try {
    // stderr is drained and discarded: it is never recorded.
    const [stdout, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout: stdout.length > MAX_TODOS_OUTPUT_BYTES ? "" : stdout, timedOut };
  } finally { clearTimeout(timer); }
};

function taskIdOf(task: Record<string, unknown>): string | undefined {
  for (const value of [task.short_id, task.id]) if (typeof value === "string" && TASK_ID.test(value)) return value;
  return undefined;
}

function parseJson(text: string, code: string): any {
  try { return JSON.parse(text); } catch { throw new DriftReportError(code); }
}

// ---------------------------------------------------------------- state and lock files

interface ReportState extends NativeDriftReport {
  schema: typeof STATE_SCHEMA; agent: string; reasonSha256: string; firstSeenAt: string; operationId?: string; finishedAt?: string;
}
interface ReportLock { schema: typeof LOCK_SCHEMA; agent: string; operationId: string; createdAt: string; spawnerPid: number }

function reportPaths(dataDir: string, agent: string) {
  if (!AGENT.test(agent)) throw new Error("Invalid native drift report agent");
  const directory = join(dataDir, REPORT_DIRECTORY);
  return { directory, state: join(directory, `${agent}.report.json`), lock: join(directory, `${agent}.report.lock`) };
}

function readBounded(fd: number, limit: number): Buffer | null {
  const bytes = Buffer.alloc(limit + 1); let length = 0;
  while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
  return length > limit ? null : bytes.subarray(0, length);
}

/** A small regular file (never a link), with its identity. */
function readSmallFile(path: string): { text: string; dev: number; ino: number; mtimeMs: number } | null {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry?.isFile() || entry.size > MAX_STATE_BYTES) return null;
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { return null; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino) return null;
    const bytes = readBounded(fd, MAX_STATE_BYTES);
    if (!bytes) return null;
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
  } catch { return null; } finally { closeSync(fd); }
}

function realDirectory(path: string): boolean {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink());
}

function readState(dataDir: string, agent: string): ReportState | null {
  const file = readSmallFile(reportPaths(dataDir, agent).state);
  if (!file) return null;
  let value: any;
  try { value = JSON.parse(file.text); } catch { return null; }
  const report = parseNativeDriftReport(value);
  if (!report || value.schema !== STATE_SCHEMA || value.agent !== agent || typeof value.reasonSha256 !== "string" || !SHA256.test(value.reasonSha256)
    || !exactTimestamp(value.firstSeenAt) || (value.operationId !== undefined && (typeof value.operationId !== "string" || !OPERATION_ID.test(value.operationId)))
    || (value.finishedAt !== undefined && !exactTimestamp(value.finishedAt))) return null;
  return {
    ...report, schema: STATE_SCHEMA, agent, reasonSha256: value.reasonSha256, firstSeenAt: value.firstSeenAt,
    ...(value.operationId !== undefined ? { operationId: value.operationId } : {}), ...(value.finishedAt !== undefined ? { finishedAt: value.finishedAt } : {}),
  };
}

function writeState(dataDir: string, state: ReportState): void {
  const { directory, state: path } = reportPaths(dataDir, state.agent);
  if (!realDirectory(directory)) throw new DriftReportError("DRIFT_REPORT_STATE_UNWRITABLE");
  const current = lstatSync(path, { throwIfNoEntry: false });
  if (current && (!current.isFile() || current.isSymbolicLink())) throw new DriftReportError("DRIFT_REPORT_STATE_UNWRITABLE");
  const temporary = join(directory, `.${state.agent}.report.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    try { if (lstatSync(temporary, { throwIfNoEntry: false })?.isFile()) unlinkSync(temporary); } catch { /* left for the operator */ }
    throw error;
  }
}

interface LockSnapshot { lock: ReportLock | null; text: string; dev: number; ino: number; mtimeMs: number }
function readLock(dataDir: string, agent: string): LockSnapshot | null {
  const file = readSmallFile(reportPaths(dataDir, agent).lock);
  if (!file) return null;
  let lock: ReportLock | null = null;
  try {
    const value = JSON.parse(file.text);
    if (value?.schema === LOCK_SCHEMA && value.agent === agent && typeof value.operationId === "string" && OPERATION_ID.test(value.operationId)
      && exactTimestamp(value.createdAt) && Number.isSafeInteger(value.spawnerPid)) lock = value;
  } catch { /* being written, or damaged: judged by its age */ }
  return { lock, ...file };
}
function lockIsStale(snapshot: LockSnapshot, now: number): boolean {
  const created = snapshot.lock ? Date.parse(snapshot.lock.createdAt) : snapshot.mtimeMs;
  const age = now - Math.min(created, snapshot.mtimeMs);
  return snapshot.lock ? age > DRIFT_REPORT_LOCK_TTL_MS : age > SPAWN_GRACE_MS;
}
/** Remove the lock only while it still is the inspected file. */
function removeLockIfUnchanged(dataDir: string, agent: string, expected: LockSnapshot): void {
  const path = reportPaths(dataDir, agent).lock;
  const current = readSmallFile(path);
  if (!current || current.dev !== expected.dev || current.ino !== expected.ino || current.text !== expected.text) return;
  try { unlinkSync(path); } catch { /* another worker removed it */ }
}
function createLock(dataDir: string, lock: ReportLock): boolean {
  const { directory, lock: path } = reportPaths(dataDir, lock.agent);
  if (!realDirectory(directory)) return false;
  let fd: number;
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { return false; }
  try { writeFileSync(fd, `${JSON.stringify(lock)}\n`); } finally { closeSync(fd); }
  return true;
}
function releaseLock(dataDir: string, agent: string, operationId: string): void {
  try {
    const current = readLock(dataDir, agent);
    if (current?.lock?.operationId === operationId) removeLockIfUnchanged(dataDir, agent, current);
  } catch { /* a lock left behind expires after its TTL */ }
}

const reportOf = (state: ReportState): NativeDriftReport => ({
  status: state.status, attemptedAt: state.attemptedAt, ...(state.taskId !== undefined ? { taskId: state.taskId } : {}), ...(state.code !== undefined ? { code: state.code } : {}),
});

// ---------------------------------------------------------------- hook side

/** One drift episode: the receipt's reason and the moment this episode began. */
export interface DriftEpisode { reasonSha256: string; firstSeenAt: string }

export interface DriftReportOptions {
  env?: Record<string, string | undefined>;
  now?: () => number;
  /**
   * Tests replace the detached worker; production starts `skills hook
   * drift-report`. `notStarted` is called if the worker fails to start after
   * this returns (an asynchronous spawn error).
   */
  spawnWorker?: (args: string[], notStarted: () => void) => void;
}

export interface DriftReportPlan {
  /** The report as of this prompt, before any worker runs. */
  report: NativeDriftReport;
  /** Present when this prompt holds the lock: start the worker (after the receipt is written); returns the report to record. */
  start?: () => NativeDriftReport;
  /** Release a held lock without starting the worker (the receipt could not be recorded). */
  cancel?: () => void;
}

function spawnDetachedWorker(args: string[], notStarted: () => void): void {
  // The same pinned flags, trusted directory and allowlisted environment as
  // every other child of this CLI. No stdio is shared, so the hook's pipes
  // close when the prompt's work is done.
  const self = selfSpawnCommand(args);
  const child = spawn(self.command[0]!, self.command.slice(1), { cwd: self.cwd, env: { ...self.env, NO_COLOR: "1" }, detached: true, stdio: "ignore" });
  child.on("error", notStarted);
  child.unref();
}

/**
 * Decide this prompt's report and, when a report is due, take the exclusive
 * lock and record the attempt as pending. Never throws and never waits; it
 * makes no network call. The caller writes the receipt, then calls start().
 */
export function planNativeDriftReport(dataDir: string, agent: string, episode: DriftEpisode, options: DriftReportOptions = {}): DriftReportPlan {
  const clock = options.now ?? Date.now;
  const now = clock(), at = new Date(now).toISOString();
  try {
    const target = resolveDriftReportTarget(dataDir, options.env ?? process.env);
    if (!target.configured) return { report: { status: "not-configured", attemptedAt: at, ...(target.code ? { code: target.code } : {}) } };
    const recorded = readState(dataDir, agent);
    const current = recorded && recorded.reasonSha256 === episode.reasonSha256 && recorded.firstSeenAt === episode.firstSeenAt && recorded.status !== "not-configured" ? recorded : null;
    if (current && (current.status === "filed" || current.status === "existing")) return { report: reportOf(current) };
    const held = readLock(dataDir, agent);
    if (held && !lockIsStale(held, now)) return { report: current?.status === "pending" ? reportOf(current) : { status: "pending", attemptedAt: held.lock?.createdAt ?? at } };
    if (current) {
      const since = now - Date.parse(current.attemptedAt);
      // A pending attempt without a live lock has no worker left: it is not
      // filing anything, so it is reported as failed until the retry window ends.
      if (since >= 0 && since < DRIFT_REPORT_RETRY_MS) return { report: current.status === "pending" ? { status: "failed", attemptedAt: current.attemptedAt, code: "DRIFT_REPORT_WORKER_LOST" } : reportOf(current) };
    }
    if (held) removeLockIfUnchanged(dataDir, agent, held);
    const operationId = randomUUID();
    if (!createLock(dataDir, { schema: LOCK_SCHEMA, agent, operationId, createdAt: at, spawnerPid: process.pid })) {
      return { report: { status: "pending", attemptedAt: at } };
    }
    const pending: ReportState = { schema: STATE_SCHEMA, agent, reasonSha256: episode.reasonSha256, firstSeenAt: episode.firstSeenAt, operationId, status: "pending", attemptedAt: at };
    try { writeState(dataDir, pending); }
    catch { releaseLock(dataDir, agent, operationId); return { report: { status: "failed", attemptedAt: at, code: "DRIFT_REPORT_STATE_UNWRITABLE" } }; }
    // A worker that never started records that for this attempt only and
    // releases its lock; the retry window then applies.
    const notStarted = (code: string): NativeDriftReport => {
      const failed: ReportState = { ...pending, status: "failed", code, finishedAt: new Date(clock()).toISOString() };
      try {
        const latest = readState(dataDir, agent);
        if (latest?.operationId === operationId && latest.status === "pending") writeState(dataDir, failed);
      } catch { /* the lock below is still released */ }
      releaseLock(dataDir, agent, operationId);
      return reportOf(failed);
    };
    return {
      report: reportOf(pending),
      start: () => {
        try {
          (options.spawnWorker ?? spawnDetachedWorker)(["hook", "drift-report", "--agent", agent, "--operation-id", operationId, "--json"], () => { notStarted("DRIFT_REPORT_NOT_STARTED"); });
          return reportOf(pending);
        } catch { return notStarted("DRIFT_REPORT_NOT_STARTED"); }
      },
      cancel: () => { notStarted("DRIFT_RECEIPT_NOT_RECORDED"); },
    };
  } catch {
    return { report: { status: "failed", attemptedAt: at, code: "DRIFT_REPORT_FAILED" } };
  }
}

// ---------------------------------------------------------------- worker side

/** The receipt fields a report task may carry: safe metadata only. */
export interface DriftReportReceipt {
  agent: string; status: "active" | "cleared"; event: string; reason: string; reasonSha256: string; repair: string;
  firstSeenAt: string; lastSeenAt: string; occurrences: number; path: string;
}

export interface DriftReportRun {
  status: NativeDriftReportStatus | "superseded";
  report?: NativeDriftReport;
  episode?: DriftEpisode;
}

export interface DriftReportWorkerOptions {
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Tests replace the todos child process. */
  runTodos?: TodosRunner;
  timeoutMs?: number;
  /** Bounds the drift reason in the task description. */
  boundReason?: (reason: string) => string;
}

function dueDate(now: number): string {
  return new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The task title: a readable summary ending in the stable dedupe key. */
export function driftReportTitle(station: string, agent: string, reasonSha256: string): string {
  return `Skills native discovery drift on ${station} (${agent}) ${driftReportKey(station, agent, reasonSha256)}`;
}

/** The task description: safe metadata only (no environment, no file contents). */
export function driftReportDescription(station: string, receipt: DriftReportReceipt, reason: string): string {
  return [
    `Managed Skills hooks on station ${station} found native skill discovery drift for ${receipt.agent}. Prompts are not blocked; Skills context is omitted on this station until the drift is reviewed and repaired.`,
    "",
    `- Station: ${station}`,
    `- Agent: ${receipt.agent}`,
    `- Event: ${receipt.event}`,
    `- Reason: ${reason}`,
    `- Reason SHA-256: ${receipt.reasonSha256}`,
    `- First seen: ${receipt.firstSeenAt}`,
    `- Last seen: ${receipt.lastSeenAt}`,
    `- Occurrences: ${receipt.occurrences}`,
    `- Repair: ${receipt.repair}`,
    `- Receipt: ${receipt.path}`,
    "",
    "Filed once per station, agent and drift reason by `skills hook drift-report`. Run `skills hook drift` on the station for the current receipt.",
  ].join("\n");
}

async function findOpenReportTask(bin: string, project: string, key: string, env: Record<string, string>, run: TodosRunner, timeoutMs: number): Promise<string | undefined> {
  let continuation: string[] = [];
  for (let page = 0; page < SEARCH_PAGES; page++) {
    const result = await run(bin, ["--json", "--project", project, "list", "--tags", DRIFT_REPORT_TAG, "--limit", String(SEARCH_PAGE_SIZE), ...continuation], undefined, env, timeoutMs);
    if (result.timedOut) throw new DriftReportError("DRIFT_REPORT_TODOS_TIMEOUT");
    if (result.exitCode !== 0) throw new DriftReportError("DRIFT_REPORT_SEARCH_FAILED");
    const value = parseJson(result.stdout, "DRIFT_REPORT_SEARCH_UNREADABLE");
    if (!value || typeof value !== "object" || !Array.isArray(value.tasks)) throw new DriftReportError("DRIFT_REPORT_SEARCH_UNREADABLE");
    for (const task of value.tasks) {
      if (!task || typeof task !== "object" || typeof task.title !== "string" || !task.title.includes(key)) continue;
      if (typeof task.status === "string" && !OPEN_TASK_STATUSES.has(task.status)) continue;
      const id = taskIdOf(task);
      if (id) return id;
    }
    if (value.has_more !== true) return undefined;
    if (typeof value.next_cursor === "string" && value.next_cursor && value.next_cursor.length <= 1024) continuation = ["--cursor", value.next_cursor];
    else if (Number.isSafeInteger(value.next_offset) && value.next_offset > 0) continuation = ["--offset", String(value.next_offset)];
    else throw new DriftReportError("DRIFT_REPORT_SEARCH_INCOMPLETE");
  }
  throw new DriftReportError("DRIFT_REPORT_SEARCH_INCOMPLETE");
}

/**
 * The worker: file (or find) the one owner task for this agent's active drift
 * episode, record the outcome in the state file and release the lock. It acts
 * only for the exact lock operation that started it.
 */
export async function runDriftReportWorker(dataDir: string, agent: string, operationId: string, readReceipt: () => DriftReportReceipt | null, options: DriftReportWorkerOptions = {}): Promise<DriftReportRun> {
  const held = readLock(dataDir, agent);
  if (!held?.lock || held.lock.operationId !== operationId) return { status: "superseded" };
  const clock = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const started = readState(dataDir, agent);
  if (!started || started.operationId !== operationId) { releaseLock(dataDir, agent, operationId); return { status: "superseded" }; }
  let state: ReportState = { ...started, attemptedAt: new Date(clock()).toISOString() };
  try {
    const receipt = readReceipt();
    if (!receipt || receipt.status !== "active" || receipt.reasonSha256 !== started.reasonSha256 || receipt.firstSeenAt !== started.firstSeenAt) throw new DriftReportError("DRIFT_RECEIPT_CHANGED");
    const target = resolveDriftReportTarget(dataDir, env);
    if (!target.configured) { state = { ...state, status: "not-configured", ...(target.code ? { code: target.code } : {}) }; return { status: state.status, report: reportOf(state), episode: started }; }
    const bin = resolveTodosBinary(target.todosBin, env);
    const childEnv = todosChildEnvironment(env);
    const run = options.runTodos ?? runTodosChild, timeoutMs = options.timeoutMs ?? DRIFT_REPORT_TODOS_TIMEOUT_MS;
    const station = driftReportStation(env);
    const key = driftReportKey(station, agent, receipt.reasonSha256);
    const existing = await findOpenReportTask(bin, target.project, key, childEnv, run, timeoutMs);
    if (existing) { state = { ...state, status: "existing", taskId: existing }; delete state.code; return { status: state.status, report: reportOf(state), episode: started }; }
    const reason = (options.boundReason ?? (value => value.slice(0, 700)))(receipt.reason);
    // The description travels on stdin, never on argv.
    const created = await run(bin, ["--json", "add", driftReportTitle(station, agent, receipt.reasonSha256), "--project", target.project, "--assign", target.assignee,
      "--tags", DRIFT_REPORT_TAG, "--priority", "high", "--due", dueDate(clock()), "--description-file", "-"], driftReportDescription(station, receipt, reason), childEnv, timeoutMs);
    if (created.timedOut) throw new DriftReportError("DRIFT_REPORT_TODOS_TIMEOUT");
    if (created.exitCode !== 0) throw new DriftReportError("DRIFT_REPORT_TODOS_FAILED");
    const task = parseJson(created.stdout, "DRIFT_REPORT_NO_TASK_ID");
    const id = task && typeof task === "object" ? taskIdOf(task) : undefined;
    if (!id) throw new DriftReportError("DRIFT_REPORT_NO_TASK_ID");
    state = { ...state, status: "filed", taskId: id }; delete state.code;
    return { status: state.status, report: reportOf(state), episode: started };
  } catch (error) {
    const code = error instanceof DriftReportError && CODE.test(error.code) ? error.code : "DRIFT_REPORT_FAILED";
    state = { ...state, status: "failed", code };
    return { status: "failed", report: reportOf(state), episode: started };
  } finally {
    state = { ...state, finishedAt: new Date(clock()).toISOString() };
    try {
      const latest = readState(dataDir, agent);
      if (latest?.operationId === operationId) writeState(dataDir, state);
    } catch { /* the lock below still expires */ }
    releaseLock(dataDir, agent, operationId);
  }
}
