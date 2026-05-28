/**
 * Runtime records for skill executions.
 *
 * `.skills/runs` and `.skills/exports` hold what skills produced, not what
 * skills are. Source files and SKILL.md documents are never written here.
 */

import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { extname, join, relative } from "path";
import { normalizeSkillName } from "./utils.js";
import { getProjectStateDir } from "./project-state.js";

export type SkillRunStatus = "queued" | "running" | "completed" | "failed";

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
  remoteRunId?: string;
  costCents?: number;
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

export function createSkillRun(
  params: {
    skill: string;
    args?: string[];
    prompt?: string;
    remote?: boolean;
    remoteRunId?: string;
    costCents?: number;
    status?: SkillRunStatus;
  },
  targetDir: string = process.cwd(),
): SkillRunContext {
  const now = new Date();
  const id = createRunId(now);
  const day = now.toISOString().slice(0, 10);
  const skillName = normalizeSkillName(params.skill);
  const root = getProjectStateDir(targetDir);
  const runDir = join(root, "runs", day, id);
  const logsDir = join(runDir, "logs");
  const exportDir = join(root, "exports", skillName, id);
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(exportDir, { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });

  const record: SkillRunRecord = {
    id,
    skill: skillName,
    status: params.status ?? "running",
    ...(params.prompt ? { prompt: params.prompt } : {}),
    args: params.args ?? [],
    startedAt: now.toISOString(),
    remote: params.remote ?? false,
    ...(params.remoteRunId ? { remoteRunId: params.remoteRunId } : {}),
    ...(params.costCents !== undefined ? { costCents: params.costCents } : {}),
    artifacts: [],
    paths: {
      runDir: toProjectRelative(targetDir, runDir),
      exportDir: toProjectRelative(targetDir, exportDir),
      logsDir: toProjectRelative(targetDir, logsDir),
    },
  };

  const context = { targetDir, runDir, exportDir, logsDir, record };
  writeRunRecord(context);
  writeArtifactsManifest(context, []);
  appendRunEvent(context, "created", { status: record.status });
  return context;
}

export function completeSkillRun(
  context: SkillRunContext,
  patch: { status: SkillRunStatus; error?: string; remoteRunId?: string; costCents?: number },
): SkillRunRecord {
  const artifacts = collectRunArtifacts(context);
  context.record = {
    ...context.record,
    status: patch.status,
    completedAt: new Date().toISOString(),
    ...(patch.error ? { error: patch.error } : {}),
    ...(patch.remoteRunId ? { remoteRunId: patch.remoteRunId } : {}),
    ...(patch.costCents !== undefined ? { costCents: patch.costCents } : {}),
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

export function writeRunLogs(context: SkillRunContext, stdout = "", stderr = ""): void {
  writeFileSync(join(context.logsDir, "stdout.log"), stdout);
  writeFileSync(join(context.logsDir, "stderr.log"), stderr);
}

export function appendRunEvent(context: SkillRunContext, event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n";
  const path = join(context.runDir, "events.ndjson");
  const previous = existsSync(path) ? readFileSync(path, "utf-8") : "";
  writeFileSync(path, previous + line);
}

export function listSkillRuns(targetDir: string = process.cwd(), limit = 50): SkillRunRecord[] {
  const runsRoot = join(getProjectStateDir(targetDir), "runs");
  if (!existsSync(runsRoot)) return [];
  const records: SkillRunRecord[] = [];
  for (const day of readdirSync(runsRoot).sort().reverse()) {
    const dayDir = join(runsRoot, day);
    if (!statSync(dayDir).isDirectory()) continue;
    for (const runId of readdirSync(dayDir).sort().reverse()) {
      const record = readRunRecord(join(dayDir, runId));
      if (record) records.push(record);
      if (records.length >= limit) return records;
    }
  }
  return records;
}

export function findSkillRun(runId: string, targetDir: string = process.cwd()): SkillRunRecord | null {
  const runsRoot = join(getProjectStateDir(targetDir), "runs");
  if (!existsSync(runsRoot)) return null;
  for (const day of readdirSync(runsRoot)) {
    const record = readRunRecord(join(runsRoot, day, runId));
    if (record) return record;
  }
  return null;
}

export function getRunExportDir(runId: string, skill: string, targetDir: string = process.cwd()): string {
  return join(getProjectStateDir(targetDir), "exports", normalizeSkillName(skill), runId);
}

function writeRunRecord(context: SkillRunContext): void {
  writeFileSync(join(context.runDir, "run.json"), JSON.stringify(context.record, null, 2) + "\n");
}

function writeArtifactsManifest(context: SkillRunContext, artifacts: SkillRunArtifact[]): void {
  writeFileSync(join(context.runDir, "artifacts.json"), JSON.stringify({ runId: context.record.id, artifacts }, null, 2) + "\n");
}

function collectRunArtifacts(context: SkillRunContext): SkillRunArtifact[] {
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

function readRunRecord(runDir: string): SkillRunRecord | null {
  const path = join(runDir, "run.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkFiles(full));
    else files.push(full);
  }
  return files;
}

function createRunId(now: Date): string {
  return `run_${now.getTime().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function toProjectRelative(targetDir: string, path: string): string {
  const rel = relative(targetDir, path).split(/[\\/]/).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
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
