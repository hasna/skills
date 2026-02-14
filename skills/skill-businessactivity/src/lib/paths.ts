import { join } from 'path';
import { homedir } from 'os';

const SERVICE_NAME = 'service-businessactivity';

// Base service directory: ~/.service/service-businessactivity/
export function getServiceDir(): string {
  return join(homedir(), '.service', SERVICE_NAME);
}

// Global config: ~/.service/service-businessactivity/config.json
export function getConfigPath(): string {
  return join(getServiceDir(), 'config.json');
}

// Profiles directory: ~/.service/service-businessactivity/profiles/
export function getProfilesDir(): string {
  return join(getServiceDir(), 'profiles');
}

// Single profile directory: ~/.service/service-businessactivity/profiles/{name}/
export function getProfileDir(profileName: string): string {
  return join(getProfilesDir(), profileName);
}

// Profile config: ~/.service/service-businessactivity/profiles/{name}/profile.json
export function getProfileConfigPath(profileName: string): string {
  return join(getProfileDir(profileName), 'profile.json');
}

// Owners file: ~/.service/service-businessactivity/profiles/{name}/owners.json
export function getOwnersPath(profileName: string): string {
  return join(getProfileDir(profileName), 'owners.json');
}

// Teams file: ~/.service/service-businessactivity/profiles/{name}/teams.json
export function getTeamsPath(profileName: string): string {
  return join(getProfileDir(profileName), 'teams.json');
}

// Team members file: ~/.service/service-businessactivity/profiles/{name}/team-members.json
export function getTeamMembersPath(profileName: string): string {
  return join(getProfileDir(profileName), 'team-members.json');
}

// Functions file: ~/.service/service-businessactivity/profiles/{name}/functions.json
export function getFunctionsPath(profileName: string): string {
  return join(getProfileDir(profileName), 'functions.json');
}

// Activities file: ~/.service/service-businessactivity/profiles/{name}/activities.json
export function getActivitiesPath(profileName: string): string {
  return join(getProfileDir(profileName), 'activities.json');
}

// Workflows file: ~/.service/service-businessactivity/profiles/{name}/workflows.json
export function getWorkflowsPath(profileName: string): string {
  return join(getProfileDir(profileName), 'workflows.json');
}

// Workflow steps file: ~/.service/service-businessactivity/profiles/{name}/workflow-steps.json
export function getWorkflowStepsPath(profileName: string): string {
  return join(getProfileDir(profileName), 'workflow-steps.json');
}

// Responsibilities file: ~/.service/service-businessactivity/profiles/{name}/responsibilities.json
export function getResponsibilitiesPath(profileName: string): string {
  return join(getProfileDir(profileName), 'responsibilities.json');
}

// Logs directory: ~/.service/service-businessactivity/logs/
export function getLogsDir(): string {
  return join(getServiceDir(), 'logs');
}

// Log file: ~/.service/service-businessactivity/logs/businessactivity.log
export function getLogFilePath(): string {
  return join(getLogsDir(), 'businessactivity.log');
}
