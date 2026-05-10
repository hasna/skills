import chalk from 'chalk';

/**
 * Log info message
 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

/**
 * Log success message
 */
export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

/**
 * Log warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

/**
 * Log error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

/**
 * Log step in a process
 */
export function step(message: string): void {
  console.log(chalk.cyan('→'), message);
}

/**
 * Create a spinner-like progress indicator
 */
export function progress(message: string): { update: (msg: string) => void; done: (msg?: string) => void } {
  process.stdout.write(chalk.cyan('⏳') + ' ' + message);

  return {
    update: (msg: string) => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(chalk.cyan('⏳') + ' ' + msg);
    },
    done: (msg?: string) => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      if (msg) {
        console.log(chalk.green('✓'), msg);
      }
    },
  };
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Create a table for CLI output
 */
export function table(rows: string[][], headers?: string[]): string {
  const columnWidths: number[] = [];

  // Calculate column widths
  const allRows = headers ? [headers, ...rows] : rows;
  for (const row of allRows) {
    for (let i = 0; i < row.length; i++) {
      const len = stripAnsi(row[i]).length;
      columnWidths[i] = Math.max(columnWidths[i] || 0, len);
    }
  }

  // Format rows
  const formatRow = (row: string[]): string => {
    return row.map((cell, i) => {
      const padding = columnWidths[i] - stripAnsi(cell).length;
      return cell + ' '.repeat(padding);
    }).join('  ');
  };

  let output = '';

  if (headers) {
    output += chalk.bold(formatRow(headers)) + '\n';
    output += columnWidths.map(w => '─'.repeat(w)).join('──') + '\n';
  }

  for (const row of rows) {
    output += formatRow(row) + '\n';
  }

  return output.trimEnd();
}

/**
 * Strip ANSI codes from string
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * Print JSON output
 */
export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print markdown content
 */
export function markdown(content: string): void {
  console.log(content);
}
