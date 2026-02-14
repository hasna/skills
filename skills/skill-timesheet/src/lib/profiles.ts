import { existsSync } from 'fs';
import { readdir, mkdir, rm } from 'fs/promises';
import {
  getServiceDir,
  getConfigPath,
  getProfilesDir,
  getProfileDir,
  getProfileConfigPath,
  getEmployeesPath,
  getHolidaysPath,
  getVacationsPath,
  getExportsDir,
  getLogsDir,
} from './paths';
import { readJson, writeJson } from './storage';
import type { Profile, GlobalConfig } from '../types';

const DEFAULT_CONFIG: GlobalConfig = {
  version: '1.0.0',
};

// Check if service is set up
export function isServiceSetup(): boolean {
  return existsSync(getServiceDir());
}

// Get global config
export async function getConfig(): Promise<GlobalConfig> {
  return readJson<GlobalConfig>(getConfigPath(), DEFAULT_CONFIG);
}

// Save global config
export async function saveConfig(config: GlobalConfig): Promise<void> {
  await writeJson(getConfigPath(), config);
}

// Get default profile name
export async function getDefaultProfile(): Promise<string | undefined> {
  const config = await getConfig();
  return config.defaultProfile;
}

// Set default profile
export async function setDefaultProfile(profileName: string): Promise<void> {
  const config = await getConfig();
  config.defaultProfile = profileName;
  await saveConfig(config);
}

// List all profiles
export async function listProfiles(): Promise<string[]> {
  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  const entries = await readdir(profilesDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// Check if profile exists
export function profileExists(profileName: string): boolean {
  return existsSync(getProfileDir(profileName));
}

// Get profile data
export async function getProfile(profileName: string): Promise<Profile | null> {
  const configPath = getProfileConfigPath(profileName);
  if (!existsSync(configPath)) {
    return null;
  }
  return readJson<Profile>(configPath, null as any);
}

// Create a new profile
export async function createProfile(
  name: string,
  data: Omit<Profile, 'name' | 'createdAt'>
): Promise<Profile> {
  const profileDir = getProfileDir(name);

  if (existsSync(profileDir)) {
    throw new Error(`Profile "${name}" already exists`);
  }

  // Create profile directory structure
  await mkdir(profileDir, { recursive: true });
  await mkdir(getExportsDir(name), { recursive: true });

  const profile: Profile = {
    name,
    country: data.country,
    timezone: data.timezone,
    weekendDays: data.weekendDays,
    createdAt: new Date().toISOString(),
  };

  // Write profile config
  await writeJson(getProfileConfigPath(name), profile);

  // Initialize empty data files
  await writeJson(getEmployeesPath(name), []);
  await writeJson(getHolidaysPath(name), []);
  await writeJson(getVacationsPath(name), []);

  return profile;
}

// Delete a profile
export async function deleteProfile(profileName: string): Promise<boolean> {
  const profileDir = getProfileDir(profileName);

  if (!existsSync(profileDir)) {
    return false;
  }

  await rm(profileDir, { recursive: true, force: true });

  // Clear default if it was this profile
  const config = await getConfig();
  if (config.defaultProfile === profileName) {
    config.defaultProfile = undefined;
    await saveConfig(config);
  }

  return true;
}

// Initialize service directory
export async function setupService(): Promise<{ created: boolean; path: string }> {
  const serviceDir = getServiceDir();
  const wasNew = !existsSync(serviceDir);

  await mkdir(serviceDir, { recursive: true });
  await mkdir(getProfilesDir(), { recursive: true });
  await mkdir(getLogsDir(), { recursive: true });

  // Initialize config if not exists
  if (!existsSync(getConfigPath())) {
    await writeJson(getConfigPath(), DEFAULT_CONFIG);
  }

  return {
    created: wasNew,
    path: serviceDir,
  };
}

// Resolve profile name (use provided or default)
export async function resolveProfile(providedProfile?: string): Promise<string> {
  if (providedProfile) {
    if (!profileExists(providedProfile)) {
      throw new Error(`Profile "${providedProfile}" does not exist`);
    }
    return providedProfile;
  }

  const defaultProfile = await getDefaultProfile();
  if (!defaultProfile) {
    throw new Error('No profile specified and no default profile set. Use -p <profile> or run: timesheetgenerate profile use <name>');
  }

  if (!profileExists(defaultProfile)) {
    throw new Error(`Default profile "${defaultProfile}" does not exist`);
  }

  return defaultProfile;
}
