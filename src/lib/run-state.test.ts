import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completeSkillRun,
  beginSkillRunAttempt,
  assertRemoteSubmissionTarget,
  createSkillRun,
  markSkillRunOutcomeUnknown,
  clearRemoteSubmission,
  loadRemoteSubmission,
  persistRemoteSubmission,
  resumeSkillRunAttempt,
  findSkillRun,
  getRunExportDir,
} from "./run-state";

const authoritativeQuote = {
  tier: "premium" as const,
  creditUnit: "run" as const,
  credits: 7,
  formattedCredits: "7 credits/run",
  estimated: false,
  quoteDependsOnInput: false,
  quoteRequired: true,
  description: "Remote image execution",
};

describe("public run metadata", () => {
  test("persists credits without fiat-shaped accounting aliases", () => {
    const target = mkdtempSync(join(tmpdir(), "skills-credit-run-"));
    try {
      const context = createSkillRun({ skill: "demo", remote: true, credits: 7 }, target);
      expect(context.record.idempotencyKey).toMatch(/^skills-run-[a-f0-9]{48}$/);
      const run = completeSkillRun(context, { status: "completed", credits: 6 });
      const stored = JSON.parse(readFileSync(join(target, run.paths.runDir, "run.json"), "utf8"));
      expect(stored.credits).toBe(6);
      expect(stored.idempotencyKey).toBe(context.record.idempotencyKey);
      expect(JSON.stringify(stored)).not.toMatch(/costCents|amountCents|formattedCost/);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("resumes only an unknown remote logical attempt with the same persisted key", () => {
    const target = mkdtempSync(join(tmpdir(), "skills-credit-retry-"));
    try {
      const first = createSkillRun({
        skill: "image",
        args: ["forest"],
        remote: true,
        idempotencyKey: "stable-logical-attempt",
      }, target);
      const submission = persistRemoteSubmission(first, {
        deployment: { mode: "cloud", apiUrl: "https://skills.md/" },
        skill: "image",
        input: { brief: "forest" },
        args: ["forest"],
        authorization: {
          idempotencyKey: "stable-logical-attempt",
          quoteToken: "quote_exact_attempt",
          approved: true,
        },
        creditQuote: authoritativeQuote,
      });
      expect(submission.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(statSync(join(first.runDir, "remote-submission.json")).mode & 0o777).toBe(0o600);
      markSkillRunOutcomeUnknown(first, "The service response was not received.");

      const resumed = resumeSkillRunAttempt(first.record.id, {
        skill: "image",
        args: ["forest"],
      }, target);
      expect(resumed.record.id).toBe(first.record.id);
      expect(resumed.record.idempotencyKey).toBe("stable-logical-attempt");
      expect(resumed.record.status).toBe("unknown");
      expect(resumed.record.credits).toBe(7);
      expect(resumed.record.creditQuote).toEqual(submission.creditQuote);
      expect(loadRemoteSubmission(resumed)).toEqual(submission);
      expect(() => assertRemoteSubmissionTarget(submission, {
        mode: "self-hosted",
        apiUrl: "https://skills.md",
      })).toThrow("different deployment mode or service origin");
      expect(() => persistRemoteSubmission(resumed, {
        deployment: { mode: "cloud", apiUrl: "https://skills.md" },
        skill: "image",
        input: { brief: "different" },
        args: ["forest"],
        authorization: {
          idempotencyKey: "stable-logical-attempt",
          quoteToken: "quote_exact_attempt",
          approved: true,
        },
        creditQuote: authoritativeQuote,
      })).toThrow("does not match");

      beginSkillRunAttempt(resumed);
      expect(resumed.record.status).toBe("running");
      clearRemoteSubmission(resumed);
      expect(existsSync(join(first.runDir, "remote-submission.json"))).toBe(false);

      expect(() => resumeSkillRunAttempt(first.record.id, {
        skill: "image",
        args: ["different"],
      }, target)).toThrow("does not match");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("rejects hostile local run ids before searching or deriving export paths", () => {
    const target = mkdtempSync(join(tmpdir(), "skills-run-id-path-"));
    try {
      expect(() => findSkillRun("../../outside", target)).toThrow("invalid format");
      expect(() => resumeSkillRunAttempt("../run_escape", { skill: "image" }, target)).toThrow("invalid format");
      expect(() => getRunExportDir("../outside", "image", target)).toThrow("invalid format");
      expect(() => getRunExportDir("run_safe", "../image", target)).toThrow("invalid path format");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("refuses persisted run paths that do not match the expected run, export, and log roots", () => {
    const target = mkdtempSync(join(tmpdir(), "skills-run-contained-"));
    try {
      const context = createSkillRun({ skill: "image", args: [], remote: true }, target);
      markSkillRunOutcomeUnknown(context, "response lost");
      const recordPath = join(context.runDir, "run.json");
      const record = JSON.parse(readFileSync(recordPath, "utf8"));
      record.paths.logsDir = "../../outside-logs";
      writeFileSync(recordPath, JSON.stringify(record));

      expect(findSkillRun(context.record.id, target)).toBeNull();
      expect(() => resumeSkillRunAttempt(context.record.id, { skill: "image", args: [] }, target)).toThrow("was not found");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("rejects symlinked state roots before creating or writing a run", () => {
    const target = mkdtempSync(join(tmpdir(), "skills-run-symlink-root-"));
    const outside = mkdtempSync(join(tmpdir(), "skills-run-symlink-outside-"));
    try {
      mkdirSync(join(target, ".skills"), { recursive: true });
      symlinkSync(outside, join(target, ".skills", "runs"), "dir");
      expect(() => createSkillRun({ skill: "image", remote: true }, target)).toThrow("symbolic link");
      expect(require("node:fs").readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(target, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("does not follow a symlinked remote-submission leaf", () => {
    const target = mkdtempSync(join(tmpdir(), "skills-run-symlink-leaf-"));
    const outside = join(target, "outside.json");
    try {
      const context = createSkillRun({
        skill: "image",
        remote: true,
        idempotencyKey: "stable-symlink-attempt",
      }, target);
      writeFileSync(outside, "unchanged");
      symlinkSync(outside, join(context.runDir, "remote-submission.json"));
      expect(() => persistRemoteSubmission(context, {
        deployment: { mode: "self-hosted", apiUrl: "https://operator.example" },
        skill: "image",
        input: {},
        args: [],
        authorization: { idempotencyKey: "stable-symlink-attempt", approved: true },
        creditQuote: authoritativeQuote,
      })).toThrow();
      expect(readFileSync(outside, "utf8")).toBe("unchanged");
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});
