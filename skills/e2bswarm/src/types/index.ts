export interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
}

export interface SwarmInstance {
  id: string;
  sandboxId: string;
  template: string;
  status: 'starting' | 'cloning' | 'uploading' | 'setting-up' | 'running' | 'committing' | 'pushing' | 'creating-pr' | 'completed' | 'failed';
  source: string;  // repo URL or local path
  sourceType: 'repo' | 'local';
  branch?: string;
  newBranch?: string;
  tasks: Task[];
  prompt: string;
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
  // Paths for this instance
  exportDir?: string;
  logFile?: string;
  // GitHub integration
  autoCommit?: boolean;
  autoPush?: boolean;
  createPr?: boolean;
  prTitle?: string;
  prBase?: string;
  prUrl?: string;
  committed?: boolean;
  pushed?: boolean;
}

export interface SwarmConfig {
  apiKey: string;
  template: string;
  timeout: number;
  maxInstances: number;
}

export interface SwarmState {
  instances: SwarmInstance[];
  createdAt: string;
  updatedAt: string;
}

export interface SpawnOptions {
  repo?: string;
  local?: string;
  tasks?: string;
  tasksDir?: string;
  tasksFile?: string;
  tasksJson?: string;
  instances: string;
  prompt?: string;
  branch?: string;
  newBranch?: string;
  template?: string;
  distribute?: 'all' | 'round-robin' | 'by-dependency';
  include?: string[];
  exclude?: string[];
  // GitHub options
  autoCommit?: boolean;
  autoPush?: boolean;
  createPr?: boolean;
  prTitle?: string;
  prBase?: string;
  prDraft?: boolean;
}

export interface SyncOptions {
  instance?: string;
  commit?: boolean;
  push?: boolean;
  createPr?: boolean;
  prTitle?: string;
  prBase?: string;
  message?: string;
}

export interface StatusOptions {
  instance?: string;
  watch?: boolean;
}

export interface CollectOptions {
  output?: string;
  instance?: string;
}

export interface KillOptions {
  instance?: string;
  all?: boolean;
}

export type TaskSource =
  | { type: 'task-list-id'; value: string }
  | { type: 'directory'; value: string }
  | { type: 'file'; value: string }
  | { type: 'json'; value: string };
