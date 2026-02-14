#!/usr/bin/env bun

/**
 * Code Fix CLI
 * Auto-linting, formatting, and code quality fixes
 */
import { handleInstallCommand } from '../../_common';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-codefix',
  description: 'Code quality CLI for auto-linting, formatting, and fixing code issues',
  version: '1.0.0',
  commands: `Use: skill-codefix --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { stat } from 'fs/promises';
import type { Language, FixType, AnalyzeResult, FixResult } from './types';
import {
  fixFile,
  analyzeFile,
  fixBatch,
  analyzeBatch,
  detectLanguage,
  getAvailableTools,
  getSupportedExtensions,
} from './fixers';

// Parse command line arguments
function parseArgs(): {
  command: string;
  path?: string;
  type?: FixType;
  language?: Language;
  write?: boolean;
  dryRun?: boolean;
  diff?: boolean;
  output?: string;
  format?: 'text' | 'json' | 'github';
  errorsOnly?: boolean;
  ignore?: string[];
  parallel?: number;
  verbose?: boolean;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, unknown> = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const nextArg = args[i + 1];

      // Boolean flags
      if (key === 'write' || key === 'w') {
        parsed.write = true;
      } else if (key === 'dry-run' || key === 'dry') {
        parsed.dryRun = true;
      } else if (key === 'diff' || key === 'd') {
        parsed.diff = true;
      } else if (key === 'errors-only' || key === 'errors') {
        parsed.errorsOnly = true;
      } else if (key === 'verbose' || key === 'v') {
        parsed.verbose = true;
      } else if (key === 'ignore') {
        // Collect ignore patterns until next flag
        const patterns: string[] = [];
        i++;
        while (i < args.length && !args[i].startsWith('--')) {
          patterns.push(args[i]);
          i++;
        }
        i--;
        parsed.ignore = patterns;
      } else if (key === 'parallel' || key === 'p') {
        parsed.parallel = parseInt(nextArg, 10);
        i++;
      } else if (nextArg && !nextArg.startsWith('--')) {
        // Handle kebab-case to camelCase
        const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        parsed[camelKey] = nextArg;
        i++;
      }
    } else if (!parsed.path) {
      // First non-flag argument is the path
      parsed.path = arg;
    }
  }

  return parsed as ReturnType<typeof parseArgs>;
}

// Display help information
function showHelp(): void {
  console.log(`
Code Fix CLI - Auto-linting, formatting, and code quality fixes

USAGE:
  bun run src/index.ts <command> [path] [options]

COMMANDS:
  fix         Fix code issues in file(s)
  analyze     Analyze code without making changes
  check       Alias for analyze
  tools       Show available tools for a language
  languages   Show supported languages
  help        Show this help message

FIX OPTIONS:
  --type <type>       Fix type: lint, format, types, imports, all (default: all)
  --language <lang>   Force language detection
  --write, -w         Write fixes to files (default: false)
  --dry-run           Show what would be fixed without changing files
  --diff, -d          Show diff of changes
  --output <path>     Write fixed output to different path
  --ignore <patterns> Patterns to ignore (glob)
  --parallel <n>      Number of parallel workers (default: 4)
  --verbose, -v       Verbose output

ANALYZE OPTIONS:
  --type <type>       Check type: lint, format, types, all (default: all)
  --language <lang>   Force language detection
  --format <fmt>      Output format: text, json, github (default: text)
  --errors-only       Show only errors, not warnings
  --ignore <patterns> Patterns to ignore (glob)
  --parallel <n>      Number of parallel workers (default: 4)

FIX TYPES:
  lint       Fix linting issues (ESLint, Ruff, etc.)
  format     Format/prettify code (Prettier, gofmt, etc.)
  types      Fix type errors (TypeScript)
  imports    Organize and fix imports
  all        Run all applicable fixes

EXAMPLES:
  # Analyze a file
  bun run src/index.ts analyze src/index.ts

  # Fix and write changes
  bun run src/index.ts fix src/ --write

  # Format a file
  bun run src/index.ts fix script.py --type format --write

  # Lint with diff output
  bun run src/index.ts fix src/app.ts --type lint --diff

  # Analyze directory, JSON output
  bun run src/index.ts analyze ./src --format json

  # Check with GitHub Actions format
  bun run src/index.ts check ./src --format github

  # Fix ignoring test files
  bun run src/index.ts fix ./src --write --ignore "*.test.ts" "*.spec.ts"

SUPPORTED LANGUAGES:
  TypeScript/JavaScript (eslint, prettier, tsc)
  Python (ruff)
  Go (golangci-lint, gofmt)
  JSON/YAML/Markdown (prettier)
  CSS/SCSS (stylelint, prettier)
  Shell (shellcheck, shfmt)
`);
}

// Format issue for display
function formatIssue(
  issue: { line: number; column: number; message: string; rule?: string; severity: string },
  file?: string,
  format: 'text' | 'json' | 'github' = 'text'
): string {
  if (format === 'github') {
    // GitHub Actions annotation format
    const level = issue.severity === 'error' ? 'error' : 'warning';
    return `::${level} file=${file},line=${issue.line},col=${issue.column}::${issue.message}${issue.rule ? ` (${issue.rule})` : ''}`;
  }

  const severityIcon = {
    error: '\x1b[31m✗\x1b[0m',
    warning: '\x1b[33m⚠\x1b[0m',
    info: '\x1b[34mℹ\x1b[0m',
    hint: '\x1b[90m○\x1b[0m',
  }[issue.severity] || '○';

  return `  ${severityIcon} ${issue.line}:${issue.column} ${issue.message}${issue.rule ? ` \x1b[90m(${issue.rule})\x1b[0m` : ''}`;
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  try {
    switch (args.command) {
      case 'fix': {
        if (!args.path) {
          console.error('Error: path is required');
          console.error('Usage: bun run src/index.ts fix <path> [options]');
          process.exit(1);
        }

        const pathStat = await stat(args.path).catch(() => null);
        if (!pathStat) {
          console.error(`Error: path not found: ${args.path}`);
          process.exit(1);
        }

        console.log(`\nFixing code in: ${args.path}`);
        console.log(`Type: ${args.type || 'all'}`);
        console.log(`Write: ${args.write ? 'yes' : 'no (dry run)'}`);
        console.log('');

        if (pathStat.isDirectory()) {
          const result = await fixBatch({
            path: args.path,
            type: (args.type as FixType) || 'all',
            language: args.language as Language,
            write: args.write,
            dryRun: args.dryRun,
            diff: args.diff,
            ignore: args.ignore,
            parallel: args.parallel,
            verbose: args.verbose,
          });

          // Print results
          for (const { file, result: fileResult } of result.results) {
            const r = fileResult as FixResult;
            if (r.issuesFound > 0 || args.verbose) {
              console.log(`\x1b[1m${file}\x1b[0m`);
              for (const issue of r.issues) {
                console.log(formatIssue(issue));
              }
              if (r.diff) {
                console.log('\n\x1b[90m--- Diff ---\x1b[0m');
                console.log(r.diff);
              }
              console.log('');
            }
          }

          // Print summary
          console.log('--- Summary ---');
          console.log(`Files processed: ${result.filesProcessed}`);
          console.log(`Files with issues: ${result.filesWithIssues}`);
          console.log(`Total issues: ${result.totalIssues}`);
          console.log(`Issues fixed: ${result.totalFixed}`);
          console.log(`Duration: ${result.duration}ms`);

          if (result.totalIssues > result.totalFixed && !args.write) {
            console.log('\nRun with --write to apply fixes');
          }

          process.exit(result.success ? 0 : 1);
        } else {
          const result = await fixFile({
            path: args.path,
            type: (args.type as FixType) || 'all',
            language: args.language as Language,
            write: args.write,
            dryRun: args.dryRun,
            diff: args.diff,
            output: args.output,
            verbose: args.verbose,
          });

          console.log(`\x1b[1m${result.path}\x1b[0m`);
          for (const issue of result.issues) {
            console.log(formatIssue(issue));
          }

          if (result.diff) {
            console.log('\n\x1b[90m--- Diff ---\x1b[0m');
            console.log(result.diff);
          }

          console.log('');
          console.log(`Issues found: ${result.issuesFound}`);
          console.log(`Issues fixed: ${result.issuesFixed}`);

          if (result.error) {
            console.error(`Error: ${result.error}`);
          }

          process.exit(result.success ? 0 : 1);
        }
        break;
      }

      case 'analyze':
      case 'check': {
        if (!args.path) {
          console.error('Error: path is required');
          console.error('Usage: bun run src/index.ts analyze <path> [options]');
          process.exit(1);
        }

        const pathStat = await stat(args.path).catch(() => null);
        if (!pathStat) {
          console.error(`Error: path not found: ${args.path}`);
          process.exit(1);
        }

        if (args.format !== 'json') {
          console.log(`\nAnalyzing: ${args.path}`);
          console.log('');
        }

        if (pathStat.isDirectory()) {
          const result = await analyzeBatch({
            path: args.path,
            language: args.language as Language,
            types: args.type ? [args.type as FixType] : undefined,
            format: args.format,
            errorsOnly: args.errorsOnly,
            ignore: args.ignore,
            parallel: args.parallel,
          });

          if (args.format === 'json') {
            console.log(JSON.stringify(result, null, 2));
          } else {
            // Print results
            for (const { file, result: fileResult } of result.results) {
              const r = fileResult as AnalyzeResult;
              if (r.issues.length > 0) {
                console.log(`\x1b[1m${file}\x1b[0m`);
                for (const issue of r.issues) {
                  console.log(formatIssue(issue, file, args.format));
                }
                console.log('');
              }
            }

            // Print summary
            console.log('--- Summary ---');
            console.log(`Files analyzed: ${result.filesProcessed}`);
            console.log(`Files with issues: ${result.filesWithIssues}`);
            console.log(`Total issues: ${result.totalIssues}`);
            console.log(`Duration: ${result.duration}ms`);

            if (result.totalIssues > 0) {
              console.log('\nRun "fix --write" to auto-fix issues');
            }
          }

          process.exit(result.totalIssues > 0 ? 1 : 0);
        } else {
          const result = await analyzeFile({
            path: args.path,
            language: args.language as Language,
            types: args.type ? [args.type as FixType] : undefined,
            format: args.format,
            errorsOnly: args.errorsOnly,
          });

          if (args.format === 'json') {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`\x1b[1m${result.path}\x1b[0m`);
            for (const issue of result.issues) {
              console.log(formatIssue(issue, result.path, args.format));
            }

            console.log('');
            console.log(`Errors: ${result.summary.errors}`);
            console.log(`Warnings: ${result.summary.warnings}`);
            console.log(`Fixable: ${result.summary.fixable}`);
          }

          process.exit(result.issues.length > 0 ? 1 : 0);
        }
        break;
      }

      case 'tools': {
        const language = (args.path || args.language || 'typescript') as Language;
        console.log(`\nChecking tools for: ${language}`);

        const tools = await getAvailableTools(language);

        console.log(`\nLinting:     ${tools.lint ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}`);
        console.log(`Formatting:  ${tools.format ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}`);
        console.log(`Type check:  ${tools.typeCheck ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}`);

        if (tools.tools.length > 0) {
          console.log(`\nAvailable: ${tools.tools.join(', ')}`);
        } else {
          console.log('\nNo tools found. Install required tools:');
          if (language === 'typescript' || language === 'javascript') {
            console.log('  npm install -g eslint prettier typescript');
          } else if (language === 'python') {
            console.log('  pip install ruff mypy');
          } else if (language === 'go') {
            console.log('  go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest');
          }
        }
        break;
      }

      case 'languages': {
        console.log('\nSupported file extensions:');
        const extensions = getSupportedExtensions();
        console.log(extensions.join(', '));
        break;
      }

      case 'help':
        showHelp();
        break;

      default:
        console.error(`Unknown command: ${args.command}`);
        console.error('Use: bun run src/index.ts help');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the CLI
main();
