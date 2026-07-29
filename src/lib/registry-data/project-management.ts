import type { SkillMeta } from "../registry-types.js";

export const PROJECT_MANAGEMENT_SKILLS: SkillMeta[] = [
  {
    name: "businessactivity",
    displayName: "Business Activity",
    description: "Business activity, workflow, and ownership management service",
    category: "Project Management",
    tags: ["business", "workflow", "activities", "management"],
  },
  {
    name: "implementation",
    displayName: "Implementation",
    description: "Create .implementation scaffold for project development tracking",
    category: "Project Management",
    tags: ["implementation", "tracking", "scaffold", "project"],
  },
  {
    name: "implementation-plan",
    displayName: "Implementation Plan",
    description: "Generate detailed implementation plans with phases and milestones",
    category: "Project Management",
    tags: ["implementation", "planning", "milestones", "phases"],
  },
  {
    name: "implementation-todo",
    displayName: "Implementation Todo",
    description: "Manage implementation task lists and todo items",
    category: "Project Management",
    tags: ["implementation", "todo", "tasks", "tracking"],
  },
  {
    name: "todos-plan",
    displayName: "Todos Plan",
    description: "Author, sync, route, and verify Todos plans using Todos CLI plan IDs as source of truth",
    category: "Project Management",
    tags: ["todos", "plans", "tasks", "verification", "workflow"],
  },
];
