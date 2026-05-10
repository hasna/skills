import chalk from 'chalk';

export const logger = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.log(chalk.red('✗'), msg),
  debug: (msg: string) => {
    if (process.env.DEBUG) console.log(chalk.gray('⋯'), msg);
  },

  instance: (id: string, status: string, msg?: string) => {
    const statusColors: Record<string, (s: string) => string> = {
      starting: chalk.yellow,
      cloning: chalk.blue,
      'setting-up': chalk.blue,
      running: chalk.cyan,
      completed: chalk.green,
      failed: chalk.red,
    };
    const colorFn = statusColors[status] || chalk.white;
    const shortId = id.slice(0, 8);
    console.log(`  ${chalk.gray(`[${shortId}]`)} ${colorFn(status.padEnd(10))} ${msg || ''}`);
  },

  table: (data: Array<Record<string, unknown>>) => {
    if (data.length === 0) {
      console.log(chalk.gray('  No data'));
      return;
    }
    console.table(data);
  },

  divider: () => console.log(chalk.gray('─'.repeat(60))),

  header: (title: string) => {
    console.log();
    console.log(chalk.bold.white(title));
    logger.divider();
  },
};
