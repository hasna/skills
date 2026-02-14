#!/usr/bin/env bun

/**
 * Transcription CLI
 * Speech-to-text using ElevenLabs, OpenAI Whisper, or Google Gemini
 * Supports automatic chunking for large files
 */
import { handleInstallCommand } from '../../_common';


// Handle install/uninstall commands
const SKILL_META = {
  name: 'skill-transcript',
  description: 'Audio/video transcription skill supporting ElevenLabs, OpenAI Whisper, and Google Gemini with automatic chunking for large files',
  version: '1.0.0',
  commands: `Use: skill-transcript --help`,
  requiredEnvVars: ['SKILL_API_KEY'],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

import { getProvider, getProviderInfo } from './providers';
import { formatOutput, getOutputExtension } from './formatter';
import type { Provider, TranscriptionOptions } from './types';
import type { OutputFormat } from './formatter';
import { basename, extname, dirname, join } from 'path';

// Parse command line arguments
function parseArgs(): {
  command: string;
  input?: string;
  output?: string;
  provider?: Provider;
  language?: string;
  model?: string;
  diarize?: boolean;
  timestamps?: boolean;
  format?: OutputFormat;
} {
  const args = process.argv.slice(2);
  const parsed: any = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');

      if (key === 'diarize' || key === 'timestamps') {
        parsed[key] = true;
      } else {
        parsed[key] = args[++i];
      }
    }
  }

  return parsed;
}

// Display help information
function showHelp(): void {
  console.log(`
Transcription CLI - Speech-to-text with automatic chunking

USAGE:
  bun run src/index.ts <command> [options]

COMMANDS:
  transcribe    Transcribe an audio/video file
  providers     Show available providers and their capabilities
  help          Show this help message

TRANSCRIBE OPTIONS:
  --input <path>        Input audio/video file (required)
  --output <path>       Output file path (optional, defaults to input name + format extension)
  --provider <name>     Provider: elevenlabs, openai, gemini (required)
  --language <code>     Language code, e.g., en, es, fr (optional)
  --model <name>        Specific model to use (optional)
  --diarize             Enable speaker diarization (ElevenLabs, Gemini)
  --timestamps          Include timestamps in output
  --format <type>       Output format: text, srt, vtt, json (default: text)

SUPPORTED FORMATS:
  Audio: mp3, wav, m4a, ogg, flac, aac, webm
  Video: mp4, webm

EXAMPLES:
  # Basic transcription with OpenAI Whisper
  bun run src/index.ts transcribe \\
    --provider openai \\
    --input ./recording.mp3 \\
    --output ./transcript.txt

  # Transcription with speaker diarization (ElevenLabs)
  bun run src/index.ts transcribe \\
    --provider elevenlabs \\
    --input ./meeting.mp3 \\
    --diarize \\
    --timestamps \\
    --format srt

  # Cost-effective transcription (Gemini)
  bun run src/index.ts transcribe \\
    --provider gemini \\
    --input ./podcast.mp3 \\
    --format vtt

  # Transcribe with specific language
  bun run src/index.ts transcribe \\
    --provider openai \\
    --input ./spanish.mp3 \\
    --language es \\
    --format json

LARGE FILE HANDLING:
  - ElevenLabs: Up to 3GB (native support)
  - Gemini: Up to 2GB (auto-chunking for efficiency)
  - OpenAI: 25MB limit (automatic compression/chunking for larger files)

ENVIRONMENT VARIABLES:
  ELEVENLABS_API_KEY    API key for ElevenLabs Scribe
  OPENAI_API_KEY        API key for OpenAI Whisper
  GOOGLE_API_KEY        API key for Google Gemini

DEPENDENCIES:
  - ffmpeg (required for chunking large files with OpenAI)
  - ffprobe (required for audio duration detection)
`);
}

// Main CLI handler
async function main(): Promise<void> {
  const args = parseArgs();

  try {
    switch (args.command) {
      case 'transcribe': {
        if (!args.input) {
          console.error('Error: --input is required');
          console.error('Use: bun run src/index.ts help');
          process.exit(1);
        }
        if (!args.provider) {
          console.error('Error: --provider is required');
          console.error('Available providers: elevenlabs, openai, gemini');
          process.exit(1);
        }

        const provider = getProvider(args.provider as Provider);
        console.log(`\nUsing ${provider.name}`);
        console.log(`Max file size: ${(provider.maxFileSize / 1024 / 1024 / 1024).toFixed(1)}GB`);
        console.log('');

        const options: TranscriptionOptions = {
          input: args.input,
          output: args.output,
          provider: args.provider as Provider,
          language: args.language,
          model: args.model,
          diarize: args.diarize,
          timestamps: args.timestamps,
          format: (args.format as OutputFormat) || 'text'
        };

        const result = await provider.transcribe(options);

        // Format output
        const format = (args.format as OutputFormat) || 'text';
        const formattedOutput = formatOutput(result, format);

        // Determine output path
        let outputPath = args.output;
        if (!outputPath) {
          const inputDir = dirname(args.input);
          const inputName = basename(args.input, extname(args.input));
          outputPath = join(inputDir, `${inputName}${getOutputExtension(format)}`);
        }

        // Write output
        await Bun.write(outputPath, formattedOutput);

        console.log(`\nTranscription complete!`);
        console.log(`Output: ${outputPath}`);
        console.log(`Format: ${format}`);

        if (result.duration) {
          console.log(`Duration: ${Math.round(result.duration)}s`);
        }
        if (result.language) {
          console.log(`Detected language: ${result.language}`);
        }
        if (result.segments) {
          console.log(`Segments: ${result.segments.length}`);
        }
        if (result.speakers) {
          console.log(`Speakers: ${result.speakers.length}`);
        }

        // Show word count
        const wordCount = result.text.split(/\s+/).length;
        console.log(`Words: ${wordCount.toLocaleString()}`);
        break;
      }

      case 'providers':
        getProviderInfo();
        break;

      case 'help':
        showHelp();
        break;

      default:
        console.error(`Unknown command: ${args.command}`);
        console.error('Use: bun run src/index.ts help');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the CLI
main();
