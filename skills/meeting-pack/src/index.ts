#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type MeetingFormat = "project" | "executive" | "sales" | "standup";
type Priority = "high" | "medium" | "low";
type ActionStatus = "todo" | "waiting" | "done";

interface MeetingOptions {
  notes: string;
  meeting: string;
  participants: string[];
  format: MeetingFormat;
  outputDir: string;
}

interface ActionItem {
  id: string;
  owner: string;
  task: string;
  deadline: string;
  priority: Priority;
  status: ActionStatus;
  source: string;
}

interface Decision {
  id: string;
  decision: string;
  rationale: string;
  owner: string;
}

interface Topic {
  name: string;
  summary: string;
  evidence: string[];
}

const SKILL_NAME = "meeting-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const FORMATS: MeetingFormat[] = ["project", "executive", "sales", "standup"];

const HELP = `Meeting Pack

Usage:
  skills run meeting-pack --notes "Discussed billing launch, docs, and support follow-ups" --meeting "Billing Launch Sync"
  skills run meeting-pack ./transcript.txt --participants "Hasna,Alex,Sam" --format executive

Options:
  --notes <text>         Meeting transcript, rough notes, or summary
  --source <path>        Read notes or transcript from a file
  --meeting <text>       Meeting title. Default: Meeting
  --participants <list>  Comma-separated participant names. Default: Team
  --format <type>        project, executive, sales, or standup. Default: project
  --output <dir>         Output directory. Default: current run export directory
  --help                 Show this help

Outputs:
  meeting-summary.md, decisions.md, action-items.csv, follow-up-email.md,
  project-export.json, timeline.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const segments = parseSegments(options.notes);
  const topics = buildTopics(segments);
  const decisions = buildDecisions(options, segments);
  const actionItems = buildActionItems(options, segments);
  const timeline = buildTimeline(options, actionItems);
  const summary = buildSummary(options, topics, decisions, actionItems);
  const followUp = buildFollowUpEmail(options, decisions, actionItems);
  const files = writeArtifacts(options, topics, decisions, actionItems, {
    summary,
    timeline,
    followUp,
    projectExport: buildProjectExport(options, topics, decisions, actionItems),
  });

  console.log(`Generated meeting pack for ${options.meeting}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.summary}`);
  console.log(`- ${files.decisions}`);
  console.log(`- ${files.actionItems}`);
  console.log(`- ${files.followUp}`);
  console.log(`- ${files.projectExport}`);
  console.log(`- ${files.timeline}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): MeetingOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      notes: { type: "string" },
      source: { type: "string" },
      meeting: { type: "string", default: "Meeting" },
      participants: { type: "string" },
      format: { type: "string", default: "project" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const format = String(values.format || "project");
  if (!isMeetingFormat(format)) {
    console.error("Invalid format. Use project, executive, sales, or standup.");
    process.exit(1);
  }

  const sourcePath = String(values.source || "").trim();
  const sourceNotes = sourcePath ? readSource(sourcePath) : "";
  const notes = String(values.notes || sourceNotes || positionals.join(" ")).trim();
  if (!notes) {
    console.error("Notes are required. Pass --notes <text>, --source <path>, or positional text.");
    process.exit(1);
  }

  return {
    notes,
    meeting: String(values.meeting || "Meeting").trim(),
    participants: parseParticipants(values.participants),
    format,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function readSource(path: string): string {
  if (!existsSync(path)) {
    console.error(`Source not found: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

function parseSegments(notes: string): string[] {
  const segments = notes
    .split(/\n{2,}|\r?\n[-*]\s+|\r?\n\d+\.\s+|\r?\n/)
    .map((segment) => segment.replace(/^[-*\d.\s]+/, "").trim())
    .filter((segment) => segment.length > 8);
  return (segments.length > 0 ? segments : [notes.trim()]).slice(0, 120);
}

function buildTopics(segments: string[]): Topic[] {
  const topicMap = new Map<string, string[]>();
  for (const segment of segments) {
    const topic = inferTopic(segment);
    const entries = topicMap.get(topic) || [];
    entries.push(segment);
    topicMap.set(topic, entries);
  }

  return Array.from(topicMap.entries()).map(([name, evidence]) => ({
    name,
    summary: summarizeEvidence(name, evidence),
    evidence: evidence.slice(0, 4),
  }));
}

function buildDecisions(options: MeetingOptions, segments: string[]): Decision[] {
  const explicit = segments.filter((segment) => /\b(decided|decision|approved|agreed|confirmed)\b/i.test(segment));
  const decisionSeeds = explicit.length > 0 ? explicit : segments.filter((segment) => /\b(launch|ship|publish|scope|plan|timeline)\b/i.test(segment));
  return decisionSeeds.slice(0, 8).map((segment, index) => ({
    id: `decision-${String(index + 1).padStart(2, "0")}`,
    decision: normalizeDecision(segment),
    rationale: rationaleFor(options.format, segment),
    owner: options.participants[index % options.participants.length] || "Team",
  }));
}

function buildActionItems(options: MeetingOptions, segments: string[]): ActionItem[] {
  const actionSegments = segments.filter((segment) => /\b(action|owner|follow|next|todo|send|draft|publish|fix|review|prepare|update|create|confirm)\b/i.test(segment));
  const seeds = actionSegments.length > 0 ? actionSegments : segments.slice(0, 5);
  return seeds.slice(0, 12).map((segment, index) => ({
    id: `action-${String(index + 1).padStart(2, "0")}`,
    owner: inferOwner(segment, options.participants, index),
    task: normalizeTask(segment),
    deadline: inferDeadline(segment, index),
    priority: inferPriority(segment),
    status: inferStatus(segment),
    source: segment,
  }));
}

function buildSummary(options: MeetingOptions, topics: Topic[], decisions: Decision[], actionItems: ActionItem[]): string {
  return `# Meeting Summary: ${options.meeting}

## Snapshot

- Format: ${options.format}
- Participants: ${options.participants.join(", ")}
- Topics covered: ${topics.length}
- Decisions captured: ${decisions.length}
- Action items captured: ${actionItems.length}

## Executive Readout

The meeting centered on ${topics.slice(0, 3).map((topic) => topic.name.toLowerCase()).join(", ") || "follow-up planning"}. The main operational need is to turn decisions into owned follow-up with visible deadlines and a shared project record.

## Topic Notes

${topics.map((topic) => `### ${topic.name}

${topic.summary}

${topic.evidence.map((line) => `- ${line}`).join("\n")}
`).join("\n")}

## Decision Summary

${decisions.length > 0 ? decisions.map((item) => `- **${item.decision}** Owner: ${item.owner}. ${item.rationale}`).join("\n") : "- No explicit decisions were detected; review the transcript before treating this meeting as final."}

## Action Summary

${actionItems.map((item) => `- [${item.priority}] ${item.owner}: ${item.task} (${item.deadline})`).join("\n")}
`;
}

function buildFollowUpEmail(options: MeetingOptions, decisions: Decision[], actionItems: ActionItem[]): string {
  return `Subject: Follow-up: ${options.meeting}

Hi team,

Thanks for the discussion. Here is the clean follow-up from ${options.meeting}.

Decisions:
${decisions.length > 0 ? decisions.map((item) => `- ${item.decision} (${item.owner})`).join("\n") : "- No final decisions captured."}

Action items:
${actionItems.map((item) => `- ${item.owner}: ${item.task} by ${item.deadline}`).join("\n")}

Please reply with corrections or missing owners so the project record stays accurate.
`;
}

function buildTimeline(options: MeetingOptions, actionItems: ActionItem[]): string {
  const grouped = groupByDeadline(actionItems);
  return `# Timeline: ${options.meeting}

${Object.entries(grouped).map(([deadline, items]) => `## ${deadline}
${items.map((item) => `- ${item.owner}: ${item.task} (${item.priority})`).join("\n")}
`).join("\n")}
`;
}

function buildProjectExport(options: MeetingOptions, topics: Topic[], decisions: Decision[], actionItems: ActionItem[]) {
  return {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    meeting: options.meeting,
    format: options.format,
    participants: options.participants,
    topics: topics.map((topic) => ({ name: topic.name, summary: topic.summary })),
    decisions,
    tasks: actionItems.map((item) => ({
      id: item.id,
      title: item.task,
      owner: item.owner,
      due: item.deadline,
      priority: item.priority,
      status: item.status,
      source: item.source,
    })),
  };
}

function writeArtifacts(
  options: MeetingOptions,
  topics: Topic[],
  decisions: Decision[],
  actionItems: ActionItem[],
  content: {
    summary: string;
    timeline: string;
    followUp: string;
    projectExport: ReturnType<typeof buildProjectExport>;
  },
) {
  const summaryPath = join(options.outputDir, "meeting-summary.md");
  const decisionsPath = join(options.outputDir, "decisions.md");
  const actionItemsPath = join(options.outputDir, "action-items.csv");
  const followUpPath = join(options.outputDir, "follow-up-email.md");
  const projectExportPath = join(options.outputDir, "project-export.json");
  const timelinePath = join(options.outputDir, "timeline.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(summaryPath, content.summary);
  writeFileSync(decisionsPath, decisionsMarkdown(options, decisions));
  writeFileSync(actionItemsPath, actionItemsCsv(actionItems));
  writeFileSync(followUpPath, content.followUp);
  writeJson(projectExportPath, content.projectExport);
  writeFileSync(timelinePath, content.timeline);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      meeting: options.meeting,
      participants: options.participants,
      format: options.format,
      topicCount: topics.length,
    },
    files: {
      summary: toManifestPath(options.outputDir, summaryPath),
      decisions: toManifestPath(options.outputDir, decisionsPath),
      actionItems: toManifestPath(options.outputDir, actionItemsPath),
      followUpEmail: toManifestPath(options.outputDir, followUpPath),
      projectExport: toManifestPath(options.outputDir, projectExportPath),
      timeline: toManifestPath(options.outputDir, timelinePath),
    },
  });

  return {
    summary: summaryPath,
    decisions: decisionsPath,
    actionItems: actionItemsPath,
    followUp: followUpPath,
    projectExport: projectExportPath,
    timeline: timelinePath,
    manifest: manifestPath,
  };
}

function decisionsMarkdown(options: MeetingOptions, decisions: Decision[]): string {
  return `# Decisions: ${options.meeting}

${decisions.length > 0 ? decisions.map((item) => `## ${item.id}

- Decision: ${item.decision}
- Owner: ${item.owner}
- Rationale: ${item.rationale}
`).join("\n") : "No explicit decisions detected.\n"}
`;
}

function actionItemsCsv(items: ActionItem[]): string {
  const headers = ["id", "owner", "task", "deadline", "priority", "status", "source"] as const;
  return [
    headers.join(","),
    ...items.map((item) => headers.map((header) => csvCell(item[header])).join(",")),
  ].join("\n") + "\n";
}

function inferTopic(segment: string): string {
  const lower = segment.toLowerCase();
  if (lower.includes("billing") || lower.includes("stripe") || lower.includes("payment")) return "Billing and Revenue";
  if (lower.includes("support") || lower.includes("customer")) return "Customer Follow-Up";
  if (lower.includes("launch") || lower.includes("release") || lower.includes("ship")) return "Launch Plan";
  if (lower.includes("docs") || lower.includes("documentation") || lower.includes("guide")) return "Documentation";
  if (lower.includes("risk") || lower.includes("block") || lower.includes("issue")) return "Risks and Blockers";
  if (lower.includes("metric") || lower.includes("kpi") || lower.includes("dashboard")) return "Metrics";
  return "General Discussion";
}

function summarizeEvidence(topic: string, evidence: string[]): string {
  const first = evidence[0] || "No detailed note captured.";
  return `${topic} came up ${evidence.length} time${evidence.length === 1 ? "" : "s"}. Main note: ${first}`;
}

function normalizeDecision(segment: string): string {
  return truncate(segment.replace(/\b(decided|decision|approved|agreed|confirmed)\b[:\s-]*/i, "").trim(), 140);
}

function rationaleFor(format: MeetingFormat, segment: string): string {
  if (format === "executive") return "This keeps leadership aligned on scope, owner, and expected business impact.";
  if (format === "sales") return "This preserves customer commitments and next-step accountability.";
  if (format === "standup") return "This keeps the team focused on the next visible increment.";
  return `Based on the discussion note: "${truncate(segment, 120)}"`;
}

function normalizeTask(segment: string): string {
  return truncate(segment.replace(/\b(action|todo|next step|owner)\b[:\s-]*/i, "").trim(), 150);
}

function inferOwner(segment: string, participants: string[], index: number): string {
  const lower = segment.toLowerCase();
  for (const participant of participants) {
    if (lower.includes(participant.toLowerCase())) return participant;
  }
  return participants[index % participants.length] || "Team";
}

function inferDeadline(segment: string, index: number): string {
  const lower = segment.toLowerCase();
  if (lower.includes("today")) return "today";
  if (lower.includes("tomorrow")) return "tomorrow";
  if (lower.includes("friday")) return "Friday";
  if (lower.includes("week")) return "this week";
  return index < 3 ? "next business day" : "next week";
}

function inferPriority(segment: string): Priority {
  const lower = segment.toLowerCase();
  if (/\b(urgent|critical|block|launch|customer|payment|security)\b/.test(lower)) return "high";
  if (/\b(review|update|prepare|draft)\b/.test(lower)) return "medium";
  return "low";
}

function inferStatus(segment: string): ActionStatus {
  const lower = segment.toLowerCase();
  if (/\b(done|completed|shipped|resolved)\b/.test(lower)) return "done";
  if (/\b(waiting|blocked|pending)\b/.test(lower)) return "waiting";
  return "todo";
}

function groupByDeadline(items: ActionItem[]): Record<string, ActionItem[]> {
  return items.reduce<Record<string, ActionItem[]>>((groups, item) => {
    groups[item.deadline] = groups[item.deadline] || [];
    groups[item.deadline].push(item);
    return groups;
  }, {});
}

function parseParticipants(value: unknown): string[] {
  const names = String(value || "Team")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 20);
  return names.length > 0 ? names : ["Team"];
}

function isMeetingFormat(value: string): value is MeetingFormat {
  return FORMATS.includes(value as MeetingFormat);
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
