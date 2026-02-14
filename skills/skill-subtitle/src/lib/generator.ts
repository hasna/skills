/**
 * Subtitle generation using OpenAI Whisper
 */

import OpenAI from "openai";
import { createReadStream } from "fs";
import { basename } from "path";
import * as logger from "../utils/logger.js";
import { loadConfig, saveSubtitle } from "./storage.js";
import { formatTimestamp, getOutputFilename, isSupportedMedia } from "../utils/paths.js";
import type { SubtitleOptions, SubtitleResult, SubtitleSegment, SubtitleStyle } from "../types/index.js";
import { DEFAULT_STYLE } from "../types/index.js";

const DEFAULT_OPTIONS: SubtitleOptions = {
  format: "srt",
  maxCharsPerLine: 42,
  maxLinesPerSubtitle: 2,
  minDuration: 1,
  maxDuration: 7,
};

/**
 * Generate subtitles from audio file
 */
export async function generateSubtitles(
  filePath: string,
  options: Partial<SubtitleOptions> = {}
): Promise<SubtitleResult> {
  const config = loadConfig();
  const opts: SubtitleOptions = { ...DEFAULT_OPTIONS, ...options };

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set");
  }

  if (!isSupportedMedia(filePath)) {
    throw new Error("Unsupported file format");
  }

  const openai = new OpenAI();

  logger.info(`Transcribing: ${basename(filePath)}`);

  const file = createReadStream(filePath);

  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: opts.language,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const data = response as any;

  // Convert to segments
  const segments: SubtitleSegment[] = (data.segments || []).map((s: any, i: number) => ({
    index: i + 1,
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  // Process segments (split long ones, merge short ones)
  const processedSegments = processSegments(segments, opts);

  // Format output
  const formatted = formatSubtitles(processedSegments, opts.format, opts.style || config.defaultStyle);

  return {
    segments: processedSegments,
    duration: data.duration || 0,
    language: data.language,
    formatted,
  };
}

/**
 * Process segments for better subtitle timing
 */
function processSegments(segments: SubtitleSegment[], opts: SubtitleOptions): SubtitleSegment[] {
  const result: SubtitleSegment[] = [];
  let index = 1;

  for (const segment of segments) {
    const duration = segment.end - segment.start;
    const text = segment.text;

    // Split long segments
    if (duration > (opts.maxDuration || 7)) {
      const words = text.split(" ");
      const midpoint = Math.ceil(words.length / 2);
      const first = words.slice(0, midpoint).join(" ");
      const second = words.slice(midpoint).join(" ");
      const midTime = segment.start + duration / 2;

      result.push({
        index: index++,
        start: segment.start,
        end: midTime,
        text: first,
      });
      result.push({
        index: index++,
        start: midTime,
        end: segment.end,
        text: second,
      });
    } else {
      result.push({
        ...segment,
        index: index++,
      });
    }
  }

  return result;
}

/**
 * Format subtitles to output format
 */
function formatSubtitles(
  segments: SubtitleSegment[],
  format: SubtitleOptions["format"],
  style: SubtitleStyle
): string {
  switch (format) {
    case "srt":
      return formatSRT(segments);
    case "vtt":
      return formatVTT(segments);
    case "ass":
      return formatASS(segments, style);
    case "json":
      return JSON.stringify(segments, null, 2);
    default:
      return formatSRT(segments);
  }
}

/**
 * Format as SRT
 */
function formatSRT(segments: SubtitleSegment[]): string {
  return segments
    .map((s) => {
      const start = formatTimestamp(s.start, "srt");
      const end = formatTimestamp(s.end, "srt");
      return `${s.index}\n${start} --> ${end}\n${s.text}\n`;
    })
    .join("\n");
}

/**
 * Format as WebVTT
 */
function formatVTT(segments: SubtitleSegment[]): string {
  const cues = segments
    .map((s) => {
      const start = formatTimestamp(s.start, "vtt");
      const end = formatTimestamp(s.end, "vtt");
      return `${start} --> ${end}\n${s.text}`;
    })
    .join("\n\n");

  return `WEBVTT\n\n${cues}`;
}

/**
 * Format as ASS (Advanced SubStation Alpha) with styling
 */
function formatASS(segments: SubtitleSegment[], style: SubtitleStyle): string {
  const s = { ...DEFAULT_STYLE, ...style };

  const header = `[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayDepth: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.fontName},${s.fontSize},${s.primaryColor},${s.secondaryColor},${s.outlineColor},${s.backColor},${s.bold ? 1 : 0},${s.italic ? 1 : 0},0,0,100,100,0,0,1,${s.outline},${s.shadow},${s.alignment},${s.marginL},${s.marginR},${s.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = segments
    .map((seg) => {
      const start = formatTimestamp(seg.start, "ass");
      const end = formatTimestamp(seg.end, "ass");
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${seg.text}`;
    })
    .join("\n");

  return `${header}\n${events}`;
}

/**
 * Generate and save subtitles
 */
export async function generateAndSave(
  filePath: string,
  options: Partial<SubtitleOptions> = {}
): Promise<{ result: SubtitleResult; outputPath: string }> {
  const config = loadConfig();
  const format = options.format || config.defaultFormat;

  const result = await generateSubtitles(filePath, { ...options, format });

  const filename = getOutputFilename(filePath, format);
  const outputPath = saveSubtitle(filename, result.formatted);

  return { result, outputPath };
}
