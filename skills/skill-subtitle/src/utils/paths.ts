/**
 * Path utilities
 */

import { homedir } from "os";
import { join, basename, extname } from "path";

export function getDataDir(): string {
  return process.env.DATA_DIR || join(homedir(), ".service", "service-subtitlegenerate");
}

export function getOutputDir(): string {
  return join(getDataDir(), "output");
}

export function getConfigPath(): string {
  return join(getDataDir(), "config.json");
}

export function formatTimestamp(seconds: number, format: "srt" | "vtt" | "ass"): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  const cs = Math.round((seconds % 1) * 100);

  if (format === "ass") {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
  }

  const separator = format === "srt" ? "," : ".";
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}${separator}${ms.toString().padStart(3, "0")}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function getOutputFilename(inputPath: string, format: string): string {
  const name = basename(inputPath, extname(inputPath));
  return `${name}.${format}`;
}

export function isSupportedMedia(filePath: string): boolean {
  const supportedExtensions = [
    ".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".flac", ".aac"
  ];
  return supportedExtensions.includes(extname(filePath).toLowerCase());
}
