#!/usr/bin/env bun

/**
 * Generate PR Description Skill
 *
 * Auto-generate comprehensive PR descriptions from git diff with AI-powered analysis
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, basename } from 'path';
import { spawnSync } from 'child_process';

// ============================================================================
// Types and Interfaces
// ============================================================================

interface Options {
  base: string;
  head?: string;
  format: 'github' | 'gitlab' | 'bitbucket' | 'plain';
  output?: string;
  includeFiles: boolean;
  template?: string;
  staged: boolean;
  unstaged: boolean;
  noAi: boolean;
  model: string;
  copy: boolean;
  verbose: boolean;
}

interface GitDiffResult {
  diff: string;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  files: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface PRDescription {
  summary: string;
  changes: string[];
  whatChanged: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  whyChanged: string;
  breakingChanges: string[];
  testPlan: string[];
  additionalNotes: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

function parseArguments(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    base: 'main',
    format: 'github',
    includeFiles: false,
    staged: false,
    unstaged: false,
    noAi: false,
    model: 'claude-3-5-sonnet-20241022',
    copy: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--base':
        options.base = args[++i];
        break;
      case '--head':
        options.head = args[++i];
        break;
      case '--format':
        options.format = args[++i] as Options['format'];
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--include-files':
        options.includeFiles = true;
        break;
      case '--template':
        options.template = args[++i];
        break;
      case '--staged':
        options.staged = true;
        break;
      case '--unstaged':
        options.unstaged = true;
        break;
      case '--no-ai':
        options.noAi = true;
        break;
      case '--model':
        options.model = args[++i];
        break;
      case '--copy':
        options.copy = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
    }
  }

  return options;
}

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

function isGitRepository(): boolean {
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

function branchExists(branch: string): boolean {
  try {
    runGitCommand(['rev-parse', '--verify', branch]);
    return true;
  } catch {
    return false;
  }
}

function getDiff(options: Options): GitDiffResult {
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

function getCommitHistory(options: Options): CommitInfo[] {
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

function copyToClipboard(text: string): boolean {
  try {
    // Try pbcopy (macOS)
    const pbcopy = spawnSync('pbcopy', [], {
      input: text,
      encoding: 'utf-8',
    });
    if (pbcopy.status === 0) return true;

    // Try xclip (Linux)
    const xclip = spawnSync('xclip', ['-selection', 'clipboard'], {
      input: text,
      encoding: 'utf-8',
    });
    if (xclip.status === 0) return true;

    // Try wl-copy (Wayland)
    const wlcopy = spawnSync('wl-copy', [], {
      input: text,
      encoding: 'utf-8',
    });
    if (wlcopy.status === 0) return true;

    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// AI Analysis
// ============================================================================

async function analyzeWithAI(
  diff: string,
  commits: CommitInfo[],
  files: GitDiffResult['files'],
  options: Options
): Promise<PRDescription> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    if (options.verbose) {
      console.log('⚠️  ANTHROPIC_API_KEY not set, using basic template');
    }
    return generateBasicDescription(diff, commits, files);
  }

  try {
    const prompt = buildAnalysisPrompt(diff, commits, files);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    return parseAIResponse(content, files);
  } catch (error) {
    if (options.verbose) {
      console.error('AI analysis failed:', error);
      console.log('Falling back to basic template');
    }
    return generateBasicDescription(diff, commits, files);
  }
}

function buildAnalysisPrompt(
  diff: string,
  commits: CommitInfo[],
  files: GitDiffResult['files']
): string {
  // Truncate diff if too large
  const maxDiffLength = 50000;
  const truncatedDiff = diff.length > maxDiffLength
    ? diff.substring(0, maxDiffLength) + '\n\n[... diff truncated ...]'
    : diff;

  const commitMessages = commits.map(c => `- ${c.message} (${c.hash})`).join('\n');

  return `Analyze the following git changes and generate a comprehensive pull request description.

FILES CHANGED:
Added: ${files.added.join(', ') || 'none'}
Modified: ${files.modified.join(', ') || 'none'}
Deleted: ${files.deleted.join(', ') || 'none'}

COMMIT HISTORY:
${commitMessages || 'No commits'}

GIT DIFF:
${truncatedDiff}

Please provide a PR description in the following JSON format:
{
  "summary": "Brief 1-2 sentence overview of what this PR does",
  "changes": ["List of key changes made (3-7 items)"],
  "whyChanged": "Detailed explanation of why these changes were needed and the approach taken",
  "breakingChanges": ["List any breaking changes, or empty array if none"],
  "testPlan": ["Suggested testing steps"],
  "additionalNotes": ["Any other relevant notes"]
}

Focus on:
1. What problem is being solved
2. Key technical changes
3. Any breaking changes or migration notes
4. Testing recommendations

Return only the JSON, no additional text.`;
}

function parseAIResponse(content: string, files: GitDiffResult['files']): PRDescription {
  try {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/\`\`\`(?:json)?\s*(\{[\s\S]*\})\s*\`\`\`/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    const parsed = JSON.parse(jsonStr);

    return {
      summary: parsed.summary || 'Changes made to the codebase',
      changes: parsed.changes || [],
      whatChanged: files,
      whyChanged: parsed.whyChanged || 'No detailed explanation provided',
      breakingChanges: parsed.breakingChanges || [],
      testPlan: parsed.testPlan || [],
      additionalNotes: parsed.additionalNotes || [],
    };
  } catch (error) {
    throw new Error(`Failed to parse AI response: ${error}`);
  }
}

function generateBasicDescription(
  diff: string,
  commits: CommitInfo[],
  files: GitDiffResult['files']
): PRDescription {
  const summary = commits.length > 0
    ? commits[0].message
    : 'Changes to the codebase';

  const changes = commits.map(c => c.message);

  return {
    summary,
    changes: changes.length > 0 ? changes : ['Various code changes'],
    whatChanged: files,
    whyChanged: 'Please add context about why these changes were made.',
    breakingChanges: [],
    testPlan: ['Run existing test suite', 'Manual testing as needed'],
    additionalNotes: [],
  };
}

// ============================================================================
// Output Formatters
// ============================================================================

function formatGitHub(description: PRDescription, options: Options): string {
  let output = '## Summary\n\n';
  output += `${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes\n\n';
    description.changes.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  if (options.includeFiles) {
    output += '## What Changed\n\n';

    if (description.whatChanged.added.length > 0) {
      output += '### Added\n';
      description.whatChanged.added.forEach(file => {
        output += `- \`${file}\`\n`;
      });
      output += '\n';
    }

    if (description.whatChanged.modified.length > 0) {
      output += '### Modified\n';
      description.whatChanged.modified.forEach(file => {
        output += `- \`${file}\`\n`;
      });
      output += '\n';
    }

    if (description.whatChanged.deleted.length > 0) {
      output += '### Deleted\n';
      description.whatChanged.deleted.forEach(file => {
        output += `- \`${file}\`\n`;
      });
      output += '\n';
    }
  }

  output += '## Why These Changes\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `- 🚨 ${change}\n`;
    });
    output += '\n';
  }

  if (description.testPlan.length > 0) {
    output += '## Testing\n\n';
    output += '### Test Plan\n';
    description.testPlan.forEach(test => {
      output += `- [ ] ${test}\n`;
    });
    output += '\n';
  }

  if (description.additionalNotes.length > 0) {
    output += '## Additional Notes\n\n';
    description.additionalNotes.forEach(note => {
      output += `- ${note}\n`;
    });
    output += '\n';
  }

  return output;
}

function formatGitLab(description: PRDescription, options: Options): string {
  let output = '## What does this MR do?\n\n';
  output += `${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes Made\n\n';
    description.changes.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  output += '## Why was this MR needed?\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `- ⚠️ ${change}\n`;
    });
    output += '\n';
  }

  output += '## Does this MR meet the acceptance criteria?\n\n';
  if (description.testPlan.length > 0) {
    description.testPlan.forEach(test => {
      output += `- [ ] ${test}\n`;
    });
  } else {
    output += '- [ ] Tests added/updated\n';
    output += '- [ ] Documentation updated\n';
    output += '- [ ] Code reviewed\n';
    output += '- [ ] All pipelines pass\n';
  }
  output += '\n';

  if (options.includeFiles) {
    output += '## Files Changed\n\n';
    const totalFiles =
      description.whatChanged.added.length +
      description.whatChanged.modified.length +
      description.whatChanged.deleted.length;
    output += `${totalFiles} files changed\n\n`;
  }

  return output;
}

function formatBitbucket(description: PRDescription, options: Options): string {
  let output = '# Description\n\n';
  output += `${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes\n\n';
    description.changes.forEach(change => {
      output += `* ${change}\n`;
    });
    output += '\n';
  }

  output += '## Context\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `* ${change}\n`;
    });
    output += '\n';
  }

  output += '## Testing\n\n';
  if (description.testPlan.length > 0) {
    description.testPlan.forEach(test => {
      output += `* [ ] ${test}\n`;
    });
  } else {
    output += '* [ ] Tests pass\n';
    output += '* [ ] Code reviewed\n';
  }
  output += '\n';

  return output;
}

function formatPlain(description: PRDescription, options: Options): string {
  let output = `# ${description.summary}\n\n`;

  if (description.changes.length > 0) {
    output += '## Changes\n\n';
    description.changes.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  if (options.includeFiles) {
    const totalFiles =
      description.whatChanged.added.length +
      description.whatChanged.modified.length +
      description.whatChanged.deleted.length;
    output += `## Files Changed: ${totalFiles}\n\n`;
  }

  output += '## Details\n\n';
  output += `${description.whyChanged}\n\n`;

  if (description.breakingChanges.length > 0) {
    output += '## Breaking Changes\n\n';
    description.breakingChanges.forEach(change => {
      output += `- ${change}\n`;
    });
    output += '\n';
  }

  return output;
}

function formatOutput(description: PRDescription, options: Options): string {
  switch (options.format) {
    case 'gitlab':
      return formatGitLab(description, options);
    case 'bitbucket':
      return formatBitbucket(description, options);
    case 'plain':
      return formatPlain(description, options);
    case 'github':
    default:
      return formatGitHub(description, options);
  }
}

function applyTemplate(template: string, description: PRDescription): string {
  let output = template;

  output = output.replace(/\{\{summary\}\}/g, description.summary);
  output = output.replace(/\{\{changes\}\}/g, description.changes.join('\n- '));
  output = output.replace(/\{\{why_changed\}\}/g, description.whyChanged);
  output = output.replace(
    /\{\{breaking_changes\}\}/g,
    description.breakingChanges.join('\n- ')
  );
  output = output.replace(/\{\{test_plan\}\}/g, description.testPlan.join('\n- [ ] '));
  output = output.replace(
    /\{\{files_added\}\}/g,
    description.whatChanged.added.join('\n- ')
  );
  output = output.replace(
    /\{\{files_modified\}\}/g,
    description.whatChanged.modified.join('\n- ')
  );
  output = output.replace(
    /\{\{files_deleted\}\}/g,
    description.whatChanged.deleted.join('\n- ')
  );

  return output;
}

// ============================================================================
// Main Function
// ============================================================================

async function main() {
  try {
    const options = parseArguments();

    // Validate git repository
    if (!isGitRepository()) {
      console.error('❌ Error: Not a git repository');
      console.error('Run this command from within a git repository');
      process.exit(1);
    }

    if (options.verbose) {
      console.log('🔍 Analyzing git changes...');
    }

    // Validate branches
    if (!options.staged && !options.unstaged) {
      if (!branchExists(options.base)) {
        console.error(`❌ Error: Base branch '${options.base}' does not exist`);
        process.exit(1);
      }

      if (options.head && !branchExists(options.head)) {
        console.error(`❌ Error: Head branch '${options.head}' does not exist`);
        process.exit(1);
      }
    }

    // Get diff
    const diffResult = getDiff(options);

    if (!diffResult.diff) {
      console.log('ℹ️  No changes to analyze');
      process.exit(0);
    }

    if (options.verbose) {
      console.log(
        `📊 Found ${diffResult.stats.filesChanged} files changed ` +
        `(+${diffResult.stats.insertions}, -${diffResult.stats.deletions})`
      );
    }

    // Get commit history
    const commits = getCommitHistory(options);

    if (options.verbose && commits.length > 0) {
      console.log(`📝 Analyzing ${commits.length} commits`);
    }

    // Generate description
    let description: PRDescription;

    if (options.noAi) {
      if (options.verbose) {
        console.log('📄 Generating basic template (AI disabled)');
      }
      description = generateBasicDescription(diffResult.diff, commits, diffResult.files);
    } else {
      if (options.verbose) {
        console.log('🤖 Analyzing with AI...');
      }
      description = await analyzeWithAI(
        diffResult.diff,
        commits,
        diffResult.files,
        options
      );
    }

    // Format output
    let output: string;

    if (options.template) {
      if (!existsSync(options.template)) {
        console.error(`❌ Error: Template file not found: ${options.template}`);
        process.exit(1);
      }
      const template = readFileSync(options.template, 'utf-8');
      output = applyTemplate(template, description);
    } else {
      output = formatOutput(description, options);
    }

    // Save or print
    if (options.output) {
      const outputPath = resolve(process.cwd(), options.output);
      writeFileSync(outputPath, output, 'utf-8');
      console.log(`✅ PR description saved to: ${outputPath}`);
    } else {
      console.log(output);
    }

    // Copy to clipboard
    if (options.copy) {
      if (copyToClipboard(output)) {
        console.log('📋 Copied to clipboard');
      } else {
        console.log('⚠️  Could not copy to clipboard (no clipboard utility found)');
      }
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}
