import { spawnSync } from "child_process";
import type { CommitInfo, GitDiffResult, Options } from "./types";

function runGitCommand(args: string[], cwd?: string): string {
  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
  });

  if (result.error) {
    throw new Error(`Git command failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Git command failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

export function isGitRepository(): boolean {
  try {
    runGitCommand(['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

function getCurrentBranch(): string {
  try {
    return runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return 'HEAD';
  }
}

export function branchExists(branch: string): boolean {
  try {
    runGitCommand(['rev-parse', '--verify', branch]);
    return true;
  } catch {
    return false;
  }
}

export function getDiff(options: Options): GitDiffResult {
  let diffArgs: string[] = ['diff'];

  if (options.staged) {
    diffArgs.push('--staged');
  } else if (options.unstaged) {
    // Just diff working tree
  } else {
    // Compare branches
    const head = options.head || getCurrentBranch();
    diffArgs.push(`${options.base}...${head}`);
  }

  const diff = runGitCommand(diffArgs);

  // Get diff stats
  const statsArgs = [...diffArgs, '--stat'];
  const statsOutput = runGitCommand(statsArgs);
  const stats = parseDiffStats(statsOutput);

  // Get file changes
  const nameStatusArgs = [...diffArgs, '--name-status'];
  const nameStatus = runGitCommand(nameStatusArgs);
  const files = parseNameStatus(nameStatus);

  return { diff, stats, files };
}

function parseDiffStats(output: string): GitDiffResult['stats'] {
  const lines = output.split('\n');
  const summaryLine = lines[lines.length - 1];

  const stats = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  };

  const fileMatch = summaryLine.match(/(\d+) files? changed/);
  if (fileMatch) stats.filesChanged = parseInt(fileMatch[1]);

  const insertMatch = summaryLine.match(/(\d+) insertions?\(\+\)/);
  if (insertMatch) stats.insertions = parseInt(insertMatch[1]);

  const deleteMatch = summaryLine.match(/(\d+) deletions?\(-\)/);
  if (deleteMatch) stats.deletions = parseInt(deleteMatch[1]);

  return stats;
}

function parseNameStatus(output: string): GitDiffResult['files'] {
  const files = {
    added: [] as string[],
    modified: [] as string[],
    deleted: [] as string[],
  };

  const lines = output.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const [status, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');

    switch (status[0]) {
      case 'A':
        files.added.push(path);
        break;
      case 'M':
        files.modified.push(path);
        break;
      case 'D':
        files.deleted.push(path);
        break;
      case 'R':
        // Renamed file - treat as modified
        files.modified.push(path);
        break;
    }
  }

  return files;
}

export function getCommitHistory(options: Options): CommitInfo[] {
  let logArgs = ['log', '--pretty=format:%H|%s|%an|%ad', '--date=short'];

  if (options.staged || options.unstaged) {
    // Just get the last few commits for context
    logArgs.push('-10');
  } else {
    const head = options.head || getCurrentBranch();
    logArgs.push(`${options.base}..${head}`);
  }

  try {
    const output = runGitCommand(logArgs);
    const lines = output.split('\n').filter(line => line.trim());

    return lines.map(line => {
      const [hash, message, author, date] = line.split('|');
      return { hash: hash.substring(0, 7), message, author, date };
    });
  } catch {
    return [];
  }
}
