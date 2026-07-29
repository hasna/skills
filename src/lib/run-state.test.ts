import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const tempProjects: string[] = [];

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), "skills-run-state-"));
  tempProjects.push(project);
  return project;
}

afterEach(() => {
  for (const project of tempProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
});

describe("run state", () => {
  test("creates a run and persists updates, logs, and events", () => {
    const project = makeProject();
    const context = createSkillRun({
      skill: "demo-skill",
      args: ["--format", "json"],
      prompt: "Build the report",
      remote: true,
      remoteRunId: "remote-123",
      costCents: 25,
      status: "queued",
    }, project);

    expect(context.record.id).toMatch(/^run_[a-z0-9]+_[0-9a-f]{8}$/);
    expect(context.record).toMatchObject({
      skill: "demo-skill",
      args: ["--format", "json"],
      prompt: "Build the report",
      status: "queued",
      remote: true,
      remoteRunId: "remote-123",
      costCents: 25,
      artifacts: [],
    });
    expect(context.record.paths.runDir.startsWith(".skills/runs/")).toBe(true);
    expect(context.record.paths.exportDir).toBe(`.skills/exports/demo-skill/${context.record.id}`);
    expect(existsSync(context.logsDir)).toBe(true);
    expect(existsSync(context.exportDir)).toBe(true);
    expect(JSON.parse(readFileSync(join(context.runDir, "artifacts.json"), "utf8"))).toEqual({
      runId: context.record.id,
      artifacts: [],
    });

    writeRunLogs(context, "standard output\n", "standard error\n");
    expect(readFileSync(join(context.logsDir, "stdout.log"), "utf8")).toBe("standard output\n");
    expect(readFileSync(join(context.logsDir, "stderr.log"), "utf8")).toBe("standard error\n");

    appendRunEvent(context, "checkpoint", { progress: 50 });
    const updated = updateSkillRun(context, { status: "running", costCents: 30 });
    expect(updated.status).toBe("running");
    expect(updated.costCents).toBe(30);
    expect(JSON.parse(readFileSync(join(context.runDir, "run.json"), "utf8"))).toEqual(updated);

    const events = readFileSync(join(context.runDir, "events.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual(["created", "checkpoint", "updated"]);
    expect(events[1]).toMatchObject({ event: "checkpoint", progress: 50 });
    expect(events[2]).toMatchObject({ event: "updated", status: "running" });

    expect(getRunExportDir("run-fixed", "demo-skill", project)).toBe(
      join(project, ".skills", "exports", "demo-skill", "run-fixed"),
    );
  });

  test("completes a run with recursive artifact metadata", () => {
    const project = makeProject();
    const context = createSkillRun({ skill: "Artifact Skill" }, project);
    mkdirSync(join(context.exportDir, "nested"), { recursive: true });
    writeFileSync(join(context.exportDir, "report.txt"), "hello");
    writeFileSync(join(context.exportDir, "nested", "result.json"), "{\"ok\":true}\n");

    const record = completeSkillRun(context, {
      status: "failed",
      error: "renderer exited 1",
      remoteRunId: "remote-failed",
      costCents: 9,
    });

    expect(record).toMatchObject({
      status: "failed",
      error: "renderer exited 1",
      remoteRunId: "remote-failed",
      costCents: 9,
      remote: false,
    });
    expect(typeof record.completedAt).toBe("string");
    expect(record.artifacts).toHaveLength(2);
    expect(record.artifacts.map((artifact) => artifact.path)).toEqual(
      [...record.artifacts.map((artifact) => artifact.path)].sort(),
    );

    const report = record.artifacts.find((artifact) => artifact.path.endsWith("/report.txt"));
    expect(report).toMatchObject({
      mime: "text/plain",
      sizeBytes: 5,
      sha256: createHash("sha256").update("hello").digest("hex"),
    });
    const result = record.artifacts.find((artifact) => artifact.path.endsWith("/nested/result.json"));
    expect(result).toMatchObject({ mime: "application/json", sizeBytes: 12 });

    expect(JSON.parse(readFileSync(join(context.runDir, "artifacts.json"), "utf8"))).toEqual({
      runId: record.id,
      artifacts: record.artifacts,
    });
    const lastEvent = readFileSync(join(context.runDir, "events.ndjson"), "utf8").trim().split("\n").at(-1);
    expect(JSON.parse(lastEvent ?? "{}")).toMatchObject({
      event: "failed",
      error: "renderer exited 1",
    });
  });

  test("handles empty, malformed, and limited run listings", () => {
    const project = makeProject();
    expect(listSkillRuns(project)).toEqual([]);
    expect(findSkillRun("missing", project)).toBeNull();

    const first = createSkillRun({ skill: "First" }, project);
    const second = createSkillRun({ skill: "Second" }, project);
    const runsRoot = join(project, ".skills", "runs");
    writeFileSync(join(runsRoot, "not-a-directory"), "ignored");
    const malformedDir = join(runsRoot, "9999-12-31", "broken");
    mkdirSync(malformedDir, { recursive: true });
    writeFileSync(join(malformedDir, "run.json"), "{broken json");

    const all = listSkillRuns(project);
    expect(new Set(all.map((record) => record.id))).toEqual(new Set([first.record.id, second.record.id]));
    expect(listSkillRuns(project, 1)).toHaveLength(1);
    expect(findSkillRun(first.record.id, project)).toEqual(first.record);
    expect(findSkillRun("broken", project)).toBeNull();

    rmSync(second.exportDir, { recursive: true, force: true });
    expect(completeSkillRun(second, { status: "completed" }).artifacts).toEqual([]);
  });
});
