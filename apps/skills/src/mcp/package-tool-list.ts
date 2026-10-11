import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Serve tools/list with JSON Schema converted by this package's own zod.
 *
 * bin/mcp.js bundles zod but loads the MCP SDK from the consumer's
 * node_modules, and the SDK may resolve a different zod. The SDK's own
 * tools/list converts each input schema with its zod; when that zod is older
 * than the one that built the schema it fails (`ctx.deferred.push`) or
 * advertises degraded schemas. This records the schemas each tool is
 * registered with and converts them exactly as the SDK does (draft-7, `io`
 * input/output, raw shapes as objects), but with the zod that built them.
 * Argument validation for tools/call stays with the SDK.
 *
 * Call it right after constructing the server and before registering tools.
 * Both `registerTool` and the positional `tool()` form are covered.
 */
export function servePackageZodToolList(server: McpServer): void {
  const tools = new Map<string, { tool: RegisteredTool; input: unknown; output: unknown }>();
  let installed = false;

  const track = (name: string, tool: RegisteredTool, input: unknown, output: unknown) => {
    tools.set(name, { tool, input, output });
    const update = tool.update.bind(tool);
    // Keep the record in step with the SDK's own registry (rename, removal, new schemas).
    tool.update = ((updates: Parameters<RegisteredTool["update"]>[0]) => {
      update(updates);
      const entry = tools.get(name);
      if (!entry) return;
      if (updates.paramsSchema !== undefined) entry.input = updates.paramsSchema;
      if (updates.outputSchema !== undefined) entry.output = updates.outputSchema;
      if (updates.name !== undefined && updates.name !== name) {
        tools.delete(name);
        if (updates.name) { name = updates.name; tools.set(name, entry); }
      }
    }) as RegisteredTool["update"];
    // The SDK installs its tools/list handler at the first registration; replace it once.
    if (!installed) {
      installed = true;
      server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listTools(tools) }));
    }
  };

  const registerTool = server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, cb: unknown) => RegisteredTool;
  server.registerTool = ((name: string, config: Record<string, unknown>, cb: unknown) => {
    const tool = registerTool(name, config, cb);
    track(name, tool, config.inputSchema, config.outputSchema);
    return tool;
  }) as McpServer["registerTool"];

  const legacyTool = server.tool.bind(server) as (name: string, ...rest: unknown[]) => RegisteredTool;
  server.tool = ((name: string, ...rest: unknown[]) => {
    const tool = legacyTool(name, ...rest);
    track(name, tool, legacyInputSchema(rest), undefined);
    return tool;
  }) as McpServer["tool"];
}

function listTools(tools: Map<string, { tool: RegisteredTool; input: unknown; output: unknown }>): Tool[] {
  return [...tools].filter(([, entry]) => entry.tool.enabled).map(([name, { tool, input, output }]) => {
    // Same fields and order as the SDK's own tools/list.
    const definition: Record<string, unknown> = {
      name,
      title: tool.title,
      description: tool.description,
      inputSchema: jsonSchema(input, "input") ?? EMPTY_OBJECT_JSON_SCHEMA,
      annotations: tool.annotations,
      execution: tool.execution,
      _meta: tool._meta,
    };
    const outputSchema = jsonSchema(output, "output");
    if (outputSchema) definition.outputSchema = outputSchema;
    return definition as Tool;
  });
}

/** The SDK's schema for a tool registered without input. */
const EMPTY_OBJECT_JSON_SCHEMA = { type: "object" as const, properties: {} };

function isZodTypeLike(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && typeof (value as { parse?: unknown }).parse === "function" && typeof (value as { safeParse?: unknown }).safeParse === "function";
}

/** The SDK's raw-shape test: a plain object of schemas, or an empty object. */
function isRawShape(value: unknown): value is z.ZodRawShape {
  if (typeof value !== "object" || value === null || "_def" in value || "_zod" in value || isZodTypeLike(value)) return false;
  const values = Object.values(value);
  return values.length === 0 || values.some(isZodTypeLike);
}

/** The input schema the SDK's positional `tool()` form takes from its arguments. */
export function legacyInputSchema(rest: readonly unknown[]): unknown {
  const args = [...rest];
  if (typeof args[0] === "string") args.shift();
  return args.length > 1 && isRawShape(args[0]) ? args[0] : undefined;
}

function jsonSchema(schema: unknown, io: "input" | "output"): Tool["inputSchema"] | undefined {
  if (schema === undefined || schema === null) return undefined;
  const object = isRawShape(schema) ? z.object(schema) : schema;
  const def = (object as { _zod?: { def?: { type?: unknown; shape?: unknown } } })._zod?.def;
  if (!def) throw new Error("Skills MCP tool schemas must be built with this package's zod 4");
  // The SDK lists only object schemas; anything else is advertised as an empty object.
  if (def.type !== "object" && def.shape === undefined) return undefined;
  return z.toJSONSchema(object as z.ZodType, { target: "draft-7", io }) as Tool["inputSchema"];
}
