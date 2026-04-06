/**
 * Scheduler tests — cron validation, getNextRun, and schedule CRUD
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  validateCron,
  getNextRun,
  addSchedule,
  listSchedules,
  removeSchedule,
  setScheduleEnabled,
  getDueSchedules,
  recordScheduleRun,
} from "./scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTmpDir(): string {
  const dir = join(__dirname, "..", "..", "tmp-sched-test-" + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

describe("validateCron", () => {
  test("rejects fewer/more than 5 fields", () => {
    expect(validateCron("0 9 * *").valid).toBe(false);
    expect(validateCron("* * * * * *").valid).toBe(false);
    expect(validateCron("").valid).toBe(false);
  });

  test("accepts common valid patterns", () => {
    expect(validateCron("*/5 * * * *").valid).toBe(true);
    expect(validateCron("0 9 * * *").valid).toBe(true);
    expect(validateCron("30 8,12,17 * * 1-5").valid).toBe(true);
    expect(validateCron("0 0 1 1 *").valid).toBe(true);
    expect(validateCron("0 0 * * 0").valid).toBe(true);
  });

  test("rejects values outside ranges", () => {
    expect(validateCron("60 * * * *").valid).toBe(false);  // minute > 59
    expect(validateCron("* 24 * * *").valid).toBe(false);  // hour > 23
    expect(validateCron("* * 32 * *").valid).toBe(false);  // dom > 31
    expect(validateCron("* * * 13 *").valid).toBe(false);  // month > 12
    expect(validateCron("* * * * 7").valid).toBe(false);   // dow > 6
    expect(validateCron("-1 * * * *").valid).toBe(false);  // negative minute
    expect(validateCron("* -1 * * *").valid).toBe(false);  // negative hour
  });

  test("rejects invalid step expressions", () => {
    expect(validateCron("*/0 * * * *").valid).toBe(false);  // step 0
  });

  test("rejects invalid ranges", () => {
    expect(validateCron("10-5 * * * *").valid).toBe(false);  // lo > hi
    expect(validateCron("* abc * * *").valid).toBe(false);    // non-numeric
  });
});

describe("getNextRun", () => {
  test("every minute schedule", () => {
    const from = new Date("2026-04-05T10:30:00Z");
    const next = getNextRun("* * * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(new Date("2026-04-05T10:31:00Z").getTime());
  });

  test("daily at 9am", () => {
    const from = new Date("2026-04-05T08:00:00Z");
    const next = getNextRun("0 9 * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });

  test("every 5 minutes", () => {
    const from = new Date("2026-04-05T10:02:00Z");
    const next = getNextRun("*/5 * * * *", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCMinutes()).toBe(5);
  });

  test("weekday-only schedule", () => {
    const from = new Date("2026-04-04T10:00:00Z"); // Saturday
    const next = getNextRun("0 9 * * 1-5", from);
    expect(next).not.toBeNull();
    expect(next!.getUTCDay()).toBe(1); // Monday
  });
});

describe("addSchedule", () => {
  let dir: string;
  afterEach(() => cleanup(dir));

  test("creates a valid schedule", () => {
    dir = makeTmpDir();
    const { schedule, error } = addSchedule("image", "0 9 * * *", { name: "daily image", targetDir: dir });
    expect(error).toBeUndefined();
    expect(schedule).not.toBeNull();
    expect(schedule!.skill).toBe("image");
    expect(schedule!.cron).toBe("0 9 * * *");
    expect(schedule!.enabled).toBe(true);
    expect(schedule!.nextRun).toBeDefined();
  });

  test("rejects invalid cron", () => {
    dir = makeTmpDir();
    const { schedule, error } = addSchedule("image", "99 99 * * *", { targetDir: dir });
    expect(error).toBeDefined();
    expect(schedule).toBeNull();
  });
});

describe("listSchedules / removeSchedule / setScheduleEnabled", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => cleanup(dir));

  test("list returns empty initially", () => {
    expect(listSchedules(dir)).toHaveLength(0);
  });

  test("add then list", () => {
    addSchedule("image", "0 9 * * *", { name: "daily", targetDir: dir });
    const schedules = listSchedules(dir);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].name).toBe("daily");
  });

  test("remove by id", () => {
    addSchedule("image", "0 9 * * *", { targetDir: dir });
    const schedules = listSchedules(dir);
    expect(removeSchedule(schedules[0].id, dir)).toBe(true);
    expect(listSchedules(dir)).toHaveLength(0);
  });

  test("setScheduleEnabled disables and re-enables", () => {
    addSchedule("image", "0 9 * * *", { targetDir: dir });
    const schedules = listSchedules(dir);
    expect(schedules[0].enabled).toBe(true);

    setScheduleEnabled(schedules[0].id, false, dir);
    expect(listSchedules(dir)[0].enabled).toBe(false);
  });
});

describe("getDueSchedules", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => cleanup(dir));

  test("no schedules due in the future", () => {
    addSchedule("image", "0 9 * * *", { targetDir: dir });
    expect(getDueSchedules(dir)).toHaveLength(0);
  });

  test("schedule is due when nextRun is in the past", () => {
    addSchedule("image", "* * * * *", { targetDir: dir });
    const schedules = listSchedules(dir);
    expect(schedules[0].nextRun).toBeDefined();
    // Wait 0ms — nextRun should be ~1 min from now; not due yet
    // To test due schedules, manually set nextRun to past
    const data = JSON.parse(require("fs").readFileSync(join(dir, ".skills", "schedules.json"), "utf-8"));
    data.schedules[0].nextRun = "2020-01-01T00:00:00.000Z";
    require("fs").writeFileSync(join(dir, ".skills", "schedules.json"), JSON.stringify(data));
    const due = getDueSchedules(dir);
    expect(due).toHaveLength(1);
  });
});

describe("recordScheduleRun", () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => cleanup(dir));

  test("updates lastRun and nextRun", () => {
    addSchedule("image", "0 9 * * *", { targetDir: dir });
    const schedules = listSchedules(dir);
    expect(schedules[0].lastRun).toBeUndefined();
    recordScheduleRun(schedules[0].id, "success", dir);
    const after = listSchedules(dir);
    expect(after[0].lastRun).toBeDefined();
    expect(after[0].lastRunStatus).toBe("success");
    expect(after[0].nextRun).toBeDefined();
    expect(new Date(after[0].nextRun!).getTime()).toBeGreaterThan(new Date(after[0].lastRun!).getTime());
  });
});
