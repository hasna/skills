import type { Options } from "./types";

export function parseArguments(): Options {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`generate-pr-description

Usage:
  generate-pr-description [options]

Options:
  --base <branch>       Base branch, default main
  --head <branch>       Head branch
  --format <format>     github, gitlab, bitbucket, or plain
  --output <path>       Output file
  --include-files       Include changed file list
  --staged              Use staged changes
  --unstaged            Use unstaged changes
  --no-ai               Generate a basic non-AI template
  --copy                Copy output to clipboard`);
    process.exit(0);
  }

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
