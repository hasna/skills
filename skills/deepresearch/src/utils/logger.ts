import ora, { type Ora } from "ora";
import chalk from "chalk";

let spinner: Ora | null = null;

export const logger = {
  info(message: string) {
    if (spinner?.isSpinning) spinner.stop();
    console.log(chalk.blue("ℹ"), message);
    if (spinner) spinner.start();
  },

  success(message: string) {
    if (spinner?.isSpinning) spinner.stop();
    console.log(chalk.green("✓"), message);
  },

  warn(message: string) {
    if (spinner?.isSpinning) spinner.stop();
    console.log(chalk.yellow("⚠"), message);
    if (spinner) spinner.start();
  },

  error(message: string) {
    if (spinner?.isSpinning) spinner.stop();
    console.log(chalk.red("✗"), message);
  },

  step(step: number, total: number, message: string) {
    if (spinner?.isSpinning) spinner.stop();
    console.log(chalk.dim(`[${step}/${total}]`), message);
  },

  startSpinner(message: string): Ora {
    spinner = ora({
      text: message,
      color: "cyan",
    }).start();
    return spinner;
  },

  updateSpinner(message: string) {
    if (spinner) {
      spinner.text = message;
    }
  },

  succeedSpinner(message: string) {
    if (spinner) {
      spinner.succeed(message);
      spinner = null;
    }
  },

  failSpinner(message: string) {
    if (spinner) {
      spinner.fail(message);
      spinner = null;
    }
  },

  stopSpinner() {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
  },

  header(title: string) {
    console.log();
    console.log(chalk.bold.cyan(`═══ ${title} ═══`));
    console.log();
  },

  divider() {
    console.log(chalk.dim("─".repeat(50)));
  },

  stats(label: string, value: string | number) {
    console.log(chalk.dim(`  ${label}:`), chalk.white(value));
  },
};

export default logger;
