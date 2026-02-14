#!/usr/bin/env bun
import { Command } from 'commander';
import { spawn } from './commands/spawn';
import { status } from './commands/status';
import { kill } from './commands/kill';
import { collect } from './commands/collect';
import { sync } from './commands/sync';
import { install } from './commands/install';
import { paths } from './lib/paths';

const program = new Command();

program
  .name('skill-e2bswarm')
  .description('Spawn E2B sandbox instances for parallel Claude Code task execution')
  .version('0.4.0');

program
  .command('spawn')
  .description('Spawn E2B instances with tasks')
  .option('-r, --repo <url>', 'Git repository URL to clone')
  .option('-l, --local <path>', 'Local directory to upload (alternative to --repo)')
  .option('-t, --tasks <id>', 'Task list ID from ~/.claude/tasks/')
  .option('--tasks-dir <dir>', 'Load tasks from a local directory')
  .option('--tasks-file <file>', 'Load tasks from a JSON file')
  .option('--tasks-json <json>', 'Inline JSON array of tasks')
  .option('-n, --instances <count>', 'Number of parallel instances', '1')
  .option('-p, --prompt <text>', 'Additional prompt/instructions for Claude')
  .option('-b, --branch <name>', 'Git branch to clone (only with --repo)')
  .option('--new-branch <name>', 'Create and switch to new branch before making changes')
  .option('--template <name>', 'E2B template to use', 'hasnaxyz-codebox')
  .option('-d, --distribute <mode>', 'Task distribution: all, round-robin, by-dependency', 'all')
  .option('--include <patterns...>', 'Include only these patterns (for --local)')
  .option('--exclude <patterns...>', 'Exclude these patterns (for --local)')
  // GitHub integration options
  .option('--auto-commit', 'Automatically commit changes when tasks complete')
  .option('--auto-push', 'Automatically push changes (requires --auto-commit)')
  .option('--create-pr', 'Create a pull request after pushing')
  .option('--pr-title <title>', 'Pull request title')
  .option('--pr-base <branch>', 'Base branch for pull request (default: main)')
  .action(spawn);

program
  .command('status')
  .description('Check instance status')
  .option('-i, --instance <id>', 'Specific instance ID (prefix match)')
  .option('-w, --watch', 'Watch for status changes')
  .action(status);

program
  .command('collect')
  .description('Collect results from instances')
  .option('-o, --output <dir>', 'Output directory (default: ~/.skills/skill-e2bswarm/exports/<timestamp>)')
  .option('-i, --instance <id>', 'Specific instance ID (prefix match)')
  .action(collect);

program
  .command('kill')
  .description('Kill running instances')
  .option('-i, --instance <id>', 'Specific instance ID (kills all if not specified)')
  .action(kill);

program
  .command('sync')
  .description('Sync changes back to GitHub (commit, push, create PR)')
  .option('-i, --instance <id>', 'Specific instance ID (prefix match)')
  .option('--commit', 'Commit changes')
  .option('--no-commit', 'Skip committing')
  .option('--push', 'Push changes to remote')
  .option('--no-push', 'Skip pushing')
  .option('--create-pr', 'Create a pull request')
  .option('--pr-title <title>', 'Pull request title')
  .option('--pr-base <branch>', 'Base branch for pull request')
  .option('-m, --message <msg>', 'Commit message')
  .action(sync);

program
  .command('clean')
  .description('Clean up state file (remove old/completed instances)')
  .action(async () => {
    const { loadState, saveState } = await import('./lib/config');
    const { logger } = await import('./lib/logger');

    const state = await loadState();
    const before = state.instances.length;

    // Remove completed and failed instances older than 24 hours
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    state.instances = state.instances.filter(i => {
      if (i.status === 'running' || i.status === 'starting') return true;
      const completedAt = i.completedAt ? new Date(i.completedAt).getTime() : 0;
      return completedAt > cutoff;
    });

    await saveState(state);
    logger.success(`Cleaned up ${before - state.instances.length} old instances`);
  });

program
  .command('info')
  .description('Show skill data directory paths')
  .action(() => {
    console.log('Skill Data Directory Structure:');
    console.log();
    console.log(`  Root:     ${paths.skillData}`);
    console.log(`  Exports:  ${paths.exports}`);
    console.log(`  Logs:     ${paths.logs}`);
    console.log(`  Cache:    ${paths.cache}`);
    console.log(`  Config:   ${paths.config}`);
    console.log(`  State:    ${paths.state}`);
  });

program
  .command('install')
  .description('Install this skill to Claude Code or Codex')
  .option('--claude', 'Install to Claude Code (~/.claude/skills/)')
  .option('--codex', 'Install to OpenAI Codex (~/.codex/skills/)')
  .option('--local', 'Install to local repo (.claude/skills/ or .codex/skills/)')
  .action(install);

program.parse();
