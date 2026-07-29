import { resolve } from 'path';
import { parseArgs } from 'util';

import { log } from './logger';
import type { AnalysisOptions } from './types';

export function parseArguments(): { filePath: string; options: AnalysisOptions } {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      format: { type: 'string', default: 'markdown' },
      output: { type: 'string' },
      correlations: { type: 'boolean', default: false },
      outliers: { type: 'boolean', default: false },
      trends: { type: 'boolean', default: false },
      sample: { type: 'string' },
      percentiles: { type: 'string', default: '25,50,75,90,95' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Analyze Data - Comprehensive data analysis for CSV and JSON files

Usage:
  skills run analyze-data -- <file-path> [options]

Options:
  --format <fmt>       Output format: markdown, json, html (default: markdown)
  --output <path>      Save report to file
  --correlations       Calculate correlations
  --outliers           Detect outliers
  --trends             Detect trends
  --sample <n>         Analyze only first n rows
  --percentiles <list> Comma-separated percentiles (default: 25,50,75,90,95)
  --verbose            Show detailed progress
  --help, -h           Show this help
`);
    process.exit(0);
  }

  if (positionals.length === 0) {
    log('Error: File path is required', 'error');
    console.log('Usage: skills run analyze-data -- <file-path> [options]');
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), positionals[0]);

  return {
    filePath,
    options: {
      format: values.format as 'markdown' | 'json' | 'html',
      output: values.output as string,
      correlations: values.correlations as boolean,
      outliers: values.outliers as boolean,
      trends: values.trends as boolean,
      sample: values.sample ? parseInt(values.sample as string) : undefined,
      percentiles: (values.percentiles as string).split(',').map(Number),
      verbose: values.verbose as boolean,
    }
  };
}
