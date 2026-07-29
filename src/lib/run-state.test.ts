import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
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

function withTempProject(run: (projectDir: string) => void): void {
  const projectDir = mkdtempSync(join(tmpdir(), "skills-run-state-"));
  try {
    run(projectDir);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("run state", () => {
  test("creates, updates, logs, locates, and completes a run on disk", () => {
    withTempProject((projectDir) => {
      const context = createSkillRun({
        skill: "demo-skill",
        args: ["--format", "json"],
        prompt: "Build the report",
        remote: true,
        remoteRunId: "remote_123",
        costCents: 0,
        status: "queued",
      }, projectDir);

      expect(context.record).toMatchObject({
        skill: "demo-skill",
        args: ["--format", "json"],
        prompt: "Build the report",
        remote: true,
        remoteRunId: "remote_123",
        costCents: 0,
        status: "queued",
        artifacts: [],
      });
      expect(context.record.id).toMatch(/^run_[a-z0-9]+_[0-9a-f]{8}$/);
      expect(existsSync(context.logsDir)).toBe(true);
      expect(existsSync(context.exportDir)).toBe(true);
      expect(readJson(join(context.runDir, "run.json"))).toEqual(context.record);
      expect(readJson(join(context.runDir, "artifacts.json"))).toEqual({
        runId: context.record.id,
        artifacts: [],
      });
      expect(getRunExportDir(context.record.id, "demo-skill", projectDir)).toBe(context.exportDir);

      const updated = updateSkillRun(context, { status: "running", costCents: 17 });
      expect(updated).toMatchObject({ status: "running", costCents: 17 });
      expect(findSkillRun(context.record.id, projectDir)).toEqual(updated);

      writeRunLogs(context, "standard output\n", "standard error\n");
      expect(readFileSync(join(context.logsDir, "stdout.log"), "utf8")).toBe("standard output\n");
      expect(readFileSync(join(context.logsDir, "stderr.log"), "utf8")).toBe("standard error\n");

      const artifactPath = join(context.exportDir, "nested", "result.json");
      mkdirSync(dirname(artifactPath), { recursive: true });
      const artifactBody = '{"ok":true}\n';
      writeFileSync(artifactPath, artifactBody);
      appendRunEvent(context, "artifact-written", { relativePath: "nested/result.json" });

      const completed = completeSkillRun(context, {
        status: "failed",
        error: "renderer stopped",
        remoteRunId: "remote_456",
        costCents: 23,
      });
      expect(completed).toMatchObject({
        status: "failed",
        error: "renderer stopped",
        remoteRunId: "remote_456",
        costCents: 23,
      });
      expect(completed.completedAt).toBeString();
      expect(completed.artifacts).toEqual([{
        path: `.skills/exports/demo-skill/${context.record.id}/nested/result.json`,
        mime: "application/json",
        sha256: createHash("sha256").update(artifactBody).digest("hex"),
        sizeBytes: Buffer.byteLength(artifactBody),
      }]);
      expect(readJson(join(context.runDir, "run.json"))).toEqual(completed);
      expect(readJson(join(context.runDir, "artifacts.json"))).toEqual({
        runId: context.record.id,
        artifacts: completed.artifacts,
      });

      const events = readFileSync(join(context.runDir, "events.ndjson"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.map((event) => event.event)).toEqual([
        "created",
        "updated",
        "artifact-written",
        "failed",
      ]);
      expect(events[2]).toMatchObject({ relativePath: "nested/result.json" });
      expect(events[3]).toMatchObject({ error: "renderer stopped" });
    });
  });

  test("returns empty results for missing state and ignores corrupt run records", () => {
    withTempProject((projectDir) => {
      expect(listSkillRuns(projectDir)).toEqual([]);
      expect(findSkillRun("run_missing", projectDir)).toBeNull();

      const first = createSkillRun({ skill: "first" }, projectDir);
      const second = createSkillRun({ skill: "second" }, projectDir);
      const corruptDir = join(projectDir, ".skills", "runs", "9999-12-31", "run_corrupt");
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(join(corruptDir, "run.json"), "{not-json");

      const runs = listSkillRuns(projectDir, 1);
      expect(runs).toHaveLength(1);
      expect([first.record.id, second.record.id]).toContain(runs[0].id);
      expect(findSkillRun("run_corrupt", projectDir)).toBeNull();

      rmSync(first.exportDir, { recursive: true, force: true });
      writeRunLogs(first);
      const completed = completeSkillRun(first, { status: "completed" });
      expect(completed.artifacts).toEqual([]);
      expect(readFileSync(join(first.logsDir, "stdout.log"), "utf8")).toBe("");
      expect(readFileSync(join(first.logsDir, "stderr.log"), "utf8")).toBe("");
    });
  });
});
