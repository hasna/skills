#!/usr/bin/env bun
/**
 * Read Gmail Skill
 * Read and search emails from Gmail using OAuth access token
 */

import { parseArgs } from "util";

// Gmail API base URL
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Types
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    }>;
    mimeType?: string;
  };
}

interface ListMessagesResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface FormattedMessage {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  labelIds?: string[];
  body?: {
    text?: string;
    html?: string;
  };
}

// Get access token from environment
function getAccessToken(): string {
  const token = process.env.GMAIL_ACCESS_TOKEN;
  if (!token) {
    console.error("Error: Gmail not connected.");
    console.error("");
    console.error("To use this skill, you need to connect your Gmail account:");
    console.error("1. Go to https://skills.md/dashboard/connectors");
    console.error("2. Click 'Connect' on the Gmail connector");
    console.error("3. Authorize access to your Gmail account");
    process.exit(1);
  }
  return token;
}

// Make authenticated Gmail API request
async function gmailRequest<T>(endpoint: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GMAIL_API_BASE}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) {
      console.error("Error: Gmail access token expired or invalid.");
      console.error("Please reconnect your Gmail account in the Connectors dashboard.");
      process.exit(1);
    }
    throw new Error(error.error?.message || `Gmail API error: ${response.status}`);
  }

  return response.json();
}

// List messages
async function listMessages(
  accessToken: string,
  options: {
    query?: string;
    maxResults: number;
    labelIds?: string;
    pageToken?: string;
  }
): Promise<ListMessagesResponse> {
  const params = new URLSearchParams();
  params.set("maxResults", options.maxResults.toString());

  if (options.query) {
    params.set("q", options.query);
  }
  if (options.labelIds) {
    params.set("labelIds", options.labelIds);
  }
  if (options.pageToken) {
    params.set("pageToken", options.pageToken);
  }

  return gmailRequest(`/messages?${params.toString()}`, accessToken);
}

// Get single message with metadata
async function getMessage(
  accessToken: string,
  messageId: string,
  format: "metadata" | "full" = "metadata"
): Promise<GmailMessage> {
  const metadataHeaders = "metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date";
  const endpoint = format === "full"
    ? `/messages/${messageId}?format=full`
    : `/messages/${messageId}?format=metadata&${metadataHeaders}`;

  return gmailRequest(endpoint, accessToken);
}

// Extract header value
function getHeader(message: GmailMessage, name: string): string | undefined {
  const headers = message.payload?.headers || [];
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

// Extract body from message
function extractBody(message: GmailMessage): { text?: string; html?: string } {
  let textBody = "";
  let htmlBody = "";

  const extractPart = (part: {
    mimeType: string;
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  }) => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      textBody = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      htmlBody = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.parts) {
      part.parts.forEach(extractPart);
    }
  };

  if (message.payload?.parts) {
    message.payload.parts.forEach(extractPart);
  } else if (message.payload?.body?.data) {
    const decoded = Buffer.from(message.payload.body.data, "base64").toString("utf-8");
    if (message.payload.mimeType === "text/html") {
      htmlBody = decoded;
    } else {
      textBody = decoded;
    }
  }

  return { text: textBody || undefined, html: htmlBody || undefined };
}

// Format message for output
function formatMessage(message: GmailMessage, includeFull: boolean = false): FormattedMessage {
  const formatted: FormattedMessage = {
    id: message.id,
    threadId: message.threadId,
    from: getHeader(message, "From"),
    to: getHeader(message, "To"),
    subject: getHeader(message, "Subject"),
    date: getHeader(message, "Date"),
    snippet: message.snippet,
    labelIds: message.labelIds,
  };

  if (includeFull) {
    formatted.body = extractBody(message);
  }

  return formatted;
}

// Format output for display
function formatTextOutput(messages: FormattedMessage[], includeFull: boolean): string {
  if (messages.length === 0) {
    return "No messages found.";
  }

  const lines: string[] = ["=== Gmail Messages ===", ""];

  messages.forEach((msg, index) => {
    lines.push(`[${index + 1}] From: ${msg.from || "Unknown"}`);
    lines.push(`    Subject: ${msg.subject || "(no subject)"}`);
    lines.push(`    Date: ${msg.date || "Unknown"}`);

    if (msg.labelIds?.length) {
      lines.push(`    Labels: ${msg.labelIds.join(", ")}`);
    }

    if (includeFull && msg.body?.text) {
      lines.push(`    ---`);
      lines.push(`    ${msg.body.text.slice(0, 500)}${msg.body.text.length > 500 ? "..." : ""}`);
    } else if (msg.snippet) {
      lines.push(`    Preview: ${msg.snippet}`);
    }

    lines.push(`    ID: ${msg.id}`);
    lines.push("");
  });

  return lines.join("\n");
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      query: { type: "string", short: "q" },
      max: { type: "string", default: "10" },
      id: { type: "string" },
      label: { type: "string" },
      format: { type: "string", default: "text" },
      full: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Show help
  if (values.help) {
    console.log(`
Read Gmail - Read and search emails from your Gmail inbox

Usage:
  bun run src/index.ts [options]

Options:
  --query, -q <query>    Gmail search query (e.g., "from:user@example.com is:unread")
  --max <number>         Maximum number of emails to return [default: 10]
  --id <message-id>      Get a specific message by ID
  --label <label>        Filter by label (INBOX, SENT, UNREAD, STARRED, etc.)
  --format <format>      Output format: text or json [default: text]
  --full                 Include full email body
  --help, -h             Show this help

Examples:
  # List recent emails
  bun run src/index.ts

  # Search emails
  bun run src/index.ts --query "from:boss@company.com"

  # Get unread emails
  bun run src/index.ts --query "is:unread" --max 20

  # Read specific email
  bun run src/index.ts --id abc123 --full

  # Output as JSON
  bun run src/index.ts --format json
`);
    process.exit(0);
  }

  const accessToken = getAccessToken();
  const maxResults = Math.min(parseInt(values.max as string, 10) || 10, 100);
  const outputFormat = values.format as string;
  const includeFull = values.full as boolean;

  try {
    // Get specific message by ID
    if (values.id) {
      const message = await getMessage(accessToken, values.id as string, includeFull ? "full" : "metadata");
      const formatted = formatMessage(message, includeFull);

      if (outputFormat === "json") {
        console.log(JSON.stringify(formatted, null, 2));
      } else {
        console.log(formatTextOutput([formatted], includeFull));
      }
      return;
    }

    // List messages
    const listResult = await listMessages(accessToken, {
      query: values.query as string | undefined,
      maxResults,
      labelIds: values.label as string | undefined,
    });

    if (!listResult.messages || listResult.messages.length === 0) {
      if (outputFormat === "json") {
        console.log(JSON.stringify({ messages: [], resultSizeEstimate: 0 }, null, 2));
      } else {
        console.log("No messages found.");
      }
      return;
    }

    // Fetch details for each message (limit to avoid rate limits)
    const messagesToFetch = listResult.messages.slice(0, Math.min(maxResults, 20));
    const messages = await Promise.all(
      messagesToFetch.map(async (msg) => {
        try {
          const fullMsg = await getMessage(accessToken, msg.id, includeFull ? "full" : "metadata");
          return formatMessage(fullMsg, includeFull);
        } catch (error) {
          return {
            id: msg.id,
            threadId: msg.threadId,
            error: "Failed to fetch message details",
          } as FormattedMessage;
        }
      })
    );

    // Output results
    if (outputFormat === "json") {
      console.log(JSON.stringify({
        messages,
        nextPageToken: listResult.nextPageToken,
        resultSizeEstimate: listResult.resultSizeEstimate,
      }, null, 2));
    } else {
      console.log(formatTextOutput(messages, includeFull));
      if (listResult.resultSizeEstimate && listResult.resultSizeEstimate > messages.length) {
        console.log(`Showing ${messages.length} of ~${listResult.resultSizeEstimate} messages.`);
        console.log(`Use --max to fetch more messages.`);
      }
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exit(1);
  }
}

main();
