import ora from 'ora';
import { E2BSwarm } from '../lib/e2b';
import { loadConfig, loadState, saveState } from '../lib/config';
import { logger } from '../lib/logger';
import type { KillOptions } from '../types';

export async function kill(options: KillOptions) {
  const spinner = ora('Loading state...').start();

  try {
    const config = await loadConfig();
    const state = await loadState();

    if (state.instances.length === 0) {
      spinner.info('No instances found');
      return;
    }

    const swarm = new E2BSwarm(config);

    // Filter instances to kill
    let instances = state.instances.filter(
      i => i.status === 'running' || i.status === 'starting' || i.status === 'setting-up' || i.status === 'cloning'
    );

    if (options.instance) {
      instances = instances.filter(i => i.id.startsWith(options.instance!));
    }

    if (instances.length === 0) {
      spinner.info('No running instances to kill');
      return;
    }

    spinner.succeed(`Found ${instances.length} instances to kill`);

    logger.header('Killing Instances');

    for (const instance of instances) {
      const shortId = instance.id.slice(0, 8);
      spinner.start(`[${shortId}] Killing...`);

      try {
        await swarm.kill(instance);
        spinner.succeed(`[${shortId}] Killed`);
      } catch (error) {
        spinner.warn(`[${shortId}] Failed: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Update state
    await saveState(state);

    logger.header('Summary');
    logger.info(`Killed ${instances.length} instances`);

  } catch (error) {
    spinner.fail('Failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
