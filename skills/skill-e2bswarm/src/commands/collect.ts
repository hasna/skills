import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import ora from 'ora';
import { E2BSwarm } from '../lib/e2b';
import { loadConfig, loadState } from '../lib/config';
import { logger } from '../lib/logger';
import { paths } from '../lib/paths';
import type { CollectOptions } from '../types';

export async function collect(options: CollectOptions) {
  const spinner = ora('Loading state...').start();

  try {
    const config = await loadConfig();
    const state = await loadState();

    if (state.instances.length === 0) {
      spinner.fail('No instances found');
      return;
    }

    const swarm = new E2BSwarm(config);

    // Filter instances
    const instances = options.instance
      ? state.instances.filter(i => i.id.startsWith(options.instance!))
      : state.instances.filter(i => i.status === 'completed' || i.status === 'running');

    if (instances.length === 0) {
      spinner.fail('No completed instances to collect from');
      logger.info('Use `skill-e2bswarm status` to check instance status');
      return;
    }

    spinner.text = `Found ${instances.length} instances to collect from`;

    // Use provided output dir or default to skill exports directory
    const outputDir = options.output || paths.getExportDir('collect');
    await mkdir(outputDir, { recursive: true });
    spinner.succeed(`Output directory: ${outputDir}`);

    logger.header('Collecting Results');

    const results: Array<{
      instanceId: string;
      status: string;
      tasks: number;
      completed: number;
      outputFile: string;
    }> = [];

    for (const instance of instances) {
      const shortId = instance.id.slice(0, 8);
      spinner.start(`[${shortId}] Collecting...`);

      try {
        if (instance.status === 'running') {
          // Update status first
          const updated = await swarm.checkInstance(instance);
          Object.assign(instance, updated);
        }

        if (instance.sandboxId) {
          const collected = await swarm.collectResults(instance);

          // Write results to file
          const outputFile = join(outputDir, `${shortId}-results.json`);
          const resultData = {
            instanceId: instance.id,
            sandboxId: instance.sandboxId,
            template: instance.template,
            source: instance.source,
            sourceType: instance.sourceType,
            status: instance.status,
            startedAt: instance.startedAt,
            completedAt: instance.completedAt,
            duration: instance.completedAt
              ? new Date(instance.completedAt).getTime() - new Date(instance.startedAt).getTime()
              : null,
            tasks: collected.tasks,
            output: collected.output,
            logs: collected.logs,
          };

          await Bun.write(outputFile, JSON.stringify(resultData, null, 2));

          // Also copy to instance export dir if it exists
          if (instance.exportDir) {
            await mkdir(instance.exportDir, { recursive: true });
            await Bun.write(join(instance.exportDir, 'results.json'), JSON.stringify(resultData, null, 2));
          }

          const completedTasks = collected.tasks.filter(t => t.status === 'completed').length;
          results.push({
            instanceId: shortId,
            status: instance.status,
            tasks: collected.tasks.length,
            completed: completedTasks,
            outputFile,
          });

          spinner.succeed(`[${shortId}] Collected ${completedTasks}/${collected.tasks.length} tasks`);
        } else {
          spinner.warn(`[${shortId}] No sandbox ID, skipping`);
        }
      } catch (error) {
        spinner.warn(`[${shortId}] Failed: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Write summary
    const summaryFile = join(outputDir, 'summary.json');
    const summary = {
      collectedAt: new Date().toISOString(),
      outputDir,
      totalInstances: results.length,
      totalTasks: results.reduce((sum, r) => sum + r.tasks, 0),
      completedTasks: results.reduce((sum, r) => sum + r.completed, 0),
      instances: results,
    };

    await Bun.write(summaryFile, JSON.stringify(summary, null, 2));

    logger.header('Summary');
    logger.info(`Instances collected: ${results.length}`);
    logger.info(`Total tasks: ${summary.totalTasks}`);
    logger.info(`Completed tasks: ${summary.completedTasks}`);
    logger.info(`Results saved to: ${outputDir}`);

  } catch (error) {
    spinner.fail('Failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
