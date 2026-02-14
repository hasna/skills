import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Standard skill data directory structure
 *
 * ~/.skills/
 * └── skill-[name]/
 *     ├── exports/     # Output data, results, artifacts
 *     ├── logs/        # Execution logs, debug info
 *     ├── cache/       # Temporary cached data
 *     └── config/      # Skill-specific configuration
 */

const SKILL_NAME = 'skill-e2bswarm';
const SKILLS_ROOT = join(process.env.HOME!, '.skills');
const SKILL_DATA_DIR = join(SKILLS_ROOT, SKILL_NAME);

export const paths = {
  // Root directories
  skillsRoot: SKILLS_ROOT,
  skillData: SKILL_DATA_DIR,

  // Standard subdirectories
  exports: join(SKILL_DATA_DIR, 'exports'),
  logs: join(SKILL_DATA_DIR, 'logs'),
  cache: join(SKILL_DATA_DIR, 'cache'),
  config: join(SKILL_DATA_DIR, 'config'),

  // State file (moved from ~/.claude/)
  state: join(SKILL_DATA_DIR, 'state.json'),

  // Helper to get timestamped export directory
  getExportDir: (prefix?: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dirName = prefix ? `${prefix}-${timestamp}` : timestamp;
    return join(SKILL_DATA_DIR, 'exports', dirName);
  },

  // Helper to get log file path
  getLogFile: (name: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return join(SKILL_DATA_DIR, 'logs', `${name}-${timestamp}.log`);
  },

  // Helper to get instance-specific paths
  getInstance: (instanceId: string) => ({
    exports: join(SKILL_DATA_DIR, 'exports', instanceId),
    logs: join(SKILL_DATA_DIR, 'logs', instanceId),
  }),
};

/**
 * Ensure all skill directories exist
 */
export async function ensureSkillDirs(): Promise<void> {
  await mkdir(paths.exports, { recursive: true });
  await mkdir(paths.logs, { recursive: true });
  await mkdir(paths.cache, { recursive: true });
  await mkdir(paths.config, { recursive: true });
}

/**
 * Get skill data path for any skill (reusable utility)
 */
export function getSkillPaths(skillName: string) {
  const skillDir = join(SKILLS_ROOT, skillName);
  return {
    root: skillDir,
    exports: join(skillDir, 'exports'),
    logs: join(skillDir, 'logs'),
    cache: join(skillDir, 'cache'),
    config: join(skillDir, 'config'),
  };
}
