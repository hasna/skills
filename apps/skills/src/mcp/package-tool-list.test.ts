import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };

import { useDefaultTestTimeout } from "../test-preload.js";
import { RemoteSkillsAuthClient } from "../lib/remote-auth.js";
import { registerInvitationRecoveryTools } from "./invitation-recovery.js";
import { legacyInputSchema, servePackageZodToolList } from "./package-tool-list.js";
import { buildServer, registerSkillsTools } from "./server.js";

useDefaultTestTimeout();

// In this checkout the MCP SDK and the package resolve the same zod, so the
// SDK's own tools/list is the reference. Ours must match it exactly, while
// never depending on the SDK's conversion (bin/mcp.js bundles its own zod).

async function listTools(server: McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "package-tool-list-test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try { return (await client.listTools()).tools; }
  finally { await client.close(); await server.close(); }
}

function sdkReference(register: (server: McpServer) => void, name = "skills"): McpServer {
  const server = new McpServer({ name, version: pkg.version });
  register(server);
  return server;
}

const LEGACY_TOOLS = ["register_agent", "heartbeat", "set_focus", "list_agents", "send_feedback"];

test("tools/list matches the SDK's own conversion for every Skills tool, legacy tool() ones included", async () => {
  const reference = await listTools(sdkReference(registerSkillsTools));
  const ours = await listTools(buildServer());
  expect(reference.length).toBeGreaterThan(0);
  expect(ours.map(tool => tool.name)).toEqual(reference.map(tool => tool.name));
  for (const name of LEGACY_TOOLS) expect(ours.some(tool => tool.name === name)).toBe(true);
  expect(ours).toEqual(reference);
  expect(JSON.stringify(ours)).toBe(JSON.stringify(reference));
});

test("tools/list matches the SDK's own conversion for the invitation recovery tools", async () => {
  const register = (server: McpServer) => registerInvitationRecoveryTools(server,
    new RemoteSkillsAuthClient("https://skills.example.test"), { unchanged() {} });
  const reference = await listTools(sdkReference(register, "skills-invitation-recovery"));
  const server = new McpServer({ name: "skills-invitation-recovery", version: pkg.version });
  servePackageZodToolList(server);
  register(server);
  const ours = await listTools(server);
  expect(ours.map(tool => tool.name)).toEqual(["request_invitation_email_challenge", "accept_invitation_email_challenge"]);
  expect(JSON.stringify(ours)).toBe(JSON.stringify(reference));
});

test("tools/list never uses the SDK's conversion of the registered schemas", async () => {
  // Stand-in for an SDK whose zod cannot convert the package's schemas.
  const poison = (server: McpServer) => {
    const registry = (server as unknown as { _registeredTools: Record<string, { inputSchema?: unknown }> })._registeredTools;
    expect(Object.keys(registry).length).toBeGreaterThan(0);
    for (const tool of Object.values(registry)) {
      if (tool.inputSchema) tool.inputSchema = new Proxy({}, { has: () => true, get: () => { throw new Error("SDK schema conversion used"); } });
    }
  };
  const expected = await listTools(buildServer());
  const reference = sdkReference(registerSkillsTools);
  poison(reference);
  await expect(listTools(reference)).rejects.toThrow();
  const ours = buildServer();
  poison(ours);
  expect(await listTools(ours)).toEqual(expected);
});

test("every registration form and tool update lists exactly as the SDK lists it", async () => {
  const handler = async () => ({ content: [] });
  const register = (server: McpServer) => {
    const tools = {
      a: server.tool("a", handler),
      b: server.tool("b", "Description only.", handler),
      c: server.tool("c", { x: z.string() }, handler),
      d: server.tool("d", "Shape.", { x: z.number().optional(), y: z.enum(["one", "two"]) }, handler),
      e: server.tool("e", { x: z.string().describe("Field.") }, { readOnlyHint: true }, handler),
      f: server.tool("f", "Shape and annotations.", { x: z.array(z.string()).min(1) }, { destructiveHint: false }, handler),
      g: server.tool("g", { readOnlyHint: true }, handler),
      h: server.tool("h", "Empty shape.", {}, handler),
      i: server.registerTool("i", { title: "Object", description: "Strict object.", inputSchema: z.object({ id: z.string().uuid(), n: z.number().int().default(3) }).strict(),
        annotations: { idempotentHint: true } }, handler),
      j: server.registerTool("j", { description: "No input." }, handler),
      k: server.registerTool("k", { inputSchema: { flag: z.boolean(), map: z.record(z.string(), z.number()) }, outputSchema: { ok: z.boolean() }, _meta: { origin: "test" } },
        async () => ({ content: [], structuredContent: { ok: true } })),
      l: server.registerTool("l", { inputSchema: z.object({ when: z.string().transform(value => value.length) }) }, handler),
    };
    tools.c.disable();
    tools.d.update({ name: "d-renamed", description: "Renamed." });
    tools.e.update({ paramsSchema: { y: z.literal(true) } });
    tools.g.remove();
    tools.j.update({ outputSchema: { count: z.number() } });
  };
  const reference = await listTools(sdkReference(register, "fixture"));
  const server = new McpServer({ name: "fixture", version: pkg.version });
  servePackageZodToolList(server);
  register(server);
  const ours = await listTools(server);
  expect(ours.map(tool => tool.name)).toEqual(["a", "b", "e", "f", "h", "i", "j", "k", "l", "d-renamed"]);
  expect(JSON.stringify(ours)).toBe(JSON.stringify(reference));
});

test("the SDK still refuses invalid arguments with -32602, including on .strict() tools", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  const client = new Client({ name: "package-tool-list-test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const uuid = "00000000-0000-4000-8000-000000000001";
  const accept = { userId: uuid, membershipId: uuid, email: "member@example.test", code: "000000", invitationId: uuid,
    token: "t".repeat(43), confirm: true };
  const refusal = async (name: string, args: Record<string, unknown>) => {
    try {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      return JSON.stringify(result.content);
    } catch (error) {
      return `MCP error ${(error as { code?: number }).code}: ${(error as Error).message}`;
    }
  };
  try {
    for (const [name, args, field] of [
      ["list_skills", { limit: "one" }, "limit"],
      ["accept_workspace_invitation", { ...accept, confirm: false }, "confirm"],
      ["accept_workspace_invitation", { ...accept, unexpectedKey: true }, "unexpectedKey"],
    ] as const) {
      const text = await refusal(name, args);
      expect(text).toContain("-32602");
      expect(text).toContain(field);
    }
  } finally { await client.close(); await server.close(); }
});

test("the positional tool() form takes its input schema where the SDK does", () => {
  const shape = { x: z.string() }, annotations = { readOnlyHint: true }, cb = () => undefined;
  expect(legacyInputSchema([cb])).toBeUndefined();
  expect(legacyInputSchema(["Description.", cb])).toBeUndefined();
  expect(legacyInputSchema([shape, cb])).toBe(shape);
  expect(legacyInputSchema(["Description.", shape, cb])).toBe(shape);
  expect(legacyInputSchema([shape, annotations, cb])).toBe(shape);
  expect(legacyInputSchema(["Description.", shape, annotations, cb])).toBe(shape);
  expect(legacyInputSchema([annotations, cb])).toBeUndefined();
  const empty = {};
  expect(legacyInputSchema(["Description.", empty, cb])).toBe(empty);
  expect(legacyInputSchema([z.object(shape), cb])).toBeUndefined();
});
