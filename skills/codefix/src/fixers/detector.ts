/**
 * Language and tool detection utilities
 */

import { extname } from 'path';
import type { Language, FixerConfig } from '../types';
import { FIXER_CONFIGS } from '../types';

/** Extension to language mapping */
const EXTENSION_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.mdx': 'markdown',
};

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): Language {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] || 'auto';
}

/**
 * Get fixer configuration for a language
 */
export function getFixerConfig(language: Language): FixerConfig | undefined {
  return FIXER_CONFIGS[language];
}

/**
 * Check if a tool is available on the system
 */
export async function isToolAvailable(tool: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', tool], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get available tools for a language
 */
export async function getAvailableTools(language: Language): Promise<{
  lint: boolean;
  format: boolean;
  typeCheck: boolean;
  tools: string[];
}> {
  const config = getFixerConfig(language);
  const result = {
    lint: false,
    format: false,
    typeCheck: false,
    tools: [] as string[],
  };

  if (!config) return result;

  // Check each tool
  const checks: Promise<void>[] = [];

  if (config.lintCommand) {
    const tool = config.lintCommand.split(' ')[0];
    checks.push(
      isToolAvailable(tool).then((available) => {
        if (available) {
          result.lint = true;
          result.tools.push(tool);
        }
      })
    );
  }

  if (config.formatCommand) {
    const tool = config.formatCommand.split(' ')[0];
    checks.push(
      isToolAvailable(tool).then((available) => {
        if (available) {
          result.format = true;
          result.tools.push(tool);
        }
      })
    );
  }

  if (config.typeCheckCommand) {
    const tool = config.typeCheckCommand.split(' ')[0];
    checks.push(
      isToolAvailable(tool).then((available) => {
        if (available) {
          result.typeCheck = true;
          result.tools.push(tool);
        }
      })
    );
  }

  await Promise.all(checks);
  return result;
}

/**
 * Get all supported extensions
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP);
}

/**
 * Check if a file is supported
 */
export function isSupported(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext in EXTENSION_MAP;
}
