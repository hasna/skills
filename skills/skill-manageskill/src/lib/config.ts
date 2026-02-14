import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

export interface Config {
  apiUrl?: string;
  apiKey?: string;
}

export const CONFIG_FILE = join(homedir(), '.manageskill.json');

export async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function getApiKey(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.apiKey || process.env.API_KEY;
}

export async function getApiUrl(): Promise<string | undefined> {
  const config = await loadConfig();
  return config.apiUrl || process.env.API_URL;
}
