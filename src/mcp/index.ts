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
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { SqliteAdapter as Database } from "@hasna/cloud";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import {
  SKILLS,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
  findSimilarSkills,
  loadRegistry,
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
  getAgentSkillsDir,
  AGENT_TARGETS,
  AGENT_LABELS,
  type AgentTarget,
} from "../lib/installer.js";
import {
  getSkillDocs,
  getSkillBestDoc,
  getSkillRequirements,
  generateSkillMd,
  runSkill,
  detectProjectSkills,
} from "../lib/skillinfo.js";
import {
  addSchedule,
  listSchedules,
  removeSchedule,
  setScheduleEnabled,
  getDueSchedules,
} from "../lib/scheduler.js";

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
    : loadRegistry();

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
  description: "Install a skill to .skills/ or to an agent dir (for: claude|codex|gemini|pi|opencode|all).",
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
      return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
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
      return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
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
      return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
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
  for (const skill of loadRegistry()) {
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
      return mcpError("INVALID_AGENT", (err as Error).message, [...AGENT_TARGETS, "all"]);
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

  const agents: Array<{ agent: string; label: string; path: string; exists: boolean; skillCount: number }> = [];
  for (const agent of AGENT_TARGETS) {
    const agentSkillsPath = getAgentSkillsDir(agent, "global");
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
    agents.push({ agent, label: AGENT_LABELS[agent], path: agentSkillsPath, exists, skillCount });
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

server.registerTool("schedule_skill", {
  title: "Schedule Skill",
  description: "Add a cron schedule to run a skill at a recurring time. Cron format: 'minute hour dom month dow' (e.g. '0 9 * * *' = daily at 9am).",
  inputSchema: {
    skill: z.string(),
    cron: z.string(),
    name: z.string().optional(),
    args: z.array(z.string()).optional(),
  },
}, async ({ skill, cron, name, args }) => {
  const { schedule, error } = addSchedule(skill, cron, { name, args });
  if (error || !schedule) {
    return { content: [{ type: "text", text: JSON.stringify({ error: error || "Failed to add schedule" }) }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }] };
});

server.registerTool("list_schedules", {
  title: "List Schedules",
  description: "List all scheduled skill runs.",
  inputSchema: {},
}, async () => {
  const schedules = listSchedules();
  return { content: [{ type: "text", text: JSON.stringify(schedules, null, 2) }] };
});

server.registerTool("remove_schedule", {
  title: "Remove Schedule",
  description: "Remove a schedule by its ID or name.",
  inputSchema: {
    id_or_name: z.string(),
  },
}, async ({ id_or_name }) => {
  const removed = removeSchedule(id_or_name);
  return { content: [{ type: "text", text: JSON.stringify({ removed, id_or_name }) }] };
});

server.registerTool("detect_project_skills", {
  title: "Detect Project Skills",
  description: "Detect project type from package.json and return recommended skills based on dependencies.",
  inputSchema: {
    directory: z.string().optional(),
  },
}, async ({ directory }) => {
  const cwd = directory || process.cwd();
  const { detected, recommended } = detectProjectSkills(cwd);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        directory: cwd,
        detected,
        recommended: recommended.map((s) => ({ name: s.name, displayName: s.displayName, description: s.description, category: s.category })),
      }, null, 2),
    }],
  };
});

server.registerTool("validate_skill", {
  title: "Validate Skill",
  description: "Check a skill's structure: SKILL.md, package.json with bin entry, tsconfig.json, src/index.ts. Returns validation result with list of issues.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  const skillPath = getSkillPath(name);
  const issues: string[] = [];

  if (!existsSync(skillPath)) {
    return {
      content: [{ type: "text", text: JSON.stringify({ name, valid: false, issues: [`Skill directory not found: ${skillPath}`] }) }],
    };
  }

  // Check required files
  if (!existsSync(join(skillPath, "SKILL.md"))) issues.push("Missing SKILL.md");
  if (!existsSync(join(skillPath, "tsconfig.json"))) issues.push("Missing tsconfig.json");

  const pkgPath = join(skillPath, "package.json");
  if (!existsSync(pkgPath)) {
    issues.push("Missing package.json");
  } else {
    try {
      const pkg = JSON.parse(require("fs").readFileSync(pkgPath, "utf-8"));
      if (!pkg.bin || Object.keys(pkg.bin).length === 0) issues.push("package.json missing 'bin' entry");
    } catch {
      issues.push("package.json is invalid JSON");
    }
  }

  const srcDir = join(skillPath, "src");
  if (!existsSync(srcDir)) {
    issues.push("Missing src/ directory");
  } else if (!existsSync(join(srcDir, "index.ts"))) {
    issues.push("Missing src/index.ts");
  }

  const valid = issues.length === 0;
  return {
    content: [{ type: "text", text: JSON.stringify({ name, valid, path: skillPath, issues }) }],
  };
});

// ---- Resources ----

server.registerResource("Skills Registry", "skills://registry", {
  description: "Compact skill list [{name,category}]. Use skills://{name} for detail.",
}, async () => ({
  contents: [{
    uri: "skills://registry",
    text: JSON.stringify(loadRegistry().map(s => ({ name: s.name, category: s.category }))),
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
    "register_agent", "heartbeat", "set_focus", "list_agents",
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
    register_agent: "Register agent session (idempotent). Params: name, session_id?",
    heartbeat: "Update last_seen_at to signal agent is active. Params: agent_id",
    set_focus: "Set active project context. Params: agent_id, project_id?",
    list_agents: "List all registered agents.",
  };
  const result = names.map((n: string) => `${n}: ${descriptions[n] || "See tool schema"}`).join("\n");
  return { content: [{ type: "text", text: result }] };
});

// ---- Start server ----


const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string }>();

server.tool(
  "register_agent",
  "Register this agent session. Returns agent_id for use in heartbeat/set_focus.",
  { name: z.string(), session_id: z.string().optional() },
  async (a: { name: string; session_id?: string }) => {
    const existing = [..._agentReg.values()].find(x => x.name === a.name);
    if (existing) { existing.last_seen_at = new Date().toISOString(); return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] }; }
    const id = Math.random().toString(36).slice(2, 10);
    const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
    _agentReg.set(id, ag);
    return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
  }
);

server.tool(
  "heartbeat",
  "Update last_seen_at to signal agent is active.",
  { agent_id: z.string() },
  async (a: { agent_id: string }) => {
    const ag = _agentReg.get(a.agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
    ag.last_seen_at = new Date().toISOString();
    return { content: [{ type: "text" as const, text: `♥ ${ag.name} — active` }] };
  }
);

server.tool(
  "set_focus",
  "Set active project context for this agent session.",
  { agent_id: z.string(), project_id: z.string().optional() },
  async (a: { agent_id: string; project_id?: string }) => {
    const ag = _agentReg.get(a.agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
    (ag as any).project_id = a.project_id;
    return { content: [{ type: "text" as const, text: a.project_id ? `Focus: ${a.project_id}` : "Focus cleared" }] };
  }
);

server.tool(
  "list_agents",
  "List all registered agents.",
  {},
  async () => {
    const agents = [..._agentReg.values()];
    if (agents.length === 0) return { content: [{ type: "text" as const, text: "No agents registered." }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }] };
  }
);

function getFeedbackDb(): Database {
  const home = homedir();
  const dbPath = join(home, ".hasna", "skills", "skills.db");
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), message TEXT NOT NULL, email TEXT, category TEXT DEFAULT 'general', version TEXT, machine_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  return db;
}

server.tool(
  "send_feedback",
  "Send feedback about this service",
  { message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional() },
  async (params: { message: string; email?: string; category?: string }) => {
    try {
      const db = getFeedbackDb();
      db.run("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)", [params.message, params.email || null, params.category || "general", pkg.version]);
      db.close();
      return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: String(e) }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
