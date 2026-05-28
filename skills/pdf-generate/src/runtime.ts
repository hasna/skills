import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type PdfLibModule = typeof import("pdf-lib");

export const SKILL_NAME = "generate-pdf";
export const SESSION_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
export const EXPORTS_DIR = process.env.SKILLS_EXPORTS_DIR || join(process.cwd(), "exports");
export const LOGS_DIR = process.env.SKILLS_LOGS_DIR || join(process.cwd(), "logs");
export const SKILLS_INPUT = process.env.SKILLS_INPUT || "";
export const LOG_FILE = join(LOGS_DIR, `${SESSION_ID}.log`);

[EXPORTS_DIR, LOGS_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

export function log(message: string, level: "info" | "error" | "warn" = "info") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage);
  if (level === "error") {
    console.error(message);
  }
}

export async function loadPdfLib(): Promise<PdfLibModule> {
  try {
    return await import("pdf-lib");
  } catch {
    throw new Error("Missing dependency 'pdf-lib'. Run bun install in this skill directory.");
  }
}
