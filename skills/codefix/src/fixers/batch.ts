/**
 * Batch processing for multiple files
 */

import { readdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import type {
  FixOptions,
  AnalyzeOptions,
  FixResult,
  AnalyzeResult,
  BatchResult,
  FileResult,
} from '../types';
import { fixFile, analyzeFile } from './runner';
import { isSupported, getSupportedExtensions } from './detector';

/**
 * Default ignore patterns
 */
const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'venv',
  '.venv',
  'vendor',
  'target',
];

/**
 * Check if a path should be ignored
 */
function shouldIgnore(path: string, ignorePatterns: string[]): boolean {
  const patterns = [...DEFAULT_IGNORE, ...ignorePatterns];
  return patterns.some((pattern) => {
    if (pattern.includes('*')) {
      // Simple glob matching
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      );
      return regex.test(path);
    }
    return path.includes(pattern);
  });
}

/**
 * Recursively collect files from a directory
 */
async function collectFiles(
  dir: string,
  ignore: string[],
  includeHidden: boolean
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // Skip hidden files unless requested
    if (!includeHidden && entry.name.startsWith('.')) {
      continue;
    }

    // Skip ignored paths
    if (shouldIgnore(fullPath, ignore)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, ignore, includeHidden);
      files.push(...subFiles);
    } else if (entry.isFile() && isSupported(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Fix multiple files
 */
export async function fixBatch(
  options: FixOptions & { parallel?: number }
): Promise<BatchResult> {
  const startTime = Date.now();
  const results: FileResult[] = [];
  const parallel = options.parallel || 4;

  // Determine files to process
  let files: string[];
  const pathStat = await stat(options.path);

  if (pathStat.isDirectory()) {
    files = await collectFiles(
      options.path,
      options.ignore || [],
      options.includeHidden ?? false
    );
  } else {
    files = [options.path];
  }

  // Process files in parallel batches
  for (let i = 0; i < files.length; i += parallel) {
    const batch = files.slice(i, i + parallel);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const result = await fixFile({
          ...options,
          path: file,
        });
        return { file, result };
      })
    );
    results.push(...batchResults);
  }

  // Calculate totals
  let totalIssues = 0;
  let totalFixed = 0;
  let filesWithIssues = 0;

  for (const { result } of results) {
    const fixResult = result as FixResult;
    totalIssues += fixResult.issuesFound;
    totalFixed += fixResult.issuesFixed;
    if (fixResult.issuesFound > 0) filesWithIssues++;
  }

  return {
    success: results.every(({ result }) => result.success),
    filesProcessed: files.length,
    filesWithIssues,
    totalIssues,
    totalFixed,
    results,
    duration: Date.now() - startTime,
  };
}

/**
 * Analyze multiple files
 */
export async function analyzeBatch(
  options: AnalyzeOptions & { parallel?: number }
): Promise<BatchResult> {
  const startTime = Date.now();
  const results: FileResult[] = [];
  const parallel = options.parallel || 4;

  // Determine files to process
  let files: string[];
  const pathStat = await stat(options.path);

  if (pathStat.isDirectory()) {
    files = await collectFiles(
      options.path,
      options.ignore || [],
      false
    );
  } else {
    files = [options.path];
  }

  // Process files in parallel batches
  for (let i = 0; i < files.length; i += parallel) {
    const batch = files.slice(i, i + parallel);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const result = await analyzeFile({
          ...options,
          path: file,
        });
        return { file, result };
      })
    );
    results.push(...batchResults);
  }

  // Calculate totals
  let totalIssues = 0;
  let filesWithIssues = 0;

  for (const { result } of results) {
    const analyzeResult = result as AnalyzeResult;
    const issueCount = analyzeResult.issues.length;
    totalIssues += issueCount;
    if (issueCount > 0) filesWithIssues++;
  }

  return {
    success: results.every(({ result }) => result.success),
    filesProcessed: files.length,
    filesWithIssues,
    totalIssues,
    totalFixed: 0,
    results,
    duration: Date.now() - startTime,
  };
}
