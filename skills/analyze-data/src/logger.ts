import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

export const SKILL_NAME = "analyze-data";
export const SESSION_ID = randomUUID().slice(0, 8);
export const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
export const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
export const LOG_FILE = join(LOGS_DIR, `${new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19)}_${SESSION_ID}.log`);

export function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function log(message: string, level: "info" | "error" | "success" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage);

  const prefixes = {
    info: "ℹ️ ",
    error: "❌ ",
    success: "✅ "
  };

  if (level === "error") {
    console.error(`${prefixes[level]} ${message}`);
  } else {
    console.log(`${prefixes[level]} ${message}`);
  }
}

// ============================================================================
