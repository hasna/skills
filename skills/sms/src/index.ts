#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import twilio from "twilio";

// Configuration
const CONFIG = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || "",
  authToken: process.env.TWILIO_AUTH_TOKEN || "",
};

// Twilio Client
const twilioClient = twilio(CONFIG.accountSid, CONFIG.authToken);

// Helper: Capitalize first letter
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Helper: Get display name for agent - "[Name] (AI Agent)"
function getDisplayName(agentName: string): string {
  return `${capitalize(agentName)} (AI Agent)`;
}

// Helper: Format phone number to E.164
function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (!phone.startsWith("+")) {
    return `+${digits}`;
  }
  return phone;
}

// Create MCP Server
const server = new McpServer({
  name: "mcp-sms",
  version: "1.0.0",
});

// Tool: Send SMS
server.tool(
  "send_sms",
  "Send an SMS message from an AI agent",
  {
    agent_name: z
      .string()
      .describe("Name of the AI agent sending the SMS (e.g., 'claude', 'opus')"),
    from_number: z
      .string()
      .describe("Twilio phone number to send from (e.g., '+15551234567')"),
    to: z.string().describe("Recipient phone number"),
    body: z.string().describe("SMS message body (max 1600 characters)"),
  },
  async ({ agent_name, from_number, to, body }) => {
    try {
      const message = await twilioClient.messages.create({
        body,
        from: formatPhoneNumber(from_number),
        to: formatPhoneNumber(to),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message_sid: message.sid,
                agent: getDisplayName(agent_name),
                from: formatPhoneNumber(from_number),
                to: formatPhoneNumber(to),
                status: message.status,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error.message,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: List Messages
server.tool(
  "list_messages",
  "List SMS messages for a phone number",
  {
    agent_name: z.string().describe("Name of the AI agent"),
    phone_number: z.string().describe("Phone number to list messages for"),
    limit: z.number().optional().default(20).describe("Maximum number of messages to return"),
    direction: z
      .enum(["inbound", "outbound"])
      .optional()
      .describe("Filter by message direction"),
  },
  async ({ agent_name, phone_number, limit, direction }) => {
    try {
      const options: any = { limit };

      if (direction === "inbound") {
        options.to = formatPhoneNumber(phone_number);
      } else if (direction === "outbound") {
        options.from = formatPhoneNumber(phone_number);
      }

      const messages = await twilioClient.messages.list(options);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                agent: getDisplayName(agent_name),
                count: messages.length,
                messages: messages.map((m) => ({
                  sid: m.sid,
                  from: m.from,
                  to: m.to,
                  body: m.body,
                  status: m.status,
                  direction: m.direction,
                  date_sent: m.dateSent?.toISOString(),
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error.message,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Read Message
server.tool(
  "read_message",
  "Read a specific SMS message by SID",
  {
    message_sid: z.string().describe("The Twilio message SID"),
  },
  async ({ message_sid }) => {
    try {
      const message = await twilioClient.messages(message_sid).fetch();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                sid: message.sid,
                from: message.from,
                to: message.to,
                body: message.body,
                status: message.status,
                direction: message.direction,
                date_sent: message.dateSent?.toISOString(),
                date_created: message.dateCreated?.toISOString(),
                price: message.price,
                price_unit: message.priceUnit,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error.message,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: List Phone Numbers
server.tool(
  "list_phone_numbers",
  "List all Twilio phone numbers in the account",
  {},
  async () => {
    try {
      const numbers = await twilioClient.incomingPhoneNumbers.list();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                count: numbers.length,
                phone_numbers: numbers.map((n) => ({
                  sid: n.sid,
                  phone_number: n.phoneNumber,
                  friendly_name: n.friendlyName,
                  capabilities: n.capabilities,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error.message,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Get Agent Info
server.tool(
  "get_agent_info",
  "Get SMS configuration info for an AI agent",
  {
    agent_name: z.string().describe("Name of the AI agent"),
  },
  async ({ agent_name }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              agent_name,
              display_name: getDisplayName(agent_name),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP SMS Server running on stdio");
}

main().catch(console.error);
