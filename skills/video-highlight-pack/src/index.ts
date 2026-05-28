#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

interface VideoOptions {
  source: string;
  title: string;
  platforms: string[];
  durationMinutes: number;
  aspectRatio: string;
  outputDir: string;
}

interface Moment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  title: string;
  hook: string;
  body: string;
}

interface Chapter {
  start: string;
  title: string;
  summary: string;
}

const SKILL_NAME = "video-highlight-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const DEFAULT_PLATFORMS = ["youtube-shorts", "instagram", "tiktok", "linkedin"];

const HELP = `Video Highlight Pack

Usage:
  skills run video-highlight-pack --source ./webinar.mp4 --title "AI billing launch webinar" --platforms "youtube-shorts,linkedin"
  skills run video-highlight-pack --source ./transcript.txt --duration-minutes 58 --aspect-ratio 9:16

Options:
  --source <path-or-text>       Video file, transcript text file, or transcript text
  --title <text>                Recording title. Default: Video Highlight Pack
  --platforms <list>            Comma-separated platforms
  --duration-minutes <number>   Approximate source runtime. Default: 45
  --aspect-ratio <ratio>        Primary edit aspect ratio. Default: 9:16
  --output <dir>                Output directory. Default: current run export directory
  --help                        Show this help

Outputs:
  highlight-plan.md, clips.csv, chapters.json, captions.srt, thumbnail-briefs.md, social-posts.md, edit-decision-list.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const sourceText = readSourceText(options.source, options.title);
  const moments = buildMoments(sourceText, options);
  const chapters = buildChapters(moments);
  const files = writeArtifacts(options, moments, chapters, {
    plan: buildHighlightPlan(options, moments, chapters),
    clipsCsv: buildClipsCsv(options, moments),
    chaptersJson: JSON.stringify({ schemaVersion: 1, title: options.title, chapters }, null, 2) + "\n",
    captions: buildCaptions(moments),
    thumbnails: buildThumbnailBriefs(options, moments),
    socialPosts: buildSocialPosts(options, moments),
    editDecisionList: buildEditDecisionList(options, moments),
  });

  console.log(`Generated video highlight pack for ${options.title}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.plan}`);
  console.log(`- ${files.clips}`);
  console.log(`- ${files.chapters}`);
  console.log(`- ${files.captions}`);
  console.log(`- ${files.thumbnails}`);
  console.log(`- ${files.socialPosts}`);
  console.log(`- ${files.editDecisionList}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): VideoOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      source: { type: "string" },
      title: { type: "string", default: "Video Highlight Pack" },
      platforms: { type: "string", default: DEFAULT_PLATFORMS.join(",") },
      "duration-minutes": { type: "string", default: "45" },
      "aspect-ratio": { type: "string", default: "9:16" },
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

  return {
    source,
    title: String(values.title || "Video Highlight Pack").trim(),
    platforms: parseList(values.platforms, DEFAULT_PLATFORMS),
    durationMinutes: positiveNumber(values["duration-minutes"], 45),
    aspectRatio: String(values["aspect-ratio"] || "9:16").trim(),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function readSourceText(source: string, title: string): string {
  if (existsSync(source)) {
    try {
      const text = readFileSync(source, "utf8").trim();
      if (text) return text;
    } catch {
      return `${title} opens with context, builds toward practical examples, and closes with clear takeaways.`;
    }
  }
  return source;
}

function buildMoments(sourceText: string, options: VideoOptions): Moment[] {
  const statements = sourceText
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.trim().replace(/^\[[0-9:.\s-]+\]\s*/, ""))
    .filter((item) => item.length > 0)
    .slice(0, 18);
  const source = statements.length > 0 ? statements : [
    `${options.title} introduces the main problem.`,
    "The middle section shows examples and tradeoffs.",
    "The ending gives a concise takeaway.",
  ];
  const selected = pickMoments(source);
  const totalSeconds = Math.max(180, Math.round(options.durationMinutes * 60));
  const spacing = Math.max(35, Math.floor(totalSeconds / Math.max(selected.length + 1, 2)));

  return selected.map((text, index) => {
    const startSeconds = Math.min(totalSeconds - 30, index * spacing + 12);
    const endSeconds = Math.min(totalSeconds, startSeconds + clipDuration(index, options.platforms));
    return {
      index: index + 1,
      startSeconds,
      endSeconds,
      title: headline(text),
      hook: hookFor(text, index),
      body: text,
    };
  });
}

function pickMoments(statements: string[]): string[] {
  if (statements.length <= 5) return statements;
  const indexes = [0, Math.floor(statements.length * 0.25), Math.floor(statements.length * 0.5), Math.floor(statements.length * 0.75), statements.length - 1];
  return [...new Set(indexes)].map((index) => statements[index]).filter(Boolean);
}

function buildChapters(moments: Moment[]): Chapter[] {
  return moments.map((moment) => ({
    start: timestamp(moment.startSeconds),
    title: moment.title,
    summary: moment.body,
  }));
}

function buildHighlightPlan(options: VideoOptions, moments: Moment[], chapters: Chapter[]): string {
  return `# Highlight Plan

## ${options.title}

- Primary aspect ratio: ${options.aspectRatio}
- Platforms: ${options.platforms.join(", ")}
- Source duration estimate: ${options.durationMinutes} minutes
- Recommended clips: ${moments.length}

## Clip Strategy

${moments.map((moment) => `### Clip ${moment.index}: ${moment.title}

- Window: ${timestamp(moment.startSeconds)}-${timestamp(moment.endSeconds)}
- Hook: ${moment.hook}
- Edit note: Open on the hook, add captions, cut dead air, and close with a text card.
`).join("\n")}

## Chapter Markers

${chapters.map((chapter) => `- ${chapter.start}: ${chapter.title}`).join("\n")}
`;
}

function buildClipsCsv(options: VideoOptions, moments: Moment[]): string {
  return [
    "clip,start,end,title,hook,aspect_ratio,platforms",
    ...moments.map((moment) => [
      String(moment.index),
      timestamp(moment.startSeconds),
      timestamp(moment.endSeconds),
      moment.title,
      moment.hook,
      options.aspectRatio,
      options.platforms.join("|"),
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function buildCaptions(moments: Moment[]): string {
  return moments.map((moment) => `${moment.index}
${srtTimestamp(moment.startSeconds)} --> ${srtTimestamp(moment.endSeconds)}
${moment.hook} ${moment.body}
`).join("\n");
}

function buildThumbnailBriefs(options: VideoOptions, moments: Moment[]): string {
  return `# Thumbnail Briefs

${moments.map((moment) => `## Clip ${moment.index}: ${moment.title}

- Format: ${options.aspectRatio}
- Text overlay: "${shortText(moment.title)}"
- Visual direction: speaker close-up, high contrast background, product or topic cue, no clutter.
- Use case: ${options.platforms.join(", ")}
`).join("\n")}
`;
}

function buildSocialPosts(options: VideoOptions, moments: Moment[]): string {
  return `# Social Posts

${moments.map((moment) => `## Clip ${moment.index}

${options.platforms.map((platform) => `### ${platform}

${moment.hook}

${moment.body}

Watch the full ${options.title} for the full context.`).join("\n\n")}
`).join("\n")}
`;
}

function buildEditDecisionList(options: VideoOptions, moments: Moment[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    title: options.title,
    aspectRatio: options.aspectRatio,
    platforms: options.platforms,
    edits: moments.map((moment) => ({
      clip: moment.index,
      sourceIn: timestamp(moment.startSeconds),
      sourceOut: timestamp(moment.endSeconds),
      caption: moment.hook,
      titleCard: moment.title,
      deliverables: options.platforms.map((platform) => `${platform}/${slug(moment.title)}.mp4`),
    })),
  }, null, 2) + "\n";
}

function writeArtifacts(
  options: VideoOptions,
  moments: Moment[],
  chapters: Chapter[],
  docs: {
    plan: string;
    clipsCsv: string;
    chaptersJson: string;
    captions: string;
    thumbnails: string;
    socialPosts: string;
    editDecisionList: string;
  },
) {
  const planPath = join(options.outputDir, "highlight-plan.md");
  const clipsPath = join(options.outputDir, "clips.csv");
  const chaptersPath = join(options.outputDir, "chapters.json");
  const captionsPath = join(options.outputDir, "captions.srt");
  const thumbnailsPath = join(options.outputDir, "thumbnail-briefs.md");
  const socialPostsPath = join(options.outputDir, "social-posts.md");
  const editDecisionListPath = join(options.outputDir, "edit-decision-list.json");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(planPath, docs.plan);
  writeFileSync(clipsPath, docs.clipsCsv);
  writeFileSync(chaptersPath, docs.chaptersJson);
  writeFileSync(captionsPath, docs.captions);
  writeFileSync(thumbnailsPath, docs.thumbnails);
  writeFileSync(socialPostsPath, docs.socialPosts);
  writeFileSync(editDecisionListPath, docs.editDecisionList);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      source: options.source,
      title: options.title,
      platforms: options.platforms,
      durationMinutes: options.durationMinutes,
      aspectRatio: options.aspectRatio,
    },
    clipCount: moments.length,
    chapterCount: chapters.length,
    files: {
      plan: toManifestPath(options.outputDir, planPath),
      clips: toManifestPath(options.outputDir, clipsPath),
      chapters: toManifestPath(options.outputDir, chaptersPath),
      captions: toManifestPath(options.outputDir, captionsPath),
      thumbnails: toManifestPath(options.outputDir, thumbnailsPath),
      socialPosts: toManifestPath(options.outputDir, socialPostsPath),
      editDecisionList: toManifestPath(options.outputDir, editDecisionListPath),
      manifest: toManifestPath(options.outputDir, manifestPath),
    },
  });

  return {
    plan: planPath,
    clips: clipsPath,
    chapters: chaptersPath,
    captions: captionsPath,
    thumbnails: thumbnailsPath,
    socialPosts: socialPostsPath,
    editDecisionList: editDecisionListPath,
    manifest: manifestPath,
  };
}

function parseList(value: unknown, fallback: string[]): string[] {
  const items = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function clipDuration(index: number, platforms: string[]): number {
  if (platforms.some((platform) => platform.includes("short") || platform.includes("tiktok"))) return index === 0 ? 34 : 42;
  return 60;
}

function hookFor(text: string, index: number): string {
  const prefixes = ["Start here:", "The useful takeaway:", "This is the part to clip:", "Do not miss this:", "The closing idea:"];
  return `${prefixes[index % prefixes.length]} ${headline(text)}`;
}

function headline(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Key video moment";
  return cleaned.length > 86 ? `${cleaned.slice(0, 83).trim()}...` : cleaned;
}

function shortText(text: string): string {
  const cleaned = text.replace(/[.!?]+$/g, "");
  return cleaned.length > 34 ? `${cleaned.slice(0, 31).trim()}...` : cleaned;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "highlight";
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
