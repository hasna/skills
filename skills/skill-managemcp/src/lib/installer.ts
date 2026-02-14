import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getItem } from './api-client';

export type Target = 'claude' | 'codex';
export type ConflictStrategy = 'skip' | 'overwrite';

export interface InstallResult {
  success: boolean;
  message: string;
  itemId: string;
}

export interface InstalledItem {
  id: string;
  name: string;
  target: Target;
  installedAt: string;
}

const CLAUDE_DIR = join(homedir(), '.claude', 'skills');
const CODEX_DIR = join(homedir(), '.codex', 'skills');

function getTargetDir(target: Target): string {
  return target === 'claude' ? CLAUDE_DIR : CODEX_DIR;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeItemFile(
  target: Target,
  itemId: string,
  content: string,
  strategy: ConflictStrategy
): Promise<boolean> {
  const dir = getTargetDir(target);
  await ensureDir(dir);

  const filePath = join(dir, `${itemId}.json`);

  try {
    await readFile(filePath);
    if (strategy === 'skip') return false;
  } catch {
    // File doesn't exist, proceed
  }

  await writeFile(filePath, content, 'utf-8');
  return true;
}

async function installToTarget(
  target: Target,
  itemId: string,
  strategy: ConflictStrategy = 'skip'
): Promise<InstallResult> {
  try {
    const item = await getItem(itemId);
    const content = JSON.stringify(item, null, 2);
    const written = await writeItemFile(target, itemId, content, strategy);

    const targetName = target.charAt(0).toUpperCase() + target.slice(1);
    return {
      success: true,
      message: written
        ? `Installed to ${targetName}: ${item.name}`
        : `Skipped (already exists): ${item.name}`,
      itemId,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install to ${target}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      itemId,
    };
  }
}

export async function install(
  itemId: string,
  target: Target | 'both' = 'both',
  strategy: ConflictStrategy = 'skip'
): Promise<InstallResult> {
  if (target === 'both') {
    const claudeResult = await installToTarget('claude', itemId, strategy);
    const codexResult = await installToTarget('codex', itemId, strategy);

    return {
      success: claudeResult.success && codexResult.success,
      message: `${claudeResult.message}\n${codexResult.message}`,
      itemId,
    };
  }

  return await installToTarget(target, itemId, strategy);
}

export async function clearTarget(target?: Target | 'both'): Promise<void> {
  const targets: Target[] = target === 'both' || !target ? ['claude', 'codex'] : [target];

  for (const t of targets) {
    const dir = getTargetDir(t);
    try {
      const files = await readdir(dir);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).map((f) => unlink(join(dir, f)));
      await Promise.all(jsonFiles);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export async function listInstalled(target?: Target | 'both'): Promise<InstalledItem[]> {
  const targets: Target[] = target === 'both' || !target ? ['claude', 'codex'] : [target];
  const items: InstalledItem[] = [];

  for (const t of targets) {
    const dir = getTargetDir(t);
    try {
      const files = await readdir(dir);
      for (const file of files.filter((f) => f.endsWith('.json'))) {
        const content = await readFile(join(dir, file), 'utf-8');
        const item = JSON.parse(content);
        items.push({
          id: item.id,
          name: item.name,
          target: t,
          installedAt: file,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  return items;
}
