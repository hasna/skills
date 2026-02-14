#!/usr/bin/env bun
/**
 * MCP Browse SSE Server
 * Browser automation using Browser-Use Cloud API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import express from "express";
import cors from "cors";
import { BrowserUseClient } from "./client";
import type { LLMModel, ProxyCountry, TaskSecrets } from "./types";

// Configuration
const CONFIG = {
  port: parseInt(process.env.PORT || "3852"),
  apiKey: process.env.MCP_BROWSE_API_KEY || "",
  browserUseApiKey: process.env.BROWSER_USE_API_KEY || "",
};

// Validate API key middleware
function validateApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!CONFIG.apiKey) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized - missing Authorization header" });
  }
  const [type, key] = authHeader.split(" ");
  if (type !== "Bearer" || key !== CONFIG.apiKey) {
    return res.status(401).json({ error: "Unauthorized - invalid API key" });
  }
  next();
}

// Create Express app
const app = express();
app.use(cors());
// Don't use express.json() globally - SSEServerTransport needs raw stream

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mcp-browse",
    timestamp: new Date().toISOString(),
  });
});

// Store active transports - keyed by sessionId from transport
const transports: { [sessionId: string]: SSEServerTransport } = {};

// Create MCP server factory
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-browse",
    version: "1.0.0",
  });

  // Initialize client
  let client: BrowserUseClient | null = null;
  try {
    client = new BrowserUseClient(CONFIG.browserUseApiKey);
  } catch (error) {
    console.error("Failed to initialize BrowserUseClient:", error);
  }

  // Tool: Browse
  server.tool(
    "browse",
    "Execute a browser automation task and wait for completion",
    {
      task: z.string().describe("Natural language task description"),
      model: z
        .enum([
          "gpt-4o",
          "o3",
          "o4-mini",
          "claude-sonnet-4",
          "claude-3-5-sonnet",
          "gemini-flash-latest",
          "browser-use",
        ])
        .optional()
        .describe("LLM model to use (default: gpt-4o)"),
      use_proxy: z
        .boolean()
        .optional()
        .describe("Enable proxy for captcha bypass"),
      proxy_country: z
        .enum(["us", "fr", "it", "jp", "au", "de", "fi", "ca"])
        .optional()
        .describe("Proxy country code (default: us)"),
      use_adblock: z.boolean().optional().describe("Enable ad blocking"),
      highlight_elements: z
        .boolean()
        .optional()
        .describe("Highlight elements during execution"),
      timeout: z
        .number()
        .optional()
        .describe("Task timeout in milliseconds (default: 300000)"),
      secrets: z
        .record(z.string())
        .optional()
        .describe("Credentials - keys are placeholders in task, values are actual secrets"),
      allowed_domains: z
        .array(z.string())
        .optional()
        .describe("List of allowed domains the browser can navigate to"),
    },
    async ({
      task,
      model,
      use_proxy,
      proxy_country,
      use_adblock,
      highlight_elements,
      timeout,
      secrets,
      allowed_domains,
    }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.browse({
          task,
          model: model as LLMModel,
          useProxy: use_proxy,
          proxyCountry: proxy_country as ProxyCountry,
          useAdblock: use_adblock,
          highlightElements: highlight_elements,
          timeout,
          secrets: secrets as TaskSecrets,
          allowedDomains: allowed_domains,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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

  // Tool: Run Task (non-blocking)
  server.tool(
    "run_task",
    "Start a browser automation task without waiting for completion",
    {
      task: z.string().describe("Natural language task description"),
      model: z
        .enum([
          "gpt-4o",
          "o3",
          "o4-mini",
          "claude-sonnet-4",
          "claude-3-5-sonnet",
          "gemini-flash-latest",
          "browser-use",
        ])
        .optional()
        .describe("LLM model to use (default: gpt-4o)"),
      use_proxy: z
        .boolean()
        .optional()
        .describe("Enable proxy for captcha bypass"),
      proxy_country: z
        .enum(["us", "fr", "it", "jp", "au", "de", "fi", "ca"])
        .optional()
        .describe("Proxy country code (default: us)"),
      use_adblock: z.boolean().optional().describe("Enable ad blocking"),
      highlight_elements: z
        .boolean()
        .optional()
        .describe("Highlight elements during execution"),
      secrets: z
        .record(z.string())
        .optional()
        .describe("Credentials - keys are placeholders in task, values are actual secrets"),
      allowed_domains: z
        .array(z.string())
        .optional()
        .describe("List of allowed domains the browser can navigate to"),
    },
    async ({
      task,
      model,
      use_proxy,
      proxy_country,
      use_adblock,
      highlight_elements,
      secrets,
      allowed_domains,
    }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.runTask({
          task,
          model: model as LLMModel,
          useProxy: use_proxy,
          proxyCountry: proxy_country as ProxyCountry,
          useAdblock: use_adblock,
          highlightElements: highlight_elements,
          secrets: secrets as TaskSecrets,
          allowedDomains: allowed_domains,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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

  // Tool: Extract
  server.tool(
    "extract",
    "Extract structured data from a website",
    {
      task: z.string().describe("Extraction task description"),
      model: z
        .enum([
          "gpt-4o",
          "o3",
          "o4-mini",
          "claude-sonnet-4",
          "claude-3-5-sonnet",
          "gemini-flash-latest",
          "browser-use",
        ])
        .optional()
        .describe("LLM model to use (default: gpt-4o)"),
      schema: z
        .record(z.unknown())
        .optional()
        .describe("JSON schema for structured output"),
      use_proxy: z
        .boolean()
        .optional()
        .describe("Enable proxy for captcha bypass"),
      proxy_country: z
        .enum(["us", "fr", "it", "jp", "au", "de", "fi", "ca"])
        .optional()
        .describe("Proxy country code (default: us)"),
      use_adblock: z.boolean().optional().describe("Enable ad blocking"),
      timeout: z
        .number()
        .optional()
        .describe("Task timeout in milliseconds (default: 300000)"),
      secrets: z
        .record(z.string())
        .optional()
        .describe("Credentials - keys are placeholders in task, values are actual secrets"),
      allowed_domains: z
        .array(z.string())
        .optional()
        .describe("List of allowed domains the browser can navigate to"),
    },
    async ({
      task,
      model,
      schema,
      use_proxy,
      proxy_country,
      use_adblock,
      timeout,
      secrets,
      allowed_domains,
    }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.extract({
          task,
          model: model as LLMModel,
          schema: schema as Record<string, unknown>,
          useProxy: use_proxy,
          proxyCountry: proxy_country as ProxyCountry,
          useAdblock: use_adblock,
          timeout,
          secrets: secrets as TaskSecrets,
          allowedDomains: allowed_domains,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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

  // Tool: Get Task Status
  server.tool(
    "get_task_status",
    "Get the current status of a browser task",
    {
      task_id: z.string().describe("Task ID to check"),
    },
    async ({ task_id }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.getTaskStatus(task_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  task_id,
                  ...result,
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

  // Tool: Get Task Details
  server.tool(
    "get_task",
    "Get detailed information about a browser task including output and steps",
    {
      task_id: z.string().describe("Task ID to get details for"),
    },
    async ({ task_id }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await client.getTask(task_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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

  // Tool: List Tasks
  server.tool(
    "list_tasks",
    "List all browser automation tasks",
    {},
    async () => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const tasks = await client.listTasks();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  count: tasks.length,
                  tasks,
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

  // Tool: Pause Task
  server.tool(
    "pause_task",
    "Pause a running browser task",
    {
      task_id: z.string().describe("Task ID to pause"),
    },
    async ({ task_id }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        await client.pauseTask(task_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  task_id,
                  message: "Task paused",
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

  // Tool: Resume Task
  server.tool(
    "resume_task",
    "Resume a paused browser task",
    {
      task_id: z.string().describe("Task ID to resume"),
    },
    async ({ task_id }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        await client.resumeTask(task_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  task_id,
                  message: "Task resumed",
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

  // Tool: Stop Task
  server.tool(
    "stop_task",
    "Stop a running browser task permanently",
    {
      task_id: z.string().describe("Task ID to stop"),
    },
    async ({ task_id }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        await client.stopTask(task_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  task_id,
                  message: "Task stopped",
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

  // Tool: Get Screenshots
  server.tool(
    "get_screenshots",
    "Get screenshots from a browser task",
    {
      task_id: z.string().describe("Task ID to get screenshots for"),
    },
    async ({ task_id }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: "Browser-Use client not initialized. Check BROWSER_USE_API_KEY.",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      try {
        const screenshots = await client.getTaskScreenshots(task_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  task_id,
                  count: screenshots.length,
                  screenshots,
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

  return server;
}

// SSE endpoint - Caddy rewrites /mcp/browse/sse -> /sse
app.get("/sse", validateApiKey, async (req, res) => {
  console.log("SSE connection request received");

  const transport = new SSEServerTransport("/mcp/browse/messages", res);
  transports[transport.sessionId] = transport;

  console.log("SSE session started:", transport.sessionId);

  res.on("close", () => {
    console.log("SSE session closed:", transport.sessionId);
    delete transports[transport.sessionId];
  });

  const server = createMcpServer();
  await server.connect(transport);
});

// Messages endpoint - Caddy rewrites /mcp/browse/messages -> /messages
app.post("/messages", validateApiKey, async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: "No transport found for sessionId" });
  }
});

// Start server
app.listen(CONFIG.port, () => {
  console.log(`MCP Browse SSE server running on port ${CONFIG.port}`);
  console.log(`SSE endpoint: http://localhost:${CONFIG.port}/sse`);
  console.log(`Messages endpoint: http://localhost:${CONFIG.port}/messages`);
  console.log(`Health check: http://localhost:${CONFIG.port}/health`);
  console.log(`API Key: ${CONFIG.apiKey ? "configured" : "not configured (open access)"}`);
  if (!CONFIG.browserUseApiKey) {
    console.warn("WARNING: BROWSER_USE_API_KEY not set - client will not work");
  }
});
