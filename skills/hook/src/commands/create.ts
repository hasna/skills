/**
 * Create a new hook scaffold
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

import {
  generateBunfig,
  generateGitignore,
  generateHookConfig,
  generateHookMd,
  generatePackageJson,
  generateReadme,
  generateTsConfig,
} from '../templates/root';
import {
  generateClaudeTs,
  generateConfigTs,
  generateCoreTs,
  generateIndexTs,
  generateLoggerTs,
  generateRunTs,
  generateSetupTs,
  generateTestTs,
} from '../templates/source';

interface CreateOptions {
  event?: string;
  matcher?: string;
  output?: string;
}

export async function createHook(name: string, options: CreateOptions): Promise<void> {
  const hookName = name.startsWith('hook-') ? name : `hook-${name}`;
  const shortName = hookName.replace('hook-', '');
  const event = options.event || 'PreToolUse';
  const matcher = options.matcher || '*';
  const outputDir = options.output || process.cwd();
  const hookDir = join(outputDir, hookName);

  // Validate event
  const validEvents = ['PreToolUse', 'PostToolUse', 'Stop'];
  if (!validEvents.includes(event)) {
    console.error(`Invalid event: ${event}. Must be one of: ${validEvents.join(', ')}`);
    process.exit(1);
  }

  // Check if directory exists
  if (existsSync(hookDir)) {
    console.error(`Directory already exists: ${hookDir}`);
    process.exit(1);
  }

  console.log(`Creating hook: ${hookName}`);
  console.log(`  Event: ${event}`);
  console.log(`  Matcher: ${matcher}`);
  console.log(`  Output: ${hookDir}`);
  console.log('');

  // Create directory structure
  const dirs = [
    hookDir,
    join(hookDir, 'src'),
    join(hookDir, 'src', 'commands'),
    join(hookDir, 'src', 'core'),
    join(hookDir, 'src', 'utils'),
  ];

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Write all files
  await writeFile(join(hookDir, 'hook.config.json'), generateHookConfig(hookName, shortName, event, matcher));
  await writeFile(join(hookDir, 'package.json'), generatePackageJson(hookName, shortName));
  await writeFile(join(hookDir, 'tsconfig.json'), generateTsConfig());
  await writeFile(join(hookDir, 'bunfig.toml'), generateBunfig());
  await writeFile(join(hookDir, '.gitignore'), generateGitignore());
  await writeFile(join(hookDir, 'README.md'), generateReadme(hookName, shortName, event, matcher));
  await writeFile(join(hookDir, 'HOOK.md'), generateHookMd(hookName, shortName, event, matcher));

  // Source files
  await writeFile(join(hookDir, 'src', 'index.ts'), generateIndexTs(hookName, shortName));
  await writeFile(join(hookDir, 'src', 'commands', 'run.ts'), generateRunTs(shortName, event));
  await writeFile(join(hookDir, 'src', 'commands', 'setup.ts'), generateSetupTs(hookName));
  await writeFile(join(hookDir, 'src', 'commands', 'test.ts'), generateTestTs(shortName));
  await writeFile(join(hookDir, 'src', 'commands', 'config.ts'), generateConfigTs(hookName));
  await writeFile(join(hookDir, 'src', 'core', `${shortName}.ts`), generateCoreTs(shortName, event));
  await writeFile(join(hookDir, 'src', 'utils', 'logger.ts'), generateLoggerTs(hookName));
  await writeFile(join(hookDir, 'src', 'utils', 'claude.ts'), generateClaudeTs());

  console.log('Hook scaffold created successfully!');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. cd ${hookDir}`);
  console.log('  2. bun install');
  console.log(`  3. Edit src/core/${shortName}.ts to implement your hook logic`);
  console.log('  4. Update hook.config.json if needed');
  console.log('  5. Test with: bun run src/index.ts test');
  console.log('  6. Push to GitHub');
  console.log(`  7. Install: bun add -g git+ssh://git@github.com/your-org/${hookName}.git`);
  console.log(`  8. Setup: ${hookName} setup`);
}

async function writeFile(path: string, content: string): Promise<void> {
  await Bun.write(path, content);
}

// ============================================================================
// TEMPLATE GENERATORS
// ============================================================================
