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
  findSimilarSkills,
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

/** Strip null/undefined/empty-array fields to reduce token usage */
function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) =>
      v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
    )
  );
}

/** Simple LRU cache for search results */
const searchCache = new Map<string, unknown>();
const CACHE_MAX = 100;
function cacheGet(key: string): unknown | undefined { return searchCache.get(key); }
function cacheSet(key: string, value: unknown): void {
  if (searchCache.size >= CACHE_MAX) {
    const first = searchCache.keys().next().value;
    if (first !== undefined) searchCache.delete(first);
  }
  searchCache.set(key, value);
}
function cacheClear(): void { searchCache.clear(); }

/** Structured MCP error response */
function mcpError(code: string, message: string, suggestions?: string[]) {
  const obj: { code: string; message: string; suggestions?: string[] } = { code, message };
  if (suggestions && suggestions.length > 0) obj.suggestions = suggestions;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
    isError: true,
  };
}

// ---- Tools ----

server.registerTool("list_skills", {
  title: "List Skills",
  description: "List skills. Returns {name,category} by default; detail:true for full objects. Supports limit/offset pagination.",
  inputSchema: {
    category: z.string().optional(),
    detail: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  },
}, async ({ category, detail, limit, offset }) => {
  const skills = category
    ? getSkillsByCategory(category as Category)
    : SKILLS;

  const mapped = detail
    ? skills
    : skills.map(s => ({ name: s.name, category: s.category }));

  if (limit !== undefined || offset !== undefined) {
    const start = offset || 0;
    const sliced = limit !== undefined ? mapped.slice(start, start + limit) : mapped.slice(start);
    return {
      content: [{ type: "text", text: JSON.stringify({ skills: sliced, total: mapped.length, offset: start, limit: limit ?? null }) }],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(mapped) }],
  };
});

server.registerTool("list_installed_skills", {
  title: "List Installed Skills",
  description: "List skills installed in the current project's .skills/ directory.",
  inputSchema: {
    directory: z.string().optional(),
  },
}, async ({ directory }) => {
  const dir = directory || process.cwd();
  const installed = getInstalledSkills(dir);
  return {
    content: [{ type: "text", text: JSON.stringify({ directory: dir, count: installed.length, skills: installed }) }],
  };
});

server.registerTool("search_skills", {
  title: "Search Skills",
  description: "Search skills by name, description, or tags. Returns compact list by default. Supports limit/offset pagination.",
  inputSchema: {
    query: z.string(),
    detail: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  },
}, async ({ query, detail, limit, offset }) => {
  const cacheKey = `${query}:${detail ?? false}`;
  const cached = cacheGet(cacheKey);
  const results = cached ? cached as typeof SKILLS : searchSkills(query);
  if (!cached) cacheSet(cacheKey, results);
  const out = detail
    ? results
    : results.map(s => ({ name: s.name, category: s.category }));

  if (limit !== undefined || offset !== undefined) {
    const start = offset || 0;
    const sliced = limit !== undefined ? out.slice(start, start + limit) : out.slice(start);
    return {
      content: [{ type: "text", text: JSON.stringify({ skills: sliced, total: out.length, offset: start, limit: limit ?? null }) }],
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(out) }],
  };
});

server.registerTool("get_skill_info", {
  title: "Get Skill Info",
  description: "Get skill metadata, env vars, and dependencies.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  const skill = getSkill(name);
  if (!skill) {
    return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
  }
  const reqs = getSkillRequirements(name);
  const result = stripNulls({ ...skill, ...reqs });
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
});

server.registerTool("get_skill_docs", {
  title: "Get Skill Docs",
  description: "Get skill documentation (SKILL.md > README.md > CLAUDE.md).",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  const doc = getSkillBestDoc(name);
  if (!doc) {
    return mcpError("NO_DOCS", `No documentation found for '${name}'`);
  }
  return { content: [{ type: "text", text: doc }] };
});

server.registerTool("install_skill", {
  title: "Install Skill",
  description: "Install a skill to .skills/ or to an agent dir (for: claude|codex|gemini|all).",
  inputSchema: {
    name: z.string(),
    for: z.string().optional(),
    scope: z.string().optional(),
  },
}, async ({ name, for: agentArg, scope }) => {
  if (agentArg) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(agentArg);
    } catch (err) {
      return mcpError("INVALID_AGENT", (err as Error).message, ["claude", "codex", "gemini", "all"]);
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
  if (result.success) cacheClear();
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
});

server.registerTool("install_category", {
  title: "Install Category",
  description: "Install all skills in a category, optionally for a specific agent.",
  inputSchema: {
    category: z.string(),
    for: z.string().optional(),
    scope: z.string().optional(),
  },
}, async ({ category, for: agentArg, scope }) => {
  // Validate category
  const matchedCategory = CATEGORIES.find(
    (c) => c.toLowerCase() === category.toLowerCase()
  );
  if (!matchedCategory) {
    return {
      ...mcpError("UNKNOWN_CATEGORY", `Unknown category: ${category}`, CATEGORIES.slice()),
    };
  }

  const categorySkills = getSkillsByCategory(matchedCategory as Category);
  const names = categorySkills.map((s) => s.name);

  if (agentArg) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(agentArg);
    } catch (err) {
      return mcpError("INVALID_AGENT", (err as Error).message, ["claude", "codex", "gemini", "all"]);
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
  description: "Remove a skill from .skills/ or from an agent dir.",
  inputSchema: {
    name: z.string(),
    for: z.string().optional(),
    scope: z.string().optional(),
  },
}, async ({ name, for: agentArg, scope }) => {
  if (agentArg) {
    let agents: AgentTarget[];
    try {
      agents = resolveAgents(agentArg);
    } catch (err) {
      return mcpError("INVALID_AGENT", (err as Error).message, ["claude", "codex", "gemini", "all"]);
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
  if (removed) cacheClear();
  return {
    content: [{ type: "text", text: JSON.stringify({ skill: name, removed }, null, 2) }],
  };
});

server.registerTool("list_categories", {
  title: "List Categories",
  description: "List all 17 skill categories with skill counts.",
}, async () => {
  const cats = CATEGORIES.map(category => ({
    name: category,
    count: getSkillsByCategory(category).length,
  }));
  return { content: [{ type: "text", text: JSON.stringify(cats, null, 2) }] };
});

server.registerTool("list_tags", {
  title: "List Tags",
  description: "List all unique skill tags with occurrence counts.",
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
  description: "Get env vars, system deps, and npm dependencies for a skill.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  const reqs = getSkillRequirements(name);
  if (!reqs) {
    return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
  }
  return { content: [{ type: "text", text: JSON.stringify(reqs, null, 2) }] };
});

server.registerTool("run_skill", {
  title: "Run Skill",
  description: "Run a skill by name with optional arguments.",
  inputSchema: {
    name: z.string(),
    args: z.array(z.string()).optional(),
  },
}, async ({ name, args }) => {
  const skill = getSkill(name);
  if (!skill) {
    return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
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
  description: "Export installed skills as a JSON payload for import elsewhere.",
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
  description: "Install skills from an export payload. Supports agent installs via 'for'.",
  inputSchema: {
    skills: z.array(z.string()),
    for: z.string().optional(),
    scope: z.string().optional(),
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
      return mcpError("INVALID_AGENT", (err as Error).message, ["claude", "codex", "gemini", "all"]);
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
  description: "Show setup summary: version, installed skills, agent configs, cwd.",
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
  description: "Compact skill list [{name,category}]. Use skills://{name} for detail.",
}, async () => ({
  contents: [{
    uri: "skills://registry",
    text: JSON.stringify(SKILLS.map(s => ({ name: s.name, category: s.category }))),
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

// ---- Meta tools (token optimization: search then describe on demand) ----

server.registerTool("search_tools", {
  title: "Search Tools",
  description: "List tool names, optionally filtered by keyword.",
  inputSchema: { query: z.string().optional() },
}, async ({ query }) => {
  const all = [
    "list_skills", "list_installed_skills", "search_skills", "get_skill_info", "get_skill_docs",
    "install_skill", "install_category", "remove_skill",
    "list_categories", "list_tags", "get_requirements",
    "run_skill", "export_skills", "import_skills", "whoami",
    "search_tools", "describe_tools",
  ];
  const matches = query ? all.filter(n => n.includes(query.toLowerCase())) : all;
  return { content: [{ type: "text", text: matches.join(", ") }] };
});

server.registerTool("describe_tools", {
  title: "Describe Tools",
  description: "Get descriptions for specific tools by name.",
  inputSchema: { names: z.array(z.string()) },
}, async ({ names }) => {
  const descriptions: Record<string, string> = {
    list_skills: "List skills {name,category}. Params: category?, detail?",
    list_installed_skills: "List installed skills in .skills/. Params: directory?",
    search_skills: "Search skills by name/tags. Params: query, detail?",
    get_skill_info: "Get skill metadata and env vars. Params: name",
    get_skill_docs: "Get skill documentation. Params: name",
    install_skill: "Install a skill for an agent. Params: name, agent?",
    install_category: "Install all skills in a category. Params: category, agent?",
    remove_skill: "Remove an installed skill. Params: name, agent?",
    list_categories: "List skill categories with counts.",
    list_tags: "List all tags across skills.",
    get_requirements: "Get skill requirements/dependencies. Params: name",
    run_skill: "Execute a skill. Params: name, args?",
    export_skills: "Export skill config. Params: format?",
    import_skills: "Import skill config. Params: data",
    whoami: "Show setup: version, installed skills, agent configs.",
  };
  const result = names.map((n: string) => `${n}: ${descriptions[n] || "See tool schema"}`).join("\n");
  return { content: [{ type: "text", text: result }] };
});

// ---- Start server ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
