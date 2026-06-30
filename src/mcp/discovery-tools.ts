import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  SKILLS,
  getSkill,
  findSimilarSkills,
  loadRegistry,
  loadRegistryProfile,
  searchSkills,
  type SkillRegistryProfile,
} from "../lib/registry.js";
import { getInstalledSkills } from "../lib/installer.js";
import { getSkillBestDoc, getSkillRequirements } from "../lib/skillinfo.js";
import { createSkillMcpMetadata } from "../lib/mcp-contracts.js";
import {
  getCompactSkillDiscovery,
  getPublicSkillDiscovery,
  publicDiscoveryDependencies,
  publicDiscoveryEnvVars,
} from "../lib/discovery.js";
import {
  getSkillToolDependencies,
  getToolPrimitive,
  listToolPrimitives,
  validateToolPrimitiveCoverage,
} from "../lib/tool-primitives.js";
import {
  DEFAULT_MCP_LIMIT,
  paginate,
  parsePageLimit,
  parsePageOffset,
} from "../lib/compact-output.js";
import { cacheGet, cacheSet, mcpError, mcpJson, stripNulls } from "./helpers.js";

export function registerDiscoveryTools(server: McpServer): void {
  server.registerTool("list_skills", {
    title: "List Skills",
    description: "List skills with public pricing. Defaults to a compact paged response from the basic profile to avoid context overflow. Set profile:'all' for the full registry, detail:true for full public objects, and use limit/offset to page.",
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
      ? skills.map(getPublicSkillDiscovery)
      : skills.map(getCompactSkillDiscovery);

    const page = paginate(mapped, {
      limit: parsePageLimit(limit, DEFAULT_MCP_LIMIT, { max: 100 }),
      offset: parsePageOffset(offset),
    });
    return mcpJson({
      skills: page.items,
      total: page.total,
      offset: page.offset,
      limit: page.limit,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
      nextArguments: page.hasMore ? { profile: selectedProfile, category, detail: Boolean(detail), limit: page.limit, offset: page.nextOffset } : null,
      detailHint: detail ? undefined : "Set detail:true for full public skill objects, or call get_skill_info for one skill.",
    });
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
    description: "Search skills by name, description, or tags. Defaults to a compact paged response from the basic profile; set profile:'all' for the full registry and detail:true for full public objects.",
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
      ? results.map(getPublicSkillDiscovery)
      : results.map(getCompactSkillDiscovery);

    const page = paginate(out, {
      limit: parsePageLimit(limit, DEFAULT_MCP_LIMIT, { max: 100 }),
      offset: parsePageOffset(offset),
    });
    return mcpJson({
      skills: page.items,
      total: page.total,
      offset: page.offset,
      limit: page.limit,
      nextOffset: page.nextOffset,
      hasMore: page.hasMore,
      nextArguments: page.hasMore ? { query, profile: selectedProfile, detail: Boolean(detail), limit: page.limit, offset: page.nextOffset } : null,
      detailHint: detail ? undefined : "Set detail:true for full public skill objects, or call get_skill_info for one skill.",
    });
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
    const publicReqs = reqs ? {
      ...reqs,
      envVars: publicDiscoveryEnvVars(skill.name, reqs.envVars),
      dependencies: publicDiscoveryDependencies(skill.name, reqs.dependencies),
    } : reqs;
    const publicSkill = getPublicSkillDiscovery(skill);
    const result = stripNulls({
      ...publicSkill,
      ...publicReqs,
      mcp: createSkillMcpMetadata(publicSkill),
    });
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

  server.registerTool("list_tool_primitives", {
    title: "List Tool Primitives",
    description: "List primitive tools that skills depend on across CLI, MCP, API, and hosted worker execution.",
    inputSchema: {
      query: z.string().optional(),
    },
  }, async ({ query }) => mcpJson({
    schemaVersion: 1,
    primitives: listToolPrimitives(query),
    total: listToolPrimitives(query).length,
  }));

  server.registerTool("get_tool_primitive", {
    title: "Get Tool Primitive",
    description: "Get one primitive tool definition by name.",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }) => {
    const primitive = getToolPrimitive(name);
    if (!primitive) return mcpError("PRIMITIVE_NOT_FOUND", `Primitive '${name}' not found`);
    return mcpJson(primitive);
  });

  server.registerTool("get_skill_tool_dependencies", {
    title: "Get Skill Tool Dependencies",
    description: "Get primitive tool dependencies for one skill.",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }) => {
    const deps = getSkillToolDependencies(name);
    if (!deps) return mcpError("SKILL_NOT_FOUND", `Skill '${name}' not found`, findSimilarSkills(name));
    return mcpJson(deps);
  });

  server.registerTool("validate_tool_primitives", {
    title: "Validate Tool Primitives",
    description: "Validate primitive tool coverage for the bundled skill catalog.",
    inputSchema: {
      profile: z.enum(["basic", "all"]).optional(),
    },
  }, async ({ profile }) => mcpJson(validateToolPrimitiveCoverage(profile || "all")));

}
