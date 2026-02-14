#!/usr/bin/env bun
/**
 * Manage Gmail Skill
 * Manage Gmail labels, threads, and message organization
 */

import { parseArgs } from "util";

// Gmail API base URL
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Types
interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  messageListVisibility?: "show" | "hide";
  labelListVisibility?: "labelShow" | "labelShowIfUnread" | "labelHide";
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

interface ModifyRequest {
  addLabelIds?: string[];
  removeLabelIds?: string[];
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
async function gmailRequest<T>(
  endpoint: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${GMAIL_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
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

  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// List all labels
async function listLabels(accessToken: string): Promise<GmailLabel[]> {
  const response = await gmailRequest<{ labels: GmailLabel[] }>("/labels", accessToken);
  return response.labels || [];
}

// Create a label
async function createLabel(
  accessToken: string,
  name: string
): Promise<GmailLabel> {
  return gmailRequest("/labels", accessToken, {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
}

// Delete a label
async function deleteLabel(accessToken: string, labelId: string): Promise<void> {
  await gmailRequest(`/labels/${labelId}`, accessToken, {
    method: "DELETE",
  });
}

// Modify message labels
async function modifyMessage(
  accessToken: string,
  messageId: string,
  modifications: ModifyRequest
): Promise<void> {
  await gmailRequest(`/messages/${messageId}/modify`, accessToken, {
    method: "POST",
    body: JSON.stringify(modifications),
  });
}

// Batch modify messages
async function batchModifyMessages(
  accessToken: string,
  messageIds: string[],
  modifications: ModifyRequest
): Promise<void> {
  await gmailRequest("/messages/batchModify", accessToken, {
    method: "POST",
    body: JSON.stringify({
      ids: messageIds,
      ...modifications,
    }),
  });
}

// Trash a message
async function trashMessage(accessToken: string, messageId: string): Promise<void> {
  await gmailRequest(`/messages/${messageId}/trash`, accessToken, {
    method: "POST",
  });
}

// Untrash a message
async function untrashMessage(accessToken: string, messageId: string): Promise<void> {
  await gmailRequest(`/messages/${messageId}/untrash`, accessToken, {
    method: "POST",
  });
}

// Format labels for output
function formatLabelsText(labels: GmailLabel[]): string {
  const lines = ["Gmail Labels", "============", ""];

  // Sort: system labels first, then user labels alphabetically
  const systemLabels = labels.filter((l) => l.type === "system").sort((a, b) => a.name.localeCompare(b.name));
  const userLabels = labels.filter((l) => l.type === "user").sort((a, b) => a.name.localeCompare(b.name));

  for (const label of systemLabels) {
    lines.push(`${label.name} (system)`);
  }

  if (userLabels.length > 0) {
    lines.push("");
    lines.push("Custom Labels:");
    for (const label of userLabels) {
      const stats = label.messagesTotal !== undefined ? ` [${label.messagesUnread || 0}/${label.messagesTotal}]` : "";
      lines.push(`  ${label.id}: ${label.name}${stats}`);
    }
  }

  return lines.join("\n");
}

// Parse message IDs from comma-separated string
function parseMessageIds(input: string): string[] {
  return input.split(",").map((id) => id.trim()).filter(Boolean);
}

// Show help
function showHelp(): void {
  console.log(`
Manage Gmail - Manage labels, threads, and message organization

Usage:
  bun run src/index.ts <command> [options]

Commands:
  labels list              List all labels
  labels create <name>     Create a new label
  labels delete <id>       Delete a label by ID
  apply                    Add label(s) to message(s)
  remove                   Remove label(s) from message(s)
  archive                  Archive message(s)
  unarchive                Move message(s) back to inbox
  trash                    Move message(s) to trash
  untrash                  Restore message(s) from trash
  mark-read                Mark message(s) as read
  mark-unread              Mark message(s) as unread
  star                     Star message(s)
  unstar                   Unstar message(s)

Options:
  --message <ids>          Message ID(s), comma-separated
  --label <id>             Label ID (for apply/remove)
  --format <format>        Output format: text or json [default: text]
  --help, -h               Show this help

Examples:
  # List all labels
  bun run src/index.ts labels list

  # Create a label
  bun run src/index.ts labels create "Work/Projects"

  # Apply label to messages
  bun run src/index.ts apply --label Label_123 --message msg1,msg2

  # Archive messages
  bun run src/index.ts archive --message msg1,msg2

  # Mark as read
  bun run src/index.ts mark-read --message msg1
`);
}

// Main function
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      message: { type: "string", short: "m" },
      thread: { type: "string", short: "t" },
      label: { type: "string", short: "l" },
      format: { type: "string", default: "text" },
      action: { type: "string", short: "a" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  // Support both positional commands and --action option
  let command = positionals[0];
  let subcommand = positionals[1];

  // If --action is provided, use it as the command
  if (values.action) {
    const actionValue = values.action as string;
    // Handle compound actions like "labels list" or simple actions like "list"
    if (actionValue === "list" || actionValue === "create" || actionValue === "delete") {
      command = "labels";
      subcommand = actionValue;
    } else {
      command = actionValue;
    }
  }

  if (values.help || (!command && !values.action)) {
    showHelp();
    process.exit(values.help ? 0 : 1);
  }

  const accessToken = getAccessToken();
  const outputFormat = values.format as string;

  try {
    // Label commands
    if (command === "labels") {
      if (subcommand === "list" || !subcommand) {
        const labels = await listLabels(accessToken);
        if (outputFormat === "json") {
          console.log(JSON.stringify(labels, null, 2));
        } else {
          console.log(formatLabelsText(labels));
        }
        return;
      }

      if (subcommand === "create") {
        const labelName = positionals[2];
        if (!labelName) {
          console.error("Error: Label name is required");
          console.error("Usage: labels create <name>");
          process.exit(1);
        }

        const label = await createLabel(accessToken, labelName);
        if (outputFormat === "json") {
          console.log(JSON.stringify(label, null, 2));
        } else {
          console.log(`Label created successfully!`);
          console.log(`  ID: ${label.id}`);
          console.log(`  Name: ${label.name}`);
        }
        return;
      }

      if (subcommand === "delete") {
        const labelId = positionals[2];
        if (!labelId) {
          console.error("Error: Label ID is required");
          console.error("Usage: labels delete <label-id>");
          process.exit(1);
        }

        await deleteLabel(accessToken, labelId);
        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, labelId }, null, 2));
        } else {
          console.log(`Label deleted successfully: ${labelId}`);
        }
        return;
      }

      console.error(`Unknown labels subcommand: ${subcommand}`);
      process.exit(1);
    }

    // Message modification commands
    const messageIds = values.message ? parseMessageIds(values.message as string) : [];

    if (messageIds.length === 0 && ["apply", "remove", "archive", "unarchive", "trash", "untrash", "mark-read", "mark-unread", "star", "unstar"].includes(command)) {
      console.error("Error: --message is required");
      process.exit(1);
    }

    switch (command) {
      case "apply": {
        const labelId = values.label as string;
        if (!labelId) {
          console.error("Error: --label is required for apply command");
          process.exit(1);
        }

        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { addLabelIds: [labelId] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { addLabelIds: [labelId] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "apply", labelId, messageIds }, null, 2));
        } else {
          console.log(`Successfully applied label to ${messageIds.length} message(s)`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "remove": {
        const labelId = values.label as string;
        if (!labelId) {
          console.error("Error: --label is required for remove command");
          process.exit(1);
        }

        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { removeLabelIds: [labelId] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { removeLabelIds: [labelId] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "remove", labelId, messageIds }, null, 2));
        } else {
          console.log(`Successfully removed label from ${messageIds.length} message(s)`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "archive": {
        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { removeLabelIds: ["INBOX"] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { removeLabelIds: ["INBOX"] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "archive", messageIds }, null, 2));
        } else {
          console.log(`Successfully archived ${messageIds.length} message(s)`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "unarchive": {
        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { addLabelIds: ["INBOX"] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { addLabelIds: ["INBOX"] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "unarchive", messageIds }, null, 2));
        } else {
          console.log(`Successfully moved ${messageIds.length} message(s) back to inbox`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "trash": {
        for (const messageId of messageIds) {
          await trashMessage(accessToken, messageId);
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "trash", messageIds }, null, 2));
        } else {
          console.log(`Successfully trashed ${messageIds.length} message(s)`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "untrash": {
        for (const messageId of messageIds) {
          await untrashMessage(accessToken, messageId);
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "untrash", messageIds }, null, 2));
        } else {
          console.log(`Successfully restored ${messageIds.length} message(s) from trash`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "mark-read": {
        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { removeLabelIds: ["UNREAD"] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { removeLabelIds: ["UNREAD"] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "mark-read", messageIds }, null, 2));
        } else {
          console.log(`Successfully marked ${messageIds.length} message(s) as read`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "mark-unread": {
        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { addLabelIds: ["UNREAD"] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { addLabelIds: ["UNREAD"] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "mark-unread", messageIds }, null, 2));
        } else {
          console.log(`Successfully marked ${messageIds.length} message(s) as unread`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "star": {
        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { addLabelIds: ["STARRED"] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { addLabelIds: ["STARRED"] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "star", messageIds }, null, 2));
        } else {
          console.log(`Successfully starred ${messageIds.length} message(s)`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      case "unstar": {
        if (messageIds.length === 1) {
          await modifyMessage(accessToken, messageIds[0], { removeLabelIds: ["STARRED"] });
        } else {
          await batchModifyMessages(accessToken, messageIds, { removeLabelIds: ["STARRED"] });
        }

        if (outputFormat === "json") {
          console.log(JSON.stringify({ success: true, action: "unstar", messageIds }, null, 2));
        } else {
          console.log(`Successfully unstarred ${messageIds.length} message(s)`);
          messageIds.forEach((id) => console.log(`  - ${id}`));
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exit(1);
  }
}

main();
