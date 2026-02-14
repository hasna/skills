/**
 * Skill Installation Handler
 *
 * Add this code to your skill's index.ts to enable:
 *   skill-[name] install claude
 *   skill-[name] install codex
 *   skill-[name] uninstall claude
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface SkillMeta {
  name: string;
  description: string;
  version: string;
  commands: string; // Help text or command list
  requiredEnvVars?: string[];
}

export async function handleInstallCommand(meta: SkillMeta, args: string[]): Promise<boolean> {
  const command = args[0];
  const assistant = args[1];

  if (command !== 'install' && command !== 'uninstall') {
    return false; // Not an install command
  }

  if (!assistant || !['claude', 'codex', 'windsurf', 'cursor'].includes(assistant)) {
    console.error('❌ Error: Please specify an assistant');
    console.error('');
    console.error('Usage:');
    console.error(`  ${meta.name} install [claude|codex|windsurf|cursor]`);
    console.error(`  ${meta.name} uninstall [claude|codex|windsurf|cursor]`);
    console.error('');
    console.error('Examples:');
    console.error(`  ${meta.name} install claude`);
    console.error(`  ${meta.name} install codex`);
    process.exit(1);
  }

  if (command === 'install') {
    await installSkill(meta, assistant);
  } else {
    await uninstallSkill(meta, assistant);
  }

  return true;
}

async function installSkill(meta: SkillMeta, assistant: string): Promise<void> {
  console.log(`📦 Installing ${meta.name} for ${assistant}...`);
  console.log('');

  const assistantPaths: Record<string, string> = {
    claude: '.claude/skills',
    codex: '.codex/skills',
    windsurf: '.windsurf/skills',
    cursor: '.cursor/skills',
  };

  const skillDir = join(homedir(), assistantPaths[assistant], meta.name);
  mkdirSync(skillDir, { recursive: true });
  console.log(`✓ Created: ${skillDir}`);

  // Generate SKILL.md
  const skillMd = generateSkillMd(meta);
  writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
  console.log(`✓ Created: SKILL.md`);

  // Generate README.md
  const readme = generateReadme(meta);
  writeFileSync(join(skillDir, 'README.md'), readme);
  console.log(`✓ Created: README.md`);

  // Create log file
  const logFile = join(skillDir, `${meta.name}.log`);
  if (!existsSync(logFile)) {
    writeFileSync(logFile, `# ${meta.name} execution log\n# Created: ${new Date().toISOString()}\n\n`);
    console.log(`✓ Created: ${meta.name}.log`);
  }

  console.log('');
  console.log(`✅ ${meta.name} installed successfully!`);
  console.log('');
  console.log('Location:', skillDir);
  console.log('');
  console.log('Files created:');
  console.log('  - SKILL.md (documentation)');
  console.log('  - README.md (quick reference)');
  console.log(`  - ${meta.name}.log (execution logs)`);
}

async function uninstallSkill(meta: SkillMeta, assistant: string): Promise<void> {
  console.log(`🗑️  Uninstalling ${meta.name} from ${assistant}...`);
  console.log('');

  const assistantPaths: Record<string, string> = {
    claude: '.claude/skills',
    codex: '.codex/skills',
    windsurf: '.windsurf/skills',
    cursor: '.cursor/skills',
  };

  const skillDir = join(homedir(), assistantPaths[assistant], meta.name);

  if (existsSync(skillDir)) {
    console.log(`⚠️  Directory preserved: ${skillDir}`);
    console.log('   (contains logs and configuration)');
    console.log('   Delete manually if needed:');
    console.log(`   rm -rf ${skillDir}`);
  } else {
    console.log(`✓ ${meta.name} is not installed for ${assistant}`);
  }
}

function generateSkillMd(meta: SkillMeta): string {
  // Extract skill type from name (e.g., "skill-audio" -> "audio")
  const skillType = meta.name.replace('skill-', '');

  // Create gerund form for description trigger (e.g., "audio" -> "generating audio")
  const gerundForms: Record<string, string> = {
    audio: 'generating audio',
    image: 'generating images',
    video: 'generating videos',
    browse: 'browsing websites',
    codefix: 'fixing code',
    convert: 'converting files',
    deploy: 'deploying applications',
    emoji: 'generating emojis',
    extract: 'extracting data',
    transcript: 'transcribing audio',
    transform: 'transforming data',
    write: 'writing content',
  };

  const gerund = gerundForms[skillType] || `using ${skillType}`;

  // Enhanced description with usage triggers
  const enhancedDesc = `${meta.description}. Use when ${gerund} or when the user mentions ${skillType}.`;

  const envSection = meta.requiredEnvVars?.length ? `

## Environment Variables

${meta.requiredEnvVars.map(v => `- \`${v}\``).join('\n')}

Add to your \`~/.zshrc\` or \`~/.bashrc\`:
\`\`\`bash
${meta.requiredEnvVars.map(v => `export ${v}=your_key_here`).join('\n')}
\`\`\`
` : '';

  return `---
name: ${meta.name}
description: ${enhancedDesc}
---

# ${meta.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

${meta.description}

## Quick Start

\`\`\`bash
${meta.commands}
\`\`\`

## Version

${meta.version}${envSection}

## Installation

Installed at: \`~/.claude/skills/${meta.name}/\`

## Logs

Execution logs: \`~/.claude/skills/${meta.name}/${meta.name}.log\`

## Support

For issues, see the project repository.
`;
}

function generateReadme(meta: SkillMeta): string {
  return `# ${meta.name}

${meta.description}

**Version:** ${meta.version}

## Documentation

See [SKILL.md](./SKILL.md) for complete documentation.

## Quick Reference

\`\`\`bash
${meta.name} --help
\`\`\`
`;
}
