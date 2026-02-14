/**
 * Logger utility with colored output
 */

import chalk from "chalk";

export function info(message: string): void {
  console.log(chalk.blue("ℹ"), message);
}

export function success(message: string): void {
  console.log(chalk.green("✓"), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow("⚠"), message);
}

export function error(message: string): void {
  console.log(chalk.red("✗"), message);
}

export function debug(message: string): void {
  if (process.env.DEBUG) {
    console.log(chalk.gray("⋯"), message);
  }
}

export function progress(current: number, total: number, message: string): void {
  const percent = Math.round((current / total) * 100);
  const bar = "█".repeat(Math.floor(percent / 5)) + "░".repeat(20 - Math.floor(percent / 5));
  process.stdout.write(`\r${chalk.cyan(bar)} ${percent}% ${message}`);
  if (current === total) {
    process.stdout.write("\n");
  }
}

export function heading(message: string): void {
  console.log();
  console.log(chalk.bold.underline(message));
  console.log();
}

export function table(rows: [string, string][]): void {
  const maxKeyLen = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    console.log(`  ${chalk.dim(key.padEnd(maxKeyLen))}  ${value}`);
  }
}
