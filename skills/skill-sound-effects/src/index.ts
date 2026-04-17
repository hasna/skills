#!/usr/bin/env bun

import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { handleInstallCommand } from '../../_common';

const SKILL_META = {
  name: 'skill-sound-effects',
  description: 'Generate sound effects using AI (Minimax)',
  version: '1.0.0',
  commands: `Use: skill-sound-effects --help`,
  requiredEnvVars: ['MINIMAX_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

type Provider = 'minimax';

interface GenerateOptions {
  provider: Provider;
  prompt: string;
  output: string;
  duration?: number;
}

function parseArgs(): GenerateOptions | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return null;
  }

  if (args[0] !== 'generate') {
    console.error(`Unknown command: ${args[0]}`);
    process.exit(1);
  }

  const options: Partial<GenerateOptions> = { provider: 'minimax' };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--provider': case '-p': options.provider = args[++i] as Provider; break;
      case '--prompt': options.prompt = args[++i]; break;
      case '--output': case '-o': options.output = args[++i]; break;
      case '--duration': options.duration = parseInt(args[++i]); break;
      default: console.error(`Unknown option: ${args[i]}`); process.exit(1);
    }
  }

  if (!options.prompt) { console.error('Error: --prompt is required'); process.exit(1); }
  if (!options.output) { console.error('Error: --output is required'); process.exit(1); }

  return options as GenerateOptions;
}

function printHelp() {
  console.log(`
Sound Effects Generation Skill

Generate sound effects using AI models (Minimax)

USAGE:
  skill-sound-effects generate [OPTIONS]

OPTIONS:
  --provider, -p <provider>   Provider (minimax) [default: minimax]
  --prompt <text>             Description of the sound effect [required]
  --output, -o <path>         Output file path [required]
  --duration <seconds>        Duration in seconds

EXAMPLES:
  skill-sound-effects generate --prompt "thunder rolling" --output ./thunder.mp3
  skill-sound-effects generate --prompt "footsteps on gravel" --duration 5 --output ./steps.mp3
  skill-sound-effects generate --prompt "rain on a tin roof" --output ./rain.mp3

ENVIRONMENT VARIABLES:
  MINIMAX_API_KEY             API key for Minimax
`);
}

async function generateMinimax(options: GenerateOptions): Promise<Buffer> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY environment variable is required');

  const baseUrl = 'https://api.minimax.chat/v1';

  console.log(`Generating sound effect with Minimax...`);
  console.log(`Prompt: ${options.prompt}`);

  const body: Record<string, unknown> = {
    model: 'sound-effects-01',
    prompt: options.prompt,
  };
  if (options.duration) body.duration = options.duration;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const response = await fetch(`${baseUrl}/sound_generation`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Minimax API error: ${response.status} - ${err}`);
  }

  const data = await response.json() as { task_id: string };
  console.log(`Task started: ${data.task_id}`);
  console.log('Polling for completion...');

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));

    const statusRes = await fetch(`${baseUrl}/query/sound_generation?task_id=${data.task_id}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const status = await statusRes.json() as {
      status: string;
      extra_info?: { audio_url?: string };
      audio_file?: string;
      base_resp?: { status_msg: string };
    };

    if (status.status === 'Success') {
      const audioUrl = status.extra_info?.audio_url || status.audio_file;
      if (!audioUrl) throw new Error('No audio URL in response');

      console.log('Sound effect generated. Downloading...');
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) throw new Error(`Download failed: ${audioRes.status}`);
      return Buffer.from(await audioRes.arrayBuffer());
    }

    if (status.status === 'Fail') {
      throw new Error(`Sound effect generation failed: ${status.base_resp?.status_msg || 'Unknown error'}`);
    }
  }

  throw new Error('Sound effect generation timed out');
}

async function main() {
  const options = parseArgs();
  if (!options) return;

  try {
    console.log('\n=== Sound Effect Generation ===\n');

    const buffer = await generateMinimax(options);

    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buffer);

    console.log(`\nSound effect saved to: ${outputPath}`);
    console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
    console.log('\nDone!\n');
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
