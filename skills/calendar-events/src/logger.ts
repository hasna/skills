import { appendFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";

export const SKILL_NAME = "calendar-events";
export const SESSION_ID = randomUUID().slice(0, 8);
export const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
export const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
export const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
export function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
export function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else if (level !== "debug") {
    console.log(`${prefix} ${message}`);
  }
}

// Types
