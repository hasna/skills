/**
 * Host Configurations
 *
 * Define deployment configurations for each environment.
 * These hosts should match your ~/.ssh/config entries.
 */

import type { HostConfig } from './types';

export const HOSTS: Record<string, HostConfig> = {
  'example-app': {
    name: 'Example App',
    sshHost: 'example-app',
    deployPath: '/opt/example-app',
    service: 'example-app.service',
    healthUrl: 'http://localhost:3000/health',
    gitRepo: 'git@github.com:example/example-app.git',
    gitBranch: 'main',
    user: 'root',
  },

  // Add your deployment hosts here following the pattern above.
  // Each host should match an entry in your ~/.ssh/config.
};

/**
 * Get host configuration by name
 */
export function getHost(hostName: string): HostConfig | undefined {
  return HOSTS[hostName];
}

/**
 * List all available hosts
 */
export function listHosts(): HostConfig[] {
  return Object.values(HOSTS);
}

/**
 * Get host names
 */
export function getHostNames(): string[] {
  return Object.keys(HOSTS);
}
