/**
 * Skill scheduler — cron-based scheduling for skills
 *
 * Schedules are stored in .skills/schedules.json in the project directory.
 * Each schedule entry defines a skill to run on a cron expression.
 *
 * Cron format: standard 5-field (minute hour dom month dow)
 * e.g. "0 9 * * *" = every day at 9am
 */

import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash, randomBytes } from "crypto";
import { toAuthoritativePublicCreditQuote, type PublicCreditQuote } from "./public-credits.js";
import { normalizeSkillsApiOrigin } from "./service-origin.js";
import { isUnsignedQuoteApprovalFingerprint } from "./unsigned-quote-approval.js";
import { normalizeSkillName } from "./utils.js";

export interface SkillSchedule {
  id: string;
  name: string;          // human label for this schedule
  skill: string;         // skill bare name (e.g. "image")
  cron: string;          // 5-field cron expression
  args?: string[];       // optional args to pass to the skill
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  lastRunStatus?: "success" | "error" | "unknown";
  nextRun?: string;
  pendingOccurrence?: {
    scheduledFor: string;
    idempotencyKey: string;
    state: "unknown";
    attempts: number;
    lastAttemptAt: string;
    retryAfter: string | null;
    requestFingerprint: string;
    submission: ScheduleRemoteSubmission;
  };
}

export interface ScheduleRemoteSubmission {
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

export const MAX_UNKNOWN_OCCURRENCE_ATTEMPTS = 3;
const UNKNOWN_RETRY_BASE_DELAY_MS = 1_000;

/** Stable for one persisted schedule occurrence and different for the next occurrence. */
export function createScheduleIdempotencyKey(schedule: Pick<SkillSchedule, "id" | "nextRun">): string {
  if (!schedule.nextRun) throw new Error("A persisted nextRun is required to identify a schedule occurrence.");
  const digest = createHash("sha256")
    .update(`${schedule.id}\u0000${schedule.nextRun}`)
    .digest("hex")
    .slice(0, 48);
  return `skills-schedule-${digest}`;
}

interface SchedulesFile {
  version: 1;
  schedules: SkillSchedule[];
}

function getSchedulesPath(targetDir: string = process.cwd()): string {
  return join(targetDir, ".skills", "schedules.json");
}

function loadSchedules(targetDir: string = process.cwd()): SchedulesFile {
  const path = getSchedulesPath(targetDir);
  if (existsSync(path)) return normalizeSchedulesFile(JSON.parse(readFileSync(path, "utf-8")));
  return { version: 1, schedules: [] };
}

function saveSchedules(data: SchedulesFile, targetDir: string = process.cwd()): void {
  const path = getSchedulesPath(targetDir);
  const dir = join(targetDir, ".skills");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const normalized = normalizeSchedulesFile(data);
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

/** Validate a single number or list/range/step value within bounds */
function validateCronField(expr: string, min: number, max: number, label: string): { valid: boolean; error?: string } {
  // Handle comma-separated lists
  for (const part of expr.split(",")) {
    // Wildcard
    if (part === "*") continue;

    // Step: */N or range/N or number/N
    let valuePart = part;
    if (part.includes("/")) {
      const slashIdx = part.indexOf("/");
      valuePart = part.slice(0, slashIdx);
      const stepStr = part.slice(slashIdx + 1);
      if (!/^\d+$/.test(stepStr)) return { valid: false, error: `Invalid step value in "${part}" in ${label}` };
      const step = parseInt(stepStr);
      if (isNaN(step) || step < 1) return { valid: false, error: `Invalid step value in "${part}" in ${label}` };
    }

    // If valuePart is "*", that's a bare wildcard with step — valid, nothing more to check
    if (valuePart === "*") continue;

    // Range: N-M
    if (valuePart.includes("-")) {
      if (!/^\d+-\d+$/.test(valuePart)) return { valid: false, error: `Invalid range "${valuePart}" in ${label}` };
      const rangeParts = valuePart.split("-");
      if (rangeParts.length !== 2) return { valid: false, error: `Invalid range expression "${valuePart}" in ${label}` };
      const lo = parseInt(rangeParts[0]);
      const hi = parseInt(rangeParts[1]);
      if (isNaN(lo) || isNaN(hi)) return { valid: false, error: `Invalid range "${valuePart}" in ${label}` };
      if (lo < min || hi > max || lo > hi) {
        return { valid: false, error: `Range ${lo}-${hi} outside valid ${min}-${max} in ${label}` };
      }
      continue;
    }

    // Single number
    if (!/^\d+$/.test(valuePart)) return { valid: false, error: `Invalid value "${valuePart}" in ${label}` };
    const n = parseInt(valuePart);
    if (isNaN(n)) return { valid: false, error: `Invalid value "${valuePart}" in ${label}` };
    if (n < min || n > max) {
      return { valid: false, error: `Value ${n} outside valid ${min}-${max} in ${label}` };
    }
  }
  return { valid: true };
}

/** Validate a 5-field cron expression with range checking. */
export function validateCron(expr: string): { valid: boolean; error?: string } {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, error: `Expected 5 fields, got ${fields.length}. Format: "minute hour day-of-month month day-of-week"` };
  }
  const [minuteF, hourF, domF, monthF, dowF] = fields;

  const checks = [
    { expr: minuteF, min: 0, max: 59, label: "minute" },
    { expr: hourF, min: 0, max: 23, label: "hour" },
    { expr: domF, min: 1, max: 31, label: "day-of-month" },
    { expr: monthF, min: 1, max: 12, label: "month" },
    { expr: dowF, min: 0, max: 6, label: "day-of-week" },
  ];

  for (const { expr: f, min, max, label } of checks) {
    const result = validateCronField(f, min, max, label);
    if (!result.valid) return result;
  }
  return { valid: true };
}

/** Compute the next run time for a cron expression relative to a given date. */
export function getNextRun(cron: string, from: Date = new Date()): Date | null {
  const { valid } = validateCron(cron);
  if (!valid) return null;

  const [minuteF, hourF, domF, monthF, dowF] = cron.trim().split(/\s+/);

  function parseField(f: string, min: number, max: number): number[] {
    const values = new Set<number>();

    for (const part of f.split(",")) {
      const [valuePart, stepPart] = part.split("/");
      const step = stepPart === undefined ? 1 : Number(stepPart);
      let start: number;
      let end: number;

      if (valuePart === "*") {
        start = min;
        end = max;
      } else if (valuePart.includes("-")) {
        [start, end] = valuePart.split("-").map(Number);
      } else {
        start = Number(valuePart);
        // N/S means every S values beginning at N through the field maximum.
        end = stepPart === undefined ? start : max;
      }

      for (let value = start; value <= end; value += step) values.add(value);
    }

    return [...values].sort((a, b) => a - b);
  }

  const minutes = parseField(minuteF, 0, 59);
  const hours = parseField(hourF, 0, 23);
  const doms = parseField(domF, 1, 31);
  const months = parseField(monthF, 1, 12);
  const dows = parseField(dowF, 0, 6);

  // Search forward from the next minute
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = new Date(from);
  limit.setFullYear(limit.getFullYear() + 1);

  while (candidate < limit) {
    const month = candidate.getMonth() + 1;
    const dom = candidate.getDate();
    const dow = candidate.getDay();
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();

    if (!months.includes(month)) {
      candidate.setMonth(candidate.getMonth() + 1, 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    const domMatches = doms.includes(dom);
    const dowMatches = dows.includes(dow);
    // Standard cron treats day-of-month and day-of-week as alternatives when
    // both fields are restricted. An exact wildcard leaves the other field in
    // control.
    const dayMatches = domF === "*"
      ? dowMatches
      : dowF === "*"
        ? domMatches
        : domMatches || dowMatches;
    if (!dayMatches) {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.includes(hour)) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minutes.includes(minute)) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(candidate);
  }

  return null;
}

/** Add a new schedule. Returns the created schedule. */
export function addSchedule(
  skill: string,
  cron: string,
  options: { name?: string; args?: string[]; targetDir?: string } = {}
): { schedule: SkillSchedule | null; error?: string } {
  const { valid, error } = validateCron(cron);
  if (!valid) return { schedule: null, error };

  const data = loadSchedules(options.targetDir);
  const normalizedSkill = requireScheduleSkill(skill);
  const id = `${normalizedSkill}-${Date.now()}`;
  const now = new Date();
  const nextRun = getNextRun(cron, now);

  const schedule: SkillSchedule = {
    id,
    name: options.name || `${skill} (${cron})`,
    skill: normalizedSkill,
    cron,
    args: options.args,
    enabled: true,
    createdAt: now.toISOString(),
    nextRun: nextRun?.toISOString(),
  };

  data.schedules.push(schedule);
  saveSchedules(data, options.targetDir);
  return { schedule };
}

/** List all schedules. */
export function listSchedules(targetDir?: string): SkillSchedule[] {
  return loadSchedules(targetDir).schedules;
}

/** Remove a schedule by id or name. Returns true if removed. */
export function removeSchedule(idOrName: string, targetDir?: string): boolean {
  const data = loadSchedules(targetDir);
  const before = data.schedules.length;
  data.schedules = data.schedules.filter(
    (s) => s.id !== idOrName && s.name !== idOrName
  );
  if (data.schedules.length === before) return false;
  saveSchedules(data, targetDir);
  return true;
}

/** Enable or disable a schedule by id or name. */
export function setScheduleEnabled(idOrName: string, enabled: boolean, targetDir?: string): boolean {
  const data = loadSchedules(targetDir);
  const schedule = data.schedules.find((s) => s.id === idOrName || s.name === idOrName);
  if (!schedule) return false;
  schedule.enabled = enabled;
  if (enabled) {
    const pending = schedule.pendingOccurrence;
    if (pending) {
      const expectedKey = createScheduleIdempotencyKey({ id: schedule.id, nextRun: pending.scheduledFor });
      if (pending.idempotencyKey !== expectedKey) {
        throw new Error("Cannot enable a schedule with inconsistent pending occurrence provenance.");
      }
      schedule.nextRun = pending.scheduledFor;
    } else {
      schedule.nextRun = getNextRun(schedule.cron)?.toISOString();
    }
  }
  saveSchedules(data, targetDir);
  return true;
}

/** Get all schedules that are due now (nextRun <= now and enabled). */
export function getDueSchedules(targetDir?: string): SkillSchedule[] {
  const now = new Date();
  return listSchedules(targetDir).filter(
    (s) => {
      if (!s.enabled || !s.nextRun || new Date(s.nextRun) > now) return false;
      const pending = s.pendingOccurrence;
      if (!pending) return true;
      if (pending.scheduledFor !== s.nextRun || pending.idempotencyKey !== createScheduleIdempotencyKey(s)) {
        return false;
      }
      if (pending.attempts >= MAX_UNKNOWN_OCCURRENCE_ATTEMPTS) return false;
      return !pending.retryAfter || new Date(pending.retryAfter) <= now;
    }
  );
}

/** Mark a schedule as having just run. Updates lastRun and nextRun. */
export function recordScheduleRun(
  id: string,
  status: "success" | "error" | "unknown",
  targetDir?: string
): void {
  const data = loadSchedules(targetDir);
  const schedule = data.schedules.find((s) => s.id === id);
  if (!schedule) return;
  const now = new Date();
  schedule.lastRun = now.toISOString();
  schedule.lastRunStatus = status;
  if (status === "unknown") {
    const pending = schedule.pendingOccurrence;
    if (!pending || pending.scheduledFor !== schedule.nextRun) {
      throw new Error("Cannot mark an unpersisted schedule mutation as unknown.");
    }
    const attempts = pending.attempts;
    const retryAfter = attempts >= MAX_UNKNOWN_OCCURRENCE_ATTEMPTS
      ? null
      : new Date(now.getTime() + UNKNOWN_RETRY_BASE_DELAY_MS * (2 ** (attempts - 1))).toISOString();
    schedule.pendingOccurrence = {
      ...pending,
      state: "unknown",
      lastAttemptAt: now.toISOString(),
      retryAfter,
    };
    saveSchedules(data, targetDir);
    return;
  }
  delete schedule.pendingOccurrence;
  schedule.nextRun = getNextRun(schedule.cron, now)?.toISOString();
  saveSchedules(data, targetDir);
}

/** Persist the exact scheduled mutation before sending it to the service. */
export function beginScheduleRunAttempt(
  id: string,
  submission: ScheduleRemoteSubmission,
  targetDir?: string,
): SkillSchedule["pendingOccurrence"] {
  const data = loadSchedules(targetDir);
  const schedule = data.schedules.find((candidate) => candidate.id === id);
  if (!schedule?.nextRun) throw new Error("A due persisted schedule occurrence is required before execution.");
  const idempotencyKey = createScheduleIdempotencyKey(schedule);
  if (submission.skill !== schedule.skill || submission.authorization.idempotencyKey !== idempotencyKey) {
    throw new Error("The scheduled submission does not match the persisted occurrence.");
  }
  const requestFingerprint = createHash("sha256").update(canonicalJson(submission)).digest("hex");
  const prior = schedule.pendingOccurrence;
  if (prior && (prior.scheduledFor !== schedule.nextRun
    || prior.idempotencyKey !== idempotencyKey
    || prior.requestFingerprint !== requestFingerprint)) {
    throw new Error("The scheduled retry request does not match the persisted logical occurrence.");
  }
  const attempts = (prior?.attempts ?? 0) + 1;
  if (attempts > MAX_UNKNOWN_OCCURRENCE_ATTEMPTS) {
    throw new Error("The scheduled occurrence exhausted its bounded retry attempts.");
  }
  schedule.pendingOccurrence = {
    scheduledFor: schedule.nextRun,
    idempotencyKey,
    state: "unknown",
    attempts,
    lastAttemptAt: new Date().toISOString(),
    retryAfter: null,
    requestFingerprint,
    submission: structuredClone(submission),
  };
  saveSchedules(data, targetDir);
  return schedule.pendingOccurrence;
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
  return JSON.stringify(value) ?? "null";
}

function normalizeSchedulesFile(value: unknown): SchedulesFile {
  if (!isRecord(value)) throw new Error("Schedules state must be an object.");
  assertOnlyKeys(value, ["version", "schedules"], "schedules state");
  if (value.version !== 1 || !Array.isArray(value.schedules)) {
    throw new Error("Schedules state has an unsupported or malformed schema.");
  }
  return {
    version: 1,
    schedules: value.schedules.map((schedule, index) => normalizeSchedule(schedule, index)),
  };
}

function normalizeSchedule(value: unknown, index: number): SkillSchedule {
  const label = `schedule[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  assertOnlyKeys(value, [
    "id", "name", "skill", "cron", "args", "enabled", "createdAt", "lastRun",
    "lastRunStatus", "nextRun", "pendingOccurrence",
  ], label);
  const skill = requireScheduleSkill(value.skill);
  const id = requiredString(value.id, `${label}.id`, 200);
  if (!/^[a-z0-9][a-z0-9._:-]*-\d{10,}$/.test(id)) throw new Error(`${label}.id is invalid.`);
  const name = requiredString(value.name, `${label}.name`, 200);
  const cron = requiredString(value.cron, `${label}.cron`, 200);
  const cronValidation = validateCron(cron);
  if (!cronValidation.valid) throw new Error(`${label}.cron is invalid: ${cronValidation.error}`);
  if (typeof value.enabled !== "boolean") throw new Error(`${label}.enabled must be a boolean.`);
  const createdAt = requiredTimestamp(value.createdAt, `${label}.createdAt`);
  const args = value.args === undefined ? undefined : stringArray(value.args, `${label}.args`);
  const lastRun = value.lastRun === undefined ? undefined : requiredTimestamp(value.lastRun, `${label}.lastRun`);
  const nextRun = value.nextRun === undefined ? undefined : requiredTimestamp(value.nextRun, `${label}.nextRun`);
  const lastRunStatus = value.lastRunStatus;
  if (lastRunStatus !== undefined && !["success", "error", "unknown"].includes(String(lastRunStatus))) {
    throw new Error(`${label}.lastRunStatus is invalid.`);
  }
  const schedule: SkillSchedule = {
    id,
    name,
    skill,
    cron,
    ...(args ? { args } : {}),
    enabled: value.enabled,
    createdAt,
    ...(lastRun ? { lastRun } : {}),
    ...(lastRunStatus ? { lastRunStatus: lastRunStatus as SkillSchedule["lastRunStatus"] } : {}),
    ...(nextRun ? { nextRun } : {}),
  };
  if (value.pendingOccurrence !== undefined) {
    schedule.pendingOccurrence = normalizePendingOccurrence(value.pendingOccurrence, schedule, label);
  }
  return schedule;
}

function normalizePendingOccurrence(
  value: unknown,
  schedule: SkillSchedule,
  scheduleLabel: string,
): NonNullable<SkillSchedule["pendingOccurrence"]> {
  const label = `${scheduleLabel}.pendingOccurrence`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  assertOnlyKeys(value, [
    "scheduledFor", "idempotencyKey", "state", "attempts", "lastAttemptAt",
    "retryAfter", "requestFingerprint", "submission",
  ], label);
  const scheduledFor = requiredTimestamp(value.scheduledFor, `${label}.scheduledFor`);
  const idempotencyKey = requiredString(value.idempotencyKey, `${label}.idempotencyKey`, 200);
  const expectedKey = createScheduleIdempotencyKey({ id: schedule.id, nextRun: scheduledFor });
  if (idempotencyKey !== expectedKey || schedule.nextRun !== scheduledFor) {
    throw new Error(`${label} does not match the persisted schedule occurrence.`);
  }
  if (value.state !== "unknown") throw new Error(`${label}.state must be unknown.`);
  if (!Number.isSafeInteger(value.attempts) || Number(value.attempts) < 1
    || Number(value.attempts) > MAX_UNKNOWN_OCCURRENCE_ATTEMPTS) {
    throw new Error(`${label}.attempts is invalid.`);
  }
  const lastAttemptAt = requiredTimestamp(value.lastAttemptAt, `${label}.lastAttemptAt`);
  const retryAfter = value.retryAfter === null
    ? null
    : requiredTimestamp(value.retryAfter, `${label}.retryAfter`);
  const requestFingerprint = requiredString(value.requestFingerprint, `${label}.requestFingerprint`, 64);
  if (!/^[a-f0-9]{64}$/.test(requestFingerprint)) throw new Error(`${label}.requestFingerprint is invalid.`);
  const submission = normalizeScheduleSubmission(value.submission, `${label}.submission`);
  if (submission.skill !== schedule.skill || submission.authorization.idempotencyKey !== idempotencyKey) {
    throw new Error(`${label}.submission does not match the schedule occurrence.`);
  }
  const expectedFingerprint = createHash("sha256").update(canonicalJson(submission)).digest("hex");
  if (requestFingerprint !== expectedFingerprint) throw new Error(`${label}.requestFingerprint does not match its submission.`);
  return {
    scheduledFor,
    idempotencyKey,
    state: "unknown",
    attempts: Number(value.attempts),
    lastAttemptAt,
    retryAfter,
    requestFingerprint,
    submission,
  };
}

function normalizeScheduleSubmission(value: unknown, label: string): ScheduleRemoteSubmission {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  assertOnlyKeys(value, [
    "deployment", "skill", "input", "args", "authorization", "creditQuote", "approvedQuoteFingerprint",
  ], label);
  if (!isRecord(value.deployment)) throw new Error(`${label}.deployment must be an object.`);
  assertOnlyKeys(value.deployment, ["mode", "apiUrl"], `${label}.deployment`);
  if (value.deployment.mode !== "cloud" && value.deployment.mode !== "self-hosted") {
    throw new Error(`${label}.deployment.mode must be cloud or self-hosted.`);
  }
  const deployment = {
    mode: value.deployment.mode as "cloud" | "self-hosted",
    apiUrl: normalizeSkillsApiOrigin(
      requiredString(value.deployment.apiUrl, `${label}.deployment.apiUrl`, 2_048),
      process.env,
    ),
  };
  const skill = requireScheduleSkill(value.skill);
  if (!isRecord(value.input) || !isJsonValue(value.input)) throw new Error(`${label}.input must be a JSON object.`);
  const args = stringArray(value.args, `${label}.args`);
  if (!isRecord(value.authorization)) throw new Error(`${label}.authorization must be an object.`);
  assertOnlyKeys(value.authorization, ["idempotencyKey", "quoteToken", "approved"], `${label}.authorization`);
  const idempotencyKey = requiredString(value.authorization.idempotencyKey, `${label}.authorization.idempotencyKey`, 200);
  if (!/^[\x21-\x7E]+$/.test(idempotencyKey)) throw new Error(`${label}.authorization.idempotencyKey is invalid.`);
  const quoteToken = value.authorization.quoteToken === undefined
    ? undefined
    : requiredString(value.authorization.quoteToken, `${label}.authorization.quoteToken`, 8_192);
  if (value.authorization.approved !== undefined && typeof value.authorization.approved !== "boolean") {
    throw new Error(`${label}.authorization.approved must be a boolean.`);
  }
  const approvedQuoteFingerprint = value.approvedQuoteFingerprint;
  if (approvedQuoteFingerprint !== undefined && !isUnsignedQuoteApprovalFingerprint(approvedQuoteFingerprint)) {
    throw new Error(`${label}.approvedQuoteFingerprint is invalid.`);
  }
  return {
    deployment,
    skill,
    input: structuredClone(value.input),
    args,
    authorization: {
      idempotencyKey,
      ...(quoteToken ? { quoteToken } : {}),
      ...(value.authorization.approved !== undefined ? { approved: value.authorization.approved } : {}),
    },
    creditQuote: toAuthoritativePublicCreditQuote(value.creditQuote),
    ...(approvedQuoteFingerprint ? { approvedQuoteFingerprint } : {}),
  };
}

function requireScheduleSkill(value: unknown): string {
  const skill = typeof value === "string" ? normalizeSkillName(value) : "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) throw new Error("Schedule skill is invalid.");
  return skill;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`${label} must be a non-empty safe string.`);
  }
  return value;
}

function requiredTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100
    || value.some((item) => typeof item !== "string" || item.length > 4_096 || /\u0000/.test(item))) {
    throw new Error(`${label} must be an array of safe strings.`);
  }
  return [...value];
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unsupported) throw new Error(`${label} contains unsupported field '${unsupported}'.`);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
