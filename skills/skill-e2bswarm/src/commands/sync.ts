import { Sandbox } from 'e2b';
import ora from 'ora';
import { loadConfig, loadState, saveState } from '../lib/config';
import { logger } from '../lib/logger';
import {
  setupGitHubAuth,
  commitChanges,
  pushChanges,
  createBranch,
  createPullRequest,
  downloadChangedFiles,
  getGitStatus,
} from '../lib/github';
import type { SyncOptions, SwarmInstance } from '../types';

export async function sync(options: SyncOptions) {
  const spinner = ora('Loading state...').start();

  try {
    const config = await loadConfig();
    const state = await loadState();

    if (state.instances.length === 0) {
      spinner.fail('No instances found');
      return;
    }

    // Filter instances
    const instances = options.instance
      ? state.instances.filter(i => i.id.startsWith(options.instance!))
      : state.instances.filter(i =>
          i.status === 'completed' ||
          i.status === 'running' ||
          i.status === 'committing' ||
          i.status === 'pushing'
        );

    if (instances.length === 0) {
      spinner.fail('No instances to sync');
      logger.info('Use `skill-e2bswarm status` to check instance status');
      return;
    }

    spinner.succeed(`Found ${instances.length} instances to sync`);

    for (const instance of instances) {
      await syncInstance(instance, config, options);
    }

    // Save updated state
    await saveState(state);

    logger.header('Sync Complete');

    // Summary
    const committed = instances.filter(i => i.committed).length;
    const pushed = instances.filter(i => i.pushed).length;
    const prs = instances.filter(i => i.prUrl).length;

    if (committed > 0) logger.info(`Committed: ${committed} instances`);
    if (pushed > 0) logger.info(`Pushed: ${pushed} instances`);
    if (prs > 0) {
      logger.info(`PRs created: ${prs}`);
      for (const instance of instances) {
        if (instance.prUrl) {
          logger.success(`  ${instance.prUrl}`);
        }
      }
    }

  } catch (error) {
    spinner.fail('Failed');
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function syncInstance(
  instance: SwarmInstance,
  config: { apiKey: string; template: string; timeout: number; maxInstances: number },
  options: SyncOptions
): Promise<void> {
  const shortId = instance.id.slice(0, 8);

  if (!instance.sandboxId) {
    logger.warn(`[${shortId}] No sandbox ID, skipping`);
    return;
  }

  if (instance.sourceType !== 'repo') {
    logger.warn(`[${shortId}] Not a repo source, skipping GitHub sync`);
    return;
  }

  try {
    const sandbox = await Sandbox.connect(instance.sandboxId, {
      apiKey: config.apiKey,
    });

    // Setup GitHub auth
    await setupGitHubAuth(sandbox);

    // Get git status
    const gitStatus = await getGitStatus(sandbox);
    logger.instance(instance.id, 'syncing', `Branch: ${gitStatus.branch}`);

    const hasChanges =
      gitStatus.modified.length > 0 ||
      gitStatus.added.length > 0 ||
      gitStatus.deleted.length > 0;

    if (!hasChanges) {
      logger.instance(instance.id, 'syncing', 'No changes to sync');
      return;
    }

    logger.instance(instance.id, 'syncing',
      `Changes: ${gitStatus.modified.length} modified, ${gitStatus.added.length} added, ${gitStatus.deleted.length} deleted`
    );

    // Download changed files to local export dir
    const downloadedFiles = await downloadChangedFiles(sandbox, instance);
    if (downloadedFiles.length > 0) {
      logger.instance(instance.id, 'syncing', `Downloaded ${downloadedFiles.length} files to ${instance.exportDir}/changes`);
    }

    // Create new branch if specified
    if (instance.newBranch && gitStatus.branch !== instance.newBranch) {
      const branchResult = await createBranch(sandbox, instance.newBranch);
      if (!branchResult.success) {
        logger.error(`[${shortId}] ${branchResult.error}`);
        return;
      }
      logger.instance(instance.id, 'syncing', `Created branch: ${instance.newBranch}`);
    }

    // Commit if requested
    if (options.commit !== false && (options.commit || instance.autoCommit)) {
      instance.status = 'committing';
      const commitMessage = options.message ||
        `chore: automated changes from e2b-swarm\n\nInstance: ${instance.id}\nTasks completed: ${instance.tasks.filter(t => t.status === 'completed').length}/${instance.tasks.length}`;

      const commitResult = await commitChanges(sandbox, commitMessage);
      if (!commitResult.success) {
        logger.error(`[${shortId}] ${commitResult.error}`);
        return;
      }
      instance.committed = true;
      logger.instance(instance.id, 'committing', 'Changes committed');
    }

    // Push if requested
    if (options.push !== false && (options.push || instance.autoPush)) {
      instance.status = 'pushing';
      const pushResult = await pushChanges(sandbox, instance.newBranch);
      if (!pushResult.success) {
        logger.error(`[${shortId}] ${pushResult.error}`);
        return;
      }
      instance.pushed = true;
      logger.instance(instance.id, 'pushing', 'Changes pushed');
    }

    // Create PR if requested
    if (options.createPr || instance.createPr) {
      instance.status = 'creating-pr';
      const prTitle = options.prTitle || instance.prTitle ||
        `[E2B Swarm] Automated changes - ${shortId}`;

      const prBody = `## Automated Changes

This PR was created by E2B Swarm.

**Instance ID:** ${instance.id}
**Tasks completed:** ${instance.tasks.filter(t => t.status === 'completed').length}/${instance.tasks.length}

### Tasks

${instance.tasks.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.subject}`).join('\n')}

---
🤖 Generated by skill-e2bswarm
`;

      const prResult = await createPullRequest(sandbox, {
        title: prTitle,
        body: prBody,
        base: options.prBase || instance.prBase,
        draft: false,
      });

      if (!prResult.success) {
        logger.error(`[${shortId}] ${prResult.error}`);
        return;
      }

      instance.prUrl = prResult.prUrl;
      logger.instance(instance.id, 'creating-pr', `PR created: ${prResult.prUrl}`);
    }

    instance.status = 'completed';

  } catch (error) {
    logger.error(`[${shortId}] Failed: ${error instanceof Error ? error.message : error}`);
    instance.status = 'failed';
    instance.error = error instanceof Error ? error.message : String(error);
  }
}
