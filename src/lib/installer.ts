/**
 * Skill setup and project preferences.
 *
 * Skills are discovered through the CLI/MCP registry and executed from the
 * bundled package or the remote platform. This module deliberately does not
 * copy skill source, SKILL.md, package.json, scripts, or runtime folders into
 * projects or agent-native skill folders.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { normalizeSkillName } from "./utils.js";
import { getSkill } from "./registry.js";
import { normalizeSkillSlug, resolveSkillAlias } from "./skill-aliases.js";
import {
  getDisabledProjectSkills,
  loadProjectConfig,
  getProjectConfigPath,
  listPinnedSkills,
  pinProjectSkill,
  setSkillDisabled,
  unpinProjectSkill,
  type ProjectSkillPin,
  type SkillsProjectConfig,
} from "./project-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find the bundled skills directory - works from both src/lib/ and built dist.
function findSkillsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "skills");
    if (existsSync(candidate) && !dir.includes(".skills")) return candidate;
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
  mode?: InstallMode;
}

export interface InstallOptions {
  targetDir?: string;
  overwrite?: boolean;
}

export type InstallMode = "pin" | "source" | "manifest";
export type InstallSource = ProjectSkillPin["source"];

export interface SkillInstallManifest {
  name: string;
  skillMd: string;
  version?: string;
  source?: InstallSource;
  metadata?: Record<string, unknown>;
}

export interface ManifestInstallOptions extends InstallOptions {
  source?: InstallSource;
  createRuntimeDirs?: boolean;
  writeManifestFile?: boolean;
}

interface InstallMetaEntry {
  installedAt: string;
  version: string;
  mode?: InstallMode;
  source?: InstallSource;
}

interface MetaFile {
  skills: Record<string, InstallMetaEntry>;
  disabled?: string[];
}

/**
 * Get the path to a bundled skill in the package.
 */
export function getSkillPath(name: string): string {
  const skillName = normalizeSkillName(getCanonicalSkillName(name));
  return join(SKILLS_DIR, skillName);
}

function getCanonicalSkillName(name: string): string {
  return getSkill(name)?.name ?? resolveSkillAlias(normalizeSkillSlug(name));
}

/**
 * Check if a skill exists in the bundled/registered catalog.
 */
export function skillExists(name: string): boolean {
  return existsSync(getSkillPath(name));
}

/**
 * Pin a skill in .skills/project.json.
 *
 * This intentionally does not write .skills/skills or any SKILL.md/source files.
 */
export function installSkill(name: string, options: InstallOptions = {}): InstallResult {
  const { targetDir = process.cwd(), overwrite = false } = options;
  const canonicalName = getCanonicalSkillName(name);
  const skillName = normalizeSkillName(canonicalName);
  if (!existsSync(getSkillPath(name))) {
    return { skill: canonicalName, success: false, error: `Skill '${name}' not found`, mode: "pin" };
  }
  const existing = new Set(listPinnedSkills(targetDir));
  if (existing.has(skillName) && !overwrite) {
    return {
      skill: canonicalName,
      success: false,
      error: "Already pinned. Use --overwrite to refresh.",
      path: getProjectConfigPath(targetDir),
      mode: "pin",
    };
  }
  const meta = getSkill(canonicalName);
  const version = readBundledSkillVersion(name);
  pinProjectSkill(skillName, { version, source: meta?.source ?? "official" }, targetDir);
  warnMissingDependencies(canonicalName, targetDir);
  return { skill: canonicalName, success: true, path: getProjectConfigPath(targetDir), mode: "pin" };
}

/**
 * Source installs are disabled by design. Runtime source stays in the package
 * or on the platform, never in a user project.
 */
export function installSkillSource(name: string, _options: InstallOptions = {}): InstallResult {
  const canonicalName = getCanonicalSkillName(name);
  if (!existsSync(getSkillPath(name))) {
    return { skill: canonicalName, success: false, error: `Skill '${name}' not found`, mode: "source" };
  }
  return {
    skill: canonicalName,
    success: false,
    error: "Source installs are disabled. Use Skills MCP discovery and project pins instead.",
    mode: "source",
  };
}

/**
 * SKILL.md manifest installs are disabled. Docs are served by the remote or
 * bundled registry and must not be cached into project skill folders.
 */
export function installSkillManifest(
  manifest: SkillInstallManifest,
  _options: ManifestInstallOptions = {},
): InstallResult {
  const skillName = normalizeSkillName(manifest.name);
  return {
    skill: skillName,
    success: false,
    error: "Manifest installs are disabled. Fetch skill docs through Skills CLI/MCP instead.",
    mode: "manifest",
  };
}

/**
 * Build an in-memory manifest from a bundled local skill.
 */
export function createLocalSkillManifest(
  name: string,
  generateSkillMd?: (name: string) => string | null,
): SkillInstallManifest | null {
  const sourcePath = getSkillPath(name);
  if (!existsSync(sourcePath)) return null;

  let skillMd = "";
  const skillMdPath = join(sourcePath, "SKILL.md");
  if (existsSync(skillMdPath)) {
    skillMd = readFileSync(skillMdPath, "utf-8");
  } else if (generateSkillMd) {
    skillMd = generateSkillMd(name) ?? "";
  } else {
    skillMd = generateMinimalSkillMd(name) ?? "";
  }
  if (!skillMd) return null;

  const registryMeta = getSkill(name);
  return {
    name: registryMeta?.name ?? name,
    skillMd,
    version: readBundledSkillVersion(name),
    source: "local",
    metadata: registryMeta ? {
      displayName: registryMeta.displayName,
      description: registryMeta.description,
      category: registryMeta.category,
      tags: registryMeta.tags,
      dependencies: registryMeta.dependencies,
    } : undefined,
  };
}

export function installSkills(names: string[], options: InstallOptions = {}): InstallResult[] {
  return names.map((name) => installSkill(name, options));
}

export function getInstallMeta(targetDir: string = process.cwd()): MetaFile {
  const config = loadProjectConfigCompat(targetDir);
  if (!config) return { skills: {} };
  const skills: Record<string, InstallMetaEntry> = {};
  for (const name of config.pinnedSkills) {
    const pin = config.pins[name];
    skills[name] = {
      installedAt: pin?.pinnedAt ?? config.createdAt,
      version: pin?.version ?? "unknown",
      mode: "pin",
      source: pin?.source ?? "official",
    };
  }
  return { skills, disabled: config.disabledSkills ?? [] };
}

export function disableSkill(name: string, targetDir: string = process.cwd()): boolean {
  return setSkillDisabled(getCanonicalSkillName(name), true, targetDir);
}

export function enableSkill(name: string, targetDir: string = process.cwd()): boolean {
  return setSkillDisabled(getCanonicalSkillName(name), false, targetDir);
}

export function getDisabledSkills(targetDir: string = process.cwd()): string[] {
  return getDisabledProjectSkills(targetDir);
}

/**
 * Project-pinned skills. Historically this represented copied installs; it now
 * reads .skills/project.json only.
 */
export function getInstalledSkills(targetDir: string = process.cwd()): string[] {
  return listPinnedSkills(targetDir);
}

export function removeSkill(name: string, targetDir: string = process.cwd()): boolean {
  const canonicalName = getCanonicalSkillName(name);
  return unpinProjectSkill(canonicalName, targetDir).unpinned;
}

export function pinSkill(name: string, options: InstallOptions = {}): InstallResult {
  return installSkill(name, options);
}

export function unpinSkill(name: string, targetDir: string = process.cwd()): boolean {
  return removeSkill(name, targetDir);
}

export function getPinnedSkills(targetDir: string = process.cwd()): string[] {
  return getInstalledSkills(targetDir);
}

// ---- Agent setup support ----

export type AgentTarget = "claude" | "codex" | "gemini" | "pi" | "opencode" | "cursor" | "windsurf";
export type AgentScope = "global" | "project";

export const AGENT_TARGETS: AgentTarget[] = ["claude", "codex", "gemini", "pi", "opencode", "cursor", "windsurf"];

export const AGENT_LABELS: Record<AgentTarget, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
  pi: "pi.dev",
  opencode: "OpenCode",
  cursor: "Cursor",
  windsurf: "Windsurf",
};

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

export function getAgentSkillsDir(agent: AgentTarget, scope: AgentScope = "global", projectDir?: string): string {
  const base = projectDir || process.cwd();
  switch (agent) {
    case "pi":
      return scope === "project" ? join(base, ".pi", "skills") : join(homedir(), ".pi", "agent", "skills");
    case "opencode":
      return scope === "project" ? join(base, ".opencode", "skills") : join(homedir(), ".config", "opencode", "skills");
    default:
      return scope === "project" ? join(base, `.${agent}`, "skills") : join(homedir(), `.${agent}`, "skills");
  }
}

export function getAgentSkillPath(name: string, agent: AgentTarget, scope: AgentScope = "global", projectDir?: string): string {
  const skillName = normalizeSkillName(getCanonicalSkillName(name));
  return join(getAgentSkillsDir(agent, scope, projectDir), skillName);
}

export function installSkillForAgent(
  name: string,
  options: AgentInstallOptions,
  _generateSkillMd?: (name: string) => string | null,
): InstallResult {
  const canonicalName = getCanonicalSkillName(name);
  if (!existsSync(getSkillPath(name))) {
    return { skill: canonicalName, success: false, error: `Skill '${name}' not found` };
  }
  return {
    skill: canonicalName,
    success: false,
    error: `Direct agent skill-folder installs are disabled. Register Skills MCP instead: skills mcp --register ${options.agent}`,
  };
}

export function removeSkillForAgent(_name: string, _options: AgentInstallOptions): boolean {
  return false;
}

function warnMissingDependencies(name: string, targetDir: string): void {
  const meta = getSkill(name);
  if (!meta?.dependencies?.length) return;
  const installedSet = new Set(getInstalledSkills(targetDir));
  for (const dep of meta.dependencies) {
    if (!installedSet.has(dep)) {
      console.warn(`Warning: ${meta.name} depends on ${dep} which is not pinned`);
    }
  }
}

function generateMinimalSkillMd(name: string): string | null {
  const sourcePath = getSkillPath(name);
  if (!existsSync(sourcePath)) return null;
  const canonicalName = getCanonicalSkillName(name);
  const meta = getSkill(canonicalName);
  const description = meta?.description ?? `${canonicalName} skill`;
  const tags = meta?.tags ?? [];
  const frontmatter = [
    "---",
    `name: ${canonicalName}`,
    `description: ${JSON.stringify(description)}`,
    tags.length ? "tags:" : "",
    ...tags.map((tag) => `  - ${tag}`),
    "---",
    "",
  ].filter(Boolean);
  const fallbackDoc = readFileIfExists(join(sourcePath, "README.md")) || readFileIfExists(join(sourcePath, "CLAUDE.md"));
  if (fallbackDoc) return `${frontmatter.join("\n")}${fallbackDoc.trim()}\n`;
  const displayName = meta?.displayName ?? canonicalName;
  return `${frontmatter.join("\n")}# ${displayName}\n\n${description}\n\n## Usage\n\n\`\`\`bash\nskills run ${canonicalName}\n\`\`\`\n`;
}

function readBundledSkillVersion(name: string): string {
  const pkgPath = join(getSkillPath(name), "package.json");
  if (!existsSync(pkgPath)) return "unknown";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function readFileIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

function loadProjectConfigCompat(targetDir: string): SkillsProjectConfig | null {
  return loadProjectConfig(targetDir);
}
