import { E2BSwarm } from '../lib/e2b';
import { loadConfig, loadState, saveState } from '../lib/config';
import { logger } from '../lib/logger';
import type { StatusOptions } from '../types';

export async function status(options: StatusOptions) {
  try {
    const config = await loadConfig();
    const state = await loadState();

    if (state.instances.length === 0) {
      logger.info('No instances found. Use `e2b-swarm spawn` to create instances.');
      return;
    }

    const swarm = new E2BSwarm(config);

    logger.header('Instance Status');

    // Filter to specific instance if requested
    const instances = options.instance
      ? state.instances.filter(i => i.id.startsWith(options.instance!))
      : state.instances;

    if (instances.length === 0) {
      logger.warn(`No instance found matching: ${options.instance}`);
      return;
    }

    // Check and update status for running instances
    for (const instance of instances) {
      if (instance.status === 'running') {
        const updated = await swarm.checkInstance(instance);
        Object.assign(instance, updated);
      }
    }

    // Save updated state
    await saveState(state);

    // Display status
    for (const instance of instances) {
      const shortId = instance.id.slice(0, 8);
      const duration = instance.completedAt
        ? formatDuration(new Date(instance.completedAt).getTime() - new Date(instance.startedAt).getTime())
        : formatDuration(Date.now() - new Date(instance.startedAt).getTime());

      logger.instance(instance.id, instance.status, `${instance.tasks.length} tasks`);
      console.log(`           Repo: ${instance.source}`);
      console.log(`           Duration: ${duration}`);
      console.log(`           Sandbox: ${instance.sandboxId || 'N/A'}`);

      if (instance.error) {
        console.log(`           Error: ${instance.error}`);
      }

      console.log();
    }

    // Summary
    const summary = {
      total: instances.length,
      starting: instances.filter(i => ['starting', 'cloning', 'setting-up'].includes(i.status)).length,
      running: instances.filter(i => i.status === 'running').length,
      completed: instances.filter(i => i.status === 'completed').length,
      failed: instances.filter(i => i.status === 'failed').length,
    };

    logger.divider();
    console.log(`Total: ${summary.total} | Running: ${summary.running} | Completed: ${summary.completed} | Failed: ${summary.failed}`);

  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
