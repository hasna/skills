import { Sandbox } from 'e2b';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { SwarmInstance, SwarmConfig, Task } from '../types';
import { logger } from './logger';
import { paths } from './paths';

// Default patterns to exclude when uploading local files
const DEFAULT_EXCLUDE = [
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.cache',
  '*.log',
  '.DS_Store',
  '.env',
  '.env.local',
  '.env*.local',
];

export class E2BSwarm {
  private config: SwarmConfig;

  constructor(config: SwarmConfig) {
    this.config = config;
  }

  /**
   * Spawn a new E2B sandbox instance
   */
  async spawn(options: {
    source: string;
    sourceType: 'repo' | 'local';
    tasks: Task[];
    prompt: string;
    branch?: string;
    newBranch?: string;
    include?: string[];
    exclude?: string[];
    // GitHub options
    autoCommit?: boolean;
    autoPush?: boolean;
    createPr?: boolean;
    prTitle?: string;
    prBase?: string;
  }): Promise<SwarmInstance> {
    const instanceId = crypto.randomUUID();
    const shortId = instanceId.slice(0, 8);

    // Create instance-specific directories
    const instancePaths = paths.getInstance(shortId);
    await mkdir(instancePaths.exports, { recursive: true });
    await mkdir(instancePaths.logs, { recursive: true });

    const instance: SwarmInstance = {
      id: instanceId,
      sandboxId: '',
      template: this.config.template,
      status: 'starting',
      source: options.source,
      sourceType: options.sourceType,
      branch: options.branch,
      newBranch: options.newBranch,
      tasks: options.tasks,
      prompt: options.prompt,
      startedAt: new Date().toISOString(),
      exportDir: instancePaths.exports,
      logFile: `${instancePaths.logs}/execution.log`,
      // GitHub integration options
      autoCommit: options.autoCommit,
      autoPush: options.autoPush,
      createPr: options.createPr,
      prTitle: options.prTitle,
      prBase: options.prBase,
    };

    try {
      logger.instance(instanceId, 'starting', `Using template: ${this.config.template}`);

      // Create the sandbox with specified template
      const sandbox = await Sandbox.create(this.config.template, {
        apiKey: this.config.apiKey,
        timeoutMs: this.config.timeout,
      });

      instance.sandboxId = sandbox.sandboxId;
      logger.instance(instanceId, 'starting', `Sandbox ID: ${sandbox.sandboxId}`);

      // Setup the instance based on source type
      if (options.sourceType === 'local') {
        await this.setupInstanceFromLocal(sandbox, instance, options.include, options.exclude);
      } else {
        await this.setupInstanceFromRepo(sandbox, instance);
      }

      return instance;
    } catch (error) {
      instance.status = 'failed';
      instance.error = error instanceof Error ? error.message : String(error);
      logger.instance(instanceId, 'failed', instance.error);

      // Log error to file
      await this.appendLog(instance, `ERROR: ${instance.error}`);

      return instance;
    }
  }

  /**
   * Load Anthropic API key from ~/.secrets
   */
  private async loadAnthropicKey(): Promise<string | undefined> {
    try {
      const secrets = await Bun.file(`${process.env.HOME}/.secrets`).text();
      const match = secrets.match(/ANTHROPIC_API_KEY=["']?([^"'\n]+)["']?/);
      return match?.[1];
    } catch {
      return undefined;
    }
  }

  /**
   * Append to instance log file
   */
  private async appendLog(instance: SwarmInstance, message: string): Promise<void> {
    if (!instance.logFile) return;
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    try {
      const existing = await Bun.file(instance.logFile).text().catch(() => '');
      await Bun.write(instance.logFile, existing + logLine);
    } catch {
      // Ignore log write errors
    }
  }

  /**
   * Setup instance by uploading local files
   */
  private async setupInstanceFromLocal(
    sandbox: Sandbox,
    instance: SwarmInstance,
    include?: string[],
    exclude?: string[]
  ): Promise<void> {
    const localPath = instance.source;
    const excludePatterns = [...DEFAULT_EXCLUDE, ...(exclude || [])];

    instance.status = 'uploading';
    logger.instance(instance.id, 'uploading', localPath);
    await this.appendLog(instance, `Uploading local files from: ${localPath}`);

    // Create workspace directory
    await sandbox.commands.run('mkdir -p /home/user/workspace');

    // Get all files to upload
    const files = await this.getFilesToUpload(localPath, excludePatterns, include);
    await this.appendLog(instance, `Found ${files.length} files to upload`);

    // Upload files in batches
    let uploaded = 0;
    for (const file of files) {
      const relativePath = relative(localPath, file);
      const remotePath = `/home/user/workspace/${relativePath}`;

      try {
        const content = await Bun.file(file).text();
        await sandbox.files.write(remotePath, content);
        uploaded++;

        if (uploaded % 50 === 0) {
          logger.instance(instance.id, 'uploading', `${uploaded}/${files.length} files`);
        }
      } catch (error) {
        // Skip binary files or files that fail to read
        await this.appendLog(instance, `Skipped: ${relativePath} (${error})`);
      }
    }

    await this.appendLog(instance, `Uploaded ${uploaded} files`);
    logger.instance(instance.id, 'uploading', `${uploaded} files uploaded`);

    // Continue with common setup
    await this.finishSetup(sandbox, instance);
  }

  /**
   * Setup instance by cloning from git repo
   */
  private async setupInstanceFromRepo(sandbox: Sandbox, instance: SwarmInstance): Promise<void> {
    const { source: repo, branch } = instance;

    await this.appendLog(instance, `Starting setup for repo: ${repo}`);

    // Clone the repository
    instance.status = 'cloning';
    logger.instance(instance.id, 'cloning', repo);
    await this.appendLog(instance, `Cloning repository...`);

    const cloneCmd = branch
      ? `git clone --branch ${branch} --depth 1 ${repo} /home/user/workspace`
      : `git clone --depth 1 ${repo} /home/user/workspace`;

    const cloneResult = await sandbox.commands.run(cloneCmd, { timeoutMs: 120000 });
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone repo: ${cloneResult.stderr}`);
    }
    await this.appendLog(instance, `Clone successful`);

    // Continue with common setup
    await this.finishSetup(sandbox, instance);
  }

  /**
   * Common setup after files are in place
   */
  private async finishSetup(sandbox: Sandbox, instance: SwarmInstance): Promise<void> {
    const { tasks, prompt } = instance;

    // Setup directories
    instance.status = 'setting-up';
    logger.instance(instance.id, 'setting-up', 'Creating task files...');
    await this.appendLog(instance, `Setting up task files...`);

    await sandbox.commands.run('mkdir -p /home/user/workspace/.claude/tasks/swarm');

    // Write individual task files (matching Claude Code format)
    for (const task of tasks) {
      const taskJson = JSON.stringify(task, null, 2);
      await sandbox.files.write(
        `/home/user/workspace/.claude/tasks/swarm/${task.id}.json`,
        taskJson
      );
    }
    await this.appendLog(instance, `Created ${tasks.length} task files`);

    // Write the prompt file
    const promptContent = `# Swarm Task Execution

${prompt}

## Assigned Tasks

${tasks.map(t => `- [${t.id}] ${t.subject}`).join('\n')}

## Instructions

1. Read each task using TaskGet
2. Set task status to in_progress when starting
3. Complete the task following its description
4. Set task status to completed when done
5. Move to the next task

Work through all assigned tasks systematically.
`;

    await sandbox.files.write('/home/user/workspace/.claude/swarm-prompt.md', promptContent);

    // Install dependencies
    logger.instance(instance.id, 'setting-up', 'Installing dependencies...');
    await this.appendLog(instance, `Installing dependencies...`);
    await sandbox.commands.run('cd /home/user/workspace && bun install 2>/dev/null || npm install 2>/dev/null || true', {
      timeoutMs: 180000,
    });

    // Start Claude Code (non-blocking, runs in background)
    instance.status = 'running';
    logger.instance(instance.id, 'running', 'Starting Claude Code...');
    await this.appendLog(instance, `Starting Claude Code...`);

    // Get Anthropic API key for Claude Code
    const anthropicKey = process.env.ANTHROPIC_API_KEY || await this.loadAnthropicKey();
    if (!anthropicKey) {
      throw new Error(
        'ANTHROPIC_API_KEY not found. Add it to ~/.secrets:\n' +
        '  export ANTHROPIC_API_KEY="your-api-key"\n\n' +
        'Get your API key at: https://console.anthropic.com'
      );
    }

    // Run Claude Code with the task list
    const claudeCmd = `
      cd /home/user/workspace && \
      export ANTHROPIC_API_KEY="${anthropicKey}" && \
      export CLAUDE_CODE_TASK_LIST_ID=swarm && \
      claude --print "$(cat .claude/swarm-prompt.md)" \
        --dangerously-skip-permissions \
        --output-format json \
        > /home/user/workspace/.claude/swarm-output.json 2>&1 &
      echo $! > /home/user/workspace/.claude/swarm-pid
    `;

    await sandbox.commands.run(claudeCmd);
    logger.instance(instance.id, 'running', 'Claude Code started');
    await this.appendLog(instance, `Claude Code process started`);
  }

  /**
   * Get list of files to upload, respecting exclude patterns
   */
  private async getFilesToUpload(
    dir: string,
    exclude: string[],
    include?: string[]
  ): Promise<string[]> {
    const files: string[] = [];

    const walk = async (currentDir: string) => {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        const relativePath = relative(dir, fullPath);

        // Check if excluded
        if (this.shouldExclude(relativePath, entry.name, exclude)) {
          continue;
        }

        // Check if included (if include patterns specified)
        if (include && include.length > 0 && !this.matchesAny(relativePath, include)) {
          if (!entry.isDirectory()) continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          // Skip large files (> 1MB)
          const stats = await stat(fullPath);
          if (stats.size < 1024 * 1024) {
            files.push(fullPath);
          }
        }
      }
    };

    await walk(dir);
    return files;
  }

  /**
   * Check if path should be excluded
   */
  private shouldExclude(relativePath: string, name: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      // Exact match
      if (name === pattern || relativePath === pattern) return true;

      // Glob pattern (simple)
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(name) || regex.test(relativePath)) return true;
      }

      // Directory match
      if (relativePath.startsWith(pattern + '/')) return true;
    }
    return false;
  }

  /**
   * Check if path matches any pattern
   */
  private matchesAny(path: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(path)) return true;
      } else if (path.startsWith(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check the status of a running instance
   */
  async checkInstance(instance: SwarmInstance): Promise<SwarmInstance> {
    if (!instance.sandboxId || instance.status === 'failed') {
      return instance;
    }

    try {
      const sandbox = await Sandbox.connect(instance.sandboxId, {
        apiKey: this.config.apiKey,
      });

      // Check if Claude Code is still running
      const pidResult = await sandbox.commands.run('cat /home/user/workspace/.claude/swarm-pid 2>/dev/null || echo ""');
      const pid = pidResult.stdout.trim();

      if (pid) {
        const psResult = await sandbox.commands.run(`ps -p ${pid} -o pid= 2>/dev/null || echo ""`);
        if (!psResult.stdout.trim()) {
          // Process completed
          instance.status = 'completed';
          instance.completedAt = new Date().toISOString();

          // Read output
          const outputResult = await sandbox.commands.run('cat /home/user/workspace/.claude/swarm-output.json 2>/dev/null || echo "{}"');
          instance.output = outputResult.stdout;

          await this.appendLog(instance, `Execution completed`);
        }
      }

      return instance;
    } catch (error) {
      // Sandbox might have been closed
      if (instance.status === 'running') {
        instance.status = 'failed';
        instance.error = error instanceof Error ? error.message : 'Sandbox connection lost';
        await this.appendLog(instance, `ERROR: ${instance.error}`);
      }
      return instance;
    }
  }

  /**
   * Collect results from a completed instance
   */
  async collectResults(instance: SwarmInstance): Promise<{
    output: string;
    tasks: Task[];
    logs: string;
  }> {
    if (!instance.sandboxId) {
      throw new Error('Instance has no sandbox ID');
    }

    const sandbox = await Sandbox.connect(instance.sandboxId, {
      apiKey: this.config.apiKey,
    });

    // Read output
    const outputResult = await sandbox.commands.run('cat /home/user/workspace/.claude/swarm-output.json 2>/dev/null || echo "{}"');

    // Read updated task files
    const tasksResult = await sandbox.commands.run('cat /home/user/workspace/.claude/tasks/swarm/*.json 2>/dev/null');
    const taskLines = tasksResult.stdout.split('\n').filter(Boolean);
    const tasks: Task[] = [];

    for (const line of taskLines) {
      try {
        tasks.push(JSON.parse(line));
      } catch {
        // Skip invalid JSON
      }
    }

    // Read any logs
    const logsResult = await sandbox.commands.run('cat /home/user/workspace/.claude/swarm-output.json 2>/dev/null || echo ""');

    await this.appendLog(instance, `Results collected: ${tasks.length} tasks`);

    return {
      output: outputResult.stdout,
      tasks,
      logs: logsResult.stdout,
    };
  }

  /**
   * Kill a sandbox instance
   */
  async kill(instance: SwarmInstance): Promise<void> {
    if (!instance.sandboxId) {
      return;
    }

    try {
      const sandbox = await Sandbox.connect(instance.sandboxId, {
        apiKey: this.config.apiKey,
      });
      await sandbox.kill();
      instance.status = 'failed';
      instance.error = 'Killed by user';
      instance.completedAt = new Date().toISOString();
      logger.instance(instance.id, 'failed', 'Killed');
      await this.appendLog(instance, `Instance killed by user`);
    } catch (error) {
      // Sandbox might already be dead
      logger.debug(`Failed to kill sandbox ${instance.sandboxId}: ${error}`);
    }
  }
}
