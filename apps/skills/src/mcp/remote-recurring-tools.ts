import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRecurringSurface, recurringMcpSchema, recurringSurfaceOperations } from "../lib/recurring-surface.js";
import { recurringCustomerError } from "../lib/recurring-customer.js";
import { mcpJson } from "./helpers.js";

export function registerRecurringTools(server: McpServer) {
  for (const operation of recurringSurfaceOperations) {
    server.registerTool(operation.name, {
      title: operation.title,
      description: "Use the configured server and original user/membership. Preview/draft return immutable terms; activation requires explicit recurring acceptance of that hash, original caller key and fresh human OTP, never an API key alone. Unconfirmed mutations retain their recovery directory; only explicit same-request recovery is allowed. Revocation leaves already-authorized exposure; cancellation is separate. Sessions are never persisted or returned. The host may retain supplied OTP tool arguments; use the masked terminal flow if that is unsuitable.",
      annotations: { readOnlyHint: operation.read, destructiveHint: !operation.read,
        idempotentHint: operation.action !== "preview" && operation.action !== "verification" },
      inputSchema: recurringMcpSchema(operation.action),
    }, async (input: Record<string, unknown>) => {
      try {
        const result = await executeRecurringSurface(operation.action, input);
        return { ...mcpJson(result), ...(result && typeof result === "object" && "outcomeUnknown" in result && result.outcomeUnknown ? { isError: true } : {}) };
      } catch (error) { return { ...mcpJson({ ...recurringCustomerError(error),
        ...(typeof input.recoveryDirectory === "string" ? { recoveryDirectory: input.recoveryDirectory } : {}) }), isError: true }; }
    });
  }
}
