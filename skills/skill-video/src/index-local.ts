#!/usr/bin/env bun

import { parseArgs, validateGenerateOptions, validateStatusOptions } from './cli';
import { getProvider } from './providers';
import { resolve } from 'path';
import { handleInstallCommand } from './skill-install';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-video',
  description: 'Claude Code skill for AI video generation',
  version: '1.0.0',
  commands: `Use: skill-video --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

async function main() {
  try {
    const { command, options } = parseArgs();

    switch (command) {
      case 'generate': {
        const generateOptions = validateGenerateOptions(options);
        const provider = getProvider(generateOptions.provider);

        console.log('\n=== Video Generation ===');
        console.log(`Provider: ${provider.name}`);
        console.log(`Prompt: "${generateOptions.prompt}"\n`);

        // Start generation
        const job = await provider.generate(generateOptions);

        console.log(`\n=== Generation Started ===`);
        console.log(`Job ID: ${job.jobId}`);
        console.log(`Status: ${job.status}`);

        // If already completed (synchronous providers)
        if (job.status === 'completed' && job.videoUrl) {
          console.log(`\nVideo is ready!`);

          if (generateOptions.output) {
            const outputPath = resolve(generateOptions.output);
            await provider.download(job.videoUrl, outputPath);
            console.log(`\nSaved to: ${outputPath}`);
          } else {
            console.log(`\nVideo URL: ${job.videoUrl}`);
            console.log(`Use --output to download automatically.`);
          }
        } else {
          // Async generation - poll for status
          console.log(`\nVideo generation in progress...`);
          console.log(`\nTo check status, run:`);
          console.log(`bun run src/index.ts status --provider ${generateOptions.provider} --job-id ${job.jobId}`);

          // Auto-poll if output path is specified
          if (generateOptions.output) {
            console.log(`\nAuto-polling for completion...`);
            await pollUntilComplete(provider, job.jobId, generateOptions.output);
          }
        }

        break;
      }

      case 'status': {
        const statusOptions = validateStatusOptions(options);
        const provider = getProvider(statusOptions.provider);

        console.log('\n=== Checking Status ===');
        console.log(`Provider: ${provider.name}`);
        console.log(`Job ID: ${statusOptions.jobId}\n`);

        const job = await provider.getStatus(statusOptions.jobId);

        console.log(`Status: ${job.status}`);
        if (job.progress !== undefined) {
          console.log(`Progress: ${job.progress}%`);
        }
        if (job.error) {
          console.log(`Error: ${job.error}`);
        }
        if (job.videoUrl) {
          console.log(`Video URL: ${job.videoUrl}`);
        }

        // Offer to download if completed
        if (job.status === 'completed' && job.videoUrl && options.output) {
          const outputPath = resolve(options.output);
          console.log(`\nDownloading video...`);
          await provider.download(job.videoUrl, outputPath);
          console.log(`Saved to: ${outputPath}`);
        }

        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log(`Run "bun run src/index.ts help" for usage information.`);
        process.exit(1);
    }

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function pollUntilComplete(
  provider: any,
  jobId: string,
  outputPath: string,
  maxAttempts: number = 60,
  intervalMs: number = 10000
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));

    const job = await provider.getStatus(jobId);

    if (job.progress !== undefined) {
      console.log(`Progress: ${job.progress}%`);
    }

    if (job.status === 'completed') {
      if (job.videoUrl) {
        console.log(`\nVideo generation complete!`);
        const resolvedPath = resolve(outputPath);
        await provider.download(job.videoUrl, resolvedPath);
        console.log(`Saved to: ${resolvedPath}`);
      }
      return;
    }

    if (job.status === 'failed') {
      throw new Error(`Video generation failed: ${job.error || 'Unknown error'}`);
    }
  }

  throw new Error('Video generation timed out. Use status command to check manually.');
}

main();
