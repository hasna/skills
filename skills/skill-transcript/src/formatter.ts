/**
 * Output Formatter
 * Converts transcription results to various output formats
 */

import type { TranscriptionResult, TranscriptionSegment } from './types';

export type OutputFormat = 'text' | 'srt' | 'vtt' | 'json';

export function formatOutput(result: TranscriptionResult, format: OutputFormat): string {
  switch (format) {
    case 'text':
      return formatText(result);
    case 'srt':
      return formatSRT(result);
    case 'vtt':
      return formatVTT(result);
    case 'json':
      return formatJSON(result);
    default:
      return formatText(result);
  }
}

function formatText(result: TranscriptionResult): string {
  if (!result.segments || result.segments.length === 0) {
    return result.text;
  }

  // Format with speaker labels if available
  let output = '';
  let currentSpeaker = '';

  for (const segment of result.segments) {
    if (segment.speaker && segment.speaker !== currentSpeaker) {
      currentSpeaker = segment.speaker;
      output += `\n[${currentSpeaker}]\n`;
    }
    output += segment.text + ' ';
  }

  return output.trim();
}

function formatSRT(result: TranscriptionResult): string {
  if (!result.segments || result.segments.length === 0) {
    // Create a single segment if no segments available
    return `1\n00:00:00,000 --> 00:00:00,000\n${result.text}\n`;
  }

  let srt = '';

  for (let i = 0; i < result.segments.length; i++) {
    const segment = result.segments[i];
    const startTime = formatTimestamp(segment.start, 'srt');
    const endTime = formatTimestamp(segment.end, 'srt');

    srt += `${i + 1}\n`;
    srt += `${startTime} --> ${endTime}\n`;

    if (segment.speaker) {
      srt += `<v ${segment.speaker}>${segment.text}\n`;
    } else {
      srt += `${segment.text}\n`;
    }

    srt += '\n';
  }

  return srt.trim();
}

function formatVTT(result: TranscriptionResult): string {
  let vtt = 'WEBVTT\n\n';

  if (!result.segments || result.segments.length === 0) {
    vtt += `00:00:00.000 --> 00:00:00.000\n${result.text}\n`;
    return vtt;
  }

  for (const segment of result.segments) {
    const startTime = formatTimestamp(segment.start, 'vtt');
    const endTime = formatTimestamp(segment.end, 'vtt');

    vtt += `${startTime} --> ${endTime}\n`;

    if (segment.speaker) {
      vtt += `<v ${segment.speaker}>${segment.text}\n`;
    } else {
      vtt += `${segment.text}\n`;
    }

    vtt += '\n';
  }

  return vtt.trim();
}

function formatJSON(result: TranscriptionResult): string {
  return JSON.stringify(result, null, 2);
}

function formatTimestamp(seconds: number, format: 'srt' | 'vtt'): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');

  if (format === 'srt') {
    return `${hh}:${mm}:${ss},${mmm}`;
  } else {
    return `${hh}:${mm}:${ss}.${mmm}`;
  }
}

export function getOutputExtension(format: OutputFormat): string {
  switch (format) {
    case 'text':
      return '.txt';
    case 'srt':
      return '.srt';
    case 'vtt':
      return '.vtt';
    case 'json':
      return '.json';
    default:
      return '.txt';
  }
}
