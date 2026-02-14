/**
 * Browser-Use API Client
 * Wrapper around the Browser-Use Cloud API
 */

import type {
  BrowseOptions,
  BrowseResult,
  ExtractOptions,
  ExtractResult,
  TaskInfo,
  TaskResult,
  TaskStep,
} from './types';

export class BrowserUseClient {
  private apiKey: string;
  private baseUrl = 'https://api.browser-use.com/api/v1';
  private defaultModel: string;
  private defaultProxy: boolean;
  private defaultProxyCountry: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BROWSER_USE_API_KEY || '';
    if (!this.apiKey) {
      throw new Error(
        'BROWSER_USE_API_KEY environment variable is required. ' +
          'Get your key from: https://cloud.browser-use.com/billing'
      );
    }
    this.defaultModel = process.env.BROWSER_USE_MODEL || 'gpt-4o';
    this.defaultProxy = process.env.BROWSER_USE_PROXY === 'true';
    this.defaultProxyCountry = process.env.BROWSER_USE_PROXY_COUNTRY || 'us';
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Browser-Use API error (${response.status}): ${errorText}`
      );
    }

    return response.json() as T;
  }

  /**
   * Run a browser automation task
   */
  async runTask(options: BrowseOptions): Promise<TaskResult> {
    const payload: Record<string, unknown> = {
      task: options.task,
      llm_model: options.model || this.defaultModel,
      use_proxy: options.useProxy ?? this.defaultProxy,
      proxy_country_code: options.proxyCountry || this.defaultProxyCountry,
      use_adblock: options.useAdblock ?? false,
      highlight_elements: options.highlightElements ?? true,
    };

    // Add secrets/credentials if provided
    if (options.secrets && Object.keys(options.secrets).length > 0) {
      payload.secrets = options.secrets;
    }

    // Add allowed domains if provided
    if (options.allowedDomains && options.allowedDomains.length > 0) {
      payload.allowed_domains = options.allowedDomains;
    }

    const result = await this.request<{
      id: string;
      status: string;
      live_url?: string;
      output?: string;
      error?: string;
    }>('/run-task', 'POST', payload);

    return {
      taskId: result.id,
      status: result.status as TaskResult['status'],
      liveUrl: result.live_url,
      output: result.output,
      error: result.error,
    };
  }

  /**
   * Run a task and wait for completion
   */
  async browse(options: BrowseOptions): Promise<BrowseResult> {
    const task = await this.runTask(options);
    const timeout = options.timeout || 300000; // 5 minutes default
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    console.log(`Task started: ${task.taskId}`);
    if (task.liveUrl) {
      console.log(`Live view: ${task.liveUrl}`);
    }

    // Poll for completion
    while (Date.now() - startTime < timeout) {
      const status = await this.getTaskStatus(task.taskId);

      if (status.status === 'finished') {
        const result = await this.getTask(task.taskId);
        return {
          success: true,
          taskId: task.taskId,
          output: result.output,
          liveUrl: task.liveUrl,
          steps: result.steps,
        };
      }

      if (status.status === 'failed' || status.status === 'stopped') {
        return {
          success: false,
          taskId: task.taskId,
          error: status.error || `Task ${status.status}`,
          liveUrl: task.liveUrl,
        };
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      taskId: task.taskId,
      error: 'Task timed out',
      liveUrl: task.liveUrl,
    };
  }

  /**
   * Extract structured data from a website
   */
  async extract(options: ExtractOptions): Promise<ExtractResult> {
    const payload: Record<string, unknown> = {
      task: options.task,
      llm_model: options.model || this.defaultModel,
      use_proxy: options.useProxy ?? this.defaultProxy,
      proxy_country_code: options.proxyCountry || this.defaultProxyCountry,
      use_adblock: options.useAdblock ?? false,
      highlight_elements: options.highlightElements ?? true,
    };

    if (options.schema) {
      payload.structured_output_json = options.schema;
    }

    // Add secrets/credentials if provided
    if (options.secrets && Object.keys(options.secrets).length > 0) {
      payload.secrets = options.secrets;
    }

    // Add allowed domains if provided
    if (options.allowedDomains && options.allowedDomains.length > 0) {
      payload.allowed_domains = options.allowedDomains;
    }

    const task = await this.request<{
      id: string;
      status: string;
      live_url?: string;
    }>('/run-task', 'POST', payload);

    const timeout = options.timeout || 300000;
    const startTime = Date.now();
    const pollInterval = 2000;

    console.log(`Extraction task started: ${task.id}`);
    if (task.live_url) {
      console.log(`Live view: ${task.live_url}`);
    }

    // Poll for completion
    while (Date.now() - startTime < timeout) {
      const result = await this.getTask(task.id);

      if (result.status === 'finished') {
        let data: unknown = result.output;
        let savedTo: string | undefined;

        // Try to parse JSON output
        if (typeof result.output === 'string') {
          try {
            data = JSON.parse(result.output);
          } catch {
            // Keep as string if not valid JSON
          }
        }

        // Save to file if path provided
        if (options.outputPath && data) {
          const content =
            typeof data === 'string' ? data : JSON.stringify(data, null, 2);
          await Bun.write(options.outputPath, content);
          savedTo = options.outputPath;
          console.log(`Data saved to: ${savedTo}`);
        }

        return {
          success: true,
          taskId: task.id,
          output: result.output,
          data,
          savedTo,
          liveUrl: task.live_url,
          steps: result.steps,
        };
      }

      if (result.status === 'failed' || result.status === 'stopped') {
        return {
          success: false,
          taskId: task.id,
          error: result.error || `Task ${result.status}`,
          liveUrl: task.live_url,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return {
      success: false,
      taskId: task.id,
      error: 'Task timed out',
      liveUrl: task.live_url,
    };
  }

  /**
   * Get task details
   */
  async getTask(taskId: string): Promise<TaskResult> {
    const result = await this.request<{
      id: string;
      status: string;
      output?: string;
      error?: string;
      steps?: Array<{
        id: string;
        step: number;
        evaluation_previous_goal?: string;
        next_goal?: string;
        url?: string;
      }>;
    }>(`/task/${taskId}`);

    // Transform steps to our format
    const steps = result.steps?.map((s) => ({
      index: s.step,
      action: s.next_goal || s.evaluation_previous_goal || `Step ${s.step}`,
      result: s.evaluation_previous_goal,
      timestamp: new Date().toISOString(),
    }));

    return {
      taskId: result.id,
      status: result.status as TaskResult['status'],
      output: result.output,
      error: result.error,
      steps,
    };
  }

  /**
   * Get task status
   */
  async getTaskStatus(
    taskId: string
  ): Promise<{ status: string; error?: string }> {
    const url = `${this.baseUrl}/task/${taskId}/status`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Browser-Use API error (${response.status}): ${errorText}`
      );
    }

    const text = await response.text();
    // Status endpoint returns just the status string, not an object
    const status = text.replace(/"/g, '');
    return { status };
  }

  /**
   * Pause a running task
   */
  async pauseTask(taskId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/task/${taskId}/pause`, 'POST');
  }

  /**
   * Resume a paused task
   */
  async resumeTask(taskId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/task/${taskId}/resume`, 'POST');
  }

  /**
   * Stop a running task permanently
   */
  async stopTask(taskId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/task/${taskId}/stop`, 'POST');
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<TaskInfo[]> {
    const result = await this.request<{
      tasks: Array<{
        id: string;
        status: string;
        task: string;
        live_url?: string;
        created_at: string;
        completed_at?: string;
      }>;
    }>('/tasks');

    return (result.tasks || []).map((t) => ({
      id: t.id,
      status: t.status as TaskInfo['status'],
      task: t.task,
      liveUrl: t.live_url,
      createdAt: t.created_at,
      completedAt: t.completed_at,
    }));
  }

  /**
   * Get screenshots from a task
   */
  async getTaskScreenshots(taskId: string): Promise<string[]> {
    const result = await this.request<{ screenshots: string[] }>(
      `/task/${taskId}/screenshots`
    );
    return result.screenshots || [];
  }
}
