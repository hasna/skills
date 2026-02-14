import { join } from 'path';
import { homedir } from 'os';

const SERVICE_NAME = 'service-timesheetgenerate';

// Base service directory: ~/.service/service-timesheetgenerate/
export function getServiceDir(): string {
  return join(homedir(), '.service', SERVICE_NAME);
}

// Global config: ~/.service/service-timesheetgenerate/config.json
export function getConfigPath(): string {
  return join(getServiceDir(), 'config.json');
}

// Profiles directory: ~/.service/service-timesheetgenerate/profiles/
export function getProfilesDir(): string {
  return join(getServiceDir(), 'profiles');
}

// Single profile directory: ~/.service/service-timesheetgenerate/profiles/{name}/
export function getProfileDir(profileName: string): string {
  return join(getProfilesDir(), profileName);
}

// Profile config: ~/.service/service-timesheetgenerate/profiles/{name}/profile.json
export function getProfileConfigPath(profileName: string): string {
  return join(getProfileDir(profileName), 'profile.json');
}

// Employees file: ~/.service/service-timesheetgenerate/profiles/{name}/employees.json
export function getEmployeesPath(profileName: string): string {
  return join(getProfileDir(profileName), 'employees.json');
}

// Holidays file: ~/.service/service-timesheetgenerate/profiles/{name}/holidays.json
export function getHolidaysPath(profileName: string): string {
  return join(getProfileDir(profileName), 'holidays.json');
}

// Vacations file: ~/.service/service-timesheetgenerate/profiles/{name}/vacations.json
export function getVacationsPath(profileName: string): string {
  return join(getProfileDir(profileName), 'vacations.json');
}

// Exports directory: ~/.service/service-timesheetgenerate/profiles/{name}/exports/
export function getExportsDir(profileName: string): string {
  return join(getProfileDir(profileName), 'exports');
}

// Logs directory: ~/.service/service-timesheetgenerate/logs/
export function getLogsDir(): string {
  return join(getServiceDir(), 'logs');
}

// Log file: ~/.service/service-timesheetgenerate/logs/timesheetgenerate.log
export function getLogFilePath(): string {
  return join(getLogsDir(), 'timesheetgenerate.log');
}
