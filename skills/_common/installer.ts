#!/usr/bin/env bun

/**
 * Legacy per-skill installer boundary.
 *
 * Agent-native skill folders are intentionally unmanaged. Skills are exposed
 * through the root Skills CLI/MCP server so local agents discover the catalog
 * without receiving copied source, package files, or SKILL.md files.
 */

export interface SkillConfig {
  name: string;
  description: string;
  version: string;
  commands: Array<{
    name: string;
    description: string;
    usage: string;
    examples: string[];
  }>;
  requiredEnvVars?: string[];
  optionalEnvVars?: string[];
}

export type AssistantType = "claude" | "codex" | "windsurf" | "cursor";

export class SkillInstaller {
  private config: SkillConfig;

  constructor(config: SkillConfig, _currentFilePath: string) {
    this.config = config;
  }

  async install(assistant: AssistantType): Promise<void> {
    throw new Error(registrationMessage(this.config.name, assistant));
  }

  async uninstall(assistant: AssistantType): Promise<void> {
    throw new Error(
      `Direct agent skill-folder uninstalls are disabled for ${this.config.name}. ` +
        `Skills MCP owns discovery; update MCP registration with: skills mcp --register ${assistant}`,
    );
  }
}

export async function runInstaller(
  config: SkillConfig,
  currentFilePath: string,
  args: string[] = process.argv.slice(2),
): Promise<boolean> {
  const command = args[0];
  if (command !== "install" && command !== "uninstall") {
    return false;
  }

  const assistant = args.find((arg): arg is AssistantType =>
    ["claude", "codex", "windsurf", "cursor"].includes(arg),
  );
  const installer = new SkillInstaller(config, currentFilePath);
  if (command === "install") {
    await installer.install(assistant ?? "claude");
  } else {
    await installer.uninstall(assistant ?? "claude");
  }
  return true;
}

function registrationMessage(skillName: string, assistant: AssistantType): string {
  return (
    `Direct agent skill-folder installs are disabled for ${skillName}. ` +
    `Register the Skills MCP server instead: skills mcp --register ${assistant}`
  );
}
