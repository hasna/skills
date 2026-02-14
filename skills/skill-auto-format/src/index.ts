#!/usr/bin/env bun
import fs from 'fs';
import path from 'path';
import prettier from 'prettier';
import { parseArgs } from 'util';
import { randomUUID } from 'crypto';

// ============================================================================
// Constants & Logging
// ============================================================================

const SKILL_NAME = "auto-format";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || path.join(process.cwd(), ".skills");
const LOGS_DIR = path.join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const LOG_FILE = path.join(LOGS_DIR, `${new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19)}_${SESSION_ID}.log`);

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: "info" | "error" | "success" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logMessage);

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

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Auto Format - Format files using Prettier

Usage:
  skills run auto-format -- <file-path>

Options:
  --help, -h    Show this help
`);
    process.exit(0);
  }

  if (positionals.length === 0) {
    log('Error: File path is required', 'error');
    console.log('Usage: skills run auto-format -- <file-path>');
    process.exit(1);
  }

  const filePath = positionals[0];
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);
  log(`Formatting file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    log(`Error: File not found at ${filePath}`, 'error');
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  
  let formattedContent = '';
  let error = '';

  try {
    formattedContent = await prettier.format(fileContent, {
      filepath: filePath,
    });
  } catch (e: any) {
    error = `Error formatting file: ${e.message}`;
  }

  if (error) {
    log(error, 'error');
    process.exit(1);
  }

  fs.writeFileSync(filePath, formattedContent);
  log(`Successfully formatted ${filePath}`, 'success');
  process.exit(0);
}

main();