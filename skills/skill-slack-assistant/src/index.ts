#!/usr/bin/env bun
import { WebClient } from "@slack/web-api";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(`
skill-slack-assistant - Interact with Slack channels and messages

Usage:
  skills run slack-assistant -- action=<action> [options]

Options:
  -h, --help               Show this help message
  action=<action>          Action to perform (required):
                           - list-channels: List all accessible channels
                           - history: Get recent messages from a channel
                           - send: Send a message to a channel
  channelId=<id>           Channel ID (required for history, send)
  text=<message>           Message text (required for send)

Examples:
  skills run slack-assistant -- action=list-channels
  skills run slack-assistant -- action=history channelId=C01234567
  skills run slack-assistant -- action=send channelId=C01234567 text="Hello team!"

Requirements:
  Requires Slack connector to be connected in skills.md.
`);
  process.exit(0);
}

const actionArg = args.find(a => a.startsWith("action="))?.split("=")[1];
const channelIdArg = args.find(a => a.startsWith("channelId="))?.split("=")[1];
const textArg = args.find(a => a.startsWith("text="))?.split("=")[1];

if (!process.env.SLACK_ACCESS_TOKEN) {
  console.error("Error: Slack connector not connected. Please connect Slack in skills.md.");
  process.exit(1);
}

const client = new WebClient(process.env.SLACK_ACCESS_TOKEN);

async function main() {
  try {
    switch (actionArg) {
      case "list-channels":
        const result = await client.conversations.list({ types: "public_channel,private_channel" });
        console.log(JSON.stringify(result.channels?.map(c => ({ id: c.id, name: c.name })), null, 2));
        break;

      case "history":
        if (!channelIdArg) {
          console.error("Error: channelId is required for history");
          process.exit(1);
        }
        const history = await client.conversations.history({ channel: channelIdArg, limit: 10 });
        console.log(JSON.stringify(history.messages?.map(m => ({ user: m.user, text: m.text, ts: m.ts })), null, 2));
        break;

      case "send":
        if (!channelIdArg || !textArg) {
          console.error("Error: channelId and text are required for send");
          process.exit(1);
        }
        const response = await client.chat.postMessage({ channel: channelIdArg, text: textArg });
        console.log(`Message sent: ${response.ts}`);
        break;

      default:
        console.log("Usage: skills run slack-assistant -- action=<list-channels|history|send> [channelId=...] [text=...]");
    }
  } catch (error: any) {
    console.error("Slack API Error:", error.message);
    process.exit(1);
  }
}

main();
