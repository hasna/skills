import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getSkill,
  findSimilarSkills,
  searchSkills,
  type SkillRegistryProfile,
} from "../lib/registry.js";
import { getBrowseRegistry, requireSkillsReadAccess } from "../lib/read-access.js";
import { requiresCliSkillLoading } from "../lib/managed-policy.js";
import { loadSelectedSkill, selectedSkillRequirements } from "../lib/selection-resolver.js";
import { selectedProfileId } from "../cli/commands/context.js";
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
import { mcpError, mcpJson, readSurface, stripNulls } from "./helpers.js";

// Every tool here that answers with skill DATA runs the same fail-closed
// preamble as the CLI's browsing and introspection verbs (lib/read-access.ts):
// with no credential, no authority and no HASNA_SKILLS_LOCAL=1 opt-in it
// answers AUTH_REQUIRED instead of the bundled catalog and the on-machine corpus
// (#1720 validation). The listing tools share getBrowseRegistry() with
// `skills list` / `search`, so a hosted install sees the same folder UNION cloud
// registry on both surfaces.
export function registerDiscoveryTools(server: McpServer): void {
  server.registerTool("list_skills", {
    title: "List Skills",
    description: "List skills with name, category, and description. Defaults to a compact paged response from the basic profile to avoid context overflow. Set profile:'all' for the full registry, detail:true for full public objects, and use limit/offset to page.",
    inputSchema: {
      category: z.string().optional(),
      profile: z.enum(["basic", "all"]).optional(),
      detail: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  }, async ({ category, profile, detail, limit, offset }) => readSurface(async () => {
    const selectedProfile = (profile || "basic") as SkillRegistryProfile;
    const registry = await getBrowseRegistry({ all: selectedProfile === "all" });
    const skills = category ? registry.filter((s) => s.category === category) : registry;

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
  }));

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
  }, async ({ query, profile, detail, limit, offset }) => readSurface(async () => {
    const selectedProfile = (profile || "basic") as SkillRegistryProfile;
    // No result cache any more: the registry is resolved through the ladder on
    // every call, and a cached hit would answer a later call the ladder refuses.
    const results = searchSkills(query, await getBrowseRegistry({ all: selectedProfile === "all" }));
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
  }));

  server.registerTool("get_skill_info", {
    title: "Get Skill Info",
    description: "Get skill metadata, env vars, and dependencies.",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }) => readSurface(async () => {
    await requireSkillsReadAccess();
    if (requiresCliSkillLoading()) {
      const result = await selectedSkillRequirements(name, selectedProfileId(), { projectDir: process.cwd() });
      return mcpJson({ name: result.selection.slug, version: result.selection.version, source: "remote", ...result });
    }
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
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  }));

  server.registerTool("get_skill_docs", {
    title: "Get Skill Docs",
    description: "Get skill documentation (SKILL.md > README.md > CLAUDE.md).",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }) => readSurface(async () => {
    await requireSkillsReadAccess();
    if (requiresCliSkillLoading()) {
      const result = await loadSelectedSkill(name, selectedProfileId(), { projectDir: process.cwd() });
      return mcpJson(result);
    }
    const doc = getSkillBestDoc(name);
    if (!doc) {
      return mcpError("NO_DOCS", `No documentation found for '${name}'`);
    }
    return { content: [{ type: "text" as const, text: doc }] };
  }));

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
