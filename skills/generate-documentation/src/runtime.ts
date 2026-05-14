import { appendFileSync, existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";

export const SKILL_NAME = "generate-documentation";
export const SESSION_ID = randomUUID().slice(0, 8);
export const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
export const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
export const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
export const BACKUPS_DIR = join(SKILLS_OUTPUT_DIR, "backups", SKILL_NAME);
export const SESSION_TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "_")
  .replace(/-/g, "_")
  .slice(0, 19)
  .toLowerCase();

export function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function log(message: string, level: "info" | "error" | "success" | "warn" = "info") {
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

  ensureDir(LOGS_DIR);

  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(logFile, logEntry);

  const prefix = level === "error" ? "Error" : level === "success" ? "Success" : level === "warn" ? "Warning" : "Info";
  console.log(`[${prefix}] ${message}`);
}
