import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };

import { getSkill, loadRegistryProfile } from "../lib/registry.js";
import { getSkillBestDoc, getSkillRequirements } from "../lib/skillinfo.js";
import { saveFeedback, type FeedbackCategory } from "../lib/feedback.js";
import {
  createMcpContractManifest,
  createSkillMcpMetadata,
  describeMcpToolContracts,
  listMcpToolContracts,
  summarizeMcpToolContract,
} from "../lib/mcp-contracts.js";
import {
  getCompactSkillDiscovery,
  getPublicSkillDiscovery,
  publicDiscoveryDependencies,
  publicDiscoveryDocumentation,
  publicDiscoveryEnvVars,
} from "../lib/discovery.js";
import { mcpError, mcpJson } from "./helpers.js";

export function registerResourceMetaTools(server: McpServer): void {
  // ---- Resources ----

  server.registerResource("MCP Contracts", "skills://mcp/contracts", {
    description: "Machine-readable MCP tool and resource contract manifest.",
  }, async () => ({
    contents: [{
      uri: "skills://mcp/contracts",
      text: JSON.stringify(createMcpContractManifest(), null, 2),
      mimeType: "application/json",
    }],
  }));

  server.registerResource("Skills Registry", "skills://registry", {
    description: "Compact default basic skill list [{name,category,pricing}]. Use list_skills with profile:'all' for the full registry, and skills://{name} for detail.",
  }, async () => ({
    contents: [{
      uri: "skills://registry",
      text: JSON.stringify(loadRegistryProfile("basic").map(getCompactSkillDiscovery)),
      mimeType: "application/json",
    }],
  }));

  server.registerResource(
    "Skill Info",
    new ResourceTemplate("skills://{name}", { list: undefined }),
    {
      description: "Individual skill metadata and documentation",
    },
    async (uri, { name }) => {
      const skill = getSkill(name as string);
      const doc = getSkillBestDoc(name as string);
      const reqs = getSkillRequirements(name as string);
      const publicReqs = skill && reqs ? {
        ...reqs,
        envVars: publicDiscoveryEnvVars(skill.name, reqs.envVars),
        dependencies: publicDiscoveryDependencies(skill.name, reqs.dependencies),
      } : reqs;

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            ...(skill ? getPublicSkillDiscovery(skill) : {}),
            documentation: skill ? publicDiscoveryDocumentation(skill, doc) : doc,
            requirements: publicReqs,
            ...(skill ? { mcp: createSkillMcpMetadata(getPublicSkillDiscovery(skill)) } : {}),
          }, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // ---- Meta tools (token optimization: search then describe on demand) ----

  server.registerTool("search_tools", {
    title: "Search Tools",
    description: "List tool names or summaries, optionally filtered by keyword.",
    inputSchema: { query: z.string().optional(), detail: z.boolean().optional() },
  }, async ({ query, detail }) => {
    const contracts = listMcpToolContracts(query);
    const tools = detail
      ? contracts.map(summarizeMcpToolContract)
      : contracts.map((contract) => contract.name);
    return mcpJson({ schemaVersion: 1, tools, total: tools.length });
  });

  server.registerTool("describe_tools", {
    title: "Describe Tools",
    description: "Get machine-readable contracts for specific tools by name.",
    inputSchema: { names: z.array(z.string()) },
  }, async ({ names }) => {
    return mcpJson({ schemaVersion: 1, tools: describeMcpToolContracts(names) });
  });

  server.registerTool("get_mcp_contracts", {
    title: "Get MCP Contracts",
    description: "Return the machine-readable MCP tool and resource contract manifest.",
    inputSchema: {
      names: z.array(z.string()).optional(),
      includeResources: z.boolean().optional(),
    },
  }, async ({ names, includeResources }) => {
    return mcpJson(createMcpContractManifest({
      names,
      includeResources: includeResources ?? false,
    }));
  });

  // ---- Start server ----


  const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string }>();

  server.tool(
    "register_agent",
    "Register this agent session. Returns agent_id for use in heartbeat/set_focus.",
    { name: z.string(), session_id: z.string().optional() },
    async (a: { name: string; session_id?: string }) => {
      const existing = [..._agentReg.values()].find(x => x.name === a.name);
      if (existing) {
        existing.last_seen_at = new Date().toISOString();
        return mcpJson({ ...existing, registered: false });
      }
      const id = Math.random().toString(36).slice(2, 10);
      const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
      _agentReg.set(id, ag);
      return mcpJson({ ...ag, registered: true });
    }
  );

  server.tool(
    "heartbeat",
    "Update last_seen_at to signal agent is active.",
    { agent_id: z.string() },
    async (a: { agent_id: string }) => {
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return mcpError("AGENT_NOT_FOUND", `Agent not found: ${a.agent_id}`);
      ag.last_seen_at = new Date().toISOString();
      return mcpJson({ agent_id: a.agent_id, name: ag.name, active: true, last_seen_at: ag.last_seen_at });
    }
  );

  server.tool(
    "set_focus",
    "Set active project context for this agent session.",
    { agent_id: z.string(), project_id: z.string().optional() },
    async (a: { agent_id: string; project_id?: string }) => {
      const ag = _agentReg.get(a.agent_id);
      if (!ag) return mcpError("AGENT_NOT_FOUND", `Agent not found: ${a.agent_id}`);
      (ag as any).project_id = a.project_id;
      return mcpJson({ agent_id: a.agent_id, project_id: a.project_id ?? null });
    }
  );

  server.tool(
    "list_agents",
    "List all registered agents.",
    {},
    async () => {
      const agents = [..._agentReg.values()];
      return mcpJson({ agents, total: agents.length }, true);
    }
  );

  server.tool(
    "send_feedback",
    "Send feedback about this service",
    { message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional() },
    async (params: { message: string; email?: string; category?: FeedbackCategory }) => {
      try {
        const result = saveFeedback({ ...params, version: pkg.version });
        return mcpJson(result);
      } catch (e) {
        return mcpError("FEEDBACK_SAVE_FAILED", String(e));
      }
    }
  );

}
