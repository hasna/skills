import chalk from "chalk";

export const logger = {
  info: (message: string) => console.log(chalk.blue("ℹ"), message),
  success: (message: string) => console.log(chalk.green("✓"), message),
  warning: (message: string) => console.log(chalk.yellow("⚠"), message),
  error: (message: string) => console.log(chalk.red("✗"), message),
  debug: (message: string) => {
    if (process.env.DEBUG) {
      console.log(chalk.gray("🔍"), message);
    }
  },
  step: (step: number, total: number, message: string) => {
    console.log(chalk.cyan(`[${step}/${total}]`), message);
  },
  header: (title: string) => {
    console.log();
    console.log(chalk.bold.cyan(`═══ ${title} ═══`));
    console.log();
  },
  divider: () => {
    console.log(chalk.gray("─".repeat(50)));
  },
  json: (data: unknown) => {
    console.log(JSON.stringify(data, null, 2));
  },
  table: (data: Record<string, unknown>[]) => {
    console.table(data);
  },
  label: (label: string, value: string) => {
    console.log(chalk.gray(label + ":"), value);
  },
};
