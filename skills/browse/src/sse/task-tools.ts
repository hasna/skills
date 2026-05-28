import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { BrowserUseClient } from "../client";

export function registerTaskTools(server: McpServer, client: BrowserUseClient | null): void {
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

}
