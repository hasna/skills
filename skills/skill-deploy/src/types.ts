/**
 * Deployment Types
 */

export interface HostConfig {
  name: string;
  sshHost: string;
  deployPath: string;
  service?: string;
  healthUrl?: string;
  gitRepo?: string;
  gitBranch?: string;
  preDeployCommands?: string[];
  postDeployCommands?: string[];
  user?: string;
}

export interface DeploymentOptions {
  host?: string;
  skipHealthCheck?: boolean;
  skipRestart?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
}

export interface DeploymentResult {
  success: boolean;
  host: string;
  service?: string;
  gitStatus?: {
    before: string;
    after: string;
    changes: boolean;
  };
  serviceStatus?: {
    running: boolean;
    uptime?: string;
  };
  healthCheck?: {
    passed: boolean;
    url?: string;
    response?: any;
  };
  errors?: string[];
  duration: number;
}

export interface HealthCheckResult {
  passed: boolean;
  url: string;
  status?: number;
  response?: any;
  error?: string;
  duration: number;
}
