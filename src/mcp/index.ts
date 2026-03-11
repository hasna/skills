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
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import {
  SKILLS,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
  type Category,
} from "../lib/registry.js";
import {
  installSkill,
  installSkillForAgent,
  getInstalledSkills,
  removeSkill,
  removeSkillForAgent,
  resolveAgents,
  getSkillPath,
  type AgentTarget,
} from "../lib/installer.js";
import {
  getSkillDocs,
  getSkillBestDoc,
  getSkillRequirements,
  generateSkillMd,
  runSkill,
} from "../lib/skillinfo.js";

const server = new McpServer({
  name: "skills",
  version: pkg.version,
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
    ? getSkillsByCategory(category as Category)
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
}, async ({ name, for: agentArg, scope }) => {
  if (agentArg) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(agentArg);
    } catch (err) {
      return {
        content: [{ type: "text", text: (err as Error).message }],
        isError: true,
      };
    }

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

server.registerTool("install_category", {
  title: "Install Category",
  description: "Install all skills in a category. Optionally install for a specific agent (claude, codex, gemini, or all) with a given scope.",
  inputSchema: {
    category: z.string().describe("Category name (case-insensitive, e.g. 'Event Management')"),
    for: z.string().optional().describe("Agent target: claude, codex, gemini, or all"),
    scope: z.string().optional().describe("Install scope: global or project (default: global)"),
  },
}, async ({ category, for: agentArg, scope }) => {
  // Validate category
  const matchedCategory = CATEGORIES.find(
    (c) => c.toLowerCase() === category.toLowerCase()
  );
  if (!matchedCategory) {
    return {
      content: [{ type: "text", text: `Unknown category: ${category}. Available: ${CATEGORIES.join(", ")}` }],
      isError: true,
    };
  }

  const categorySkills = getSkillsByCategory(matchedCategory as Category);
  const names = categorySkills.map((s) => s.name);

  if (agentArg) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(agentArg);
    } catch (err) {
      return {
        content: [{ type: "text", text: (err as Error).message }],
        isError: true,
      };
    }

    const results = [];
    for (const name of names) {
      for (const a of agents) {
        const r = installSkillForAgent(name, { agent: a, scope: (scope as "global" | "project") || "global" }, generateSkillMd);
        results.push({ ...r, agent: a, scope: scope || "global" });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ category: matchedCategory, count: names.length, results }, null, 2) }],
      isError: results.some(r => !r.success),
    };
  }

  // Full source install
  const results = names.map(name => installSkill(name));
  return {
    content: [{ type: "text", text: JSON.stringify({ category: matchedCategory, count: names.length, results }, null, 2) }],
    isError: results.some(r => !r.success),
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
}, async ({ name, for: agentArg, scope }) => {
  if (agentArg) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(agentArg);
    } catch (err) {
      return {
        content: [{ type: "text", text: (err as Error).message }],
        isError: true,
      };
    }

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

server.registerTool("list_tags", {
  title: "List Tags",
  description: "List all unique tags across all skills with their occurrence counts",
}, async () => {
  const tagCounts = new Map<string, number>();
  for (const skill of SKILLS) {
    for (const tag of skill.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const sorted = Array.from(tagCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }));
  return { content: [{ type: "text", text: JSON.stringify(sorted, null, 2) }] };
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

server.registerTool("run_skill", {
  title: "Run Skill",
  description: "Run a skill by name with optional arguments. Returns the exit code and any error message.",
  inputSchema: {
    name: z.string().describe("Skill name to run"),
    args: z.array(z.string()).optional().describe("Arguments to pass to the skill"),
  },
}, async ({ name, args }) => {
  const skill = getSkill(name);
  if (!skill) {
    return { content: [{ type: "text", text: `Skill '${name}' not found` }], isError: true };
  }

  const result = await runSkill(name, args || []);
  if (result.error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ exitCode: result.exitCode, error: result.error }, null, 2) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ exitCode: result.exitCode, skill: name }, null, 2) }],
  };
});

server.registerTool("export_skills", {
  title: "Export Skills",
  description: "Export the list of currently installed skills as a JSON payload that can be imported elsewhere",
}, async () => {
  const skills = getInstalledSkills();
  const payload = {
    version: 1,
    skills,
    timestamp: new Date().toISOString(),
  };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
});

server.registerTool("import_skills", {
  title: "Import Skills",
  description: "Install a list of skills from an export payload. Supports agent-specific installs via the 'for' parameter.",
  inputSchema: {
    skills: z.array(z.string()).describe("List of skill names to install"),
    for: z.string().optional().describe("Agent target: claude, codex, gemini, or all"),
    scope: z.string().optional().describe("Install scope: global or project (default: global)"),
  },
}, async ({ skills: skillList, for: agentArg, scope }) => {
  if (!skillList || skillList.length === 0) {
    return { content: [{ type: "text", text: JSON.stringify({ imported: 0, results: [] }, null, 2) }] };
  }

  const results: Array<{ skill: string; success: boolean; error?: string }> = [];

  if (agentArg) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(agentArg);
    } catch (err) {
      return {
        content: [{ type: "text", text: (err as Error).message }],
        isError: true,
      };
    }

    for (const name of skillList) {
      const agentResults = agents.map((a) =>
        installSkillForAgent(name, { agent: a, scope: (scope as "global" | "project") || "global" }, generateSkillMd)
      );
      const success = agentResults.every((r) => r.success);
      const errors = agentResults.filter((r) => !r.success).map((r) => r.error).filter(Boolean);
      results.push({ skill: name, success, ...(errors.length > 0 ? { error: errors.join("; ") } : {}) });
    }
  } else {
    for (const name of skillList) {
      const result = installSkill(name);
      results.push({ skill: result.skill, success: result.success, ...(result.error ? { error: result.error } : {}) });
    }
  }

  const imported = results.filter((r) => r.success).length;
  const hasErrors = results.some((r) => !r.success);

  return {
    content: [{ type: "text", text: JSON.stringify({ imported, total: skillList.length, results }, null, 2) }],
    isError: hasErrors,
  };
});

server.registerTool("whoami", {
  title: "Skills Whoami",
  description: "Show setup summary: package version, installed skills, agent configurations, skills directory location, and working directory",
}, async () => {
  const version = pkg.version;
  const cwd = process.cwd();

  const installed = getInstalledSkills();

  const agentNames = ["claude", "codex", "gemini"] as const;
  const agents: Array<{ agent: string; path: string; exists: boolean; skillCount: number }> = [];
  for (const agent of agentNames) {
    const agentSkillsPath = join(homedir(), `.${agent}`, "skills");
    const exists = existsSync(agentSkillsPath);
    let skillCount = 0;
    if (exists) {
      try {
        skillCount = readdirSync(agentSkillsPath).filter((f) => {
          const full = join(agentSkillsPath, f);
          return f.startsWith("skill-") && statSync(full).isDirectory();
        }).length;
      } catch {}
    }
    agents.push({ agent, path: agentSkillsPath, exists, skillCount });
  }

  const skillsDir = getSkillPath("image").replace(/[/\\][^/\\]*$/, "");

  const result = {
    version,
    installedCount: installed.length,
    installed,
    agents,
    skillsDir,
    cwd,
  };

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
