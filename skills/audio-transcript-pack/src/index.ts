#!/usr/bin/env bun

import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, extname, join, resolve } from "path";

const VERSION = "0.1.0";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".vtt", ".srt", ".text"]);
const MEDIA_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".mp4", ".mpeg", ".mpga", ".wav", ".webm", ".flac", ".ogg", ".oga",
  ".m4b", ".mov", ".aac", ".opus", ".wma", ".avi", ".mkv",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mpga": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".aac": "audio/aac",
  ".wma": "audio/x-ms-wma",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
};

const FORMATS = ["podcast", "meeting", "lecture", "interview", "general"];

interface CliOptions {
  source?: string;
  title?: string;
  speakers: string[];
  format: string;
  durationMinutes?: number;
  output: string;
  model: string;
  apiBase: string;
  language?: string;
  clips: number;
  json: boolean;
}

interface Segment {
  index: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

interface SentenceRef {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  score: number;
}

interface Chapter {
  title: string;
  start: number;
  end: number;
  summary: string;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

function printHelp(): void {
  console.log(`audio-transcript-pack v${VERSION}

USAGE:
  audio-transcript-pack --source <transcript.txt|.md|.srt|.vtt> [options]
  audio-transcript-pack --source <recording.mp3|.m4a|.wav|.mp4|...> [options]

Text sources are processed entirely offline and need no API key.
Audio and video sources are transcribed with YOUR OWN OpenAI-compatible key,
read from the OPENAI_API_KEY environment variable.

OPTIONS:
  -s, --source <path>          Transcript file or audio/video file (required)
  -t, --title <text>           Recording title (default: derived from the file name)
      --speakers <list>        Comma-separated speaker names (default: Speaker 1)
  -f, --format <type>          ${FORMATS.join(" | ")} (default: general)
  -d, --duration-minutes <n>   Known runtime; used to pace timings for untimed text
      --clips <n>              Number of clip suggestions (default: 6)
  -o, --output <dir>           Output directory (default: ./transcript-pack)
  -m, --model <name>           Transcription model (default: whisper-1)
      --api-base <url>         OpenAI-compatible base URL (default: https://api.openai.com/v1)
  -l, --language <code>        ISO-639-1 hint for transcription, e.g. en
      --json                   Print the manifest as JSON instead of a text summary
  -h, --help                   Show this help message
  -v, --version                Show the current version

ENVIRONMENT:
  OPENAI_API_KEY               Required only for audio/video sources. Never required for text.

EXAMPLES:
  audio-transcript-pack --source ./episode-transcript.txt --title "Billing teardown" --format podcast
  OPENAI_API_KEY=sk-... audio-transcript-pack --source ./episode.mp3 --speakers "Host,Guest"
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    speakers: [],
    format: "general",
    output: "./transcript-pack",
    model: "whisper-1",
    apiBase: process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1",
    clips: 6,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--source":
      case "-s":
        options.source = argv[++i];
        break;
      case "--title":
      case "-t":
        options.title = argv[++i];
        break;
      case "--speakers":
        options.speakers = (argv[++i] ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case "--format":
      case "-f": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (!FORMATS.includes(value)) {
          throw new Error(`Unknown --format: ${value}. Available: ${FORMATS.join(", ")}`);
        }
        options.format = value;
        break;
      }
      case "--duration-minutes":
      case "-d": {
        const value = Number.parseFloat(argv[++i] ?? "");
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error(`Invalid --duration-minutes value: ${argv[i]}`);
        }
        options.durationMinutes = value;
        break;
      }
      case "--clips": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1 || value > 50) {
          throw new Error(`Invalid --clips value: ${argv[i]}. Use 1-50.`);
        }
        options.clips = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? "./transcript-pack";
        break;
      case "--model":
      case "-m":
        options.model = argv[++i] ?? "whisper-1";
        break;
      case "--api-base":
        options.apiBase = (argv[++i] ?? "").replace(/\/+$/, "");
        break;
      case "--language":
      case "-l":
        options.language = argv[++i];
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.source) {
          options.source = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.source) {
    throw new Error("Missing required --source <path> argument. See --help.");
  }
  if (!options.apiBase) {
    throw new Error("--api-base cannot be empty.");
  }

  return options;
}

/* -------------------------------------------------------------------------- */
/* Time helpers                                                                */
/* -------------------------------------------------------------------------- */

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatSrtTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(
    millis,
  ).padStart(3, "0")}`;
}

function parseTimecode(value: string): number | undefined {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!match) return undefined;
  const [, hours, minutes, seconds, fraction] = match;
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(fraction.padEnd(3, "0")) / 1000
  );
}

/* -------------------------------------------------------------------------- */
/* Transcript parsing                                                          */
/* -------------------------------------------------------------------------- */

const SPEAKER_PATTERN = /^\s*(?:\[?)([A-Z][\w .'&-]{0,28}?)(?:\]?)\s*:\s+(.*)$/;

function stripSpeaker(text: string): { speaker?: string; text: string } {
  const match = text.match(SPEAKER_PATTERN);
  if (!match) return { text: text.trim() };
  const speaker = match[1].trim();
  if (/^https?$/i.test(speaker)) return { text: text.trim() };
  return { speaker, text: match[2].trim() };
}

function parseSrt(raw: string): Segment[] {
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/);
  const segments: Segment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    const timingLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingLineIndex === -1) continue;
    const [startRaw, endRaw] = lines[timingLineIndex].split("-->");
    const start = parseTimecode(startRaw ?? "");
    const end = parseTimecode(endRaw ?? "");
    if (start === undefined || end === undefined) continue;
    const body = lines
      .slice(timingLineIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!body) continue;
    const parsed = stripSpeaker(body);
    segments.push({ index: segments.length, start, end, text: parsed.text, speaker: parsed.speaker });
  }

  return segments;
}

function parseVtt(raw: string): Segment[] {
  return parseSrt(raw.replace(/^WEBVTT.*$/m, "").replace(/^NOTE[\s\S]*?\n\n/gm, ""));
}

function parsePlainText(raw: string): Array<{ speaker?: string; text: string }> {
  const cleaned = raw
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "");

  const blocks = cleaned.split(/\n{2,}/).flatMap((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    // Speaker-per-line transcripts keep one entry per line; prose blocks join.
    const speakerLines = lines.filter((line) => SPEAKER_PATTERN.test(line)).length;
    if (speakerLines >= Math.max(1, Math.ceil(lines.length / 2))) return lines;
    return [lines.join(" ")];
  });

  const out: Array<{ speaker?: string; text: string }> = [];
  let lastSpeaker: string | undefined;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Skip leading timestamps like "[00:12:03]" or "(12:03)".
    const withoutStamp = trimmed.replace(/^[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–—]?\s*/, "");
    const parsed = stripSpeaker(withoutStamp);
    if (parsed.speaker) lastSpeaker = parsed.speaker;
    if (!parsed.text) continue;
    out.push({ speaker: parsed.speaker ?? lastSpeaker, text: parsed.text });
  }

  return out;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Deterministic timing: distribute total runtime across blocks by word count. */
function timeBlocks(
  blocks: Array<{ speaker?: string; text: string }>,
  durationMinutes: number | undefined,
): Segment[] {
  const totalWords = blocks.reduce((sum, block) => sum + countWords(block.text), 0) || 1;
  const wordsPerSecond = durationMinutes ? totalWords / (durationMinutes * 60) : 150 / 60;
  const segments: Segment[] = [];
  let cursor = 0;

  for (const block of blocks) {
    const seconds = Math.max(1.5, countWords(block.text) / wordsPerSecond);
    segments.push({
      index: segments.length,
      start: Number(cursor.toFixed(3)),
      end: Number((cursor + seconds).toFixed(3)),
      text: block.text,
      speaker: block.speaker,
    });
    cursor += seconds;
  }

  return segments;
}

/* -------------------------------------------------------------------------- */
/* Transcription (audio path, BYO key)                                         */
/* -------------------------------------------------------------------------- */

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Transcribing audio requires your own OpenAI-compatible API key. " +
        "Export OPENAI_API_KEY, or pass a text transcript with --source <file>.txt to run without any key.",
    );
  }
  return key;
}

async function transcribeMedia(path: string, options: CliOptions): Promise<{ segments: Segment[]; language?: string; duration?: number }> {
  const apiKey = requireApiKey();
  const info = await stat(path);
  if (info.size === 0) throw new Error(`Source file is empty: ${path}`);

  const bytes = await readFile(path);
  const extension = extname(path).toLowerCase();
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(bytes)], basename(path), { type: MIME_BY_EXTENSION[extension] ?? "application/octet-stream" }),
  );
  form.append("model", options.model);
  form.append("response_format", "verbose_json");
  if (options.language) form.append("language", options.language);

  const endpoint = `${options.apiBase}/audio/transcriptions`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    throw new Error(`Transcription request to ${endpoint} failed: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(
      `Transcription failed: ${response.status} ${response.statusText} from ${endpoint}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const payload = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  const speaker = options.speakers[0];
  if (Array.isArray(payload.segments) && payload.segments.length > 0) {
    return {
      language: payload.language,
      duration: payload.duration,
      segments: payload.segments.map((segment, index) => ({
        index,
        start: Number(segment.start ?? 0),
        end: Number(segment.end ?? 0),
        text: String(segment.text ?? "").trim(),
        speaker,
      })),
    };
  }

  if (!payload.text) throw new Error("Transcription response contained no text or segments.");
  const blocks = parsePlainText(payload.text).map((block) => ({ ...block, speaker: block.speaker ?? speaker }));
  return {
    language: payload.language,
    duration: payload.duration,
    segments: timeBlocks(blocks, payload.duration ? payload.duration / 60 : options.durationMinutes),
  };
}

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set(
  ("a about above after again against all am an and any are aren't as at be because been before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves just really like yeah okay right kind sort thing things going got know think said say says well actually basically" as string)
    .split(" ")
    .filter(Boolean),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ""))
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildSentences(segments: Segment[], frequencies: Map<string, number>): SentenceRef[] {
  const refs: SentenceRef[] = [];

  for (const segment of segments) {
    const sentences = splitSentences(segment.text);
    const totalWords = countWords(segment.text) || 1;
    let consumed = 0;
    const span = Math.max(0.001, segment.end - segment.start);

    for (const sentence of sentences) {
      const wordCount = countWords(sentence);
      const start = segment.start + (consumed / totalWords) * span;
      consumed += wordCount;
      const end = segment.start + (consumed / totalWords) * span;
      const tokens = tokenize(sentence);
      const unique = new Set(tokens);
      let score = 0;
      for (const token of unique) score += frequencies.get(token) ?? 0;
      score = score / Math.sqrt(Math.max(4, wordCount));
      if (wordCount < 4) score *= 0.3;
      refs.push({ text: sentence, start, end, speaker: segment.speaker, score });
    }
  }

  return refs;
}

function termFrequencies(segments: Segment[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const segment of segments) {
    for (const token of tokenize(segment.text)) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }
  return frequencies;
}

function topKeywords(frequencies: Map<string, number>, limit: number): Array<{ term: string; count: number }> {
  return Array.from(frequencies.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function headlineFrom(sentence: string): string {
  const cleaned = sentence
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^(and|but|so|then|now|well|okay|yeah)\s+/i, "")
    .replace(/[.!?]+$/, "");
  const words = cleaned.split(/\s+/).slice(0, 9).join(" ");
  const capped = words.length > 68 ? `${words.slice(0, 65).trimEnd()}…` : words;
  // Drop trailing commas and dangling connectives so headlines read as headlines.
  const trimmed = capped
    .replace(/[,;:]+$/, "")
    .replace(/\s+(and|but|or|so|the|a|an|to|of|that|with|for|when|which|while|is|are|was|were|it|we|you|they|i)$/i, "")
    .replace(/[,;:]+$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function buildChapters(sentences: SentenceRef[], totalDuration: number, count: number): Chapter[] {
  if (sentences.length === 0) return [];
  const target = Math.max(1, Math.min(count, Math.ceil(sentences.length / 2)));
  const perChapter = totalDuration / target;
  const chapters: Chapter[] = [];

  for (let i = 0; i < target; i += 1) {
    const start = i * perChapter;
    const end = i === target - 1 ? totalDuration : (i + 1) * perChapter;
    const inRange = sentences.filter((sentence) => sentence.start >= start && sentence.start < end);
    const pool = inRange.length > 0 ? inRange : [sentences[Math.min(i, sentences.length - 1)]];
    const best = [...pool].sort((a, b) => b.score - a.score)[0];
    chapters.push({
      title: headlineFrom(best.text),
      start: pool[0].start,
      end,
      summary: pool
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .sort((a, b) => a.start - b.start)
        .map((sentence) => sentence.text)
        .join(" "),
    });
  }

  return chapters;
}

interface Clip {
  rank: number;
  start: number;
  end: number;
  title: string;
  hook: string;
  quote: string;
  speaker: string;
}

function buildClips(sentences: SentenceRef[], count: number, defaultSpeaker: string): Clip[] {
  const scored = sentences
    .map((sentence, index) => ({ sentence, index }))
    .filter((entry) => countWords(entry.sentence.text) >= 6)
    .sort((a, b) => b.sentence.score - a.sentence.score);

  const clips: Clip[] = [];
  const used: Array<[number, number]> = [];

  for (const entry of scored) {
    if (clips.length >= count) break;
    const window = sentences.slice(entry.index, entry.index + 3);
    const start = window[0].start;
    // Clips are social-length: at least 20s, capped at 90s.
    const end = Math.min(Math.max(window[window.length - 1].end, start + 20), start + 90);
    if (used.some(([usedStart, usedEnd]) => start < usedEnd && end > usedStart)) continue;
    used.push([start, end]);
    const quote = window.map((sentence) => sentence.text).join(" ");
    clips.push({
      rank: clips.length + 1,
      start,
      end,
      title: headlineFrom(entry.sentence.text),
      hook: quote.length > 110 ? `${quote.slice(0, 107).trimEnd()}…` : quote,
      quote,
      speaker: entry.sentence.speaker ?? defaultSpeaker,
    });
  }

  return clips.sort((a, b) => a.start - b.start).map((clip, index) => ({ ...clip, rank: index + 1 }));
}

/* -------------------------------------------------------------------------- */
/* Renderers                                                                   */
/* -------------------------------------------------------------------------- */

interface Pack {
  title: string;
  format: string;
  speakers: string[];
  sourcePath: string;
  sourceKind: "text" | "media";
  language?: string;
  segments: Segment[];
  sentences: SentenceRef[];
  chapters: Chapter[];
  clips: Clip[];
  keywords: Array<{ term: string; count: number }>;
  summarySentences: SentenceRef[];
  duration: number;
  wordCount: number;
  transcribedWith?: string;
}

function renderTranscript(pack: Pack): string {
  const lines: string[] = [
    `# ${pack.title}`,
    "",
    `- **Source:** \`${pack.sourcePath}\``,
    `- **Runtime:** ${formatClock(pack.duration)}`,
    `- **Words:** ${pack.wordCount.toLocaleString("en-US")}`,
    `- **Speakers:** ${pack.speakers.join(", ")}`,
    `- **Format:** ${pack.format}`,
  ];

  if (pack.language) lines.push(`- **Language:** ${pack.language}`);
  if (pack.transcribedWith) lines.push(`- **Transcribed with:** ${pack.transcribedWith}`);
  if (pack.sourceKind === "media") {
    lines.push(
      "",
      "> Speaker diarization is not provided by the transcription API, so every line is attributed to " +
        `\`${pack.speakers[0]}\`. Re-label speakers by hand if the recording has more than one voice.`,
    );
  }

  lines.push("", "## Transcript", "");

  let lastSpeaker: string | undefined;
  for (const segment of pack.segments) {
    if (!segment.text) continue;
    const speaker = segment.speaker ?? pack.speakers[0];
    const heading = speaker !== lastSpeaker ? `**${speaker}**` : "";
    lastSpeaker = speaker;
    lines.push(`\`[${formatClock(segment.start)}]\` ${heading} ${segment.text}`.replace(/\s{2,}/g, " ").trim(), "");
  }

  return lines.join("\n");
}

function wrapCaption(text: string, width = 42): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderSrt(segments: Segment[]): string {
  const cues: Array<{ start: number; end: number; lines: string[] }> = [];

  for (const segment of segments) {
    if (!segment.text) continue;
    const words = segment.text.split(/\s+/).filter(Boolean);
    const span = Math.max(0.8, segment.end - segment.start);
    const maxWordsPerCue = 16;
    const cueCount = Math.max(1, Math.ceil(words.length / maxWordsPerCue));
    const wordsPerCue = Math.ceil(words.length / cueCount);

    for (let i = 0; i < cueCount; i += 1) {
      const slice = words.slice(i * wordsPerCue, (i + 1) * wordsPerCue);
      if (slice.length === 0) continue;
      const start = segment.start + (span * i) / cueCount;
      const rawEnd = segment.start + (span * (i + 1)) / cueCount;
      // Keep cues readable: at least 0.8s on screen, never longer than 7s.
      const end = Math.min(Math.max(rawEnd, start + 0.8), start + 7);
      cues.push({ start, end, lines: wrapCaption(slice.join(" ")).slice(0, 3) });
    }
  }

  return `${cues
    .map((cue, index) =>
      [`${index + 1}`, `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}`, ...cue.lines].join("\n"),
    )
    .join("\n\n")}\n`;
}

function renderSummary(pack: Pack): string {
  const lines: string[] = [
    `# Summary — ${pack.title}`,
    "",
    `${formatClock(pack.duration)} · ${pack.wordCount.toLocaleString("en-US")} words · ${pack.segments.length} segments · ${pack.speakers.join(", ")}`,
    "",
    "## TL;DR",
    "",
  ];

  for (const sentence of pack.summarySentences.slice(0, 5)) {
    lines.push(`- \`[${formatClock(sentence.start)}]\` ${sentence.text}`);
  }

  lines.push("", "## Key topics", "");
  if (pack.keywords.length === 0) {
    lines.push("_Not enough repeated vocabulary to rank topics._");
  } else {
    for (const keyword of pack.keywords.slice(0, 12)) {
      lines.push(`- **${keyword.term}** — mentioned ${keyword.count}×`);
    }
  }

  lines.push("", "## Chapter recap", "");
  for (const chapter of pack.chapters) {
    lines.push(`### \`${formatClock(chapter.start)}\` ${chapter.title}`, "", chapter.summary, "");
  }

  lines.push(
    "## Stats",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Runtime | ${formatClock(pack.duration)} |`,
    `| Words | ${pack.wordCount.toLocaleString("en-US")} |`,
    `| Words per minute | ${Math.round(pack.wordCount / Math.max(1, pack.duration / 60))} |`,
    `| Segments | ${pack.segments.length} |`,
    `| Sentences | ${pack.sentences.length} |`,
    `| Chapters | ${pack.chapters.length} |`,
    `| Clip suggestions | ${pack.clips.length} |`,
    "",
  );

  return lines.join("\n");
}

function extractLinks(segments: Segment[]): string[] {
  const found = new Set<string>();
  for (const segment of segments) {
    for (const match of segment.text.match(/https?:\/\/[^\s)>\]]+/g) ?? []) {
      found.add(match.replace(/[.,;:]+$/, ""));
    }
  }
  return Array.from(found);
}

function renderShowNotes(pack: Pack): string {
  const links = extractLinks(pack.segments);
  const lines: string[] = [
    `# Show notes — ${pack.title}`,
    "",
    `**Format:** ${pack.format} · **Runtime:** ${formatClock(pack.duration)} · **With:** ${pack.speakers.join(", ")}`,
    "",
    "## Description",
    "",
    pack.summarySentences.slice(0, 3).map((sentence) => sentence.text).join(" "),
    "",
    "## Chapters",
    "",
  ];

  for (const chapter of pack.chapters) {
    lines.push(`- \`${formatClock(chapter.start)}\` ${chapter.title}`);
  }

  lines.push("", "## Pull quotes", "");
  for (const clip of pack.clips.slice(0, 5)) {
    lines.push(`> ${clip.quote}`, "", `— ${clip.speaker}, \`${formatClock(clip.start)}\``, "");
  }

  lines.push("## Mentioned links", "");
  if (links.length === 0) {
    lines.push("_No links detected in the transcript._");
  } else {
    for (const link of links) lines.push(`- ${link}`);
  }

  lines.push("", "## Tags", "", pack.keywords.slice(0, 10).map((keyword) => `#${keyword.term.replace(/[^a-z0-9]/g, "")}`).join(" "), "");

  return lines.join("\n");
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderClipsCsv(pack: Pack): string {
  const header = ["rank", "start", "end", "duration_seconds", "speaker", "title", "hook", "quote"];
  const rows = pack.clips.map((clip) =>
    [
      clip.rank,
      formatClock(clip.start),
      formatClock(clip.end),
      Math.round(clip.end - clip.start),
      clip.speaker,
      clip.title,
      clip.hook,
      clip.quote,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[header.join(","), ...rows].join("\n")}\n`;
}

function renderRepurposing(pack: Pack): string {
  const top = pack.summarySentences;
  const hashtags = pack.keywords.slice(0, 5).map((keyword) => `#${keyword.term.replace(/[^a-z0-9]/g, "")}`).join(" ");
  const lines: string[] = [
    `# Repurposing pack — ${pack.title}`,
    "",
    "Everything below is assembled from the transcript itself. Edit before publishing.",
    "",
    "## One-line hook",
    "",
    top[0] ? `> ${headlineFrom(top[0].text)}` : "> Add a hook.",
    "",
    "## Short social post",
    "",
    "```text",
    `${pack.title}`,
    "",
    ...top.slice(0, 2).map((sentence) => sentence.text),
    "",
    hashtags,
    "```",
    "",
    "## Thread",
    "",
  ];

  top.slice(0, 6).forEach((sentence, index) => {
    lines.push(`${index + 1}/ ${sentence.text}`, "");
  });
  lines.push(`${Math.min(7, top.length + 1)}/ Full episode: ${formatClock(pack.duration)}. Timestamps in the show notes.`, "");

  lines.push("## Newsletter blurb", "", top.slice(0, 3).map((sentence) => sentence.text).join(" "), "");

  lines.push("## Blog outline", "");
  for (const chapter of pack.chapters) {
    lines.push(`### ${chapter.title}`, "", chapter.summary, "");
  }

  lines.push("## Video description", "", "```text", pack.title, "");
  lines.push(top.slice(0, 2).map((sentence) => sentence.text).join(" "), "", "Chapters:");
  for (const chapter of pack.chapters) lines.push(`${formatClock(chapter.start)} ${chapter.title}`);
  lines.push("```", "");

  lines.push("## Clip queue", "");
  for (const clip of pack.clips) {
    lines.push(
      `- \`${formatClock(clip.start)}–${formatClock(clip.end)}\` **${clip.title}** — ${clip.speaker}`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function writeOut(root: string, relativePath: string, contents: string): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  return relativePath;
}

function titleFromPath(path: string): string {
  const stem = basename(path, extname(path)).replace(/[-_]+/g, " ").trim();
  if (!stem) return "Audio Transcript Pack";
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sourcePath = resolve(options.source!);
  const extension = extname(sourcePath).toLowerCase();

  const isText = TEXT_EXTENSIONS.has(extension);
  const isMedia = MEDIA_EXTENSIONS.has(extension);
  if (!isText && !isMedia) {
    throw new Error(
      `Unsupported source extension "${extension || "(none)"}". Text: ${Array.from(TEXT_EXTENSIONS).join(", ")}. ` +
        `Audio/video: ${Array.from(MEDIA_EXTENSIONS).join(", ")}.`,
    );
  }

  try {
    await stat(sourcePath);
  } catch {
    throw new Error(`Unable to read source file: ${sourcePath}`);
  }

  const speakers = options.speakers.length > 0 ? options.speakers : ["Speaker 1"];
  let segments: Segment[];
  let language: string | undefined;
  let transcribedWith: string | undefined;

  if (isMedia) {
    const result = await transcribeMedia(sourcePath, options);
    segments = result.segments;
    language = result.language;
    transcribedWith = `${options.model} via ${options.apiBase}`;
  } else {
    const raw = await readFile(sourcePath, "utf8");
    if (!raw.trim()) throw new Error(`Source file is empty: ${sourcePath}`);
    if (extension === ".srt") segments = parseSrt(raw);
    else if (extension === ".vtt") segments = parseVtt(raw);
    else segments = timeBlocks(parsePlainText(raw), options.durationMinutes);

    if (segments.length === 0) {
      segments = timeBlocks(parsePlainText(raw), options.durationMinutes);
    }
  }

  segments = segments.filter((segment) => segment.text.trim().length > 0);
  if (segments.length === 0) {
    throw new Error("No transcript content could be extracted from the source.");
  }

  const duration = Math.max(...segments.map((segment) => segment.end), 0);
  const wordCount = segments.reduce((sum, segment) => sum + countWords(segment.text), 0);
  const frequencies = termFrequencies(segments);
  const sentences = buildSentences(segments, frequencies);
  const keywords = topKeywords(frequencies, 20);
  const chapterCount = Math.min(8, Math.max(2, Math.round(duration / 300) || 2));
  const chapters = buildChapters(sentences, duration, chapterCount);
  const clips = buildClips(sentences, options.clips, speakers[0]);
  const summarySentences = [...sentences]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => a.start - b.start);

  const pack: Pack = {
    title: options.title ?? titleFromPath(sourcePath),
    format: options.format,
    speakers,
    sourcePath,
    sourceKind: isMedia ? "media" : "text",
    language,
    segments,
    sentences,
    chapters,
    clips,
    keywords,
    summarySentences,
    duration,
    wordCount,
    transcribedWith,
  };

  const outputRoot = resolve(options.output);
  const written: string[] = [];

  written.push(await writeOut(outputRoot, "transcript.md", renderTranscript(pack)));
  written.push(await writeOut(outputRoot, "captions.srt", renderSrt(segments)));
  written.push(await writeOut(outputRoot, "summary.md", renderSummary(pack)));
  written.push(await writeOut(outputRoot, "show-notes.md", renderShowNotes(pack)));
  written.push(await writeOut(outputRoot, "clips.csv", renderClipsCsv(pack)));
  written.push(await writeOut(outputRoot, "repurposing.md", renderRepurposing(pack)));
  written.push(
    await writeOut(
      outputRoot,
      "segments.json",
      `${JSON.stringify(
        segments.map((segment) => ({
          index: segment.index,
          start: Number(segment.start.toFixed(3)),
          end: Number(segment.end.toFixed(3)),
          speaker: segment.speaker ?? speakers[0],
          text: segment.text,
        })),
        null,
        2,
      )}\n`,
    ),
  );

  const manifest = {
    skill: "audio-transcript-pack",
    skillVersion: VERSION,
    generatedAt: new Date().toISOString(),
    title: pack.title,
    source: { path: sourcePath, kind: pack.sourceKind, extension },
    transcription: isMedia
      ? { required: true, model: options.model, apiBase: options.apiBase, credential: "OPENAI_API_KEY" }
      : { required: false, note: "Text source parsed locally; no API key used." },
    language: language ?? null,
    format: options.format,
    speakers,
    timingsDerived: isMedia ? "from transcription segments" : segments[0].end > 0 && (extension === ".srt" || extension === ".vtt") ? "from source cues" : "estimated from word counts",
    stats: {
      durationSeconds: Number(duration.toFixed(2)),
      durationClock: formatClock(duration),
      words: wordCount,
      segments: segments.length,
      sentences: sentences.length,
      chapters: chapters.length,
      clips: clips.length,
    },
    outputDir: outputRoot,
    files: [...written, "manifest.json"].sort(),
  };

  written.push(await writeOut(outputRoot, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`));

  if (options.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  console.log(
    [
      `audio-transcript-pack v${VERSION}`,
      `  title      ${pack.title}`,
      `  source     ${sourcePath} (${pack.sourceKind})`,
      `  runtime    ${formatClock(duration)} · ${wordCount.toLocaleString("en-US")} words`,
      `  timings    ${manifest.timingsDerived}`,
      `  speakers   ${speakers.join(", ")}`,
      `  chapters   ${chapters.length} · clips ${clips.length}`,
      `  output     ${outputRoot}`,
      "",
      "Files:",
      ...manifest.files.map((file) => `  ${file}`),
    ].join("\n"),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`audio-transcript-pack: ${message}\n`);
  process.exit(1);
});
