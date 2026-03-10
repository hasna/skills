/**
 * Open Skills - Open source skill library for AI coding agents
 *
 * Install AI agent skills with a single command:
 *   npx skills install image deep-research
 *
 * Or use the interactive CLI:
 *   skills
 */

export {
  SKILLS,
  CATEGORIES,
  getSkill,
  getSkillsByCategory,
  searchSkills,
  getSkillsByTag,
  getAllTags,
  type SkillMeta,
  type Category,
} from "./lib/registry.js";

export {
  installSkill,
  installSkills,
  installSkillForAgent,
  removeSkillForAgent,
  getInstalledSkills,
  removeSkill,
  skillExists,
  getSkillPath,
  getAgentSkillsDir,
  getAgentSkillPath,
  AGENT_TARGETS,
  type InstallResult,
  type InstallOptions,
  type AgentTarget,
  type AgentScope,
  type AgentInstallOptions,
} from "./lib/installer.js";

export {
  getSkillDocs,
  getSkillBestDoc,
  getSkillRequirements,
  runSkill,
  generateEnvExample,
  generateSkillMd,
  type SkillDocs,
  type SkillRequirements,
} from "./lib/skillinfo.js";
