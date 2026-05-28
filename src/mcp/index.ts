#!/usr/bin/env bun
/**
 * MCP server for the skills library.
 * Exposes tools for listing, searching, pinning, and running skills.
 *
 * Usage:
 *   skills mcp          # Start MCP server on stdio
 *   skills-mcp          # Direct binary
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { registerCloudTools } from "@hasna/cloud";
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
  loadRegistryProfile,
  type SkillRegistryProfile,
  type Category,
} from "../lib/registry.js";
import {
  installSkill,
  getInstalledSkills,
  removeSkill,
  resolveAgents,
  getSkillPath,
  getAgentSkillsDir,
  AGENT_TARGETS,
  AGENT_LABELS,
  type AgentTarget,
} from "../lib/installer.js";
import {
  getSkillBestDoc,
  getSkillRequirements,
  runSkill,
  detectProjectSkills,
} from "../lib/skillinfo.js";
import {
  completeSkillRun,
  createSkillRun,
  writeRunLogs,
} from "../lib/run-state.js";
import {
  addSchedule,
  listSchedules,
  removeSchedule,
  setScheduleEnabled,
  getDueSchedules,
} from "../lib/scheduler.js";
import { validateSkillDirectory } from "../lib/skill-validation.js";
import { saveFeedback, type FeedbackCategory } from "../lib/feedback.js";

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

function mcpJson(payload: unknown, pretty = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, pretty ? 2 : 0) }],
  };
}

const TOOL_DESCRIPTIONS: Record<string, { description: string; params: string[] }> = {
  list_skills: { description: "List skills from the basic or full registry profile.", params: ["category?", "profile?", "detail?", "limit?", "offset?"] },
  list_pinned_skills: { description: "List project-pinned skills from .skills/project.json.", params: ["directory?"] },
  search_skills: { description: "Search skills by name, description, or tags.", params: ["query", "profile?", "detail?", "limit?", "offset?"] },
  get_skill_info: { description: "Get skill metadata, env vars, and dependencies.", params: ["name"] },
  get_skill_docs: { description: "Get best available skill documentation.", params: ["name"] },
  pin_skill: { description: "Pin a skill locally, or return MCP setup guidance for agent targets.", params: ["name", "for?", "scope?"] },
  pin_category: { description: "Pin all skills in a category.", params: ["category", "for?", "scope?"] },
  unpin_skill: { description: "Unpin a skill locally. Agent skill folders are unmanaged.", params: ["name", "for?", "scope?"] },
  list_categories: { description: "List skill categories with counts.", params: [] },
  list_tags: { description: "List all skill tags with counts.", params: [] },
  get_requirements: { description: "Get env vars, system deps, and npm dependencies for a skill.", params: ["name"] },
  run_skill: { description: "Run a skill by name with optional arguments.", params: ["name", "args?"] },
  export_skills: { description: "Export pinned skills as a portable JSON payload.", params: [] },
  import_skills: { description: "Pin skills from an export payload.", params: ["skills", "for?", "scope?"] },
  whoami: { description: "Show package, install, and agent setup details.", params: [] },
  schedule_skill: { description: "Create a cron schedule for a skill.", params: ["skill", "cron", "name?", "args?"] },
  list_schedules: { description: "List scheduled skill runs.", params: [] },
  remove_schedule: { description: "Remove a schedule by id or name.", params: ["id_or_name"] },
  detect_project_skills: { description: "Detect project type and recommended skills.", params: ["directory?"] },
  validate_skill: { description: "Validate a skill directory using the shared skill validator.", params: ["name"] },
  search_tools: { description: "List tool names, optionally filtered by keyword.", params: ["query?"] },
  describe_tools: { description: "Return structured descriptions for named tools.", params: ["names"] },
  register_agent: { description: "Register an agent session and return an agent id.", params: ["name", "session_id?"] },
  heartbeat: { description: "Update agent last_seen_at.", params: ["agent_id"] },
  set_focus: { description: "Set or clear active project context for an agent.", params: ["agent_id", "project_id?"] },
  list_agents: { description: "List registered in-memory agent sessions.", params: [] },
  send_feedback: { description: "Store local feedback for this service.", params: ["message", "email?", "category?"] },
};

// ---- Tools ----

server.registerTool("list_skills", {
  title: "List Skills",
  description: "List skills. Defaults to the clean basic profile to avoid context overflow. Set profile:'all' for the full registry. Returns {name,category} by default; detail:true for full objects. Supports limit/offset pagination.",
  inputSchema: {
    category: z.string().optional(),
    profile: z.enum(["basic", "all"]).optional(),
    detail: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  },
}, async ({ category, profile, detail, limit, offset }) => {
  const selectedProfile = (profile || "basic") as SkillRegistryProfile;
  const skills = category
    ? loadRegistryProfile(selectedProfile).filter((s) => s.category === category)
    : loadRegistryProfile(selectedProfile);

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

server.registerTool("list_pinned_skills", {
  title: "List Pinned Skills",
  description: "List skills pinned in the current project's .skills/project.json.",
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
  description: "Search skills by name, description, or tags. Defaults to the clean basic profile; set profile:'all' for the full registry. Returns compact list by default. Supports limit/offset pagination.",
  inputSchema: {
    query: z.string(),
    profile: z.enum(["basic", "all"]).optional(),
    detail: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  },
}, async ({ query, profile, detail, limit, offset }) => {
  const selectedProfile = (profile || "basic") as SkillRegistryProfile;
  const cacheKey = `${selectedProfile}:${query}:${detail ?? false}`;
  const cached = cacheGet(cacheKey);
  const results = cached ? cached as typeof SKILLS : searchSkills(query, loadRegistryProfile(selectedProfile));
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

server.registerTool("pin_skill", {
  title: "Pin Skill",
  description: "Pin a skill to .skills/project.json. Agent skill-folder installs are disabled; use skills mcp --register.",
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
      success: false,
      agent: a,
      scope: (scope as "global" | "project") || "global",
      error: `Direct agent skill-folder installs are disabled. Register Skills MCP instead: skills mcp --register ${a}`,
    }));

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

server.registerTool("pin_category", {
  title: "Pin Category",
  description: "Pin all skills in a category. Agent skill-folder installs are disabled.",
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
        const r = {
          skill: name,
          success: false,
          error: `Direct agent skill-folder installs are disabled. Register Skills MCP instead: skills mcp --register ${a}`,
        };
        results.push({ ...r, agent: a, scope: scope || "global" });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ category: matchedCategory, count: names.length, results }, null, 2) }],
      isError: results.some(r => !r.success),
    };
  }

  const results = names.map(name => installSkill(name));
  return {
    content: [{ type: "text", text: JSON.stringify({ category: matchedCategory, count: names.length, results }, null, 2) }],
    isError: results.some(r => !r.success),
  };
});

server.registerTool("unpin_skill", {
  title: "Unpin Skill",
  description: "Unpin a skill from .skills/project.json. Agent skill folders are unmanaged.",
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
      removed: false,
      error: `Agent skill folders are unmanaged. Register Skills MCP instead: skills mcp --register ${a}`,
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
  const runContext = createSkillRun({
    skill: name,
    args: args || [],
    remote: false,
  });

  const skill = getSkill(name);
  if (!skill) {
    return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
  }

  const result = await runSkill(name, args || [], {
    stdio: "pipe",
    env: {
      SKILLS_RUN_ID: runContext.record.id,
      SKILLS_RUN_DIR: runContext.runDir,
      SKILLS_EXPORT_DIR: runContext.exportDir,
    },
  });
  writeRunLogs(runContext, result.stdout ?? "", result.stderr ?? result.error ?? "");
  const localRun = completeSkillRun(runContext, {
    status: result.exitCode === 0 ? "completed" : "failed",
    error: result.error,
  });
  if (result.error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ exitCode: result.exitCode, error: result.error, run: localRun }, null, 2) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ exitCode: result.exitCode, skill: name, stdout: result.stdout, stderr: result.stderr, run: localRun }, null, 2) }],
  };
});

server.registerTool("export_skills", {
  title: "Export Pinned Skills",
  description: "Export pinned skills as a JSON payload for import elsewhere.",
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
  title: "Import Pinned Skills",
  description: "Pin skills from an export payload. Supports MCP setup guidance via 'for'.",
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
      results.push({
        skill: name,
        success: false,
        error: `Direct agent skill-folder installs are disabled. Register Skills MCP instead: skills mcp --register ${agents.join(",")}`,
      });
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
  description: "Show setup summary: version, pinned skills, agent configs, cwd.",
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
          return !f.startsWith(".") && statSync(full).isDirectory();
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
  description: "Validate a skill directory with structured issues, warnings, and metadata.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  const skillPath = getSkillPath(name);
  const result = validateSkillDirectory(name, skillPath, getSkill(name));
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.valid,
  };
});

// ---- Resources ----

server.registerResource("Skills Registry", "skills://registry", {
  description: "Compact default basic skill list [{name,category}]. Use list_skills with profile:'all' for the full registry, and skills://{name} for detail.",
}, async () => ({
  contents: [{
    uri: "skills://registry",
    text: JSON.stringify(loadRegistryProfile("basic").map(s => ({ name: s.name, category: s.category }))),
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
  const needle = query?.toLowerCase();
  const tools = Object.keys(TOOL_DESCRIPTIONS)
    .filter((name) => !needle || name.includes(needle) || TOOL_DESCRIPTIONS[name].description.toLowerCase().includes(needle))
    .sort();
  return mcpJson({ tools, total: tools.length });
});

server.registerTool("describe_tools", {
  title: "Describe Tools",
  description: "Get descriptions for specific tools by name.",
  inputSchema: { names: z.array(z.string()) },
}, async ({ names }) => {
  const tools = names.map((name: string) => ({
    name,
    ...(TOOL_DESCRIPTIONS[name] || { description: "Unknown tool", params: [] }),
  }));
  return mcpJson({ tools });
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

async function main() {
  const transport = new StdioServerTransport();
  registerCloudTools(server, "skills");
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
