import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getSkill } from "../lib/registry.js";
import { getSkillPath } from "../lib/installer.js";
import { detectProjectSkills } from "../lib/skillinfo.js";
import {
  addSchedule,
  listSchedules,
  removeSchedule,
} from "../lib/scheduler.js";
import { validateSkillDirectory } from "../lib/skill-validation.js";

export function registerScheduleTools(server: McpServer): void {
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

}
