/**
 * Provider Factory
 * Returns the appropriate transcription provider
 */

import { ElevenLabsProvider } from './elevenlabs';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import type { TranscriptionProvider, Provider } from '../types';

export function getProvider(providerName: Provider): TranscriptionProvider {
  switch (providerName) {
    case 'elevenlabs':
      return new ElevenLabsProvider();
    case 'openai':
      return new OpenAIProvider();
    case 'gemini':
      return new GeminiProvider();
    default:
      throw new Error(
        `Unknown provider: ${providerName}. Available: elevenlabs, openai, gemini`
      );
  }
}

export function getProviderInfo(): void {
  console.log(`
Available Transcription Providers:

ELEVENLABS (Scribe)
  - Accuracy: 96.7% for English
  - Max file size: 3GB / 10 hours
  - Features: Speaker diarization (up to 32 speakers), word timestamps
  - Cost: $0.40/hour
  - Best for: Multi-speaker recordings, highest accuracy needs

OPENAI (Whisper)
  - Accuracy: Excellent
  - Max file size: 25MB (auto-chunking for larger files)
  - Features: Segment timestamps, language detection
  - Cost: $0.006/min (GPT-4o Mini: $0.003/min)
  - Best for: Standard transcription, good balance of cost/quality

GEMINI (Flash)
  - Accuracy: Very good
  - Max file size: 2GB
  - Features: Multimodal analysis, summarization
  - Cost: ~$0.09-0.23/hour (generous free tier)
  - Best for: Cost-sensitive, multimodal needs, free tier usage

USAGE:
  skill-transcript transcribe --provider <name> --input <file> [options]
`);
}
