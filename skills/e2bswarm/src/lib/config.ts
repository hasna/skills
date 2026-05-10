import type { SwarmConfig, SwarmState } from '../types';
import { paths, ensureSkillDirs } from './paths';

const SECRETS_FILE = `${process.env.HOME}/.secrets`;

// Default E2B template - set to your custom template or use 'base' for default
const DEFAULT_TEMPLATE = process.env.E2B_TEMPLATE || 'base';

export async function loadConfig(template?: string): Promise<SwarmConfig> {
  // Ensure skill directories exist
  await ensureSkillDirs();

  // Try to load E2B_API_KEY from environment or ~/.secrets
  let apiKey = process.env.E2B_API_KEY;

  if (!apiKey) {
    try {
      const secrets = await Bun.file(SECRETS_FILE).text();
      const match = secrets.match(/E2B_API_KEY=["']?([^"'\n]+)["']?/);
      if (match) {
        apiKey = match[1];
      }
    } catch {
      // ~/.secrets doesn't exist
    }
  }

  if (!apiKey) {
    throw new Error(
      'E2B_API_KEY not found. Add it to ~/.secrets:\n' +
      '  export E2B_API_KEY="your-api-key"\n\n' +
      'Get your API key at: https://e2b.dev/dashboard'
    );
  }

  return {
    apiKey,
    template: template || DEFAULT_TEMPLATE,
    timeout: 30 * 60 * 1000, // 30 minutes
    maxInstances: 10,
  };
}

export async function loadState(): Promise<SwarmState> {
  try {
    const content = await Bun.file(paths.state).text();
    return JSON.parse(content);
  } catch {
    return {
      instances: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function saveState(state: SwarmState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await Bun.write(paths.state, JSON.stringify(state, null, 2));
}

export function getStateFilePath(): string {
  return paths.state;
}

/**
 * List available E2B templates
 * See: https://e2b.dev/docs/sandbox/templates
 */
export const E2B_TEMPLATES = {
  // Base templates
  base: 'Default E2B Ubuntu sandbox',
} as const;

export type E2BTemplate = keyof typeof E2B_TEMPLATES | string;
