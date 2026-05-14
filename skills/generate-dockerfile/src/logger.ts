import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export const SKILL_NAME = "generate-dockerfile";
export const SESSION_ID = randomUUID().slice(0, 8);
export const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
export const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME);
export const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
export const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);
export const LOG_FILE = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);

[EXPORTS_DIR, LOGS_DIR].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

export function log(message: string, level: "info" | "error" | "warn" | "success" = "info") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage);

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}
