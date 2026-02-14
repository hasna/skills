import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../lib/logger';

type Platform = 'claude' | 'codex';

function getSkillsDir(platform: Platform, local: boolean): string {
  if (local) {
    return platform === 'claude' ? '.claude/skills' : '.codex/skills';
  }
  const home = homedir();
  return platform === 'claude'
    ? join(home, '.claude', 'skills')
    : join(home, '.codex', 'skills');
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function getSkillMdContent(): Promise<string> {
  // Try to read from the package's SKILL.md first
  const possiblePaths = [
    join(__dirname, '..', '..', 'SKILL.md'),
    join(__dirname, '..', '..', '..', 'SKILL.md'),
    join(process.cwd(), 'SKILL.md'),
  ];

  for (const path of possiblePaths) {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      // Try next path
    }
  }

  // Fallback to embedded content
  return `---
name: skill-e2bswarm
description: Spawn and manage E2B sandbox instances for parallel Claude Code task execution. Use when you need to run multiple tasks in parallel across isolated environments, distribute work across sandboxes, or execute tasks in clean environments.
disable-model-invocation: true
allowed-tools: Bash(bun:*), Bash(e2b:*), Read, Write
---

# E2B Swarm

Spawn E2B sandbox instances in parallel to execute Claude Code tasks across isolated environments.

## CLI Usage

\`\`\`bash
# Spawn instances with tasks from a task list
skill-e2bswarm spawn --repo <github-url> --tasks <task-list-id> --instances <count>

# Spawn from a local directory
skill-e2bswarm spawn --local ./my-project --tasks <task-list-id> --instances 3

# Check status
skill-e2bswarm status

# Collect results
skill-e2bswarm collect --output ./results

# Kill instances
skill-e2bswarm kill
\`\`\`

## Commands

| Command | Description |
|---------|-------------|
| \`spawn\` | Spawn E2B instances with tasks |
| \`status\` | Check instance status |
| \`collect\` | Collect results from instances |
| \`kill\` | Kill running instances |
| \`sync\` | Sync changes back to GitHub |
| \`clean\` | Clean up state file |
| \`info\` | Show skill data directory paths |

## Options (spawn)

| Option | Description |
|--------|-------------|
| \`-r, --repo <url>\` | Git repository URL to clone |
| \`-l, --local <path>\` | Local directory to upload |
| \`-t, --tasks <id>\` | Task list ID from ~/.claude/tasks/ |
| \`-n, --instances <count>\` | Number of parallel instances |
| \`-d, --distribute <mode>\` | Distribution: all, round-robin, by-dependency |
| \`--auto-commit\` | Auto commit changes |
| \`--auto-push\` | Auto push changes |
| \`--create-pr\` | Create pull request |

## Data Directories

- **exports/** - Collected results and artifacts
- **logs/** - Execution logs
- **cache/** - Temporary data
- **config/** - Skill configuration

## Requirements

- \`E2B_API_KEY\` in \`~/.secrets\` - Required for E2B sandboxes
- Bun runtime with \`skill-e2bswarm\` installed globally

## Install CLI

\`\`\`bash
bun add -g @hasnaxyz/skill-e2bswarm
\`\`\`
`;
}

export async function install(options: {
  claude?: boolean;
  codex?: boolean;
  local?: boolean;
}): Promise<void> {
  if (!options.claude && !options.codex) {
    logger.error('Please specify --claude or --codex');
    process.exit(1);
  }

  const skillName = 'skill-e2bswarm';
  const platforms: Platform[] = [];
  if (options.claude) platforms.push('claude');
  if (options.codex) platforms.push('codex');

  const skillMdContent = await getSkillMdContent();

  for (const platform of platforms) {
    const baseDir = getSkillsDir(platform, options.local || false);
    const skillDir = join(baseDir, skillName);

    logger.info(`Installing skill to ${platform === 'claude' ? 'Claude Code' : 'Codex'}...`);

    try {
      // Create skill directory structure
      await ensureDir(skillDir);
      await ensureDir(join(skillDir, 'exports'));
      await ensureDir(join(skillDir, 'uploads'));
      await ensureDir(join(skillDir, 'logs'));

      // Write SKILL.md
      const skillMdPath = join(skillDir, 'SKILL.md');
      await writeFile(skillMdPath, skillMdContent, 'utf-8');

      logger.success(`Installed to ${skillDir}`);

      console.log();
      console.log('Created structure:');
      console.log(`  ${skillDir}/`);
      console.log('  ├── SKILL.md');
      console.log('  ├── exports/');
      console.log('  ├── uploads/');
      console.log('  └── logs/');
      console.log();
      console.log(`Invoke with: /${skillName}`);
    } catch (error) {
      logger.error(`Install failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      process.exit(1);
    }
  }
}
