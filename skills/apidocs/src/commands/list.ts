import * as output from '../utils/output.js';
import { listLibraries, initStorage } from '../lib/storage.js';
import { formatNumber } from '../utils/output.js';
import chalk from 'chalk';

/**
 * List all indexed libraries
 */
export async function list(): Promise<void> {
  await initStorage();

  const libraries = await listLibraries();

  if (libraries.length === 0) {
    output.info('No libraries indexed yet');
    output.info('Use `service-apidocs add <website-url>` to add documentation');
    return;
  }

  console.log();
  console.log(chalk.bold('Indexed Libraries'));
  console.log('─'.repeat(80));

  const rows = libraries.map((lib) => {
    const name = chalk.cyan(lib.name);
    const domain = chalk.yellow(lib.domain);
    const pages = chalk.gray(`${formatNumber(lib.pageCount || 0)} pages`);
    const chunks = chalk.gray(`${formatNumber(lib.chunkCount)} chunks`);
    const endpoints = lib.endpointCount
      ? chalk.magenta(`${formatNumber(lib.endpointCount)} endpoints`)
      : chalk.gray('-');
    const date = new Date(lib.indexedAt).toLocaleDateString();

    return [name, domain, pages, chunks, endpoints, chalk.gray(date)];
  });

  console.log(output.table(rows, ['Library', 'Domain', 'Pages', 'Chunks', 'Endpoints', 'Indexed']));

  // Show docs URLs for libraries that have them
  const withDocsUrl = libraries.filter((lib) => lib.docsUrl);
  if (withDocsUrl.length > 0) {
    console.log();
    console.log(chalk.dim('Documentation URLs:'));
    for (const lib of withDocsUrl) {
      console.log(chalk.dim(`  ${lib.name}: ${lib.docsUrl}`));
    }
  }

  console.log();
  console.log(chalk.gray(`Total: ${libraries.length} libraries`));
}
