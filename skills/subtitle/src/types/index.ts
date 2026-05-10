/**
 * Types for subtitle generation service
 */

export interface SubtitleStyle {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  secondaryColor?: string;
  outlineColor?: string;
  backColor?: string;
  bold?: boolean;
  italic?: boolean;
  outline?: number;
  shadow?: number;
  alignment?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginL?: number;
  marginR?: number;
  marginV?: number;
}

export interface SubtitleOptions {
  format: "srt" | "vtt" | "ass" | "json";
  language?: string;
  style?: SubtitleStyle;
  maxCharsPerLine?: number;
  maxLinesPerSubtitle?: number;
  minDuration?: number;
  maxDuration?: number;
}

export interface SubtitleSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface SubtitleResult {
  segments: SubtitleSegment[];
  duration: number;
  language?: string;
  formatted: string;
}

export interface Config {
  outputDir: string;
  defaultFormat: "srt" | "vtt" | "ass";
  defaultStyle: SubtitleStyle;
}

export const DEFAULT_STYLE: SubtitleStyle = {
  fontName: "Arial",
  fontSize: 20,
  primaryColor: "&H00FFFFFF",
  secondaryColor: "&H000000FF",
  outlineColor: "&H00000000",
  backColor: "&H00000000",
  bold: false,
  italic: false,
  outline: 2,
  shadow: 1,
  alignment: 2,
  marginL: 10,
  marginR: 10,
  marginV: 10,
};
