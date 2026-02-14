/**
 * Type definitions for skill-browse
 */

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'finished'
  | 'failed'
  | 'stopped';

export type LLMModel =
  | 'gpt-4o'
  | 'o3'
  | 'o4-mini'
  | 'claude-sonnet-4'
  | 'claude-3-5-sonnet'
  | 'gemini-flash-latest'
  | 'browser-use';

export type ProxyCountry = 'us' | 'fr' | 'it' | 'jp' | 'au' | 'de' | 'fi' | 'ca';

/**
 * Secrets/credentials for the browser task
 * Keys are placeholder names used in the task description
 * Values are the actual credentials
 *
 * Example:
 * {
 *   "twitter_user": "myemail@example.com",
 *   "twitter_pass": "mypassword123"
 * }
 *
 * Then in task: "Log into twitter with username twitter_user and password twitter_pass"
 */
export type TaskSecrets = Record<string, string>;

export interface BrowseOptions {
  task: string;
  model?: LLMModel;
  useProxy?: boolean;
  proxyCountry?: ProxyCountry;
  useAdblock?: boolean;
  highlightElements?: boolean;
  timeout?: number;
  /** Secrets/credentials - keys are placeholders, values are actual credentials */
  secrets?: TaskSecrets;
  /** List of allowed domains the browser can navigate to */
  allowedDomains?: string[];
}

export interface ExtractOptions extends BrowseOptions {
  schema?: Record<string, unknown>;
  outputPath?: string;
}

export interface ScreenshotOptions {
  url: string;
  outputPath: string;
  fullPage?: boolean;
  waitForSelector?: string;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output?: string;
  parsedOutput?: unknown;
  liveUrl?: string;
  error?: string;
  steps?: TaskStep[];
}

export interface TaskStep {
  index: number;
  action: string;
  result?: string;
  screenshot?: string;
  timestamp: string;
}

export interface BrowseResult {
  success: boolean;
  taskId: string;
  output?: string;
  liveUrl?: string;
  error?: string;
  steps?: TaskStep[];
}

export interface ExtractResult extends BrowseResult {
  data?: unknown;
  savedTo?: string;
}

export interface TaskInfo {
  id: string;
  status: TaskStatus;
  task: string;
  liveUrl?: string;
  createdAt: string;
  completedAt?: string;
}
