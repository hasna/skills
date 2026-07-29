import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { readJson, writeJson, generateId } from './storage';
import { getConfigPath, getProfileDir, getProfileConfigPath, getServiceDir } from './paths';

export interface ProfileConfig {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalConfig {
  currentProfile?: string;
}

// Ensure service directory exists
export async function ensureServiceDir(): Promise<void> {
  const dir = getServiceDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// Load global config
export async function loadConfig(): Promise<GlobalConfig> {
  return readJson<GlobalConfig>(getConfigPath(), {});
}

// Save global config
export async function saveConfig(config: GlobalConfig): Promise<void> {
  await ensureServiceDir();
  await writeJson(getConfigPath(), config);
}

// Get current profile name
export async function getCurrentProfileName(): Promise<string | null> {
  const config = await loadConfig();
  return config.currentProfile || null;
}

// Get current profile config
export async function getCurrentProfile(): Promise<ProfileConfig | null> {
  const profileName = await getCurrentProfileName();
  if (!profileName) return null;
  return getProfile(profileName);
}

// Get profile by name
export async function getProfile(name: string): Promise<ProfileConfig | null> {
  const path = getProfileConfigPath(name);
  try {
    return await readJson<ProfileConfig | null>(path, null);
  } catch {
    return null;
  }
}

// Set current profile
export async function setCurrentProfile(name: string): Promise<void> {
  const profile = await getProfile(name);
  if (!profile) {
    throw new Error(`Profile "${name}" does not exist`);
  }
  const config = await loadConfig();
  config.currentProfile = name;
  await saveConfig(config);
}

// Create a new profile
export async function createProfile(name: string, description?: string): Promise<ProfileConfig> {
  const existing = await getProfile(name);
  if (existing) {
    throw new Error(`Profile "${name}" already exists`);
  }

  const profile: ProfileConfig = {
    id: generateId('prof'),
    name,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Create profile directory and config
  const profileDir = getProfileDir(name);
  if (!existsSync(profileDir)) {
    await mkdir(profileDir, { recursive: true });
  }

  await writeJson(getProfileConfigPath(name), profile);

  // Set as current if no current profile
  const config = await loadConfig();
  if (!config.currentProfile) {
    config.currentProfile = name;
    await saveConfig(config);
  }

  return profile;
}

// Delete a profile
export async function deleteProfile(name: string): Promise<void> {
  const profile = await getProfile(name);
  if (!profile) {
    throw new Error(`Profile "${name}" does not exist`);
  }

  // Remove profile directory
  const profileDir = getProfileDir(name);
  const { rm } = await import('fs/promises');
  await rm(profileDir, { recursive: true, force: true });

  // Update current profile if needed
  const config = await loadConfig();
  if (config.currentProfile === name) {
    const profiles = await listProfiles();
    config.currentProfile = profiles.length > 0 ? profiles[0].name : undefined;
    await saveConfig(config);
  }
}

// List all profiles
export async function listProfiles(): Promise<ProfileConfig[]> {
  const { readdir } = await import('fs/promises');
  const { getProfilesDir } = await import('./paths');

  const profilesDir = getProfilesDir();
  if (!existsSync(profilesDir)) {
    return [];
  }

  try {
    const entries = await readdir(profilesDir, { withFileTypes: true });
    const profiles: ProfileConfig[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const profile = await getProfile(entry.name);
        if (profile) {
          profiles.push(profile);
        }
      }
    }

    return profiles;
  } catch {
    return [];
  }
}

// Require a profile to be selected
export async function requireProfile(): Promise<{ name: string; config: ProfileConfig }> {
  const profileName = await getCurrentProfileName();
  if (!profileName) {
    throw new Error('No profile selected. Run: businessactivity profile create --name <name>');
  }

  const config = await getProfile(profileName);
  if (!config) {
    throw new Error(`Profile "${profileName}" not found. Run: businessactivity profile create --name <name>`);
  }

  return { name: profileName, config };
}
