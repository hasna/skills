#!/usr/bin/env bun

/**
 * Browser Automation CLI
 * AI-powered web browsing using Browser-Use Cloud API
 */
import { handleInstallCommand } from './skill-install';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-browse',
  description: 'Browser automation skill using Browser-Use Cloud API for AI-powered web browsing, scraping, and automation',
  version: '1.0.0',
  commands: `Use: skill-browse --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { BrowserUseClient } from './client';
import type { LLMModel, ProxyCountry, TaskSecrets } from './types';

// Parse command line arguments
function parseArgs(): {
  command: string;
  task?: string;
  url?: string;
  model?: LLMModel;
  proxy?: boolean;
  proxyCountry?: ProxyCountry;
  adblock?: boolean;
  highlight?: boolean;
  output?: string;
  timeout?: number;
  taskId?: string;
  schema?: string;
  json?: boolean;
  secrets?: string;
  secretsFile?: string;
  allowedDomains?: string;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, unknown> = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const nextArg = args[i + 1];

      // Boolean flags
      if (key === 'proxy' || key === 'adblock' || key === 'highlight' || key === 'json') {
        parsed[key] = true;
      } else if (key === 'no-proxy') {
        parsed.proxy = false;
      } else if (key === 'no-adblock') {
        parsed.adblock = false;
      } else if (key === 'no-highlight') {
        parsed.highlight = false;
      } else if (key === 'timeout') {
        parsed.timeout = parseInt(nextArg, 10) * 1000; // Convert to ms
        i++;
      } else if (nextArg && !nextArg.startsWith('--')) {
        // Handle kebab-case to camelCase
        const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        parsed[camelKey] = nextArg;
        i++;
      }
    }
  }

  return parsed as ReturnType<typeof parseArgs>;
}

// Load secrets from file or JSON string
async function loadSecrets(secretsJson?: string, secretsFile?: string): Promise<TaskSecrets | undefined> {
  // Try to load from file first
  if (secretsFile) {
    try {
      const file = Bun.file(secretsFile);
      const content = await file.text();
      return JSON.parse(content) as TaskSecrets;
    } catch (error) {
      throw new Error(`Failed to load secrets from file: ${secretsFile}`);
    }
  }

  // Parse JSON string
  if (secretsJson) {
    try {
      return JSON.parse(secretsJson) as TaskSecrets;
    } catch {
      throw new Error('--secrets must be valid JSON');
    }
  }

  return undefined;
}

// Display help information
function showHelp(): void {
  console.log(`
Browser Automation CLI - AI-powered web browsing using Browser-Use Cloud API

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  browse      Execute a browser automation task
  extract     Extract structured data from a website
  status      Check status of a task
  list        List all tasks
  pause       Pause a running task
  resume      Resume a paused task
  stop        Stop a task permanently
  help        Show this help message

BROWSE OPTIONS:
  --task <text>           Natural language task description (required)
  --model <model>         LLM model: gpt-4o, o3, claude-sonnet-4 (default: gpt-4o)
  --proxy                 Enable proxy (for captcha bypass)
  --proxy-country <code>  Proxy country: us, fr, it, jp, au, de, fi, ca (default: us)
  --adblock               Enable ad blocking
  --highlight             Highlight elements during execution
  --timeout <seconds>     Task timeout in seconds (default: 300)
  --secrets <json>        JSON object with credentials (keys=placeholders, values=secrets)
  --secrets-file <path>   Path to JSON file with credentials
  --allowed-domains <csv> Comma-separated list of allowed domains

EXTRACT OPTIONS:
  --task <text>           Extraction task description (required)
  --output <path>         Save extracted data to file
  --schema <json>         JSON schema for structured output
  --json                  Output as JSON to stdout

TASK MANAGEMENT:
  --task-id <id>          Task ID for status/pause/resume/stop commands

EXAMPLES:
  # Browse and perform actions
  bun run src/index.ts browse \\
    --task "Go to hacker-news.com and find the top 5 posts" \\
    --model gpt-4o \\
    --proxy

  # Login with credentials (placeholders in task, values in secrets)
  bun run src/index.ts browse \\
    --task "Go to twitter.com, login with username my_user and password my_pass, then get my notifications" \\
    --secrets '{"my_user":"actual@email.com","my_pass":"actualPassword123"}' \\
    --allowed-domains twitter.com,x.com

  # Using secrets from a file
  bun run src/index.ts browse \\
    --task "Login to my_service with creds my_user and my_pass" \\
    --secrets-file ./credentials.json

  # Extract structured data
  bun run src/index.ts extract \\
    --task "Go to amazon.com and search for 'laptop', extract the top 3 product names and prices" \\
    --output ./products.json

  # Check task status
  bun run src/index.ts status --task-id abc123

  # List all tasks
  bun run src/index.ts list

  # Pause a task
  bun run src/index.ts pause --task-id abc123

  # Resume a paused task
  bun run src/index.ts resume --task-id abc123

  # Stop a task
  bun run src/index.ts stop --task-id abc123

ENVIRONMENT VARIABLES:
  BROWSER_USE_API_KEY       API key for Browser-Use Cloud (required)
  BROWSER_USE_MODEL         Default LLM model
  BROWSER_USE_PROXY         Default proxy setting (true/false)
  BROWSER_USE_PROXY_COUNTRY Default proxy country code

MODELS:
  gpt-4o          OpenAI GPT-4o (default)
  o3              OpenAI O3 (recommended for accuracy)
  claude-sonnet-4 Anthropic Claude Sonnet 4
  gemini-flash    Google Gemini Flash
  browser-use     Browser-Use proprietary model (fastest)

PROXY COUNTRIES:
  us  United States       fr  France
  it  Italy               jp  Japan
  au  Australia           de  Germany
  fi  Finland             ca  Canada
`);
}

// Format task info for display
function formatTaskInfo(task: { id: string; status: string; task: string; liveUrl?: string; createdAt: string }): string {
  const statusEmoji = {
    pending: '⏳',
    running: '🔄',
    paused: '⏸️',
    finished: '✅',
    failed: '❌',
    stopped: '🛑',
  }[task.status] || '❓';

  return `${statusEmoji} [${task.id.substring(0, 8)}...] ${task.status.padEnd(8)} ${task.task.substring(0, 50)}${task.task.length > 50 ? '...' : ''}`;
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  // Help doesn't need API key
  if (args.command === 'help') {
    showHelp();
    return;
  }

  // Initialize client (validates API key)
  let client: BrowserUseClient;
  try {
    client = new BrowserUseClient();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  try {
    switch (args.command) {
      case 'browse': {
        if (!args.task) {
          console.error('Error: --task is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        console.log('Starting browser task...');
        console.log(`Task: ${args.task}`);

        // Load secrets if provided
        const secrets = await loadSecrets(args.secrets, args.secretsFile);
        if (secrets) {
          console.log(`Using ${Object.keys(secrets).length} secret(s)`);
        }

        // Parse allowed domains
        const allowedDomains = args.allowedDomains?.split(',').map(d => d.trim());
        if (allowedDomains) {
          console.log(`Allowed domains: ${allowedDomains.join(', ')}`);
        }

        const result = await client.browse({
          task: args.task,
          model: args.model,
          useProxy: args.proxy,
          proxyCountry: args.proxyCountry,
          useAdblock: args.adblock,
          highlightElements: args.highlight,
          timeout: args.timeout,
          secrets,
          allowedDomains,
        });

        if (result.success) {
          console.log('\n✅ Task completed successfully');
          if (result.output) {
            console.log('\n--- Output ---');
            console.log(result.output);
          }
          if (result.steps && result.steps.length > 0) {
            console.log(`\n--- Steps (${result.steps.length}) ---`);
            result.steps.forEach((step, i) => {
              console.log(`${i + 1}. ${step.action}`);
            });
          }
        } else {
          console.error(`\n❌ Task failed: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case 'extract': {
        if (!args.task) {
          console.error('Error: --task is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }

        console.log('Starting extraction task...');
        console.log(`Task: ${args.task}`);

        let schema: Record<string, unknown> | undefined;
        if (args.schema) {
          try {
            schema = JSON.parse(args.schema);
          } catch {
            console.error('Error: --schema must be valid JSON');
            process.exit(1);
          }
        }

        // Load secrets if provided
        const extractSecrets = await loadSecrets(args.secrets, args.secretsFile);
        if (extractSecrets) {
          console.log(`Using ${Object.keys(extractSecrets).length} secret(s)`);
        }

        // Parse allowed domains
        const extractAllowedDomains = args.allowedDomains?.split(',').map(d => d.trim());
        if (extractAllowedDomains) {
          console.log(`Allowed domains: ${extractAllowedDomains.join(', ')}`);
        }

        const result = await client.extract({
          task: args.task,
          model: args.model,
          useProxy: args.proxy,
          proxyCountry: args.proxyCountry,
          useAdblock: args.adblock,
          highlightElements: args.highlight,
          timeout: args.timeout,
          schema,
          outputPath: args.output,
          secrets: extractSecrets,
          allowedDomains: extractAllowedDomains,
        });

        if (result.success) {
          console.log('\n✅ Extraction completed successfully');

          if (args.json && result.data) {
            // Output only JSON for piping
            console.log(JSON.stringify(result.data, null, 2));
          } else if (result.data) {
            console.log('\n--- Extracted Data ---');
            console.log(typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2));
          }

          if (result.savedTo) {
            console.log(`\nData saved to: ${result.savedTo}`);
          }
        } else {
          console.error(`\n❌ Extraction failed: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case 'status': {
        if (!args.taskId) {
          console.error('Error: --task-id is required');
          process.exit(1);
        }

        const result = await client.getTask(args.taskId);
        console.log(`Task ID: ${result.taskId}`);
        console.log(`Status: ${result.status}`);
        if (result.output) {
          console.log('\n--- Output ---');
          console.log(result.output);
        }
        if (result.error) {
          console.log(`Error: ${result.error}`);
        }
        break;
      }

      case 'list': {
        const tasks = await client.listTasks();
        if (tasks.length === 0) {
          console.log('No tasks found');
        } else {
          console.log('Tasks:');
          tasks.forEach((task) => {
            console.log(formatTaskInfo(task));
          });
        }
        break;
      }

      case 'pause': {
        if (!args.taskId) {
          console.error('Error: --task-id is required');
          process.exit(1);
        }
        await client.pauseTask(args.taskId);
        console.log(`Task ${args.taskId} paused`);
        break;
      }

      case 'resume': {
        if (!args.taskId) {
          console.error('Error: --task-id is required');
          process.exit(1);
        }
        await client.resumeTask(args.taskId);
        console.log(`Task ${args.taskId} resumed`);
        break;
      }

      case 'stop': {
        if (!args.taskId) {
          console.error('Error: --task-id is required');
          process.exit(1);
        }
        await client.stopTask(args.taskId);
        console.log(`Task ${args.taskId} stopped`);
        break;
      }

      default:
        console.error(`Unknown command: ${args.command}`);
        console.error('Use: bun run src/index.ts help');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the CLI
main();
