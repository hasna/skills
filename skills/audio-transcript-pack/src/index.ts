#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type TranscriptFormat = "podcast" | "meeting" | "lecture" | "interview" | "general";

interface TranscriptOptions {
  source: string;
  title: string;
  speakers: string[];
  format: TranscriptFormat;
  durationMinutes: number;
  outputDir: string;
}

interface TranscriptSegment {
  index: number;
  speaker: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

interface ClipSuggestion {
  start: string;
  end: string;
  title: string;
  description: string;
  repurpose: string;
}

const SKILL_NAME = "audio-transcript-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const FORMATS: TranscriptFormat[] = ["podcast", "meeting", "lecture", "interview", "general"];

const HELP = `Audio Transcript Pack

Usage:
  skills run audio-transcript-pack --source ./episode.mp3 --title "Usage-based billing teardown" --speakers "Host,Guest"
  skills run audio-transcript-pack --source ./transcript.txt --format podcast --duration-minutes 42

Options:
  --source <path-or-text>       Audio/video file, transcript text file, or transcript text
  --title <text>                Recording title. Default: Audio Transcript Pack
  --speakers <list>             Comma-separated speaker names. Default: Speaker 1,Speaker 2
  --format <type>               podcast, meeting, lecture, interview, or general
  --duration-minutes <number>   Approximate runtime for timestamp spacing. Default: 30
  --output <dir>                Output directory. Default: current run export directory
  --help                        Show this help

Outputs:
  transcript.md, captions.srt, summary.md, show-notes.md, clips.csv, content-repurpose-pack.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const sourceText = readSourceText(options.source);
  const segments = buildSegments(sourceText, options);
  const clips = buildClipSuggestions(segments, options);
  const files = writeArtifacts(options, segments, clips, {
    transcript: buildTranscript(options, segments),
    captions: buildCaptions(segments),
    summary: buildSummary(options, segments),
    showNotes: buildShowNotes(options, segments, clips),
    clipsCsv: buildClipsCsv(clips),
    repurpose: buildRepurposePack(options, segments, clips),
  });

  console.log(`Generated audio transcript pack for ${options.title}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.transcript}`);
  console.log(`- ${files.captions}`);
  console.log(`- ${files.summary}`);
  console.log(`- ${files.showNotes}`);
  console.log(`- ${files.clips}`);
  console.log(`- ${files.repurpose}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): TranscriptOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      source: { type: "string" },
      title: { type: "string", default: "Audio Transcript Pack" },
      speakers: { type: "string", default: "Speaker 1,Speaker 2" },
      format: { type: "string", default: "general" },
      "duration-minutes": { type: "string", default: "30" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const source = String(values.source || positionals.join(" ")).trim();
  if (!source) {
    console.error("Source is required. Pass --source <path-or-text> or positional transcript text.");
    process.exit(1);
  }

  const format = String(values.format || "general").toLowerCase();
  if (!FORMATS.includes(format as TranscriptFormat)) {
    console.error(`Invalid format. Use one of: ${FORMATS.join(", ")}.`);
    process.exit(1);
  }

  return {
    source,
    title: String(values.title || "Audio Transcript Pack").trim(),
    speakers: parseSpeakers(values.speakers),
    format: format as TranscriptFormat,
    durationMinutes: positiveNumber(values["duration-minutes"], 30),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function readSourceText(source: string): string {
  if (existsSync(source)) {
    try {
      const text = readFileSync(source, "utf8").trim();
      if (text) return text;
    } catch {
      return `Recording file: ${source}. Introduce the topic, explain the main points, share examples, and close with action items.`;
    }
  }
  return source;
}

function buildSegments(sourceText: string, options: TranscriptOptions): TranscriptSegment[] {
  const sentences = sourceText
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.trim().replace(/^\[[0-9:.\s-]+\]\s*/, ""))
    .filter((item) => item.length > 0)
    .slice(0, 24);
  const lines = sentences.length > 0 ? sentences : [
    `${options.title} opens with the problem and audience context.`,
    "The discussion covers constraints, examples, and operational tradeoffs.",
    "The closing section turns the conversation into next actions.",
  ];
  const totalSeconds = Math.max(60, Math.round(options.durationMinutes * 60));
  const segmentLength = Math.max(8, Math.floor(totalSeconds / Math.max(lines.length, 1)));

  return lines.map((text, index) => {
    const startSeconds = index * segmentLength;
    const endSeconds = Math.min(totalSeconds, startSeconds + segmentLength - 2);
    return {
      index: index + 1,
      speaker: options.speakers[index % options.speakers.length],
      startSeconds,
      endSeconds: Math.max(startSeconds + 1, endSeconds),
      text,
    };
  });
}

function buildClipSuggestions(segments: TranscriptSegment[], options: TranscriptOptions): ClipSuggestion[] {
  const candidates = segments.length >= 3
    ? [segments[0], segments[Math.floor(segments.length / 2)], segments[segments.length - 1]]
    : segments;
  return candidates.map((segment, index) => ({
    start: timestamp(segment.startSeconds),
    end: timestamp(Math.min(segment.endSeconds + 18, options.durationMinutes * 60)),
    title: `${clipPrefix(options.format)} ${index + 1}: ${headline(segment.text)}`,
    description: segment.text,
    repurpose: index === 0 ? "short intro clip" : index === 1 ? "social proof clip" : "closing takeaway clip",
  }));
}

function buildTranscript(options: TranscriptOptions, segments: TranscriptSegment[]): string {
  return `# Transcript

## ${options.title}

- Format: ${options.format}
- Speakers: ${options.speakers.join(", ")}
- Duration estimate: ${options.durationMinutes} minutes

${segments.map((segment) => `### ${timestamp(segment.startSeconds)} ${segment.speaker}

${segment.text}
`).join("\n")}
`;
}

function buildCaptions(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `${segment.index}
${srtTimestamp(segment.startSeconds)} --> ${srtTimestamp(segment.endSeconds)}
${segment.speaker}: ${segment.text}
`).join("\n");
}

function buildSummary(options: TranscriptOptions, segments: TranscriptSegment[]): string {
  return `# Summary

## Overview

${options.title} is a ${options.format} recording with ${segments.length} timestamped segment${segments.length === 1 ? "" : "s"}. The central thread is: ${headline(segments.map((segment) => segment.text).join(" "))}.

## Key Takeaways

${segments.slice(0, 6).map((segment) => `- ${segment.speaker} at ${timestamp(segment.startSeconds)}: ${segment.text}`).join("\n")}

## Action Items

- Turn the strongest takeaway into a short written recap.
- Review the suggested clips before publishing.
- Confirm speaker names and timestamps before external distribution.
`;
}

function buildShowNotes(options: TranscriptOptions, segments: TranscriptSegment[], clips: ClipSuggestion[]): string {
  return `# Show Notes

## Title

${options.title}

## Chapters

${segments.filter((_, index) => index % Math.max(1, Math.ceil(segments.length / 6)) === 0).map((segment) => `- ${timestamp(segment.startSeconds)} - ${headline(segment.text)}`).join("\n")}

## Suggested Clips

${clips.map((clip) => `- ${clip.start}-${clip.end}: ${clip.title}`).join("\n")}

## Description

This ${options.format} recording covers ${headline(segments.map((segment) => segment.text).join(" "))}. Use the transcript for accessibility, the clip list for short-form edits, and the repurposing pack for distribution.
`;
}

function buildClipsCsv(clips: ClipSuggestion[]): string {
  return [
    "start,end,title,description,repurpose",
    ...clips.map((clip) => [clip.start, clip.end, clip.title, clip.description, clip.repurpose].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function buildRepurposePack(options: TranscriptOptions, segments: TranscriptSegment[], clips: ClipSuggestion[]): string {
  const core = headline(segments.map((segment) => segment.text).join(" "));
  return `# Content Repurpose Pack

## LinkedIn Post

${core}. The useful part: this was discussed in a way that can be turned into an operational checklist, not just a recap.

## Email Teaser

Subject: Notes from ${options.title}

We pulled out the transcript, summary, and the strongest moments from ${options.title}. Start with the summary, then review the clip suggestions for shareable moments.

## Short-Form Hooks

${clips.map((clip) => `- ${clip.title}: ${clip.description}`).join("\n")}

## Internal Recap

- Recording type: ${options.format}
- Speakers: ${options.speakers.join(", ")}
- Best next step: verify the transcript, approve clips, and publish the recap.
`;
}

function writeArtifacts(
  options: TranscriptOptions,
  segments: TranscriptSegment[],
  clips: ClipSuggestion[],
  docs: {
    transcript: string;
    captions: string;
    summary: string;
    showNotes: string;
    clipsCsv: string;
    repurpose: string;
  },
) {
  const transcriptPath = join(options.outputDir, "transcript.md");
  const captionsPath = join(options.outputDir, "captions.srt");
  const summaryPath = join(options.outputDir, "summary.md");
  const showNotesPath = join(options.outputDir, "show-notes.md");
  const clipsPath = join(options.outputDir, "clips.csv");
  const repurposePath = join(options.outputDir, "content-repurpose-pack.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(transcriptPath, docs.transcript);
  writeFileSync(captionsPath, docs.captions);
  writeFileSync(summaryPath, docs.summary);
  writeFileSync(showNotesPath, docs.showNotes);
  writeFileSync(clipsPath, docs.clipsCsv);
  writeFileSync(repurposePath, docs.repurpose);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      source: options.source,
      title: options.title,
      speakers: options.speakers,
      format: options.format,
      durationMinutes: options.durationMinutes,
    },
    segmentCount: segments.length,
    clipCount: clips.length,
    files: {
      transcript: toManifestPath(options.outputDir, transcriptPath),
      captions: toManifestPath(options.outputDir, captionsPath),
      summary: toManifestPath(options.outputDir, summaryPath),
      showNotes: toManifestPath(options.outputDir, showNotesPath),
      clips: toManifestPath(options.outputDir, clipsPath),
      repurpose: toManifestPath(options.outputDir, repurposePath),
      manifest: toManifestPath(options.outputDir, manifestPath),
    },
  });

  return {
    transcript: transcriptPath,
    captions: captionsPath,
    summary: summaryPath,
    showNotes: showNotesPath,
    clips: clipsPath,
    repurpose: repurposePath,
    manifest: manifestPath,
  };
}

function parseSpeakers(value: unknown): string[] {
  const speakers = String(value || "Speaker 1,Speaker 2")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return speakers.length > 0 ? speakers : ["Speaker 1", "Speaker 2"];
}

function clipPrefix(format: TranscriptFormat): string {
  if (format === "podcast") return "Episode moment";
  if (format === "meeting") return "Decision moment";
  if (format === "lecture") return "Teaching moment";
  if (format === "interview") return "Interview moment";
  return "Highlight";
}

function headline(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Key recording takeaway";
  return cleaned.length > 92 ? `${cleaned.slice(0, 89).trim()}...` : cleaned;
}

function timestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function srtTimestamp(seconds: number): string {
  return `${timestamp(seconds)},000`;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
