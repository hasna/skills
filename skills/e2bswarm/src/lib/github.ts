import { Sandbox } from 'e2b';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SwarmInstance } from '../types';
import { logger } from './logger';

/**
 * Setup GitHub authentication in sandbox
 */
export async function setupGitHubAuth(sandbox: Sandbox): Promise<void> {
  // Check for GitHub token in environment
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (ghToken) {
    // Use token-based auth
    await sandbox.commands.run(`
      git config --global credential.helper store
      echo "https://oauth2:${ghToken}@github.com" > ~/.git-credentials
      git config --global user.email "swarm@e2b.dev"
      git config --global user.name "E2B Swarm"
    `);
    return;
  }

  // Try to copy SSH key from local machine
  const sshKeyPath = `${process.env.HOME}/.ssh/id_ed25519`;
  try {
    const privateKey = await Bun.file(sshKeyPath).text();
    const publicKey = await Bun.file(`${sshKeyPath}.pub`).text();

    await sandbox.commands.run('mkdir -p ~/.ssh && chmod 700 ~/.ssh');
    await sandbox.files.write('/home/user/.ssh/id_ed25519', privateKey);
    await sandbox.files.write('/home/user/.ssh/id_ed25519.pub', publicKey);
    await sandbox.commands.run(`
      chmod 600 ~/.ssh/id_ed25519
      chmod 644 ~/.ssh/id_ed25519.pub
      ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
      git config --global user.email "swarm@e2b.dev"
      git config --global user.name "E2B Swarm"
    `);
    return;
  } catch {
    // SSH key not found, try id_rsa
  }

  const rsaKeyPath = `${process.env.HOME}/.ssh/id_rsa`;
  try {
    const privateKey = await Bun.file(rsaKeyPath).text();
    const publicKey = await Bun.file(`${rsaKeyPath}.pub`).text();

    await sandbox.commands.run('mkdir -p ~/.ssh && chmod 700 ~/.ssh');
    await sandbox.files.write('/home/user/.ssh/id_rsa', privateKey);
    await sandbox.files.write('/home/user/.ssh/id_rsa.pub', publicKey);
    await sandbox.commands.run(`
      chmod 600 ~/.ssh/id_rsa
      chmod 644 ~/.ssh/id_rsa.pub
      ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
      git config --global user.email "swarm@e2b.dev"
      git config --global user.name "E2B Swarm"
    `);
    return;
  } catch {
    // No SSH key found
  }

  logger.warn('No GitHub authentication found. Set GITHUB_TOKEN or ensure SSH keys exist.');
}

/**
 * Commit changes in the sandbox
 */
export async function commitChanges(
  sandbox: Sandbox,
  message: string
): Promise<{ success: boolean; error?: string }> {
  // Stage all changes
  const addResult = await sandbox.commands.run('cd /home/user/workspace && git add -A');
  if (addResult.exitCode !== 0) {
    return { success: false, error: `Failed to stage changes: ${addResult.stderr}` };
  }

  // Check if there are changes to commit
  const statusResult = await sandbox.commands.run('cd /home/user/workspace && git status --porcelain');
  if (!statusResult.stdout.trim()) {
    return { success: true }; // No changes to commit
  }

  // Commit
  const commitResult = await sandbox.commands.run(
    `cd /home/user/workspace && git commit -m "${message.replace(/"/g, '\\"')}"`
  );
  if (commitResult.exitCode !== 0) {
    return { success: false, error: `Failed to commit: ${commitResult.stderr}` };
  }

  return { success: true };
}

/**
 * Push changes to remote
 */
export async function pushChanges(
  sandbox: Sandbox,
  branch?: string
): Promise<{ success: boolean; error?: string }> {
  const pushCmd = branch
    ? `cd /home/user/workspace && git push -u origin ${branch}`
    : 'cd /home/user/workspace && git push';

  const result = await sandbox.commands.run(pushCmd, { timeoutMs: 60000 });
  if (result.exitCode !== 0) {
    return { success: false, error: `Failed to push: ${result.stderr}` };
  }

  return { success: true };
}

/**
 * Create a new branch
 */
export async function createBranch(
  sandbox: Sandbox,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  const result = await sandbox.commands.run(
    `cd /home/user/workspace && git checkout -b ${branchName}`
  );
  if (result.exitCode !== 0) {
    return { success: false, error: `Failed to create branch: ${result.stderr}` };
  }

  return { success: true };
}

/**
 * Create a pull request using gh CLI
 */
export async function createPullRequest(
  sandbox: Sandbox,
  options: {
    title: string;
    body: string;
    base?: string;
    draft?: boolean;
  }
): Promise<{ success: boolean; prUrl?: string; error?: string }> {
  // Install gh CLI if not present
  await sandbox.commands.run(`
    which gh || (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    sudo apt update && sudo apt install gh -y) 2>/dev/null || true
  `, { timeoutMs: 120000 });

  // Check for GitHub token
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!ghToken) {
    return { success: false, error: 'GITHUB_TOKEN not set. Cannot create PR.' };
  }

  // Authenticate gh CLI
  await sandbox.commands.run(`echo "${ghToken}" | gh auth login --with-token`);

  // Build PR command
  const baseFlag = options.base ? `--base ${options.base}` : '';
  const draftFlag = options.draft ? '--draft' : '';

  const prCmd = `cd /home/user/workspace && gh pr create --title "${options.title.replace(/"/g, '\\"')}" --body "${options.body.replace(/"/g, '\\"')}" ${baseFlag} ${draftFlag}`;

  const result = await sandbox.commands.run(prCmd, { timeoutMs: 60000 });
  if (result.exitCode !== 0) {
    return { success: false, error: `Failed to create PR: ${result.stderr}` };
  }

  // Extract PR URL from output
  const prUrl = result.stdout.trim().split('\n').pop();

  return { success: true, prUrl };
}

/**
 * Download changed files from sandbox to local export directory
 */
export async function downloadChangedFiles(
  sandbox: Sandbox,
  instance: SwarmInstance
): Promise<string[]> {
  const exportDir = instance.exportDir;
  if (!exportDir) return [];

  // Get list of changed files
  const diffResult = await sandbox.commands.run(
    'cd /home/user/workspace && git diff --name-only HEAD~1 2>/dev/null || git diff --name-only'
  );

  const changedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);
  const downloadedFiles: string[] = [];

  // Create changes directory
  const changesDir = join(exportDir, 'changes');
  await mkdir(changesDir, { recursive: true });

  for (const file of changedFiles) {
    try {
      const content = await sandbox.files.read(`/home/user/workspace/${file}`);
      const localPath = join(changesDir, file);
      await mkdir(join(changesDir, file.split('/').slice(0, -1).join('/')), { recursive: true });
      await Bun.write(localPath, content);
      downloadedFiles.push(file);
    } catch {
      // File might have been deleted
    }
  }

  return downloadedFiles;
}

/**
 * Get git status from sandbox
 */
export async function getGitStatus(sandbox: Sandbox): Promise<{
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  added: string[];
  deleted: string[];
}> {
  const branchResult = await sandbox.commands.run('cd /home/user/workspace && git branch --show-current');
  const statusResult = await sandbox.commands.run('cd /home/user/workspace && git status --porcelain');

  const modified: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  for (const line of statusResult.stdout.split('\n')) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3);

    if (status.includes('M')) modified.push(file);
    if (status.includes('A') || status === '??') added.push(file);
    if (status.includes('D')) deleted.push(file);
  }

  return {
    branch: branchResult.stdout.trim(),
    ahead: 0,
    behind: 0,
    modified,
    added,
    deleted,
  };
}
