/**
 * Tool runner - executes linters, formatters, and other code tools
 */

import { readFile, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';
import type {
  Language,
  FixType,
  FixOptions,
  AnalyzeOptions,
  FixResult,
  AnalyzeResult,
  Issue,
  Severity,
} from '../types';
import { detectLanguage, getFixerConfig, isToolAvailable } from './detector';

/**
 * Parse ESLint JSON output into issues
 */
function parseEslintOutput(output: string): Issue[] {
  try {
    const results = JSON.parse(output);
    const issues: Issue[] = [];

    for (const file of results) {
      for (const msg of file.messages || []) {
        issues.push({
          line: msg.line || 1,
          column: msg.column || 1,
          message: msg.message,
          rule: msg.ruleId,
          severity: msg.severity === 2 ? 'error' : 'warning',
          fixable: !!msg.fix,
        });
      }
    }

    return issues;
  } catch {
    return [];
  }
}

/**
 * Parse Ruff output into issues
 */
function parseRuffOutput(output: string): Issue[] {
  const issues: Issue[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Format: file.py:10:5: E501 Line too long
    const match = line.match(/^[^:]+:(\d+):(\d+):\s*(\w+)\s+(.+)$/);
    if (match) {
      issues.push({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        message: match[4],
        rule: match[3],
        severity: match[3].startsWith('E') ? 'error' : 'warning',
        fixable: true,
      });
    }
  }

  return issues;
}

/**
 * Parse TypeScript compiler output into issues
 */
function parseTscOutput(output: string): Issue[] {
  const issues: Issue[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Format: file.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
    const match = line.match(/^[^(]+\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s+(.+)$/);
    if (match) {
      issues.push({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        message: match[5],
        rule: match[4],
        severity: match[3] as Severity,
        fixable: false,
      });
    }
  }

  return issues;
}

/**
 * Parse generic linter output (line:col: message format)
 */
function parseGenericOutput(output: string): Issue[] {
  const issues: Issue[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Try various formats
    let match = line.match(/^[^:]+:(\d+):(\d+):\s*(.+)$/);
    if (match) {
      issues.push({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        message: match[3],
        severity: line.toLowerCase().includes('error') ? 'error' : 'warning',
        fixable: false,
      });
    }
  }

  return issues;
}

/**
 * Run a command and capture output
 */
async function runCommand(
  command: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

/**
 * Run ESLint on a file
 */
async function runEslint(
  filePath: string,
  fix: boolean
): Promise<{ issues: Issue[]; fixed: boolean }> {
  const args = ['--format', 'json', filePath];
  if (fix) args.unshift('--fix');

  const { stdout, exitCode } = await runCommand('eslint', args);
  const issues = parseEslintOutput(stdout);

  return { issues, fixed: fix && exitCode === 0 };
}

/**
 * Run Prettier on a file
 */
async function runPrettier(
  filePath: string,
  write: boolean
): Promise<{ formatted: string; changed: boolean }> {
  const original = await readFile(filePath, 'utf-8');
  const args = write ? ['--write', filePath] : [filePath];

  const { stdout, exitCode } = await runCommand('prettier', args);

  if (write) {
    const updated = await readFile(filePath, 'utf-8');
    return { formatted: updated, changed: original !== updated };
  }

  return { formatted: stdout, changed: original !== stdout };
}

/**
 * Run Ruff on a Python file
 */
async function runRuff(
  filePath: string,
  fix: boolean
): Promise<{ issues: Issue[]; fixed: boolean }> {
  const checkArgs = ['check', filePath];
  if (fix) checkArgs.push('--fix');

  const { stdout, stderr, exitCode } = await runCommand('ruff', checkArgs);
  const issues = parseRuffOutput(stdout + stderr);

  return { issues, fixed: fix && issues.length > 0 };
}

/**
 * Run TypeScript compiler for type checking
 */
async function runTsc(filePath: string): Promise<Issue[]> {
  const { stdout, stderr } = await runCommand('tsc', ['--noEmit', filePath]);
  return parseTscOutput(stdout + stderr);
}

/**
 * Run Go linting
 */
async function runGolangciLint(
  filePath: string,
  fix: boolean
): Promise<{ issues: Issue[]; fixed: boolean }> {
  const args = ['run', '--out-format', 'line-number', filePath];
  if (fix) args.push('--fix');

  const { stdout, stderr, exitCode } = await runCommand('golangci-lint', args);
  const issues = parseGenericOutput(stdout + stderr);

  return { issues, fixed: fix };
}

/**
 * Run gofmt on a Go file
 */
async function runGofmt(
  filePath: string,
  write: boolean
): Promise<{ formatted: string; changed: boolean }> {
  const original = await readFile(filePath, 'utf-8');
  const args = write ? ['-w', filePath] : [filePath];

  const { stdout } = await runCommand('gofmt', args);

  if (write) {
    const updated = await readFile(filePath, 'utf-8');
    return { formatted: updated, changed: original !== updated };
  }

  return { formatted: stdout, changed: original !== stdout };
}

/**
 * Generate a unified diff between two strings
 */
function generateDiff(original: string, modified: string, filePath: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diff: string[] = [`--- a/${basename(filePath)}`, `+++ b/${basename(filePath)}`];

  // Simple line-by-line diff
  const maxLines = Math.max(originalLines.length, modifiedLines.length);
  let inHunk = false;
  let hunkStart = 0;
  let hunkLines: string[] = [];

  for (let i = 0; i < maxLines; i++) {
    const orig = originalLines[i];
    const mod = modifiedLines[i];

    if (orig !== mod) {
      if (!inHunk) {
        inHunk = true;
        hunkStart = i + 1;
        hunkLines = [];
      }
      if (orig !== undefined) hunkLines.push(`-${orig}`);
      if (mod !== undefined) hunkLines.push(`+${mod}`);
    } else if (inHunk) {
      diff.push(`@@ -${hunkStart},${hunkLines.filter((l) => l.startsWith('-')).length} +${hunkStart},${hunkLines.filter((l) => l.startsWith('+')).length} @@`);
      diff.push(...hunkLines);
      inHunk = false;
    }
  }

  if (inHunk) {
    diff.push(`@@ -${hunkStart},${hunkLines.filter((l) => l.startsWith('-')).length} +${hunkStart},${hunkLines.filter((l) => l.startsWith('+')).length} @@`);
    diff.push(...hunkLines);
  }

  return diff.join('\n');
}

/**
 * Fix a single file
 */
export async function fixFile(options: FixOptions): Promise<FixResult> {
  const language = options.language || detectLanguage(options.path);
  const config = getFixerConfig(language);

  const result: FixResult = {
    success: true,
    path: options.path,
    language,
    issuesFound: 0,
    issuesFixed: 0,
    issues: [],
  };

  if (!config) {
    result.success = false;
    result.error = `No fixer configured for language: ${language}`;
    return result;
  }

  try {
    const original = await readFile(options.path, 'utf-8');
    let modified = original;
    const allIssues: Issue[] = [];

    // Run linting
    if (
      (options.type === 'lint' || options.type === 'all') &&
      config.lintCommand
    ) {
      const tool = config.lintCommand.split(' ')[0];
      if (await isToolAvailable(tool)) {
        if (language === 'typescript' || language === 'javascript') {
          const { issues, fixed } = await runEslint(
            options.path,
            options.write ?? false
          );
          allIssues.push(...issues);
          if (fixed) result.issuesFixed += issues.filter((i) => i.fixable).length;
        } else if (language === 'python') {
          const { issues, fixed } = await runRuff(
            options.path,
            options.write ?? false
          );
          allIssues.push(...issues);
          if (fixed) result.issuesFixed += issues.length;
        } else if (language === 'go') {
          const { issues, fixed } = await runGolangciLint(
            options.path,
            options.write ?? false
          );
          allIssues.push(...issues);
          if (fixed) result.issuesFixed += issues.length;
        }
      }
    }

    // Run formatting
    if (
      (options.type === 'format' || options.type === 'all') &&
      config.formatCommand
    ) {
      const tool = config.formatCommand.split(' ')[0];
      if (await isToolAvailable(tool)) {
        if (tool === 'prettier') {
          const { formatted, changed } = await runPrettier(
            options.path,
            options.write ?? false
          );
          if (changed) {
            modified = formatted;
            result.issuesFixed++;
            allIssues.push({
              line: 1,
              column: 1,
              message: 'File reformatted',
              severity: 'info',
              fixable: true,
            });
          }
        } else if (tool === 'gofmt') {
          const { formatted, changed } = await runGofmt(
            options.path,
            options.write ?? false
          );
          if (changed) {
            modified = formatted;
            result.issuesFixed++;
            allIssues.push({
              line: 1,
              column: 1,
              message: 'File reformatted with gofmt',
              severity: 'info',
              fixable: true,
            });
          }
        } else if (tool === 'ruff' && language === 'python') {
          const args = ['format'];
          if (options.write) args.push(options.path);
          else args.push('--check', options.path);
          await runCommand('ruff', args);
        }
      }
    }

    // Run type checking (TypeScript only, doesn't fix)
    if (
      (options.type === 'types' || options.type === 'all') &&
      config.typeCheckCommand &&
      (language === 'typescript')
    ) {
      const tool = config.typeCheckCommand.split(' ')[0];
      if (await isToolAvailable(tool)) {
        const typeIssues = await runTsc(options.path);
        allIssues.push(...typeIssues);
      }
    }

    result.issues = allIssues;
    result.issuesFound = allIssues.length;

    // Generate diff if requested
    if (options.diff && modified !== original) {
      result.diff = generateDiff(original, modified, options.path);
    }

    // Write to output if specified
    if (options.output && modified !== original) {
      await writeFile(options.output, modified);
    }
  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

/**
 * Analyze a single file without fixing
 */
export async function analyzeFile(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const language = options.language || detectLanguage(options.path);
  const config = getFixerConfig(language);

  const result: AnalyzeResult = {
    success: true,
    path: options.path,
    language,
    issues: [],
    summary: {
      errors: 0,
      warnings: 0,
      info: 0,
      hints: 0,
      fixable: 0,
    },
  };

  if (!config) {
    return result;
  }

  try {
    const allIssues: Issue[] = [];
    const types = options.types || ['lint', 'format', 'types'];

    // Run linting (analysis only)
    if (types.includes('lint') && config.lintCommand) {
      const tool = config.lintCommand.split(' ')[0];
      if (await isToolAvailable(tool)) {
        if (language === 'typescript' || language === 'javascript') {
          const { issues } = await runEslint(options.path, false);
          allIssues.push(...issues);
        } else if (language === 'python') {
          const { issues } = await runRuff(options.path, false);
          allIssues.push(...issues);
        } else if (language === 'go') {
          const { issues } = await runGolangciLint(options.path, false);
          allIssues.push(...issues);
        }
      }
    }

    // Check formatting
    if (types.includes('format') && config.formatCommand) {
      const tool = config.formatCommand.split(' ')[0];
      if (await isToolAvailable(tool)) {
        if (tool === 'prettier') {
          const { changed } = await runPrettier(options.path, false);
          if (changed) {
            allIssues.push({
              line: 1,
              column: 1,
              message: 'File needs formatting',
              severity: 'warning',
              fixable: true,
            });
          }
        } else if (tool === 'gofmt') {
          const { changed } = await runGofmt(options.path, false);
          if (changed) {
            allIssues.push({
              line: 1,
              column: 1,
              message: 'File needs formatting (gofmt)',
              severity: 'warning',
              fixable: true,
            });
          }
        }
      }
    }

    // Type checking
    if (types.includes('types') && config.typeCheckCommand && language === 'typescript') {
      const tool = config.typeCheckCommand.split(' ')[0];
      if (await isToolAvailable(tool)) {
        const typeIssues = await runTsc(options.path);
        allIssues.push(...typeIssues);
      }
    }

    // Filter by errors only if requested
    result.issues = options.errorsOnly
      ? allIssues.filter((i) => i.severity === 'error')
      : allIssues;

    // Calculate summary
    for (const issue of result.issues) {
      result.summary[issue.severity === 'error' ? 'errors' : issue.severity === 'warning' ? 'warnings' : issue.severity === 'hint' ? 'hints' : 'info']++;
      if (issue.fixable) result.summary.fixable++;
    }
  } catch (error) {
    result.success = false;
  }

  return result;
}
