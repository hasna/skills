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
import { cacheGet, cacheSet, mcpError, stripNulls } from "./helpers.js";

export function registerDiscoveryTools(server: McpServer): void {
  server.registerTool("list_skills", {
    title: "List Skills",
    description: "List skills with public pricing. Defaults to the clean basic profile to avoid context overflow. Set profile:'all' for the full registry. Returns {name,category,pricing} by default; detail:true for full public objects. Supports limit/offset pagination.",
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
    description: "Search skills by name, description, or tags. Defaults to the clean basic profile; set profile:'all' for the full registry. Returns compact list with pricing by default. Supports limit/offset pagination.",
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

}
