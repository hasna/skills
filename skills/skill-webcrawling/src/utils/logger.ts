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
