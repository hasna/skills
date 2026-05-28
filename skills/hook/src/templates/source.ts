export function generateIndexTs(hookName: string, shortName: string): string {
  return `#!/usr/bin/env bun

/**
 * ${hookName} - Claude Code hook
 */

import { runHook } from './commands/run';
import { setupHook } from './commands/setup';
import { testHook } from './commands/test';
import { showConfig, setConfig } from './commands/config';
import { showLogs, clearLogs } from './utils/logger';

// Read hook config
const hookConfigPath = new URL('../hook.config.json', import.meta.url).pathname;
const hookConfig = await Bun.file(hookConfigPath).json();

export function printHelp() {
  console.log(\`${hookName} v\${hookConfig.version}

\${hookConfig.description}

USAGE:
  ${hookName} [command] [options]

COMMANDS:
  (no command)        Run the hook (reads stdin, outputs JSON)
  setup               Configure Claude Code to use this hook
  test [input]        Test the hook with sample input
  config              Show current configuration
  config set <k> <v>  Update configuration
  logs                View recent log entries
  logs clear          Clear the log file
  help                Show this help message

OPTIONS:
  --global            Use global scope (~/.claude)
  --project           Use project scope (./.claude)
  --verbosity <lvl>   Set log level: none, blocked, all
  --yes               Skip confirmation prompts
  --version           Show version
  --help              Show help
\`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Version
  if (args.includes('--version') || args.includes('-v')) {
    console.log(hookConfig.version);
    process.exit(0);
  }

  // Help
  if (args.includes('--help') || args.includes('-h') || command === 'help') {
    printHelp();
    process.exit(0);
  }

  // Parse options
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--global') options.global = true;
    else if (args[i] === '--project') options.project = true;
    else if (args[i] === '--yes' || args[i] === '-y') options.yes = true;
    else if (args[i] === '--verbosity' && args[i + 1]) {
      options.verbosity = args[++i];
    }
  }

  switch (command) {
    case 'setup':
      await setupHook(hookConfig, options);
      break;

    case 'test':
      await testHook(args.slice(1).filter(a => !a.startsWith('--')));
      break;

    case 'config':
      if (args[1] === 'set' && args[2] && args[3]) {
        await setConfig(hookConfig.name, args[2], args[3]);
      } else {
        await showConfig(hookConfig.name);
      }
      break;

    case 'logs':
      if (args[1] === 'clear') {
        await clearLogs(hookConfig.name);
      } else {
        await showLogs(hookConfig.name);
      }
      break;

    case undefined:
      // No command = run the hook (read from stdin)
      await runHook(hookConfig);
      break;

    default:
      console.error(\`Unknown command: \${command}\`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ decision: 'error', message: error.message }));
  process.exit(1);
});
`;
}

export function generateRunTs(shortName: string, event: string): string {
  const canBlock = event === 'PreToolUse';

  return `/**
 * Main hook execution logic
 */

import { process${shortName.charAt(0).toUpperCase() + shortName.slice(1)} } from '../core/${shortName}';
import { log } from '../utils/logger';

interface HookInput {
  tool?: string;
  input?: any;
  output?: any;
}

interface HookOutput {
  decision: 'allow' | 'block' | 'error';
  reason?: string;
  message?: string;
}

export async function runHook(hookConfig: any): Promise<void> {
  let input: HookInput = {};

  // Read from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }

  const stdinData = Buffer.concat(chunks).toString('utf-8').trim();

  if (stdinData) {
    try {
      input = JSON.parse(stdinData);
    } catch {
      // Not JSON, might be raw command
      input = { input: stdinData };
    }
  }

  try {
    const result = await process${shortName.charAt(0).toUpperCase() + shortName.slice(1)}(input, hookConfig);

    // Log based on verbosity
    await log(hookConfig.name, {
      event: hookConfig.event,
      action: result.decision,
      input,
      reason: result.reason,
    });

    // Output result
    console.log(JSON.stringify(result));
  } catch (error) {
    const errorResult: HookOutput = {
      decision: 'error',
      message: (error as Error).message,
    };

    await log(hookConfig.name, {
      event: hookConfig.event,
      action: 'error',
      input,
      reason: errorResult.message,
    });

    console.log(JSON.stringify(errorResult));
    process.exit(1);
  }
}
`;
}

export function generateSetupTs(hookName: string): string {
  return `/**
 * Setup command - configures Claude Code to use this hook
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readClaudeSettings, writeClaudeSettings, mergeHookConfig } from '../utils/claude';

interface SetupOptions {
  global?: boolean;
  project?: boolean;
  verbosity?: string;
  yes?: boolean;
}

export async function setupHook(hookConfig: any, options: SetupOptions): Promise<void> {
  console.log(\`Setting up \${hookConfig.name}...\\n\`);

  // Determine scope
  let scope: 'global' | 'project';

  if (options.global) {
    scope = 'global';
  } else if (options.project) {
    scope = 'project';
  } else {
    // Interactive prompt
    console.log('Where should the hook be configured?');
    console.log('  1. Global (~/.claude) - applies to all projects');
    console.log('  2. Project (./.claude) - applies to this project only');
    process.stdout.write('\\nChoice [1]: ');

    const choice = await readLine();
    scope = choice === '2' ? 'project' : 'global';
  }

  const baseDir = scope === 'global'
    ? join(homedir(), '.claude')
    : join(process.cwd(), '.claude');

  const hooksDir = join(baseDir, 'hooks');

  console.log(\`\\nScope: \${scope} (\${baseDir})\`);

  // Determine verbosity
  let verbosity = options.verbosity || 'blocked';
  if (!options.verbosity && !options.yes) {
    console.log('\\nLog verbosity:');
    console.log('  1. blocked - Only log blocked operations');
    console.log('  2. all - Log all operations');
    console.log('  3. none - Disable logging');
    process.stdout.write('\\nChoice [1]: ');

    const choice = await readLine();
    verbosity = choice === '2' ? 'all' : choice === '3' ? 'none' : 'blocked';
  }

  console.log(\`Verbosity: \${verbosity}\`);

  // Create hooks directory
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
    console.log(\`\\nCreated: \${hooksDir}\`);
  }

  // Create log file
  const logFile = join(hooksDir, hookConfig.logFile);
  if (!existsSync(logFile)) {
    await Bun.write(logFile, '');
    console.log(\`Created: \${logFile}\`);
  }

  // Create hook config file
  const configFile = join(hooksDir, \`\${hookConfig.name}.config.json\`);
  await Bun.write(configFile, JSON.stringify({
    verbosity,
    enabled: true,
  }, null, 2));
  console.log(\`Created: \${configFile}\`);

  // Copy HOOK.md
  const hookMdSource = new URL('../../HOOK.md', import.meta.url).pathname;
  const hookMdDest = join(hooksDir, \`\${hookConfig.name}.md\`);
  if (existsSync(hookMdSource)) {
    const content = await Bun.file(hookMdSource).text();
    await Bun.write(hookMdDest, content);
    console.log(\`Created: \${hookMdDest}\`);
  }

  // Update Claude settings
  const settingsPath = join(baseDir, 'settings.json');
  const settings = await readClaudeSettings(settingsPath);

  const newSettings = mergeHookConfig(settings, {
    event: hookConfig.event,
    matcher: hookConfig.matcher,
    command: hookConfig.name,
  });

  await writeClaudeSettings(settingsPath, newSettings);
  console.log(\`Updated: \${settingsPath}\`);

  console.log(\`\\n\${hookConfig.name} setup complete!\`);
  console.log(\`\\nThe hook will now run on \${hookConfig.event} events.\`);
}

async function readLine(): Promise<string> {
  const buf = new Uint8Array(1024);
  const n = await Bun.stdin.stream().getReader().read();
  return new TextDecoder().decode(n.value).trim();
}
`;
}

export function generateTestTs(shortName: string): string {
  return `/**
 * Test command - manually test the hook
 */

import { process${shortName.charAt(0).toUpperCase() + shortName.slice(1)} } from '../core/${shortName}';

export async function testHook(args: string[]): Promise<void> {
  const testInput = args.join(' ') || 'echo "test"';

  console.log('Testing hook with input:');
  console.log(\`  \${testInput}\\n\`);

  // Load hook config
  const hookConfigPath = new URL('../../hook.config.json', import.meta.url).pathname;
  const hookConfig = await Bun.file(hookConfigPath).json();

  const input = {
    tool: 'Bash',
    input: { command: testInput },
  };

  try {
    const result = await process${shortName.charAt(0).toUpperCase() + shortName.slice(1)}(input, hookConfig);

    console.log('Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}
`;
}

export function generateConfigTs(hookName: string): string {
  return `/**
 * Config command - show/update hook configuration
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export async function showConfig(hookName: string): Promise<void> {
  const locations = [
    join(process.cwd(), '.claude', 'hooks', \`\${hookName}.config.json\`),
    join(homedir(), '.claude', 'hooks', \`\${hookName}.config.json\`),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      console.log(\`Config: \${path}\\n\`);
      const config = await Bun.file(path).json();
      console.log(JSON.stringify(config, null, 2));
      return;
    }
  }

  console.log('No configuration found. Run setup first:');
  console.log(\`  \${hookName} setup\`);
}

export async function setConfig(hookName: string, key: string, value: string): Promise<void> {
  const locations = [
    join(process.cwd(), '.claude', 'hooks', \`\${hookName}.config.json\`),
    join(homedir(), '.claude', 'hooks', \`\${hookName}.config.json\`),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      const config = await Bun.file(path).json();

      // Parse value
      let parsedValue: any = value;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else if (!isNaN(Number(value))) parsedValue = Number(value);

      config[key] = parsedValue;

      await Bun.write(path, JSON.stringify(config, null, 2));
      console.log(\`Updated \${key} = \${parsedValue}\`);
      return;
    }
  }

  console.log('No configuration found. Run setup first:');
  console.log(\`  \${hookName} setup\`);
}
`;
}

export function generateCoreTs(shortName: string, event: string): string {
  const canBlock = event === 'PreToolUse';
  const className = shortName.charAt(0).toUpperCase() + shortName.slice(1);

  return `/**
 * Core ${shortName} logic
 *
 * TODO: Implement your hook logic here
 */

interface HookInput {
  tool?: string;
  input?: any;
  output?: any;
}

interface HookOutput {
  decision: 'allow' | 'block' | 'error';
  reason?: string;
}

/**
 * Process the hook input and return a decision
 *
 * @param input - The tool input from Claude Code
 * @param config - The hook configuration
 * @returns Decision to allow${canBlock ? ', block,' : ' or'} error
 */
export async function process${className}(
  input: HookInput,
  config: any
): Promise<HookOutput> {
  // TODO: Implement your hook logic here

  // Example: Extract command if Bash tool
  const command = input.input?.command || '';

  // TODO: Add your validation/processing logic
  // For PreToolUse hooks, you can return { decision: 'block', reason: '...' }
  // For PostToolUse/Stop hooks, typically just return { decision: 'allow' }

  ${canBlock ? `// Example blocking logic (uncomment and modify):
  // if (command.includes('rm -rf /')) {
  //   return {
  //     decision: 'block',
  //     reason: 'Dangerous command detected: rm -rf /',
  //   };
  // }` : '// This is a PostToolUse/Stop hook - cannot block, only observe'}

  return { decision: 'allow' };
}
`;
}

export function generateLoggerTs(hookName: string): string {
  return `/**
 * Logging utilities
 */

import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface LogEntry {
  timestamp: string;
  event: string;
  action: string;
  input?: any;
  reason?: string;
}

export function getLogPath(hookName: string): string | null {
  const locations = [
    join(process.cwd(), '.claude', 'hooks', \`\${hookName}.log\`),
    join(homedir(), '.claude', 'hooks', \`\${hookName}.log\`),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export function getConfigPath(hookName: string): string | null {
  const locations = [
    join(process.cwd(), '.claude', 'hooks', \`\${hookName}.config.json\`),
    join(homedir(), '.claude', 'hooks', \`\${hookName}.config.json\`),
  ];

  for (const path of locations) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export async function log(hookName: string, entry: Omit<LogEntry, 'timestamp'>): Promise<void> {
  // Check verbosity setting
  const configPath = getConfigPath(hookName);
  if (configPath) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

      if (config.verbosity === 'none') return;
      if (config.verbosity === 'blocked' && entry.action === 'allow') return;
    } catch {
      // Continue with logging if config read fails
    }
  }

  const logPath = getLogPath(hookName);
  if (!logPath) return;

  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const line = JSON.stringify(logEntry) + '\\n';
  appendFileSync(logPath, line);
}

export async function showLogs(hookName: string, limit = 20): Promise<void> {
  const logPath = getLogPath(hookName);

  if (!logPath) {
    console.log('No log file found. Run setup first:');
    console.log(\`  \${hookName} setup\`);
    return;
  }

  const content = readFileSync(logPath, 'utf-8').trim();

  if (!content) {
    console.log('Log file is empty.');
    return;
  }

  const lines = content.split('\\n').slice(-limit);

  console.log(\`Recent logs (\${logPath}):\\n\`);

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      const icon = entry.action === 'block' ? 'X' : entry.action === 'error' ? '!' : '-';
      console.log(\`[\${entry.timestamp}] \${icon} \${entry.event}: \${entry.action}\`);
      if (entry.reason) {
        console.log(\`    Reason: \${entry.reason}\`);
      }
    } catch {
      console.log(line);
    }
  }
}

export async function clearLogs(hookName: string): Promise<void> {
  const logPath = getLogPath(hookName);

  if (!logPath) {
    console.log('No log file found.');
    return;
  }

  writeFileSync(logPath, '');
  console.log('Logs cleared.');
}
`;
}

export function generateClaudeTs(): string {
  return `/**
 * Claude Code configuration utilities
 */

import { existsSync } from 'fs';

interface ClaudeSettings {
  hooks?: {
    [event: string]: Array<{
      matcher: string | string[];
      hooks: string[];
    }>;
  };
  [key: string]: any;
}

interface HookConfig {
  event: string;
  matcher: string | string[];
  command: string;
}

export async function readClaudeSettings(path: string): Promise<ClaudeSettings> {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return await Bun.file(path).json();
  } catch {
    return {};
  }
}

export async function writeClaudeSettings(path: string, settings: ClaudeSettings): Promise<void> {
  await Bun.write(path, JSON.stringify(settings, null, 2));
}

export function mergeHookConfig(settings: ClaudeSettings, hookConfig: HookConfig): ClaudeSettings {
  const { event, matcher, command } = hookConfig;

  // Initialize hooks object if needed
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Initialize event array if needed
  if (!settings.hooks[event]) {
    settings.hooks[event] = [];
  }

  // Check if hook already exists for this matcher
  const existingIndex = settings.hooks[event].findIndex(
    (h) => JSON.stringify(h.matcher) === JSON.stringify(matcher)
  );

  if (existingIndex >= 0) {
    // Add command to existing matcher if not already present
    if (!settings.hooks[event][existingIndex].hooks.includes(command)) {
      settings.hooks[event][existingIndex].hooks.push(command);
    }
  } else {
    // Add new hook config
    settings.hooks[event].push({
      matcher,
      hooks: [command],
    });
  }

  return settings;
}
`;
}
