#!/usr/bin/env bun

/**
 * Skill Installer Module
 *
 * Universal installer for skills to integrate with AI code assistants
 * Usage: skill-[name] install [claude|codex|windsurf|cursor]
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';

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

export type AssistantType = 'claude' | 'codex' | 'windsurf' | 'cursor';

const ASSISTANT_PATHS: Record<AssistantType, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
  windsurf: '.windsurf/skills',
  cursor: '.cursor/skills',
};

export class SkillInstaller {
  private config: SkillConfig;
  private skillPath: string;

  constructor(config: SkillConfig, currentFilePath: string) {
    this.config = config;
    // Get the root directory of the skill (where package.json is)
    this.skillPath = resolve(currentFilePath, '..');
  }

  /**
   * Install the skill to specified AI assistant
   */
  async install(assistant: AssistantType): Promise<void> {
    console.log(`📦 Installing ${this.config.name} for ${assistant}...`);
    console.log('');

    const assistantPath = ASSISTANT_PATHS[assistant];
    if (!assistantPath) {
      throw new Error(`Unknown assistant: ${assistant}`);
    }

    // Create skill directory
    const skillDir = join(homedir(), assistantPath, this.config.name);
    mkdirSync(skillDir, { recursive: true });
    console.log(`✓ Created: ${skillDir}`);

    // Generate and write SKILL.md
    const skillMd = this.generateSkillMd();
    writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
    console.log(`✓ Created: SKILL.md`);

    // Generate and write README.md
    const readme = this.generateReadme();
    writeFileSync(join(skillDir, 'README.md'), readme);
    console.log(`✓ Created: README.md`);

    // Create log file
    const logFile = join(skillDir, `${this.config.name}.log`);
    if (!existsSync(logFile)) {
      writeFileSync(logFile, `# ${this.config.name} execution log\n# Created: ${new Date().toISOString()}\n\n`);
      console.log(`✓ Created: ${this.config.name}.log`);
    }

    // Update MCP config
    this.updateMcpConfig(assistant, skillDir);

    console.log('');
    console.log(`✅ ${this.config.name} installed successfully!`);
    console.log('');
    console.log('Location:', skillDir);
    console.log('');
    console.log('Usage:');
    this.config.commands.slice(0, 3).forEach(cmd => {
      console.log(`  ${this.config.name} ${cmd.usage}`);
    });
  }

  /**
   * Generate SKILL.md documentation
   */
  private generateSkillMd(): string {
    const envVarsSection = this.config.requiredEnvVars?.length || this.config.optionalEnvVars?.length ? `

## Environment Variables

${this.config.requiredEnvVars?.length ? `### Required
${this.config.requiredEnvVars.map(v => `- \`${v}\``).join('\n')}
` : ''}
${this.config.optionalEnvVars?.length ? `### Optional
${this.config.optionalEnvVars.map(v => `- \`${v}\``).join('\n')}
` : ''}` : '';

    return `# ${this.config.name}

${this.config.description}

## Version
${this.config.version}

## Commands

${this.config.commands.map(cmd => `### ${cmd.name}

${cmd.description}

**Usage:**
\`\`\`bash
${this.config.name} ${cmd.usage}
\`\`\`

**Examples:**
${cmd.examples.map(ex => `\`\`\`bash
${ex}
\`\`\``).join('\n')}
`).join('\n')}
${envVarsSection}

## Installation

This skill is installed at:
\`~/.claude/skills/${this.config.name}/\`

## Logs

Execution logs are written to:
\`~/.claude/skills/${this.config.name}/${this.config.name}.log\`

## Support

For issues, visit: https://github.com/hasnaxyz/${this.config.name}/issues
`;
  }

  /**
   * Generate README.md
   */
  private generateReadme(): string {
    return `# ${this.config.name}

${this.config.description}

## Quick Start

\`\`\`bash
${this.config.commands[0] ? `${this.config.name} ${this.config.commands[0].usage}` : `${this.config.name} --help`}
\`\`\`

## Documentation

See [SKILL.md](./SKILL.md) for complete documentation.

## Version

${this.config.version}
`;
  }

  /**
   * Update MCP config to register the skill
   */
  private updateMcpConfig(assistant: AssistantType, skillDir: string): void {
    const configPaths: Record<AssistantType, string> = {
      claude: join(homedir(), '.config/claude-code/claude_mcp_config.json'),
      codex: join(homedir(), '.config/codex/mcp_config.json'),
      windsurf: join(homedir(), '.config/windsurf/mcp_config.json'),
      cursor: join(homedir(), '.config/cursor/mcp_config.json'),
    };

    const configPath = configPaths[assistant];

    // Read existing config or create new
    let config: any = { mcpServers: {} };
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      config = JSON.parse(content);
    }

    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Add or update this skill
    config.mcpServers[this.config.name] = {
      command: 'bun',
      args: ['run', join(this.skillPath, 'src/index.ts')],
      env: this.getEnvConfig(),
    };

    // Write config
    mkdirSync(resolve(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`✓ Updated: ${assistant} MCP config`);
  }

  /**
   * Get environment variables config
   */
  private getEnvConfig(): Record<string, string> {
    const env: Record<string, string> = {
      SKILL_API_KEY: process.env.SKILL_API_KEY || '',
    };

    // Add required env vars
    this.config.requiredEnvVars?.forEach(key => {
      env[key] = process.env[key] || '';
    });

    // Add optional env vars
    this.config.optionalEnvVars?.forEach(key => {
      env[key] = process.env[key] || '';
    });

    return env;
  }

  /**
   * Uninstall the skill from specified AI assistant
   */
  async uninstall(assistant: AssistantType): Promise<void> {
    console.log(`🗑️  Uninstalling ${this.config.name} from ${assistant}...`);
    console.log('');

    const assistantPath = ASSISTANT_PATHS[assistant];
    const skillDir = join(homedir(), assistantPath, this.config.name);

    if (existsSync(skillDir)) {
      // Remove from MCP config first
      this.removeFromMcpConfig(assistant);

      // Note: We don't delete the directory to preserve logs and user data
      console.log(`✓ Removed from ${assistant} MCP config`);
      console.log('');
      console.log(`⚠️  Directory preserved: ${skillDir}`);
      console.log('   (contains logs and configuration)');
      console.log('   Delete manually if needed.');
    } else {
      console.log(`⚠️  ${this.config.name} is not installed for ${assistant}`);
    }
  }

  /**
   * Remove skill from MCP config
   */
  private removeFromMcpConfig(assistant: AssistantType): void {
    const configPaths: Record<AssistantType, string> = {
      claude: join(homedir(), '.config/claude-code/claude_mcp_config.json'),
      codex: join(homedir(), '.config/codex/mcp_config.json'),
      windsurf: join(homedir(), '.config/windsurf/mcp_config.json'),
      cursor: join(homedir(), '.config/cursor/mcp_config.json'),
    };

    const configPath = configPaths[assistant];

    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      const config = JSON.parse(content);

      if (config.mcpServers && config.mcpServers[this.config.name]) {
        delete config.mcpServers[this.config.name];
        writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
    }
  }
}

/**
 * Helper to run installer from skill CLI
 */
export async function runInstaller(
  config: SkillConfig,
  currentFilePath: string,
  args: string[]
): Promise<void> {
  const installer = new SkillInstaller(config, currentFilePath);

  const command = args[0];
  const assistant = args[1] as AssistantType;

  if (command === 'install') {
    if (!assistant || !['claude', 'codex', 'windsurf', 'cursor'].includes(assistant)) {
      console.error('❌ Error: Please specify an assistant');
      console.error('');
      console.error('Usage:');
      console.error(`  ${config.name} install [claude|codex|windsurf|cursor]`);
      console.error('');
      console.error('Examples:');
      console.error(`  ${config.name} install claude`);
      console.error(`  ${config.name} install codex`);
      process.exit(1);
    }

    await installer.install(assistant);
  } else if (command === 'uninstall') {
    if (!assistant || !['claude', 'codex', 'windsurf', 'cursor'].includes(assistant)) {
      console.error('❌ Error: Please specify an assistant');
      console.error('');
      console.error('Usage:');
      console.error(`  ${config.name} uninstall [claude|codex|windsurf|cursor]`);
      process.exit(1);
    }

    await installer.uninstall(assistant);
  } else {
    console.error(`❌ Unknown installer command: ${command}`);
    process.exit(1);
  }
}
