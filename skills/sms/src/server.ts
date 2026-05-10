#!/usr/bin/env bun
/**
 * MCP SMS HTTP Server
 * Provides SMS functionality for AI agents via HTTP API using Twilio
 */

import twilio from "twilio";

// Configuration
const CONFIG = {
  port: parseInt(process.env.PORT || "3848"),
  accountSid: process.env.TWILIO_ACCOUNT_SID || "",
  authToken: process.env.TWILIO_AUTH_TOKEN || "",
  apiKey: process.env.MCP_SMS_API_KEY || "",
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

// Helper: Validate API key
function validateApiKey(request: Request): boolean {
  if (!CONFIG.apiKey) return true;
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;
  const [type, key] = authHeader.split(" ");
  return type === "Bearer" && key === CONFIG.apiKey;
}

// Helper: JSON response
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper: Error response
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
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

// Send SMS
async function sendSms(params: {
  agent_name: string;
  from_number: string;
  to: string;
  body: string;
}): Promise<{ success: boolean; message_sid?: string; error?: string }> {
  try {
    const message = await twilioClient.messages.create({
      body: params.body,
      from: formatPhoneNumber(params.from_number),
      to: formatPhoneNumber(params.to),
    });

    return {
      success: true,
      message_sid: message.sid,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// List messages
async function listMessages(params: {
  agent_name: string;
  phone_number: string;
  limit?: number;
  direction?: "inbound" | "outbound";
}): Promise<any> {
  try {
    const options: any = {
      limit: params.limit || 20,
    };

    if (params.direction === "inbound") {
      options.to = formatPhoneNumber(params.phone_number);
    } else if (params.direction === "outbound") {
      options.from = formatPhoneNumber(params.phone_number);
    }

    const messages = await twilioClient.messages.list(options);

    return {
      success: true,
      count: messages.length,
      messages: messages.map((m) => ({
        sid: m.sid,
        from: m.from,
        to: m.to,
        body: m.body,
        status: m.status,
        direction: m.direction,
        date_sent: m.dateSent?.toISOString(),
        date_created: m.dateCreated?.toISOString(),
      })),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Get message
async function getMessage(messageSid: string): Promise<any> {
  try {
    const message = await twilioClient.messages(messageSid).fetch();

    return {
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
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// List phone numbers
async function listPhoneNumbers(): Promise<any> {
  try {
    const numbers = await twilioClient.incomingPhoneNumbers.list();

    return {
      success: true,
      count: numbers.length,
      phone_numbers: numbers.map((n) => ({
        sid: n.sid,
        phone_number: n.phoneNumber,
        friendly_name: n.friendlyName,
        capabilities: n.capabilities,
        date_created: n.dateCreated?.toISOString(),
      })),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Buy phone number
async function buyPhoneNumber(params: {
  area_code?: string;
  friendly_name?: string;
}): Promise<any> {
  try {
    // Search for available numbers
    const searchOptions: any = {
      limit: 1,
    };

    if (params.area_code) {
      searchOptions.areaCode = params.area_code;
    }

    const availableNumbers =
      await twilioClient.availablePhoneNumbers("US").local.list(searchOptions);

    if (availableNumbers.length === 0) {
      return {
        success: false,
        error: "No available phone numbers found",
      };
    }

    // Purchase the number
    const purchased = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: availableNumbers[0].phoneNumber,
      friendlyName: params.friendly_name || "MCP SMS Agent",
    });

    return {
      success: true,
      phone_number: purchased.phoneNumber,
      sid: purchased.sid,
      friendly_name: purchased.friendlyName,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// HTTP Server
const PATH_PREFIX = "/sms";

const server = Bun.serve({
  port: CONFIG.port,
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;
    const method = request.method;

    // Strip path prefix if present (for ALB routing)
    if (path.startsWith(PATH_PREFIX)) {
      path = path.slice(PATH_PREFIX.length) || "/";
    }

    // Health check
    if (path === "/health" && method === "GET") {
      return jsonResponse({ status: "ok", version: "1.0.0" });
    }

    // API key validation for all other routes
    if (!validateApiKey(request)) {
      return errorResponse("Unauthorized", 401);
    }

    try {
      // POST /send - Send SMS
      if (path === "/send" && method === "POST") {
        const body = await request.json();

        if (!body.agent_name || !body.from_number || !body.to || !body.body) {
          return errorResponse(
            "Missing required fields: agent_name, from_number, to, body"
          );
        }

        const result = await sendSms(body);
        return jsonResponse({
          ...result,
          agent: getDisplayName(body.agent_name),
          from: formatPhoneNumber(body.from_number),
          to: formatPhoneNumber(body.to),
        });
      }

      // GET /messages/:phone - List messages for a phone number
      if (path.startsWith("/messages/") && method === "GET") {
        const parts = path.split("/");
        const phoneNumber = decodeURIComponent(parts[2]);
        const agentName = url.searchParams.get("agent") || "unknown";
        const limit = parseInt(url.searchParams.get("limit") || "20");
        const direction = url.searchParams.get("direction") as
          | "inbound"
          | "outbound"
          | undefined;

        if (!phoneNumber) {
          return errorResponse("Phone number required");
        }

        const result = await listMessages({
          agent_name: agentName,
          phone_number: phoneNumber,
          limit,
          direction,
        });
        return jsonResponse(result);
      }

      // GET /message/:sid - Get specific message
      if (path.startsWith("/message/") && method === "GET") {
        const messageSid = path.split("/")[2];

        if (!messageSid) {
          return errorResponse("Message SID required");
        }

        const result = await getMessage(messageSid);
        return jsonResponse(result);
      }

      // GET /numbers - List phone numbers
      if (path === "/numbers" && method === "GET") {
        const result = await listPhoneNumbers();
        return jsonResponse(result);
      }

      // POST /numbers/buy - Buy a phone number
      if (path === "/numbers/buy" && method === "POST") {
        const body = await request.json();
        const result = await buyPhoneNumber({
          area_code: body.area_code,
          friendly_name: body.friendly_name,
        });
        return jsonResponse(result);
      }

      // GET /agent/:name - Get agent info
      if (path.startsWith("/agent/") && method === "GET") {
        const agentName = path.split("/")[2];

        if (!agentName) {
          return errorResponse("Agent name required");
        }

        return jsonResponse({
          success: true,
          agent_name: agentName,
          display_name: getDisplayName(agentName),
        });
      }

      return errorResponse("Not found", 404);
    } catch (error: any) {
      console.error("Error:", error);
      return errorResponse(error.message, 500);
    }
  },
});

console.log(`MCP SMS Server running on http://localhost:${CONFIG.port}`);
console.log(`API Key: ${CONFIG.apiKey ? "configured" : "not configured (open access)"}`);
