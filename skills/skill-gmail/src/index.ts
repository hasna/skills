#!/usr/bin/env bun
/**
 * Compose Gmail Skill
 * Send emails, create drafts, and reply to threads using Gmail API
 */

import { parseArgs } from "util";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Gmail API base URL
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Constants
const SKILL_NAME = "compose-gmail";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Ensure directories exist
function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Logger
function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
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

// Get access token from environment
function getAccessToken(): string {
  const token = process.env.GMAIL_ACCESS_TOKEN;
  if (!token) {
    log("Error: Gmail not connected.", "error");
    console.error("");
    console.error("To use this skill, you need to connect your Gmail account:");
    console.error("1. Go to https://skills.md/dashboard/connectors");
    console.error("2. Click 'Connect' on the Gmail connector");
    console.error("3. Authorize access to your Gmail account");
    process.exit(1);
  }
  return token;
}

// Get account email from environment
function getAccountEmail(): string {
  return process.env.GMAIL_ACCOUNT_EMAIL || "me";
}

// Make authenticated Gmail API request
async function gmailRequest<T>(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  log(`Gmail API request: ${options.method || "GET"} ${endpoint}`, "debug");

  const response = await fetch(`${GMAIL_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  log(`Gmail API response: ${response.status}`, "debug");

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) {
      log("Error: Gmail access token expired or invalid.", "error");
      console.error("Please reconnect your Gmail account in the Connectors dashboard.");
      process.exit(1);
    }
    throw new Error(error.error?.message || `Gmail API error: ${response.status}`);
  }

  return response.json();
}

// Encode email to base64url format
function encodeEmail(
  from: string,
  to: string,
  subject: string,
  body: string,
  options: {
    cc?: string;
    bcc?: string;
    replyTo?: string;
    inReplyTo?: string;
    references?: string;
    isHtml?: boolean;
  } = {}
): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const contentType = options.isHtml ? "text/html" : "text/plain";

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${contentType}; charset=utf-8`,
  ];

  if (options.cc) {
    headers.push(`Cc: ${options.cc}`);
  }

  if (options.bcc) {
    headers.push(`Bcc: ${options.bcc}`);
  }

  if (options.replyTo) {
    headers.push(`Reply-To: ${options.replyTo}`);
  }

  if (options.inReplyTo) {
    headers.push(`In-Reply-To: ${options.inReplyTo}`);
  }

  if (options.references) {
    headers.push(`References: ${options.references}`);
  }

  const rawMessage = headers.join("\r\n") + "\r\n\r\n" + body;

  // Encode to base64url
  return Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Send an email
async function sendEmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  options: {
    cc?: string;
    bcc?: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    isHtml?: boolean;
  } = {}
): Promise<{ id: string; threadId: string }> {
  const from = getAccountEmail();
  const raw = encodeEmail(from, to, subject, body, {
    cc: options.cc,
    bcc: options.bcc,
    inReplyTo: options.inReplyTo,
    references: options.references,
    isHtml: options.isHtml,
  });

  const requestBody: { raw: string; threadId?: string } = { raw };
  if (options.threadId) {
    requestBody.threadId = options.threadId;
  }

  return gmailRequest("/messages/send", accessToken, {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

// Create a draft
async function createDraft(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  options: {
    cc?: string;
    bcc?: string;
    threadId?: string;
    isHtml?: boolean;
  } = {}
): Promise<{ id: string; message: { id: string; threadId: string } }> {
  const from = getAccountEmail();
  const raw = encodeEmail(from, to, subject, body, {
    cc: options.cc,
    bcc: options.bcc,
    isHtml: options.isHtml,
  });

  const requestBody: { message: { raw: string; threadId?: string } } = {
    message: { raw },
  };
  if (options.threadId) {
    requestBody.message.threadId = options.threadId;
  }

  return gmailRequest("/drafts", accessToken, {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
}

// Get thread details for reply
async function getThread(
  accessToken: string,
  threadId: string
): Promise<{
  id: string;
  messages: Array<{
    id: string;
    payload?: {
      headers?: Array<{ name: string; value: string }>;
    };
  }>;
}> {
  return gmailRequest(`/threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`, accessToken);
}

// Read body from stdin if available
async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

// Main function
async function main() {
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`, "debug");

  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      to: { type: "string" },
      subject: { type: "string", short: "s" },
      body: { type: "string", short: "b" },
      cc: { type: "string" },
      bcc: { type: "string" },
      "reply-to": { type: "string", short: "r" },
      draft: { type: "boolean", default: false },
      html: { type: "boolean", default: false },
      stdin: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Compose Gmail - Send emails, create drafts, and reply to threads

Usage:
  bun run src/index.ts [options]

Options:
  --to <emails>          Recipient email(s), comma-separated (required)
  --subject, -s <text>   Email subject line (required)
  --body, -b <text>      Email body content (required unless --stdin)
  --cc <emails>          CC recipients, comma-separated
  --bcc <emails>         BCC recipients, comma-separated
  --reply-to, -r <id>    Thread ID to reply to
  --draft                Save as draft instead of sending
  --html                 Treat body as HTML content
  --stdin                Read body from stdin
  --help, -h             Show this help

Examples:
  # Send a new email
  bun run src/index.ts --to "user@example.com" --subject "Hello" --body "Hi there!"

  # Reply to a thread
  bun run src/index.ts --reply-to thread_abc123 --body "Thanks for your email!"

  # Create a draft
  bun run src/index.ts --to "user@example.com" --subject "Draft" --body "..." --draft

  # Send HTML email
  bun run src/index.ts --to "user@example.com" --subject "HTML" --body "<h1>Hello</h1>" --html

  # Read body from stdin
  echo "Email body" | bun run src/index.ts --to "user@example.com" --subject "Subject" --stdin
`);
    process.exit(0);
  }

  log("Getting access token...", "debug");
  const accessToken = getAccessToken();
  log(`Access token obtained (length: ${accessToken.length})`, "debug");

  // Get body from stdin if specified
  let body = values.body as string | undefined;
  if (values.stdin) {
    const stdinBody = await readStdin();
    if (stdinBody) {
      body = stdinBody;
    }
  }

  // Handle reply mode
  const replyToThreadId = values["reply-to"] as string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let subject = values.subject as string | undefined;

  if (replyToThreadId) {
    // Fetch thread to get Message-ID for proper threading
    try {
      const thread = await getThread(accessToken, replyToThreadId);
      const lastMessage = thread.messages[thread.messages.length - 1];
      const headers = lastMessage?.payload?.headers || [];

      const messageId = headers.find(h => h.name.toLowerCase() === "message-id")?.value;
      const originalSubject = headers.find(h => h.name.toLowerCase() === "subject")?.value;

      if (messageId) {
        inReplyTo = messageId;
        references = messageId;
      }

      // Use original subject with Re: prefix if not specified
      if (!subject && originalSubject) {
        subject = originalSubject.startsWith("Re:") ? originalSubject : `Re: ${originalSubject}`;
      }
    } catch (error) {
      log(`Warning: Could not fetch thread details: ${error instanceof Error ? error.message : error}`, "error");
    }
  }

  // Validate required fields
  const to = values.to as string;

  if (!replyToThreadId && !to) {
    log("Error: --to is required (unless replying to a thread)", "error");
    process.exit(1);
  }

  if (!subject) {
    log("Error: --subject is required (unless replying to a thread)", "error");
    process.exit(1);
  }

  if (!body) {
    log("Error: --body is required (or use --stdin to read from stdin)", "error");
    process.exit(1);
  }

  try {
    if (values.draft) {
      // Create draft
      const result = await createDraft(accessToken, to, subject, body, {
        cc: values.cc as string | undefined,
        bcc: values.bcc as string | undefined,
        threadId: replyToThreadId,
        isHtml: values.html as boolean,
      });

      console.log("Draft saved successfully!");
      console.log(`  Draft ID: ${result.id}`);
      console.log(`  Message ID: ${result.message.id}`);
      if (to) console.log(`  To: ${to}`);
      console.log(`  Subject: ${subject}`);
    } else {
      // Send email
      const result = await sendEmail(accessToken, to, subject, body, {
        cc: values.cc as string | undefined,
        bcc: values.bcc as string | undefined,
        threadId: replyToThreadId,
        inReplyTo,
        references,
        isHtml: values.html as boolean,
      });

      console.log("Email sent successfully!");
      console.log(`  Message ID: ${result.id}`);
      console.log(`  Thread ID: ${result.threadId}`);
      if (to) console.log(`  To: ${to}`);
      console.log(`  Subject: ${subject}`);
    }
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    process.exit(1);
  }
}

main();
