/**
 * Skill installer - handles copying skills to user projects
 */

import { existsSync, cpSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { normalizeSkillName } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find the skills directory - works from both src/lib/ (dev) and bin/ or dist/ (built)
function findSkillsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills");
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return join(__dirname, "..", "skills");
}

const SKILLS_DIR = findSkillsDir();

export interface InstallResult {
  skill: string;
  success: boolean;
  error?: string;
  path?: string;
}

export interface InstallOptions {
  targetDir?: string;
  overwrite?: boolean;
}

/**
 * Get the path to a skill in the package
 */
export function getSkillPath(name: string): string {
  const skillName = normalizeSkillName(name);
  return join(SKILLS_DIR, skillName);
}

/**
 * Check if a skill exists in the package
 */
export function skillExists(name: string): boolean {
  return existsSync(getSkillPath(name));
}

/**
 * Install a single skill to the target directory
 */
export function installSkill(
  name: string,
  options: InstallOptions = {}
): InstallResult {
  const { targetDir = process.cwd(), overwrite = false } = options;

  const skillName = normalizeSkillName(name);
  const sourcePath = getSkillPath(name);
  const destDir = join(targetDir, ".skills");
  const destPath = join(destDir, skillName);

  // Check if skill exists in package
  if (!existsSync(sourcePath)) {
    return {
      skill: name,
      success: false,
      error: `Skill '${name}' not found`,
    };
  }

  // Check if already installed
  if (existsSync(destPath) && !overwrite) {
    return {
      skill: name,
      success: false,
      error: `Already installed. Use --overwrite to replace.`,
      path: destPath,
    };
  }

  try {
    // Ensure .skills directory exists
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Remove existing if overwriting
    if (existsSync(destPath) && overwrite) {
      rmSync(destPath, { recursive: true, force: true });
    }

    // Copy skill (skip .git, node_modules)
    cpSync(sourcePath, destPath, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(sourcePath.length);
        return !rel.includes("/.git") && !rel.includes("/node_modules");
      },
    });

    // Update or create .skills/index.ts for easy imports
    updateSkillsIndex(destDir);

    return {
      skill: name,
      success: true,
      path: destPath,
    };
  } catch (error) {
    return {
      skill: name,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Install multiple skills
 */
export function installSkills(
  names: string[],
  options: InstallOptions = {}
): InstallResult[] {
  return names.map((name) => installSkill(name, options));
}

/**
 * Update the .skills/index.ts file to export all installed skills
 */
function updateSkillsIndex(skillsDir: string): void {
  const indexPath = join(skillsDir, "index.ts");

  const skills = readdirSync(skillsDir).filter(
    (f: string) => f.startsWith("skill-") && !f.includes(".")
  );

  const exports = skills
    .map((s: string) => {
      const name = s.replace("skill-", "").replace(/-/g, "_");
      return `export * as ${name} from './${s}/src/index.js';`;
    })
    .join("\n");

  const content = `/**
 * Auto-generated index of installed skills
 * Do not edit manually - run 'skills install' to update
 */

${exports}
`;

  writeFileSync(indexPath, content);
}

/**
 * Get list of installed skills in a directory
 */
export function getInstalledSkills(targetDir: string = process.cwd()): string[] {
  const skillsDir = join(targetDir, ".skills");

  if (!existsSync(skillsDir)) {
    return [];
  }

  return readdirSync(skillsDir)
    .filter((f: string) => {
      const fullPath = join(skillsDir, f);
      return f.startsWith("skill-") && statSync(fullPath).isDirectory();
    })
    .map((f: string) => f.replace("skill-", ""));
}

/**
 * Remove an installed skill
 */
export function removeSkill(
  name: string,
  targetDir: string = process.cwd()
): boolean {
  const skillName = normalizeSkillName(name);
  const skillsDir = join(targetDir, ".skills");
  const skillPath = join(skillsDir, skillName);

  if (!existsSync(skillPath)) {
    return false;
  }

  rmSync(skillPath, { recursive: true, force: true });
  updateSkillsIndex(skillsDir);
  return true;
}

// ---- Agent install support ----

export type AgentTarget = "claude" | "codex" | "gemini";
export type AgentScope = "global" | "project";

export const AGENT_TARGETS: AgentTarget[] = ["claude", "codex", "gemini"];

/**
 * Resolve an agent argument ("all" or a specific agent name) to a list of AgentTarget values.
 * Throws if the agent name is not recognized.
 */
export function resolveAgents(agentArg: string): AgentTarget[] {
  if (agentArg === "all") return [...AGENT_TARGETS];
  const agent = agentArg as AgentTarget;
  if (!AGENT_TARGETS.includes(agent)) {
    throw new Error(`Unknown agent: ${agent}. Available: ${AGENT_TARGETS.join(", ")}, all`);
  }
  return [agent];
}

export interface AgentInstallOptions {
  agent: AgentTarget;
  scope?: AgentScope;
  projectDir?: string;
}

/**
 * Get the skills directory for a given agent and scope
 */
export function getAgentSkillsDir(agent: AgentTarget, scope: AgentScope = "global", projectDir?: string): string {
  const agentDir = `.${agent}`;

  if (scope === "project") {
    return join(projectDir || process.cwd(), agentDir, "skills");
  }

  return join(homedir(), agentDir, "skills");
}

/**
 * Get the full path where a skill's SKILL.md would be installed for an agent
 */
export function getAgentSkillPath(name: string, agent: AgentTarget, scope: AgentScope = "global", projectDir?: string): string {
  const skillName = normalizeSkillName(name);
  return join(getAgentSkillsDir(agent, scope, projectDir), skillName);
}

/**
 * Install a skill's SKILL.md for a specific agent
 * If the skill has no SKILL.md, one will be generated using the provided generator function
 */
export function installSkillForAgent(
  name: string,
  options: AgentInstallOptions,
  generateSkillMd?: (name: string) => string | null
): InstallResult {
  const { agent, scope = "global", projectDir } = options;

  const skillName = normalizeSkillName(name);
  const sourcePath = getSkillPath(name);

  if (!existsSync(sourcePath)) {
    return { skill: name, success: false, error: `Skill '${name}' not found` };
  }

  // Find or generate SKILL.md content
  let skillMdContent: string | null = null;
  const skillMdPath = join(sourcePath, "SKILL.md");

  if (existsSync(skillMdPath)) {
    skillMdContent = readFileSync(skillMdPath, "utf-8");
  } else if (generateSkillMd) {
    skillMdContent = generateSkillMd(name);
  }

  if (!skillMdContent) {
    return { skill: name, success: false, error: `No SKILL.md found and could not generate one for '${name}'` };
  }

  const destDir = getAgentSkillPath(name, agent, scope, projectDir);

  try {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "SKILL.md"), skillMdContent);
    return { skill: name, success: true, path: destDir };
  } catch (error) {
    return {
      skill: name,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Remove a skill from an agent's skill directory
 */
export function removeSkillForAgent(
  name: string,
  options: AgentInstallOptions
): boolean {
  const { agent, scope = "global", projectDir } = options;
  const destDir = getAgentSkillPath(name, agent, scope, projectDir);

  if (!existsSync(destDir)) {
    return false;
  }

  rmSync(destDir, { recursive: true, force: true });
  return true;
}
