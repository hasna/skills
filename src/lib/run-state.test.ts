import { createHash } from "crypto";
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { useDefaultTestTimeout } from "../test-preload.js";
import {
  appendRunEvent,
  completeSkillRun,
  createSkillRun,
  findSkillRun,
  getRunExportDir,
  listSkillRuns,
  updateSkillRun,
  writeRunLogs,
} from "./run-state.js";

useDefaultTestTimeout();

function withProject<T>(fn: (projectDir: string) => T): T {
  const projectDir = mkdtempSync(join(tmpdir(), "run-state-test-"));
  try {
    return fn(projectDir);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("run state", () => {
  test("createSkillRun creates isolated state with defaults and persists optional fields", () => withProject((projectDir) => {
    const context = createSkillRun({
      skill: "report-writer",
      args: ["--format", "md"],
      prompt: "Write the report",
      remote: true,
      remoteRunId: "remote_123",
      costCents: 0,
      status: "queued",
    }, projectDir);

    expect(context.record).toMatchObject({
      skill: "report-writer",
      args: ["--format", "md"],
      prompt: "Write the report",
      remote: true,
      remoteRunId: "remote_123",
      costCents: 0,
      status: "queued",
      artifacts: [],
    });
    expect(context.record.id).toMatch(/^run_[a-z0-9]+_[0-9a-f]{8}$/);
    expect(context.record.paths.runDir).toContain(`.skills/runs/`);
    expect(context.record.paths.exportDir).toContain(`.skills/exports/report-writer/${context.record.id}`);
    expect(existsSync(context.logsDir)).toBe(true);
    expect(existsSync(context.exportDir)).toBe(true);
    expect(existsSync(join(projectDir, ".skills", "tmp"))).toBe(true);
    expect(readJson(join(context.runDir, "run.json"))).toEqual(context.record);
    expect(readJson(join(context.runDir, "artifacts.json"))).toEqual({
      runId: context.record.id,
      artifacts: [],
    });
    expect(readFileSync(join(context.runDir, "events.ndjson"), "utf-8"))
      .toContain('"event":"created","status":"queued"');

    const defaults = createSkillRun({ skill: "minimal" }, projectDir).record;
    expect(defaults).toMatchObject({ skill: "minimal", args: [], status: "running", remote: false });
    expect(defaults).not.toHaveProperty("prompt");
    expect(defaults).not.toHaveProperty("remoteRunId");
    expect(defaults).not.toHaveProperty("costCents");
  }));

  test("createSkillRun surfaces filesystem refusal instead of returning an unpersisted run", () => withProject((projectDir) => {
    writeFileSync(join(projectDir, ".skills"), "not a directory");
    expect(() => createSkillRun({ skill: "blocked" }, projectDir)).toThrow();
  }));

  test("logs, events, updates, and artifact completion are persisted as observable run output", () => withProject((projectDir) => {
    const context = createSkillRun({ skill: "artifact-maker" }, projectDir);
    writeRunLogs(context, "created output\n", "warning\n");
    expect(readFileSync(join(context.logsDir, "stdout.log"), "utf-8")).toBe("created output\n");
    expect(readFileSync(join(context.logsDir, "stderr.log"), "utf-8")).toBe("warning\n");

    appendRunEvent(context, "progress", { percent: 50 });
    const updated = updateSkillRun(context, { remoteRunId: "remote_456", costCents: 0 });
    expect(updated.remoteRunId).toBe("remote_456");
    expect(updated.costCents).toBe(0);
    expect(readJson(join(context.runDir, "run.json"))).toEqual(updated);

    mkdirSync(join(context.exportDir, "nested"), { recursive: true });
    writeFileSync(join(context.exportDir, "nested", "report.md"), "# Result\n");
    writeFileSync(join(context.exportDir, "raw.bin"), new Uint8Array([0, 1, 2]));

    const completed = completeSkillRun(context, { status: "completed", remoteRunId: "remote_789", costCents: 12 });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeString();
    expect(completed.remoteRunId).toBe("remote_789");
    expect(completed.costCents).toBe(12);
    expect(completed.artifacts).toEqual([
      {
        path: expect.stringContaining(".skills/exports/artifact-maker/"),
        mime: "text/markdown",
        sha256: createHash("sha256").update("# Result\n").digest("hex"),
        sizeBytes: 9,
      },
      {
        path: expect.stringContaining(".skills/exports/artifact-maker/"),
        mime: "application/octet-stream",
        sha256: createHash("sha256").update(new Uint8Array([0, 1, 2])).digest("hex"),
        sizeBytes: 3,
      },
    ]);
    expect(completed.artifacts.map((artifact) => artifact.path)).toEqual([
      `${context.record.paths.exportDir}/nested/report.md`,
      `${context.record.paths.exportDir}/raw.bin`,
    ]);
    expect(readJson(join(context.runDir, "artifacts.json"))).toEqual({
      runId: context.record.id,
      artifacts: completed.artifacts,
    });

    const events = readFileSync(join(context.runDir, "events.ndjson"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual(["created", "progress", "updated", "completed"]);
    expect(events[1].percent).toBe(50);
    expect(events[2].status).toBe("running");
  }));

  test("default log and event values work, while missing run directories raise write errors", () => withProject((projectDir) => {
    const context = createSkillRun({ skill: "edge-cases" }, projectDir);
    writeRunLogs(context);
    appendRunEvent(context, "heartbeat");
    expect(readFileSync(join(context.logsDir, "stdout.log"), "utf-8")).toBe("");
    expect(readFileSync(join(context.logsDir, "stderr.log"), "utf-8")).toBe("");
    expect(JSON.parse(readFileSync(join(context.runDir, "events.ndjson"), "utf-8").trim().split("\n").at(-1)!))
      .toMatchObject({ event: "heartbeat" });

    rmSync(context.runDir, { recursive: true });
    expect(() => writeRunLogs(context, "lost")).toThrow();
    expect(() => appendRunEvent(context, "lost")).toThrow();
    expect(() => updateSkillRun(context, { status: "failed" })).toThrow();
  }));

  test("completeSkillRun records failures even when the export directory has disappeared", () => withProject((projectDir) => {
    const context = createSkillRun({ skill: "failed-run" }, projectDir);
    rmSync(context.exportDir, { recursive: true });

    const failed = completeSkillRun(context, { status: "failed", error: "permission refused" });

    expect(failed).toMatchObject({ status: "failed", error: "permission refused", artifacts: [] });
    expect(readJson(join(context.runDir, "run.json"))).toEqual(failed);
    expect(readJson(join(context.runDir, "artifacts.json")).artifacts).toEqual([]);
    expect(readFileSync(join(context.runDir, "events.ndjson"), "utf-8"))
      .toContain('"event":"failed","error":"permission refused"');
  }));

  test("listSkillRuns and findSkillRun handle missing, corrupt, and limited run collections", () => withProject((projectDir) => {
    expect(listSkillRuns(projectDir)).toEqual([]);
    expect(findSkillRun("missing", projectDir)).toBeNull();

    const first = createSkillRun({ skill: "first" }, projectDir);
    const second = createSkillRun({ skill: "second" }, projectDir);
    const runsRoot = join(projectDir, ".skills", "runs");
    mkdirSync(join(runsRoot, "9999-12-31", "corrupt"), { recursive: true });
    writeFileSync(join(runsRoot, "9999-12-31", "corrupt", "run.json"), "{not-json");
    writeFileSync(join(runsRoot, "9998-12-31"), "not a day directory");

    const listed = listSkillRuns(projectDir);
    expect(listed.map((run) => run.id).sort()).toEqual([first.record.id, second.record.id].sort());
    expect(listSkillRuns(projectDir, 1)).toHaveLength(1);
    expect(findSkillRun(first.record.id, projectDir)).toEqual(first.record);
    expect(findSkillRun("corrupt", projectDir)).toBeNull();
  }));

  test("getRunExportDir returns project-local paths for normal and empty skill names", () => withProject((projectDir) => {
    expect(getRunExportDir("run_123", "image", projectDir))
      .toBe(join(projectDir, ".skills", "exports", "image", "run_123"));
    expect(getRunExportDir("run_123", "", projectDir))
      .toBe(join(projectDir, ".skills", "exports", "run_123"));
  }));
});
