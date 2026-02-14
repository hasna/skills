#!/usr/bin/env bun

/**
 * Deployment CLI
 * Automates deployment to EC2 instances with health checks
 */
import { handleInstallCommand } from '../../_common';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-deploy',
  description: 'Deployment CLI for managing EC2 deployments with automated health checks',
  version: '1.0.0',
  commands: `Use: skill-deploy --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { deploy } from './deployer';
import { getHost, listHosts, getHostNames } from './hosts';
import type { DeploymentOptions } from './types';

/**
 * Parse command line arguments
 */
function parseArgs(): {
  command: string;
  hosts?: string[];
  skipHealthCheck?: boolean;
  skipRestart?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  parallel?: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, any> = {
    command: args[0] || 'help',
    hosts: [],
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');

      if (
        key === 'skip-health' ||
        key === 'skip-health-check' ||
        key === 'no-health'
      ) {
        parsed.skipHealthCheck = true;
      } else if (
        key === 'skip-restart' ||
        key === 'no-restart' ||
        key === 'no-service'
      ) {
        parsed.skipRestart = true;
      } else if (key === 'dry-run' || key === 'dry') {
        parsed.dryRun = true;
      } else if (key === 'verbose' || key === 'v') {
        parsed.verbose = true;
      } else if (key === 'force' || key === 'f') {
        parsed.force = true;
      } else if (key === 'parallel' || key === 'p') {
        parsed.parallel = true;
      } else if (key === 'host' || key === 'h') {
        // Support --host flag with comma-separated hosts
        const hostArg = args[i + 1];
        if (hostArg) {
          parsed.hosts.push(...hostArg.split(','));
          i++;
        }
      } else if (key === 'all') {
        // Deploy to all configured hosts
        parsed.hosts = getHostNames();
      }
    } else if (i > 0) {
      // Collect all positional arguments as hosts (comma-separated or space-separated)
      parsed.hosts.push(...arg.split(','));
    }
  }

  return parsed as any;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
skill-deploy - Deployment CLI for EC2 instances

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  deploy <host...>        Deploy to one or more hosts
  list                    List available hosts
  health <host>           Run health check on host
  status <host>           Check service status on host
  help                    Show this help message

OPTIONS:
  --host, -h <name>       Target host name (can use multiple times)
  --all                   Deploy to all configured hosts
  --parallel, -p          Deploy to multiple hosts in parallel
  --skip-health           Skip health check
  --skip-restart          Skip service restart
  --dry-run               Show what would be done
  --verbose, -v           Verbose output
  --force, -f             Force deployment even if up-to-date

EXAMPLES:
  # Deploy to single host
  bun run src/index.ts deploy lab-mcp

  # Deploy to multiple hosts (sequential)
  bun run src/index.ts deploy lab-mcp prod-skill

  # Deploy to multiple hosts (parallel)
  bun run src/index.ts deploy lab-mcp,prod-skill --parallel

  # Deploy to all configured hosts
  bun run src/index.ts deploy --all

  # Deploy with verbose output
  bun run src/index.ts deploy lab-mcp --verbose

  # Deploy without restarting service
  bun run src/index.ts deploy prod-skill --skip-restart

  # List available hosts
  bun run src/index.ts list

  # Check health
  bun run src/index.ts health lab-mcp

AVAILABLE HOSTS:
${getHostNames().map((name) => `  - ${name}`).join('\n')}
`);
}

/**
 * List all hosts
 */
function showHosts() {
  const hosts = listHosts();

  console.log('\nAvailable Deployment Hosts:\n');

  for (const host of hosts) {
    console.log(`📦 ${host.name} (${host.sshHost})`);
    console.log(`   Path: ${host.deployPath}`);
    console.log(`   Service: ${host.service || 'N/A'}`);
    console.log(`   Health: ${host.healthUrl || 'N/A'}`);
    console.log('');
  }
}

/**
 * Run health check command
 */
async function runHealthCommand(hostName: string) {
  const host = getHost(hostName);

  if (!host) {
    console.error(`❌ Unknown host: ${hostName}`);
    console.log(`\nAvailable hosts: ${getHostNames().join(', ')}`);
    process.exit(1);
  }

  if (!host.healthUrl) {
    console.error(`❌ No health check configured for ${host.name}`);
    process.exit(1);
  }

  console.log(`🏥 Running health check for ${host.name}...\n`);

  const { healthCheck } = await import('./health');
  const result = await healthCheck(host.sshHost, host.healthUrl);

  if (result.passed) {
    console.log(`✅ Health check passed (${result.duration}ms)`);
    if (result.response) {
      console.log(`\nResponse:`);
      console.log(JSON.stringify(result.response, null, 2));
    }
    process.exit(0);
  } else {
    console.error(`❌ Health check failed: ${result.error}`);
    process.exit(1);
  }
}

/**
 * Run status command
 */
async function runStatusCommand(hostName: string) {
  const host = getHost(hostName);

  if (!host) {
    console.error(`❌ Unknown host: ${hostName}`);
    console.log(`\nAvailable hosts: ${getHostNames().join(', ')}`);
    process.exit(1);
  }

  if (!host.service) {
    console.error(`❌ No service configured for ${host.name}`);
    process.exit(1);
  }

  console.log(`📊 Checking status for ${host.name}...\n`);

  const { checkService } = await import('./health');
  const result = await checkService(host.sshHost, host.service);

  if (result.running) {
    console.log(`✅ Service ${host.service} is running`);
    if (result.status) {
      console.log(`   Status: ${result.status}`);
    }
    process.exit(0);
  } else {
    console.error(`❌ Service ${host.service} is not running`);
    if (result.error) {
      console.error(`   Error: ${result.error}`);
    }
    process.exit(1);
  }
}

/**
 * Run deploy command for multiple hosts
 */
async function runDeployCommand(
  hostNames: string[],
  options: DeploymentOptions & { parallel?: boolean }
) {
  // Validate all hosts exist
  const hosts = hostNames.map((hostName) => {
    const host = getHost(hostName);
    if (!host) {
      console.error(`❌ Unknown host: ${hostName}`);
      console.log(`\nAvailable hosts: ${getHostNames().join(', ')}`);
      process.exit(1);
    }
    return host;
  });

  if (options.dryRun) {
    console.log(`\n🔍 DRY RUN - No changes will be made\n`);
  }

  const results = [];

  if (options.parallel && hosts.length > 1) {
    // Deploy to all hosts in parallel
    console.log(
      `\n🚀 Starting parallel deployment to ${hosts.length} hosts...\n`
    );
    const promises = hosts.map((host) => deploy(host, options));
    results.push(...(await Promise.all(promises)));
  } else {
    // Deploy to hosts sequentially
    for (const host of hosts) {
      const result = await deploy(host, options);
      results.push(result);
    }
  }

  // Summary
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`\n📊 Deployment Summary:`);
  console.log(`   Total: ${results.length}`);
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log('');

  // Show errors
  const failedResults = results.filter((r) => !r.success);
  if (failedResults.length > 0) {
    console.error(`Failed deployments:`);
    for (const result of failedResults) {
      console.error(`  - ${result.host}`);
      if (result.errors) {
        result.errors.forEach((error) => console.error(`    • ${error}`));
      }
    }
    process.exit(1);
  }

  process.exit(0);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = parseArgs();

  switch (args.command) {
    case 'deploy':
      if (!args.hosts || args.hosts.length === 0) {
        console.error(`❌ Host name required`);
        console.log(`\nUsage: bun run src/index.ts deploy <host> [host2...]`);
        console.log(`\nAvailable hosts: ${getHostNames().join(', ')}`);
        process.exit(1);
      }
      await runDeployCommand(args.hosts, {
        skipHealthCheck: args.skipHealthCheck,
        skipRestart: args.skipRestart,
        dryRun: args.dryRun,
        verbose: args.verbose,
        force: args.force,
        parallel: args.parallel,
      });
      break;

    case 'list':
    case 'hosts':
      showHosts();
      break;

    case 'health':
      if (!args.hosts || args.hosts.length === 0) {
        console.error(`❌ Host name required`);
        console.log(`\nUsage: bun run src/index.ts health <host>`);
        console.log(`\nAvailable hosts: ${getHostNames().join(', ')}`);
        process.exit(1);
      }
      await runHealthCommand(args.hosts[0]);
      break;

    case 'status':
      if (!args.hosts || args.hosts.length === 0) {
        console.error(`❌ Host name required`);
        console.log(`\nUsage: bun run src/index.ts status <host>`);
        console.log(`\nAvailable hosts: ${getHostNames().join(', ')}`);
        process.exit(1);
      }
      await runStatusCommand(args.hosts[0]);
      break;

    case 'help':
    case '--help':
    case '-h':
    default:
      showHelp();
      break;
  }
}

main().catch((error) => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
