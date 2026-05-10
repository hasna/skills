import type { GenerateOptions, StatusOptions } from './types';

export function parseArgs(): { command: string; options: any } {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const command = args[0];

  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  const options: any = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];

      if (!value || value.startsWith('--')) {
        options[key] = true;
      } else {
        options[key] = value;
        i++;
      }
    }
  }

  return { command, options };
}

export function validateGenerateOptions(options: any): GenerateOptions {
  if (!options.provider) {
    throw new Error('--provider is required (google, openai, or runway)');
  }

  if (!['google', 'openai', 'runway'].includes(options.provider)) {
    throw new Error('Invalid provider. Use: google, openai, or runway');
  }

  if (!options.prompt) {
    throw new Error('--prompt is required');
  }

  const validated: GenerateOptions = {
    provider: options.provider,
    prompt: options.prompt,
    output: options.output,
  };

  if (options.duration) {
    validated.duration = parseInt(options.duration);
    if (isNaN(validated.duration) || validated.duration < 1) {
      throw new Error('Invalid duration. Must be a positive number.');
    }
  }

  if (options.resolution) {
    if (!['720p', '1080p', '4k'].includes(options.resolution)) {
      throw new Error('Invalid resolution. Use: 720p, 1080p, or 4k');
    }
    validated.resolution = options.resolution;
  }

  if (options.aspectRatio || options['aspect-ratio']) {
    const ratio = options.aspectRatio || options['aspect-ratio'];
    if (!['16:9', '9:16', '1:1'].includes(ratio)) {
      throw new Error('Invalid aspect ratio. Use: 16:9, 9:16, or 1:1');
    }
    validated.aspectRatio = ratio;
  }

  return validated;
}

export function validateStatusOptions(options: any): StatusOptions {
  if (!options.provider) {
    throw new Error('--provider is required');
  }

  if (!['google', 'openai', 'runway'].includes(options.provider)) {
    throw new Error('Invalid provider. Use: google, openai, or runway');
  }

  if (!options.jobId && !options['job-id']) {
    throw new Error('--job-id is required');
  }

  return {
    provider: options.provider,
    jobId: options.jobId || options['job-id'],
  };
}

function showHelp() {
  console.log(`
Video Generation CLI

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  generate    Generate a new video
  status      Check the status of a video generation job
  help        Show this help message

GENERATE OPTIONS:
  --provider <name>      Provider to use (google, openai, runway) [required]
  --prompt <text>        Text prompt for video generation [required]
  --output <path>        Output file path (default: ./output.mp4)
  --duration <seconds>   Video duration in seconds (default: 5)
  --resolution <size>    Video resolution (720p, 1080p, 4k)
  --aspect-ratio <ratio> Aspect ratio (16:9, 9:16, 1:1)

STATUS OPTIONS:
  --provider <name>      Provider to use (google, openai, runway) [required]
  --job-id <id>          Job ID to check [required]

EXAMPLES:
  # Generate a video with Google Veo 2
  bun run src/index.ts generate \\
    --provider google \\
    --prompt "a cat walking on a beach at sunset" \\
    --output ./cat.mp4

  # Generate with Runway
  bun run src/index.ts generate \\
    --provider runway \\
    --prompt "ocean waves crashing on rocks" \\
    --duration 10 \\
    --resolution 1080p

  # Check generation status
  bun run src/index.ts status \\
    --provider runway \\
    --job-id abc123xyz

ENVIRONMENT VARIABLES:
  GOOGLE_API_KEY               Google Cloud API key
  GOOGLE_APPLICATION_CREDENTIALS  Path to Google service account JSON
  GOOGLE_CLOUD_PROJECT         Google Cloud project ID
  GOOGLE_CLOUD_LOCATION        Google Cloud location (default: us-central1)
  OPENAI_API_KEY               OpenAI API key
  RUNWAY_API_KEY               Runway API key

For more information, see SKILL.md
`);
}
