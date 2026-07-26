import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { Database } from "bun:sqlite";
import { getDataDir } from "./config.js";

export type FeedbackCategory = "bug" | "feature" | "general";

export interface FeedbackInput {
  message: string;
  category?: FeedbackCategory;
  email?: string;
  agent?: string;
  version?: string;
}

export interface FeedbackResult {
  saved: true;
  category: FeedbackCategory;
  path: string;
}

/**
 * Resolved via getDataDir() rather than homedir() so that it agrees with the
 * path `skills storage` advertises (native-storage.ts builds `feedbackDbPath`
 * from getDataDir()). While this read the home directly, setting
 * $HASNA_SKILLS_DIR made the reported path and the written path diverge - the
 * CLI would name a database it was not using.
 */
export function getFeedbackDbPath(): string {
  return join(getDataDir(), "skills.db");
}

function getFeedbackDb(): Database {
  const dbPath = getFeedbackDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec([
    "CREATE TABLE IF NOT EXISTS feedback (",
    "id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),",
    "message TEXT NOT NULL,",
    "email TEXT,",
    "category TEXT DEFAULT 'general',",
    "agent TEXT,",
    "version TEXT,",
    "machine_id TEXT,",
    "created_at TEXT NOT NULL DEFAULT (datetime('now'))",
    ")",
  ].join(" "));
  try {
    db.exec("ALTER TABLE feedback ADD COLUMN agent TEXT");
  } catch {}
  return db;
}

export function saveFeedback(input: FeedbackInput): FeedbackResult {
  const message = input.message.trim();
  if (!message) throw new Error("Feedback message is required");

  const category = input.category ?? "general";
  const db = getFeedbackDb();
  try {
    db.run(
      "INSERT INTO feedback (message, email, category, agent, version) VALUES (?, ?, ?, ?, ?)",
      [message, input.email || null, category, input.agent || null, input.version || null]
    );
  } finally {
    db.close();
  }
  return { saved: true, category, path: getFeedbackDbPath() };
}
