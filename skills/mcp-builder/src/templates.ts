import type { PromptDef, ResourceDef, ToolDef } from "./types";

export const TEMPLATES: Record<string, { tools: ToolDef[]; resources: ResourceDef[]; prompts: PromptDef[] }> = {
  weather: {
    tools: [
      {
        name: "get_current_weather",
        description: "Get current weather conditions for a location",
        parameters: {
          location: { type: "string", description: "City name or coordinates", required: true },
          units: { type: "string", description: "Temperature units: celsius or fahrenheit", default: "celsius" },
        },
      },
      {
        name: "get_forecast",
        description: "Get weather forecast for the next few days",
        parameters: {
          location: { type: "string", description: "City name or coordinates", required: true },
          days: { type: "number", description: "Number of days to forecast", default: 5 },
        },
      },
    ],
    resources: [{ uri: "weather://locations", name: "Saved Locations", description: "List of saved weather locations", mimeType: "application/json" }],
    prompts: [{ name: "weather_summary", description: "Generate a weather summary", arguments: [{ name: "location", description: "Location to summarize", required: true }] }],
  },
  database: {
    tools: [
      {
        name: "query",
        description: "Execute a SQL query and return results",
        parameters: {
          sql: { type: "string", description: "SQL query to execute", required: true },
          params: { type: "array", description: "Query parameters", items: { type: "string" } },
        },
      },
      {
        name: "insert",
        description: "Insert a record into a table",
        parameters: {
          table: { type: "string", description: "Table name", required: true },
          data: { type: "object", description: "Data to insert", required: true },
        },
      },
      {
        name: "update",
        description: "Update records in a table",
        parameters: {
          table: { type: "string", description: "Table name", required: true },
          data: { type: "object", description: "Data to update", required: true },
          where: { type: "string", description: "WHERE clause", required: true },
        },
      },
      {
        name: "delete",
        description: "Delete records from a table",
        parameters: {
          table: { type: "string", description: "Table name", required: true },
          where: { type: "string", description: "WHERE clause", required: true },
        },
      },
    ],
    resources: [
      { uri: "db://schema", name: "Database Schema", description: "Database schema information", mimeType: "application/json" },
      { uri: "db://tables", name: "Tables List", description: "List of all tables", mimeType: "application/json" },
    ],
    prompts: [],
  },
  api: {
    tools: [
      {
        name: "get",
        description: "Make a GET request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
      {
        name: "post",
        description: "Make a POST request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          body: { type: "object", description: "Request body", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
      {
        name: "put",
        description: "Make a PUT request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          body: { type: "object", description: "Request body", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
      {
        name: "delete",
        description: "Make a DELETE request to an API endpoint",
        parameters: {
          url: { type: "string", description: "API endpoint URL", required: true },
          headers: { type: "object", description: "Request headers" },
        },
      },
    ],
    resources: [],
    prompts: [],
  },
  filesystem: {
    tools: [
      {
        name: "read_file",
        description: "Read contents of a file",
        parameters: {
          path: { type: "string", description: "File path", required: true },
          encoding: { type: "string", description: "File encoding", default: "utf-8" },
        },
      },
      {
        name: "write_file",
        description: "Write contents to a file",
        parameters: {
          path: { type: "string", description: "File path", required: true },
          content: { type: "string", description: "Content to write", required: true },
          encoding: { type: "string", description: "File encoding", default: "utf-8" },
        },
      },
      {
        name: "list_directory",
        description: "List contents of a directory",
        parameters: {
          path: { type: "string", description: "Directory path", required: true },
          recursive: { type: "boolean", description: "List recursively", default: false },
        },
      },
      {
        name: "search_files",
        description: "Search for files matching a pattern",
        parameters: {
          pattern: { type: "string", description: "Search pattern (glob)", required: true },
          path: { type: "string", description: "Starting directory", default: "." },
        },
      },
    ],
    resources: [{ uri: "file://{path}", name: "File Content", description: "Content of a file", mimeType: "text/plain" }],
    prompts: [],
  },
};

// Parse arguments
