/**
 * Host Configurations
 *
 * Define deployment configurations for each environment.
 * These hosts should match your ~/.ssh/config entries.
 */

import type { HostConfig } from './types';

export const HOSTS: Record<string, HostConfig> = {
  'lab-mcp': {
    name: 'Lab MCP',
    sshHost: 'lab-mcp',
    deployPath: '/opt/mcp-mail',
    service: 'mcp-mail.service',
    healthUrl: 'http://localhost:3847/health',
    gitRepo: 'git@github.com:example/mcp-mail.git',
    gitBranch: 'main',
    user: 'root',
  },

  'prod-skill': {
    name: 'Prod Skill',
    sshHost: 'prod-skill',
    deployPath: '/opt/skills',
    // service: 'skills.service', // Uncomment when service is configured
    // healthUrl: 'http://localhost:8080/health', // Uncomment when health endpoint exists
    gitRepo: 'git@github.com:example/skills.git', // Update with actual repo
    gitBranch: 'main',
    user: 'ec2-user',
  },

  'skill-emoji': {
    name: 'Skill Emoji',
    sshHost: 'prod-skill',
    deployPath: '/opt/skills/skill-emoji',
    gitRepo: 'git@github.com:example/skill-emoji.git',
    gitBranch: 'dev',
    user: 'ec2-user',
  },
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
