import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Task, TaskSource, SpawnOptions } from '../types';
import { logger } from './logger';

/**
 * Determine the task source from spawn options
 */
export function determineTaskSource(options: SpawnOptions): TaskSource {
  if (options.tasksJson) {
    return { type: 'json', value: options.tasksJson };
  }
  if (options.tasksFile) {
    return { type: 'file', value: resolve(options.tasksFile) };
  }
  if (options.tasksDir) {
    return { type: 'directory', value: resolve(options.tasksDir) };
  }
  if (options.tasks) {
    // Check if it's a path or a task list ID
    if (options.tasks.includes('/') || options.tasks.endsWith('.json')) {
      return { type: 'file', value: resolve(options.tasks) };
    }
    return { type: 'task-list-id', value: options.tasks };
  }
  throw new Error(
    'No task source provided. Use one of:\n' +
    '  --tasks <task-list-id>     Load from ~/.claude/tasks/<id>/\n' +
    '  --tasks-dir <directory>    Load from a local directory\n' +
    '  --tasks-file <file.json>   Load from a JSON file\n' +
    '  --tasks-json \'[...]\''+ '       Inline JSON array'
  );
}

/**
 * Load tasks from various sources
 */
export async function loadTasks(source: TaskSource): Promise<Task[]> {
  switch (source.type) {
    case 'json':
      return parseTasksJson(source.value);

    case 'file':
      return loadTasksFromFile(source.value);

    case 'directory':
      return loadTasksFromDirectory(source.value);

    case 'task-list-id':
      return loadTasksFromTaskList(source.value);

    default:
      throw new Error(`Unknown task source type`);
  }
}

/**
 * Parse inline JSON tasks
 */
function parseTasksJson(json: string): Task[] {
  try {
    const parsed = JSON.parse(json);
    const tasks = Array.isArray(parsed) ? parsed : [parsed];
    return validateTasks(tasks);
  } catch (error) {
    throw new Error(`Failed to parse tasks JSON: ${error}`);
  }
}

/**
 * Load tasks from a JSON file
 */
async function loadTasksFromFile(filePath: string): Promise<Task[]> {
  try {
    const content = await Bun.file(filePath).text();
    const parsed = JSON.parse(content);
    const tasks = Array.isArray(parsed) ? parsed : [parsed];
    logger.debug(`Loaded ${tasks.length} tasks from file: ${filePath}`);
    return validateTasks(tasks);
  } catch (error) {
    throw new Error(`Failed to load tasks from file ${filePath}: ${error}`);
  }
}

/**
 * Load tasks from a directory containing JSON files
 */
async function loadTasksFromDirectory(dirPath: string): Promise<Task[]> {
  try {
    const files = await readdir(dirPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      throw new Error(`No JSON files found in directory: ${dirPath}`);
    }

    const tasks: Task[] = [];
    for (const file of jsonFiles) {
      const content = await Bun.file(join(dirPath, file)).text();
      const task = JSON.parse(content);
      tasks.push(task);
    }

    logger.debug(`Loaded ${tasks.length} tasks from directory: ${dirPath}`);
    return validateTasks(tasks);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    throw error;
  }
}

/**
 * Load tasks from Claude Code task list (~/.claude/tasks/<id>/)
 */
async function loadTasksFromTaskList(taskListId: string): Promise<Task[]> {
  const tasksDir = join(process.env.HOME!, '.claude', 'tasks', taskListId);

  try {
    const files = await readdir(tasksDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      throw new Error(`No tasks found in task list: ${taskListId}`);
    }

    const tasks: Task[] = [];
    for (const file of jsonFiles) {
      const content = await Bun.file(join(tasksDir, file)).text();
      const task = JSON.parse(content);
      tasks.push(task);
    }

    logger.debug(`Loaded ${tasks.length} tasks from task list: ${taskListId}`);
    return validateTasks(tasks);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Task list not found: ${taskListId}\n` +
        `Expected location: ${tasksDir}\n\n` +
        'Available task lists can be found in ~/.claude/tasks/'
      );
    }
    throw error;
  }
}

/**
 * Validate and normalize task objects
 */
function validateTasks(tasks: unknown[]): Task[] {
  return tasks.map((task, index) => {
    if (!task || typeof task !== 'object') {
      throw new Error(`Task at index ${index} is not an object`);
    }

    const t = task as Record<string, unknown>;

    if (!t.id) {
      t.id = String(index + 1);
    }
    if (!t.subject && !t.description) {
      throw new Error(`Task ${t.id} must have a subject or description`);
    }

    return {
      id: String(t.id),
      subject: String(t.subject || t.description || ''),
      description: String(t.description || t.subject || ''),
      activeForm: t.activeForm ? String(t.activeForm) : undefined,
      status: (t.status as Task['status']) || 'pending',
      blocks: Array.isArray(t.blocks) ? t.blocks.map(String) : [],
      blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy.map(String) : [],
      metadata: t.metadata as Record<string, unknown> | undefined,
    };
  });
}

/**
 * Filter tasks to only pending/in_progress
 */
export function filterPendingTasks(tasks: Task[]): Task[] {
  return tasks.filter(t => t.status !== 'completed');
}

/**
 * Distribute tasks across instances based on mode
 */
export function distributeTasks(
  tasks: Task[],
  instanceCount: number,
  mode: 'all' | 'round-robin' | 'by-dependency' = 'all'
): Task[][] {
  // Filter to pending tasks only
  const pendingTasks = filterPendingTasks(tasks);

  if (pendingTasks.length === 0) {
    logger.warn('No pending tasks to distribute');
    return Array(instanceCount).fill([]);
  }

  switch (mode) {
    case 'all':
      // Each instance gets all tasks
      return Array(instanceCount).fill(null).map(() => [...pendingTasks]);

    case 'round-robin':
      // Distribute tasks evenly across instances
      return distributeRoundRobin(pendingTasks, instanceCount);

    case 'by-dependency':
      // Group tasks by their dependency chains
      return distributeByDependency(pendingTasks, instanceCount);

    default:
      return [pendingTasks];
  }
}

function distributeRoundRobin(tasks: Task[], instanceCount: number): Task[][] {
  const distribution: Task[][] = Array.from({ length: instanceCount }, () => []);

  tasks.forEach((task, i) => {
    distribution[i % instanceCount]!.push(task);
  });

  return distribution;
}

function distributeByDependency(tasks: Task[], maxGroups: number): Task[][] {
  const chains: Task[][] = [];
  const assigned = new Set<string>();

  // Find all tasks that have no blockers (roots)
  const roots = tasks.filter(t => t.blockedBy.length === 0);

  for (const root of roots) {
    if (assigned.has(root.id)) continue;
    const chain = collectDependencyChain(root, tasks, assigned);
    if (chain.length > 0) {
      chains.push(chain);
    }
  }

  // Add any orphaned tasks
  for (const task of tasks) {
    if (!assigned.has(task.id)) {
      chains.push([task]);
      assigned.add(task.id);
    }
  }

  // Merge chains if we have more than maxGroups
  while (chains.length > maxGroups && chains.length > 1) {
    // Find the smallest chain
    let smallestIdx = 0;
    for (let i = 1; i < chains.length; i++) {
      if (chains[i]!.length < chains[smallestIdx]!.length) {
        smallestIdx = i;
      }
    }

    // Merge with the next smallest
    const smallest = chains.splice(smallestIdx, 1)[0]!;
    let targetIdx = 0;
    for (let i = 1; i < chains.length; i++) {
      if (chains[i]!.length < chains[targetIdx]!.length) {
        targetIdx = i;
      }
    }
    chains[targetIdx]!.push(...smallest);
  }

  // Pad with empty arrays if we have fewer chains than instances
  while (chains.length < maxGroups) {
    chains.push([]);
  }

  return chains;
}

function collectDependencyChain(
  task: Task,
  allTasks: Task[],
  assigned: Set<string>
): Task[] {
  if (assigned.has(task.id)) return [];

  assigned.add(task.id);
  const chain: Task[] = [task];

  // Find tasks that this one blocks (dependents)
  for (const t of allTasks) {
    if (t.blockedBy.includes(task.id)) {
      chain.push(...collectDependencyChain(t, allTasks, assigned));
    }
  }

  return chain;
}

/**
 * Serialize tasks for writing to sandbox
 */
export function serializeTasks(tasks: Task[]): string {
  return JSON.stringify(tasks, null, 2);
}

/**
 * Create a summary of task distribution
 */
export function summarizeDistribution(distribution: Task[][]): string {
  const lines = distribution.map((tasks, i) => {
    const subjects = tasks.slice(0, 3).map(t => t.subject.slice(0, 40));
    const more = tasks.length > 3 ? ` (+${tasks.length - 3} more)` : '';
    return `  Instance ${i + 1}: ${tasks.length} tasks${more}\n    ${subjects.join('\n    ')}`;
  });
  return lines.join('\n');
}
