/**
 * Runtime records for skill executions.
 *
 * `.skills/runs` and `.skills/exports` hold what skills produced, not what
 * skills are. Source files and SKILL.md documents are never written here.
 */

import { createHash, randomBytes } from "crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, relative, resolve } from "path";
import { normalizeSkillName } from "./utils.js";
import { getProjectStateDir } from "./project-state.js";
import { toAuthoritativePublicCreditQuote, type PublicCreditQuote } from "./public-credits.js";
import { normalizeSkillsApiOrigin } from "./service-origin.js";
import { isUnsignedQuoteApprovalFingerprint } from "./unsigned-quote-approval.js";

export type SkillRunStatus = "queued" | "running" | "unknown" | "completed" | "failed";

const LOCAL_RUN_ID_PATTERN = /^run_[a-z0-9]+_[a-f0-9]{8}$/;
const RUN_PATH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SKILL_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SkillRunArtifact {
  path: string;
  mime: string;
  sha256: string;
  sizeBytes: number;
}

export interface SkillRunRecord {
  id: string;
  skill: string;
  status: SkillRunStatus;
  prompt?: string;
  args: string[];
  startedAt: string;
  completedAt?: string;
  remote: boolean;
  idempotencyKey?: string;
  retryCount?: number;
  remoteRunId?: string;
  credits?: number;
  creditQuote?: PublicCreditQuote;
  error?: string;
  artifacts: SkillRunArtifact[];
  paths: {
    runDir: string;
    exportDir: string;
    logsDir: string;
  };
}

export interface SkillRunContext {
  targetDir: string;
  runDir: string;
  exportDir: string;
  logsDir: string;
  record: SkillRunRecord;
}

export interface PersistedRemoteSubmission {
  fingerprint: string;
  deployment: {
    mode: "cloud" | "self-hosted";
    apiUrl: string;
  };
  skill: string;
  input: Record<string, unknown>;
  args: string[];
  authorization: {
    idempotencyKey: string;
    quoteToken?: string;
    approved?: boolean;
  };
  creditQuote: PublicCreditQuote;
  approvedQuoteFingerprint?: string;
}

export function createSkillRun(
  params: {
    skill: string;
    args?: string[];
    prompt?: string;
    remote?: boolean;
    remoteRunId?: string;
    credits?: number;
    creditQuote?: PublicCreditQuote;
    status?: SkillRunStatus;
    idempotencyKey?: string;
  },
  targetDir: string = process.cwd(),
): SkillRunContext {
  const now = new Date();
  const id = createRunId(now);
  const day = now.toISOString().slice(0, 10);
  const skillName = requireValidSkillPathName(params.skill);
  const creditQuote = params.creditQuote
    ? toAuthoritativePublicCreditQuote(params.creditQuote)
    : undefined;
  if (creditQuote && params.credits !== undefined && params.credits !== creditQuote.credits) {
    throw new Error("Local run credits must match the authoritative credit quote.");
  }
  const root = getProjectStateDir(targetDir);
  const runDir = join(root, "runs", day, id);
  const logsDir = join(runDir, "logs");
  const exportDir = join(root, "exports", skillName, id);

  const record: SkillRunRecord = {
    id,
    skill: skillName,
    status: params.status ?? "running",
    ...(params.prompt ? { prompt: params.prompt } : {}),
    args: params.args ?? [],
    startedAt: now.toISOString(),
    remote: params.remote ?? false,
    ...(params.remote
      ? { idempotencyKey: requireValidIdempotencyKey(params.idempotencyKey ?? createRunIdempotencyKey(id)) }
      : {}),
    ...(params.remoteRunId ? { remoteRunId: params.remoteRunId } : {}),
    ...(creditQuote ? { creditQuote, credits: creditQuote.credits } : params.credits !== undefined ? { credits: params.credits } : {}),
    artifacts: [],
    paths: {
      runDir: toProjectRelative(targetDir, runDir),
      exportDir: toProjectRelative(targetDir, exportDir),
      logsDir: toProjectRelative(targetDir, logsDir),
    },
  };

  const context = { targetDir, runDir, exportDir, logsDir, record };
  assertRunContextPaths(context);
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(exportDir, { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  assertRunContextPaths(context);
  writeRunRecord(context);
  writeArtifactsManifest(context, []);
  appendRunEvent(context, "created", { status: record.status });
  return context;
}

export function completeSkillRun(
  context: SkillRunContext,
  patch: { status: SkillRunStatus; error?: string; remoteRunId?: string; credits?: number },
): SkillRunRecord {
  if (context.record.status === "unknown") return context.record;
  if (context.record.creditQuote && patch.credits !== undefined && patch.credits !== context.record.creditQuote.credits) {
    throw new Error("Completed run credits must match the authoritative credit quote.");
  }
  const artifacts = collectRunArtifacts(context);
  context.record = {
    ...context.record,
    status: patch.status,
    completedAt: new Date().toISOString(),
    ...(patch.error ? { error: patch.error } : {}),
    ...(patch.remoteRunId ? { remoteRunId: patch.remoteRunId } : {}),
    ...(patch.credits !== undefined ? { credits: patch.credits } : {}),
    artifacts,
  };
  writeArtifactsManifest(context, artifacts);
  writeRunRecord(context);
  appendRunEvent(context, patch.status, patch.error ? { error: patch.error } : {});
  return context.record;
}

export function updateSkillRun(context: SkillRunContext, patch: Partial<SkillRunRecord>): SkillRunRecord {
  context.record = { ...context.record, ...patch };
  writeRunRecord(context);
  appendRunEvent(context, "updated", { status: context.record.status });
  return context.record;
}

/**
 * Record that a mutation may have reached the service but its response was not
 * received. The record intentionally remains incomplete so a caller can retry
 * the same logical attempt with the same idempotency key.
 */
export function markSkillRunOutcomeUnknown(context: SkillRunContext, error: string): SkillRunRecord {
  context.record = {
    ...context.record,
    status: "unknown",
    error,
  };
  writeRunRecord(context);
  appendRunEvent(context, "outcome_unknown", {
    status: context.record.status,
    retryCount: context.record.retryCount ?? 0,
  });
  return context.record;
}

/** Resume a persisted ambiguous remote mutation without creating a new key. */
export function resumeSkillRunAttempt(
  runId: string,
  expected: { skill: string; args?: string[] },
  targetDir: string = process.cwd(),
): SkillRunContext {
  requireValidLocalRunId(runId);
  const record = findSkillRun(runId, targetDir);
  if (!record) throw new Error(`Local run '${runId}' was not found.`);
  const expectedSkill = normalizeSkillName(expected.skill);
  const expectedArgs = expected.args ?? [];
  if (record.skill !== expectedSkill || JSON.stringify(record.args) !== JSON.stringify(expectedArgs)) {
    throw new Error(`Local run '${runId}' does not match the requested skill and arguments.`);
  }
  if (!record.remote || record.status !== "unknown") {
    throw new Error(`Local run '${runId}' is not an unknown remote mutation and cannot be retried.`);
  }
  const idempotencyKey = requireValidIdempotencyKey(record.idempotencyKey);
  const context = {
    targetDir,
    runDir: join(targetDir, record.paths.runDir),
    exportDir: join(targetDir, record.paths.exportDir),
    logsDir: join(targetDir, record.paths.logsDir),
    record: { ...record, idempotencyKey },
  };
  assertRunContextPaths(context);
  return context;
}

/** Mark a validated retry as in flight immediately before the mutation request. */
export function beginSkillRunAttempt(context: SkillRunContext): SkillRunRecord {
  if (!context.record.remote || context.record.status !== "unknown") return context.record;
  const idempotencyKey = requireValidIdempotencyKey(context.record.idempotencyKey);
  const { error: _previousError, completedAt: _completedAt, ...persisted } = context.record;
  context.record = {
    ...persisted,
    status: "running",
    idempotencyKey,
    retryCount: (context.record.retryCount ?? 0) + 1,
  };
  writeRunRecord(context);
  appendRunEvent(context, "retry_started", {
    status: context.record.status,
    retryCount: context.record.retryCount,
  });
  return context.record;
}

export function getRunIdempotencyKey(record: Pick<SkillRunRecord, "idempotencyKey">): string {
  return requireValidIdempotencyKey(record.idempotencyKey);
}

/** Persist the exact mutation body before network I/O so response loss is replayable. */
export function persistRemoteSubmission(
  context: SkillRunContext,
  submission: Omit<PersistedRemoteSubmission, "fingerprint">,
): PersistedRemoteSubmission {
  const normalized = normalizeRemoteSubmission(submission);
  if (normalized.skill !== context.record.skill) {
    throw new Error("Remote submission skill does not match the local logical attempt.");
  }
  if (normalized.authorization.idempotencyKey !== getRunIdempotencyKey(context.record)) {
    throw new Error("Remote submission idempotency key does not match the local logical attempt.");
  }
  const existing = readPersistedRemoteSubmission(context);
  if (existing && existing.fingerprint !== normalized.fingerprint) {
    throw new Error("Remote retry request does not match the persisted logical attempt.");
  }
  const persisted = existing ?? normalized;
  context.record = {
    ...context.record,
    credits: persisted.creditQuote.credits,
    creditQuote: persisted.creditQuote,
  };
  writeRunRecord(context);
  appendRunEvent(context, "remote_submission_persisted", {
    status: context.record.status,
    deploymentMode: persisted.deployment.mode,
  });
  writeRunFile(context, remoteSubmissionPath(context), `${JSON.stringify(persisted, null, 2)}\n`, 0o600);
  return persisted;
}

/** Load the immutable request used by an unknown mutation; never reconstruct it from a fresh quote. */
export function loadRemoteSubmission(context: SkillRunContext): PersistedRemoteSubmission {
  const submission = readPersistedRemoteSubmission(context);
  if (!submission) throw new Error("The persisted remote logical attempt is missing its immutable submission request.");
  if (submission.authorization.idempotencyKey !== getRunIdempotencyKey(context.record)) {
    throw new Error("The persisted remote submission does not match the local idempotency key.");
  }
  if (!context.record.creditQuote
    || canonicalJson(toAuthoritativePublicCreditQuote(context.record.creditQuote)) !== canonicalJson(submission.creditQuote)
    || context.record.credits !== submission.creditQuote.credits) {
    throw new Error("The persisted local run does not match its authoritative remote credit quote.");
  }
  return submission;
}

export function assertRemoteSubmissionTarget(
  submission: Pick<PersistedRemoteSubmission, "deployment">,
  target: { mode: "cloud" | "self-hosted"; apiUrl: string },
): void {
  const apiUrl = normalizeSkillsApiOrigin(target.apiUrl, process.env);
  if (submission.deployment.mode !== target.mode || submission.deployment.apiUrl !== apiUrl) {
    throw new Error("The persisted remote logical attempt belongs to a different deployment mode or service origin.");
  }
}

export function clearRemoteSubmission(context: SkillRunContext): void {
  assertRunContextPaths(context);
  const path = remoteSubmissionPath(context);
  assertSafeLeaf(path, "remote submission");
  if (existsSync(path)) unlinkSync(path);
}

export function writeRunLogs(context: SkillRunContext, stdout = "", stderr = ""): void {
  assertRunContextPaths(context);
  writeRunFile(context, join(context.logsDir, "stdout.log"), stdout, 0o600);
  writeRunFile(context, join(context.logsDir, "stderr.log"), stderr, 0o600);
}

export function appendRunEvent(context: SkillRunContext, event: string, data: Record<string, unknown> = {}): void {
  assertRunContextPaths(context);
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n";
  const path = join(context.runDir, "events.ndjson");
  assertSafeLeaf(path, "run events");
  const previous = existsSync(path) ? readFileSync(path, "utf-8") : "";
  writeRunFile(context, path, previous + line, 0o600);
}

export function listSkillRuns(targetDir: string = process.cwd(), limit = 50): SkillRunRecord[] {
  const runsRoot = join(getProjectStateDir(targetDir), "runs");
  if (!existsSync(runsRoot)) return [];
  const records: SkillRunRecord[] = [];
  for (const day of readdirSync(runsRoot).sort().reverse()) {
    const dayDir = join(runsRoot, day);
    if (!statSync(dayDir).isDirectory()) continue;
    for (const runId of readdirSync(dayDir).sort().reverse()) {
      const record = readRunRecord(join(dayDir, runId), targetDir);
      if (record) records.push(record);
      if (records.length >= limit) return records;
    }
  }
  return records;
}

export function findSkillRun(runId: string, targetDir: string = process.cwd()): SkillRunRecord | null {
  const safeRunId = requireValidLocalRunId(runId);
  const runsRoot = join(getProjectStateDir(targetDir), "runs");
  if (!existsSync(runsRoot)) return null;
  for (const day of readdirSync(runsRoot)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const candidate = join(runsRoot, day, safeRunId);
    assertPathContained(runsRoot, candidate, "run directory");
    const record = readRunRecord(candidate, targetDir);
    if (record) return record;
  }
  return null;
}

export function getRunExportDir(runId: string, skill: string, targetDir: string = process.cwd()): string {
  const safeRunId = requireValidRunPathId(runId);
  const safeSkill = requireValidSkillPathName(skill);
  const exportsRoot = join(getProjectStateDir(targetDir), "exports");
  const exportDir = join(exportsRoot, safeSkill, safeRunId);
  assertPathContained(exportsRoot, exportDir, "export directory");
  return exportDir;
}

function writeRunRecord(context: SkillRunContext): void {
  assertRunContextPaths(context);
  writeRunFile(context, join(context.runDir, "run.json"), JSON.stringify(context.record, null, 2) + "\n", 0o600);
}

function writeArtifactsManifest(context: SkillRunContext, artifacts: SkillRunArtifact[]): void {
  assertRunContextPaths(context);
  writeRunFile(context, join(context.runDir, "artifacts.json"), JSON.stringify({ runId: context.record.id, artifacts }, null, 2) + "\n", 0o600);
}

function collectRunArtifacts(context: SkillRunContext): SkillRunArtifact[] {
  assertRunContextPaths(context);
  if (!existsSync(context.exportDir)) return [];
  const artifacts: SkillRunArtifact[] = [];
  for (const path of walkFiles(context.exportDir)) {
    const stat = statSync(path);
    const bytes = readFileSync(path);
    artifacts.push({
      path: toProjectRelative(context.targetDir, path),
      mime: mimeForPath(path),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: stat.size,
    });
  }
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

function readRunRecord(runDir: string, targetDir: string): SkillRunRecord | null {
  const path = join(runDir, "run.json");
  if (!existsSync(path)) return null;
  try {
    assertSafeLeaf(path, "run record");
    const record = JSON.parse(readFileSync(path, "utf-8")) as SkillRunRecord;
    assertRunRecordShape(record);
    const context = {
      targetDir,
      runDir,
      exportDir: resolve(targetDir, record.paths.exportDir),
      logsDir: resolve(targetDir, record.paths.logsDir),
      record,
    };
    assertRunContextPaths(context);
    return record;
  } catch {
    return null;
  }
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error("Run exports must not contain symbolic links.");
    if (stat.isDirectory()) files.push(...walkFiles(full));
    else if (stat.isFile()) files.push(full);
  }
  return files;
}

function createRunId(now: Date): string {
  return `run_${now.getTime().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function createRunIdempotencyKey(runId: string): string {
  return `skills-run-${createHash("sha256").update(runId).digest("hex").slice(0, 48)}`;
}

export function requireValidLocalRunId(value: string): string {
  if (!LOCAL_RUN_ID_PATTERN.test(value)) {
    throw new Error("Local run id has an invalid format.");
  }
  return value;
}

export function requireValidIdempotencyKey(value: string | undefined): string {
  if (!value || value.length > 200 || !/^[\x21-\x7E]+$/.test(value)) {
    throw new Error("Idempotency key must contain 1-200 visible ASCII characters.");
  }
  return value;
}

function remoteSubmissionPath(context: SkillRunContext): string {
  assertRunContextPaths(context);
  return join(context.runDir, "remote-submission.json");
}

function normalizeRemoteSubmission(
  submission: Omit<PersistedRemoteSubmission, "fingerprint">,
): PersistedRemoteSubmission {
  const skill = normalizeSkillName(submission.skill);
  const deployment = {
    mode: submission.deployment.mode,
    apiUrl: normalizeSkillsApiOrigin(submission.deployment.apiUrl, process.env),
  };
  if (deployment.mode !== "cloud" && deployment.mode !== "self-hosted") {
    throw new Error("Remote submission requires cloud or self-hosted deployment mode.");
  }
  const creditQuote = toAuthoritativePublicCreditQuote(submission.creditQuote);
  const approvedQuoteFingerprint = submission.approvedQuoteFingerprint;
  if (approvedQuoteFingerprint !== undefined && !isUnsignedQuoteApprovalFingerprint(approvedQuoteFingerprint)) {
    throw new Error("Remote submission contains an invalid approved quote fingerprint.");
  }
  const authorization = {
    idempotencyKey: requireValidIdempotencyKey(submission.authorization.idempotencyKey),
    ...(submission.authorization.quoteToken ? { quoteToken: submission.authorization.quoteToken } : {}),
    ...(submission.authorization.approved !== undefined ? { approved: submission.authorization.approved } : {}),
  };
  const body = {
    deployment,
    skill,
    input: structuredClone(submission.input),
    args: [...submission.args],
    authorization,
    creditQuote,
    ...(approvedQuoteFingerprint ? { approvedQuoteFingerprint } : {}),
  };
  return {
    ...body,
    fingerprint: createHash("sha256").update(canonicalJson(body)).digest("hex"),
  };
}

function readPersistedRemoteSubmission(context: SkillRunContext): PersistedRemoteSubmission | undefined {
  const path = remoteSubmissionPath(context);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedRemoteSubmission;
    const normalized = normalizeRemoteSubmission(parsed);
    return parsed.fingerprint === normalized.fingerprint ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toProjectRelative(targetDir: string, path: string): string {
  const rel = relative(targetDir, path).split(/[\\/]/).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function requireValidRunPathId(value: string): string {
  if (!RUN_PATH_ID_PATTERN.test(value)) throw new Error("Run id has an invalid format.");
  return value;
}

function requireValidSkillPathName(value: string): string {
  const normalized = normalizeSkillName(value);
  if (!SKILL_PATH_PATTERN.test(normalized)) throw new Error("Skill name has an invalid path format.");
  return normalized;
}

function assertRunRecordShape(record: SkillRunRecord): void {
  requireValidLocalRunId(record.id);
  requireValidSkillPathName(record.skill);
  if (!["queued", "running", "unknown", "completed", "failed"].includes(record.status)) {
    throw new Error("Persisted run status is invalid.");
  }
  if (!Array.isArray(record.args) || record.args.some((arg) => typeof arg !== "string")) {
    throw new Error("Persisted run arguments are invalid.");
  }
  if (typeof record.startedAt !== "string" || !Number.isFinite(Date.parse(record.startedAt))) {
    throw new Error("Persisted run start time is invalid.");
  }
  if (typeof record.remote !== "boolean" || !Array.isArray(record.artifacts)) {
    throw new Error("Persisted run metadata is invalid.");
  }
  if (!record.paths || typeof record.paths.runDir !== "string"
    || typeof record.paths.exportDir !== "string" || typeof record.paths.logsDir !== "string") {
    throw new Error("Persisted run paths are invalid.");
  }
}

function assertRunContextPaths(context: SkillRunContext): void {
  assertRunRecordShape(context.record);
  const stateRoot = resolve(getProjectStateDir(context.targetDir));
  const runsRoot = join(stateRoot, "runs");
  const exportsRoot = join(stateRoot, "exports");
  const day = context.record.startedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Persisted run start date is invalid.");
  const expectedRunDir = join(runsRoot, day, context.record.id);
  const expectedExportDir = join(exportsRoot, context.record.skill, context.record.id);
  const expectedLogsDir = join(expectedRunDir, "logs");
  const recordedRunDir = resolve(context.targetDir, context.record.paths.runDir);
  const recordedExportDir = resolve(context.targetDir, context.record.paths.exportDir);
  const recordedLogsDir = resolve(context.targetDir, context.record.paths.logsDir);

  assertExactPath(context.runDir, expectedRunDir, "run directory");
  assertExactPath(context.exportDir, expectedExportDir, "export directory");
  assertExactPath(context.logsDir, expectedLogsDir, "logs directory");
  assertExactPath(recordedRunDir, expectedRunDir, "persisted run directory");
  assertExactPath(recordedExportDir, expectedExportDir, "persisted export directory");
  assertExactPath(recordedLogsDir, expectedLogsDir, "persisted logs directory");
  assertPathContained(runsRoot, expectedRunDir, "run directory");
  assertPathContained(exportsRoot, expectedExportDir, "export directory");
  assertPathContained(expectedRunDir, expectedLogsDir, "logs directory");
  const projectRoot = resolve(context.targetDir);
  assertNoSymlinkComponents(projectRoot, expectedRunDir, "run directory");
  assertNoSymlinkComponents(projectRoot, expectedExportDir, "export directory");
  assertNoSymlinkComponents(projectRoot, expectedLogsDir, "logs directory");
  assertNoSymlinkComponents(projectRoot, join(stateRoot, "tmp"), "temporary directory");
}

function assertExactPath(actual: string, expected: string, label: string): void {
  if (resolve(actual) !== resolve(expected)) throw new Error(`${label} does not match the expected project run path.`);
}

function assertPathContained(root: string, candidate: string, label: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${/\\/.test(rel) ? "\\" : "/"}`) || resolve(resolvedRoot, rel) !== resolvedCandidate) {
    if (rel !== "") throw new Error(`${label} escapes its expected project root.`);
  }
  if (existsSync(resolvedRoot) && existsSync(resolvedCandidate)) {
    const realRoot = realpathSync(resolvedRoot);
    const realCandidate = realpathSync(resolvedCandidate);
    const realRel = relative(realRoot, realCandidate);
    if (realRel === ".." || realRel.startsWith("../") || realRel.startsWith("..\\")) {
      throw new Error(`${label} resolves outside its expected project root.`);
    }
  }
}

function assertNoSymlinkComponents(base: string, candidate: string, label: string): void {
  const resolvedBase = resolve(base);
  const resolvedCandidate = resolve(candidate);
  assertPathContained(resolvedBase, resolvedCandidate, label);
  if (existsSync(resolvedBase) && lstatSync(resolvedBase).isSymbolicLink()) {
    throw new Error(`${label} project root must not be a symbolic link.`);
  }
  const rel = relative(resolvedBase, resolvedCandidate);
  let current = resolvedBase;
  for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link.`);
  }
}

function assertSafeLeaf(path: string, label: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file.`);
}

function writeRunFile(context: SkillRunContext, path: string, contents: string, mode: number): void {
  assertRunContextPaths(context);
  const allowedRoot = resolve(path).startsWith(`${resolve(context.logsDir)}/`)
    ? context.logsDir
    : context.runDir;
  assertPathContained(allowedRoot, path, "run file");
  assertNoSymlinkComponents(resolve(context.targetDir), dirname(path), "run file parent");
  assertSafeLeaf(path, "run file");
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    writeFileSync(temporaryPath, contents, { mode, flag: "wx" });
    chmodSync(temporaryPath, mode);
    renameSync(temporaryPath, path);
    chmodSync(path, mode);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function mimeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".pdf": return "application/pdf";
    case ".md": return "text/markdown";
    case ".txt":
    case ".log": return "text/plain";
    case ".json": return "application/json";
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    default: return "application/octet-stream";
  }
}
