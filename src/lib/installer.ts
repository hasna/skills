/**
 * Skill installer - handles copying skills to user projects
 */

import { existsSync, cpSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync, accessSync, constants } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { normalizeSkillName } from "./utils.js";
import { getSkill } from "./registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find the skills directory - works from both src/lib/ (dev) and bin/ or dist/ (built).
// Guards against accidentally returning a path that is inside a .skills/ install dir.
function findSkillsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills");
    // Only accept if the candidate itself is not inside a .skills/ directory
    // (prevents double-nesting when run from within an installed project)
    if (existsSync(candidate) && !dir.includes(".skills")) {
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

    // Track installation metadata
    recordInstall(destDir, name);

    // Check for missing skill dependencies and warn
    const meta = getSkill(name);
    if (meta?.dependencies && meta.dependencies.length > 0) {
      const installed = getInstalledSkills(targetDir);
      const installedSet = new Set(installed);
      for (const dep of meta.dependencies) {
        if (!installedSet.has(dep)) {
          console.warn(`Warning: skill-${meta.name} depends on skill-${dep} which is not installed`);
        }
      }
    }

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
 * Update the .skills/index.ts file to export all installed skills (excluding disabled)
 */
function updateSkillsIndex(skillsDir: string): void {
  const indexPath = join(skillsDir, "index.ts");

  const meta = loadMeta(skillsDir);
  const disabledSet = new Set(meta.disabled || []);

  const skills = readdirSync(skillsDir).filter(
    (f: string) => f.startsWith("skill-") && !f.includes(".") && !disabledSet.has(f.replace("skill-", ""))
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

// ---- Installation metadata tracking ----

interface SkillMeta {
  installedAt: string;
  version: string;
}

interface MetaFile {
  skills: Record<string, SkillMeta>;
  disabled?: string[];
}

function getMetaPath(skillsDir: string): string {
  return join(skillsDir, ".meta.json");
}

function loadMeta(skillsDir: string): MetaFile {
  const metaPath = getMetaPath(skillsDir);
  if (existsSync(metaPath)) {
    try {
      return JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch {}
  }
  return { skills: {} };
}

function saveMeta(skillsDir: string, meta: MetaFile): void {
  writeFileSync(getMetaPath(skillsDir), JSON.stringify(meta, null, 2));
}

function recordInstall(skillsDir: string, name: string): void {
  const meta = loadMeta(skillsDir);
  const skillName = normalizeSkillName(name);
  // Try to read version from the installed skill's package.json
  let version = "unknown";
  try {
    const pkgPath = join(skillsDir, skillName, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      version = pkg.version || "unknown";
    }
  } catch {}
  meta.skills[name] = { installedAt: new Date().toISOString(), version };
  saveMeta(skillsDir, meta);
}

function recordRemove(skillsDir: string, name: string): void {
  const meta = loadMeta(skillsDir);
  delete meta.skills[name];
  saveMeta(skillsDir, meta);
}

/**
 * Get installation metadata for installed skills
 */
export function getInstallMeta(targetDir: string = process.cwd()): MetaFile {
  return loadMeta(join(targetDir, ".skills"));
}

/**
 * Disable a skill (exclude from .skills/index.ts without removing files)
 */
export function disableSkill(name: string, targetDir: string = process.cwd()): boolean {
  const skillsDir = join(targetDir, ".skills");
  const skillName = normalizeSkillName(name);
  if (!existsSync(join(skillsDir, skillName))) return false;

  const meta = loadMeta(skillsDir);
  const disabled = new Set(meta.disabled || []);
  if (disabled.has(name)) return false; // already disabled
  disabled.add(name);
  meta.disabled = [...disabled];
  saveMeta(skillsDir, meta);
  updateSkillsIndex(skillsDir);
  return true;
}

/**
 * Enable a previously disabled skill (re-add to .skills/index.ts)
 */
export function enableSkill(name: string, targetDir: string = process.cwd()): boolean {
  const skillsDir = join(targetDir, ".skills");
  const meta = loadMeta(skillsDir);
  const disabled = new Set(meta.disabled || []);
  if (!disabled.has(name)) return false; // not disabled
  disabled.delete(name);
  meta.disabled = [...disabled];
  saveMeta(skillsDir, meta);
  updateSkillsIndex(skillsDir);
  return true;
}

/**
 * Get list of disabled skills
 */
export function getDisabledSkills(targetDir: string = process.cwd()): string[] {
  const meta = loadMeta(join(targetDir, ".skills"));
  return meta.disabled || [];
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
  recordRemove(skillsDir, name);
  return true;
}

// ---- Agent install support ----

export type AgentTarget = "claude" | "codex" | "gemini" | "pi" | "opencode";
export type AgentScope = "global" | "project";

export const AGENT_TARGETS: AgentTarget[] = ["claude", "codex", "gemini", "pi", "opencode"];

/** Human-readable labels for each agent */
export const AGENT_LABELS: Record<AgentTarget, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  pi: "pi.dev",
  opencode: "OpenCode",
};

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
 * Get the skills directory for a given agent and scope.
 *
 * Agent config dir conventions:
 *   claude  — ~/.claude/skills/          | .claude/skills/
 *   codex   — ~/.codex/skills/           | .codex/skills/
 *   gemini  — ~/.gemini/skills/          | .gemini/skills/
 *   pi      — ~/.pi/agent/skills/        | .pi/skills/
 *   opencode — ~/.opencode/skills/       | .opencode/skills/
 */
export function getAgentSkillsDir(agent: AgentTarget, scope: AgentScope = "global", projectDir?: string): string {
  const base = projectDir || process.cwd();

  switch (agent) {
    case "pi":
      // pi.dev: global uses ~/.pi/agent/skills/, project uses .pi/skills/
      return scope === "project"
        ? join(base, ".pi", "skills")
        : join(homedir(), ".pi", "agent", "skills");
    case "opencode":
      return scope === "project"
        ? join(base, ".opencode", "skills")
        : join(homedir(), ".opencode", "skills");
    default:
      // claude, codex, gemini: ~/.{agent}/skills/ or .{agent}/skills/
      return scope === "project"
        ? join(base, `.${agent}`, "skills")
        : join(homedir(), `.${agent}`, "skills");
  }
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

  // For global scope, validate that the agent config directory exists
  // For project scope, directories will be created as needed
  if (scope === "global") {
    // Determine the agent's top-level config dir (used for existence check)
    const agentBaseDir = agent === "pi"
      ? join(homedir(), ".pi", "agent")
      : join(homedir(), `.${agent}`);
    if (!existsSync(agentBaseDir)) {
      return {
        skill: name,
        success: false,
        error: `Agent directory ${agentBaseDir} does not exist. Is ${AGENT_LABELS[agent]} installed?`,
      };
    }
    try {
      accessSync(agentBaseDir, constants.W_OK);
    } catch {
      return {
        skill: name,
        success: false,
        error: `Agent directory ${agentBaseDir} is not writable. Check permissions.`,
      };
    }
  }

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
