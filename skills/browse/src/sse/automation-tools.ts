import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { BrowserUseClient } from "../client";
import type { LLMModel, ProxyCountry, TaskSecrets } from "../types";

export function registerAutomationTools(server: McpServer, client: BrowserUseClient | null): void {
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

}
