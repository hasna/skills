import { resolve } from 'node:path';
import ora from 'ora';
import { E2BSwarm } from '../lib/e2b';
import { loadTasks, distributeTasks, determineTaskSource, summarizeDistribution } from '../lib/tasks';
import { loadConfig, loadState, saveState } from '../lib/config';
import { logger } from '../lib/logger';
import { paths } from '../lib/paths';
import type { SpawnOptions, SwarmInstance } from '../types';

export async function spawn(options: SpawnOptions) {
  const spinner = ora('Loading configuration...').start();

  try {
    // Validate source options
    if (!options.repo && !options.local) {
      throw new Error(
        'Must specify either --repo <url> or --local <path>\n' +
        '  --repo <url>    Clone from git repository\n' +
        '  --local <path>  Upload from local directory'
      );
    }

    if (options.repo && options.local) {
      throw new Error('Cannot specify both --repo and --local');
    }

    // Determine source type
    const sourceType = options.local ? 'local' : 'repo';
    const source = options.local ? resolve(options.local) : options.repo!;

    // Load config with template
    const config = await loadConfig(options.template);
    spinner.succeed(`Configuration loaded (template: ${config.template})`);

    // Determine task source and load tasks
    spinner.start('Loading tasks...');
    const taskSource = determineTaskSource(options);
    const allTasks = await loadTasks(taskSource);
    spinner.succeed(`Loaded ${allTasks.length} tasks from ${taskSource.type}`);

    // Parse instance count
    const instanceCount = parseInt(options.instances, 10);
    if (isNaN(instanceCount) || instanceCount < 1) {
      throw new Error('Instance count must be a positive number');
    }

    if (instanceCount > config.maxInstances) {
      throw new Error(`Maximum ${config.maxInstances} instances allowed`);
    }

    // Distribute tasks
    const distributeMode = options.distribute || 'all';
    const distribution = distributeTasks(allTasks, instanceCount, distributeMode);

    logger.header('Task Distribution');
    console.log(summarizeDistribution(distribution));
    console.log();

    // Create swarm manager
    const swarm = new E2BSwarm(config);

    // Load existing state
    const state = await loadState();

    logger.header(`Spawning ${instanceCount} Instances`);
    logger.info(`Source: ${source} (${sourceType})`);
    logger.info(`Template: ${config.template}`);
    logger.info(`Data directory: ${paths.skillData}`);
    console.log();

    // Parse include/exclude patterns
    const include = options.include;
    const exclude = options.exclude;

    // Spawn instances in parallel
    const spawnPromises = distribution.map(async (tasks, i) => {
      if (tasks.length === 0) {
        logger.warn(`Instance ${i + 1} has no tasks assigned, skipping`);
        return null;
      }

      const instance = await swarm.spawn({
        source,
        sourceType,
        tasks,
        prompt: options.prompt || `Execute the assigned tasks from the swarm task list.`,
        branch: options.branch,
        newBranch: options.newBranch,
        include,
        exclude,
        // GitHub integration options
        autoCommit: options.autoCommit,
        autoPush: options.autoPush,
        createPr: options.createPr,
        prTitle: options.prTitle,
        prBase: options.prBase,
      });

      return instance;
    });

    const instances = (await Promise.all(spawnPromises)).filter(
      (i): i is SwarmInstance => i !== null
    );

    // Save state
    state.instances.push(...instances);
    await saveState(state);

    // Summary
    logger.header('Summary');

    const running = instances.filter(i => i.status === 'running').length;
    const failed = instances.filter(i => i.status === 'failed').length;

    logger.info(`Total instances: ${instances.length}`);
    logger.info(`Running: ${running}`);
    if (failed > 0) {
      logger.error(`Failed: ${failed}`);
    }

    console.log();
    logger.info(`Exports: ${paths.exports}`);
    logger.info(`Logs: ${paths.logs}`);
    console.log();
    logger.info('Use `skill-e2bswarm status` to check progress');
    logger.info('Use `skill-e2bswarm collect` to gather results');

  } catch (error) {
    spinner.fail('Failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
