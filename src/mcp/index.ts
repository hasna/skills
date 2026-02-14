#!/usr/bin/env bun
/**
 * MCP server for the skills library.
 * Exposes tools for listing, searching, and installing skills.
 *
 * Usage:
 *   skills mcp          # Start MCP server on stdio
 *   skills-mcp          # Direct binary
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  SKILLS,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
} from "../lib/registry.js";
import {
  installSkill,
  installSkillForAgent,
  removeSkill,
  removeSkillForAgent,
  AGENT_TARGETS,
  type AgentTarget,
} from "../lib/installer.js";
import {
  getSkillDocs,
  getSkillBestDoc,
  getSkillRequirements,
  generateSkillMd,
} from "../lib/skillinfo.js";

const server = new McpServer({
  name: "skills",
  version: "0.0.1",
});

// ---- Tools ----

server.registerTool("list_skills", {
  title: "List Skills",
  description: "List all available skills, optionally filtered by category",
  inputSchema: {
    category: z.string().optional().describe("Filter by category name"),
  },
}, async ({ category }) => {
  const skills = category
    ? getSkillsByCategory(category)
    : SKILLS;

  return {
    content: [{ type: "text", text: JSON.stringify(skills, null, 2) }],
  };
});

server.registerTool("search_skills", {
  title: "Search Skills",
  description: "Search skills by query string (matches name, description, and tags)",
  inputSchema: {
    query: z.string().describe("Search query"),
  },
}, async ({ query }) => {
  const results = searchSkills(query);
  return {
    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
  };
});

server.registerTool("get_skill_info", {
  title: "Get Skill Info",
  description: "Get detailed metadata about a skill including requirements, env vars, and dependencies",
  inputSchema: {
    name: z.string().describe("Skill name (e.g. 'image', 'deep-research')"),
  },
}, async ({ name }) => {
  const skill = getSkill(name);
  if (!skill) {
    return { content: [{ type: "text", text: `Skill '${name}' not found` }], isError: true };
  }

  const reqs = getSkillRequirements(name);
  return {
    content: [{ type: "text", text: JSON.stringify({ ...skill, ...reqs }, null, 2) }],
  };
});

server.registerTool("get_skill_docs", {
  title: "Get Skill Docs",
  description: "Get documentation for a skill (SKILL.md, README.md, or CLAUDE.md)",
  inputSchema: {
    name: z.string().describe("Skill name"),
  },
}, async ({ name }) => {
  const doc = getSkillBestDoc(name);
  if (!doc) {
    return { content: [{ type: "text", text: `No documentation found for '${name}'` }], isError: true };
  }
  return { content: [{ type: "text", text: doc }] };
});

server.registerTool("install_skill", {
  title: "Install Skill",
  description: "Install a skill. Without --for, installs full source to .skills/. With --for, copies SKILL.md to agent skill directory.",
  inputSchema: {
    name: z.string().describe("Skill name to install"),
    for: z.string().optional().describe("Agent target: claude, codex, gemini, or all"),
    scope: z.string().optional().describe("Install scope: global or project (default: global)"),
  },
}, async ({ name, for: agent, scope }) => {
  if (agent) {
    const agents: AgentTarget[] = agent === "all"
      ? [...AGENT_TARGETS]
      : [agent as AgentTarget];

    const results = agents.map(a =>
      installSkillForAgent(name, { agent: a, scope: (scope as "global" | "project") || "global" }, generateSkillMd)
    );

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      isError: results.some(r => !r.success),
    };
  }

  const result = installSkill(name);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
});

server.registerTool("remove_skill", {
  title: "Remove Skill",
  description: "Remove an installed skill. Without --for, removes from .skills/. With --for, removes from agent skill directory.",
  inputSchema: {
    name: z.string().describe("Skill name to remove"),
    for: z.string().optional().describe("Agent target: claude, codex, gemini, or all"),
    scope: z.string().optional().describe("Remove scope: global or project (default: global)"),
  },
}, async ({ name, for: agent, scope }) => {
  if (agent) {
    const agents: AgentTarget[] = agent === "all"
      ? [...AGENT_TARGETS]
      : [agent as AgentTarget];

    const results = agents.map(a => ({
      skill: name,
      agent: a,
      removed: removeSkillForAgent(name, { agent: a, scope: (scope as "global" | "project") || "global" }),
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  const removed = removeSkill(name);
  return {
    content: [{ type: "text", text: JSON.stringify({ skill: name, removed }, null, 2) }],
  };
});

server.registerTool("list_categories", {
  title: "List Categories",
  description: "List all skill categories with counts",
}, async () => {
  const cats = CATEGORIES.map(category => ({
    name: category,
    count: getSkillsByCategory(category).length,
  }));
  return { content: [{ type: "text", text: JSON.stringify(cats, null, 2) }] };
});

server.registerTool("get_requirements", {
  title: "Get Requirements",
  description: "Get environment variables, system dependencies, and npm dependencies for a skill",
  inputSchema: {
    name: z.string().describe("Skill name"),
  },
}, async ({ name }) => {
  const reqs = getSkillRequirements(name);
  if (!reqs) {
    return { content: [{ type: "text", text: `Skill '${name}' not found` }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(reqs, null, 2) }] };
});

// ---- Resources ----

server.registerResource("Skills Registry", "skills://registry", {
  description: "Full list of all available skills as JSON",
}, async () => ({
  contents: [{
    uri: "skills://registry",
    text: JSON.stringify(SKILLS, null, 2),
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

    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify({ ...skill, documentation: doc, requirements: reqs }, null, 2),
        mimeType: "application/json",
      }],
    };
  }
);

// ---- Start server ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
