/**
 * OpenAI Whisper Provider
 * Industry-standard speech-to-text with automatic chunking for large files
 */

import type {
  TranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionSegment,
  OpenAITranscriptionResponse
} from '../types';
import {
  needsChunking,
  splitAudioFile,
  mergeTranscriptions,
  cleanupChunks,
  compressAudio,
  getFileSize
} from '../chunker';
import { dirname, join, basename, extname } from 'path';

// OpenAI Whisper has a 25MB limit
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export class OpenAIProvider implements TranscriptionProvider {
  name = 'OpenAI Whisper';
  maxFileSize = MAX_FILE_SIZE;
  supportedFormats = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'];

  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async transcribe(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const {
      input,
      language,
      model = 'whisper-1',
      timestamps = true
    } = options;

    console.log(`[OpenAI] Transcribing: ${input}`);
    console.log(`[OpenAI] Model: ${model}`);

    // Check if file needs chunking
    const fileSize = await getFileSize(input);
    console.log(`[OpenAI] File size: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

    if (fileSize > this.maxFileSize) {
      console.log(`[OpenAI] File exceeds 25MB limit, chunking required`);
      return this.transcribeWithChunking(options);
    }

    return this.transcribeSingle(options);
  }

  private async transcribeSingle(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const {
      input,
      language,
      model = 'whisper-1',
      timestamps = true
    } = options;

    // Read the file
    const file = Bun.file(input);
    const fileBuffer = await file.arrayBuffer();

    // Create form data
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), input.split('/').pop());
    formData.append('model', model);
    formData.append('response_format', timestamps ? 'verbose_json' : 'json');

    if (language) {
      formData.append('language', language);
    }

    if (timestamps) {
      formData.append('timestamp_granularities[]', 'segment');
      formData.append('timestamp_granularities[]', 'word');
    }

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI transcription failed: ${error}`);
    }

    const data = await response.json() as OpenAITranscriptionResponse;
    console.log(`[OpenAI] Transcription complete`);

    return this.formatResult(data, model);
  }

  private async transcribeWithChunking(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const { input, model = 'whisper-1' } = options;
    const outputDir = dirname(input);

    // First try compression
    const compressedPath = join(outputDir, `.compressed_${basename(input, extname(input))}.ogg`);

    try {
      console.log('[OpenAI] Attempting compression first...');
      await compressAudio(input, compressedPath, '32k');
      const compressedSize = await getFileSize(compressedPath);

      if (compressedSize <= this.maxFileSize) {
        console.log('[OpenAI] Compressed file is under 25MB, transcribing directly');
        const result = await this.transcribeSingle({
          ...options,
          input: compressedPath
        });

        // Cleanup compressed file
        await Bun.write(compressedPath, '').catch(() => {});

        return result;
      }
    } catch {
      console.log('[OpenAI] Compression failed or still too large, falling back to chunking');
    }

    // Split into chunks
    const chunks = await splitAudioFile(input, outputDir);
    const transcriptions: string[] = [];
    const allSegments: TranscriptionSegment[] = [];

    try {
      // Process chunks sequentially to maintain order
      for (const chunk of chunks) {
        console.log(`[OpenAI] Processing chunk ${chunk.index + 1}/${chunks.length}`);

        const result = await this.transcribeSingle({
          ...options,
          input: chunk.path
        });

        transcriptions.push(result.text);

        // Adjust segment timestamps based on chunk start time
        if (result.segments) {
          for (const segment of result.segments) {
            allSegments.push({
              ...segment,
              id: allSegments.length,
              start: segment.start + chunk.startTime,
              end: segment.end + chunk.startTime
            });
          }
        }
      }

      // Merge transcriptions
      const mergedText = mergeTranscriptions(transcriptions);

      return {
        text: mergedText,
        segments: allSegments.length > 0 ? allSegments : undefined,
        model,
        provider: 'openai'
      };
    } finally {
      // Cleanup chunks
      const chunkDir = join(outputDir, '.chunks');
      await cleanupChunks(chunkDir);
    }
  }

  private formatResult(data: OpenAITranscriptionResponse, model: string): TranscriptionResult {
    const segments: TranscriptionSegment[] = data.segments?.map((seg, i) => ({
      id: i,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      confidence: 1 - seg.no_speech_prob
    })) || [];

    return {
      text: data.text,
      segments: segments.length > 0 ? segments : undefined,
      duration: data.duration,
      language: data.language,
      model,
      provider: 'openai'
    };
  }
}
