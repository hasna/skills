/**
 * Skill scheduler — cron-based scheduling for skills
 *
 * Schedules are stored in .skills/schedules.json in the project directory.
 * Each schedule entry defines a skill to run on a cron expression.
 *
 * Cron format: standard 5-field (minute hour dom month dow)
 * e.g. "0 9 * * *" = every day at 9am
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export interface SkillSchedule {
  id: string;
  name: string;          // human label for this schedule
  skill: string;         // skill bare name (e.g. "image")
  cron: string;          // 5-field cron expression
  args?: string[];       // optional args to pass to the skill
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
  lastRunStatus?: "success" | "error";
  nextRun?: string;
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
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {}
  }
  return { version: 1, schedules: [] };
}

function saveSchedules(data: SchedulesFile, targetDir: string = process.cwd()): void {
  const path = getSchedulesPath(targetDir);
  const dir = join(targetDir, ".skills");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
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
      const step = parseInt(stepStr);
      if (isNaN(step) || step < 1) return { valid: false, error: `Invalid step value in "${part}" in ${label}` };
    }

    // If valuePart is "*", that's a bare wildcard with step — valid, nothing more to check
    if (valuePart === "*") continue;

    // Range: N-M
    if (valuePart.includes("-")) {
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
    if (f === "*") return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    if (f.startsWith("*/")) {
      const step = parseInt(f.slice(2));
      if (isNaN(step)) return [];
      const vals: number[] = [];
      for (let i = min; i <= max; i += step) vals.push(i);
      return vals;
    }
    return f.split(",").flatMap((part) => {
      if (part.includes("-")) {
        const [lo, hi] = part.split("-").map(Number);
        return Array.from({ length: hi - lo + 1 }, (_, i) => i + lo);
      }
      const n = parseInt(part);
      return isNaN(n) ? [] : [n];
    });
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
    if (!doms.includes(dom) || !dows.includes(dow)) {
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
  const id = `${skill}-${Date.now()}`;
  const now = new Date();
  const nextRun = getNextRun(cron, now);

  const schedule: SkillSchedule = {
    id,
    name: options.name || `${skill} (${cron})`,
    skill,
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
    schedule.nextRun = getNextRun(schedule.cron)?.toISOString();
  }
  saveSchedules(data, targetDir);
  return true;
}

/** Get all schedules that are due now (nextRun <= now and enabled). */
export function getDueSchedules(targetDir?: string): SkillSchedule[] {
  const now = new Date();
  return listSchedules(targetDir).filter(
    (s) => s.enabled && s.nextRun && new Date(s.nextRun) <= now
  );
}

/** Mark a schedule as having just run. Updates lastRun and nextRun. */
export function recordScheduleRun(
  id: string,
  status: "success" | "error",
  targetDir?: string
): void {
  const data = loadSchedules(targetDir);
  const schedule = data.schedules.find((s) => s.id === id);
  if (!schedule) return;
  const now = new Date();
  schedule.lastRun = now.toISOString();
  schedule.lastRunStatus = status;
  schedule.nextRun = getNextRun(schedule.cron, now)?.toISOString();
  saveSchedules(data, targetDir);
}
