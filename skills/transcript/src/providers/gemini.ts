/**
 * Google Gemini Provider
 * Multimodal transcription with analysis capabilities
 */

import { readFile } from 'fs/promises';
import type {
  TranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResult,
  GeminiResponse
} from '../types';
import { getFileSize, needsChunking, splitAudioFile, mergeTranscriptions, cleanupChunks } from '../chunker';
import { dirname, join } from 'path';

// Gemini supports up to 2GB files
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

const MIME_TYPES: Record<string, string> = {
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'ogg': 'audio/ogg',
  'flac': 'audio/flac',
  'm4a': 'audio/mp4',
  'aac': 'audio/aac',
  'mp4': 'video/mp4',
  'webm': 'video/webm'
};

export class GeminiProvider implements TranscriptionProvider {
  name = 'Google Gemini';
  maxFileSize = MAX_FILE_SIZE;
  supportedFormats = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4', 'webm'];

  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async transcribe(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const {
      input,
      language,
      model = 'gemini-2.0-flash',
      diarize = false,
      timestamps = false
    } = options;

    console.log(`[Gemini] Transcribing: ${input}`);
    console.log(`[Gemini] Model: ${model}`);

    // Check file size
    const fileSize = await getFileSize(input);
    console.log(`[Gemini] File size: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

    // For very large files, use chunking
    if (fileSize > 100 * 1024 * 1024) { // > 100MB use chunking for efficiency
      console.log(`[Gemini] Large file detected, using chunking for efficiency`);
      return this.transcribeWithChunking(options);
    }

    return this.transcribeSingle(options);
  }

  private async transcribeSingle(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const {
      input,
      language,
      model = 'gemini-2.0-flash',
      diarize = false,
      timestamps = false
    } = options;

    // Read and encode file
    const fileBuffer = await readFile(input);
    const base64Audio = fileBuffer.toString('base64');

    // Determine MIME type
    const ext = input.split('.').pop()?.toLowerCase() || 'mp3';
    const mimeType = MIME_TYPES[ext] || 'audio/mpeg';

    // Build prompt based on options
    let prompt = 'Transcribe this audio accurately. ';

    if (language) {
      prompt += `The audio is in ${language}. `;
    }

    if (diarize) {
      prompt += 'Identify and label different speakers (Speaker A, Speaker B, etc.). ';
    }

    if (timestamps) {
      prompt += 'Include timestamps for each segment in [HH:MM:SS] format. ';
    }

    prompt += 'Provide only the transcription without any additional commentary.';

    const response = await fetch(
      `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Audio
                  }
                },
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini transcription failed: ${error}`);
    }

    const data = await response.json() as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log(`[Gemini] Transcription complete`);

    return {
      text: text.trim(),
      model,
      provider: 'gemini'
    };
  }

  private async transcribeWithChunking(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const { input, model = 'gemini-2.0-flash' } = options;
    const outputDir = dirname(input);

    // Split into chunks
    const chunks = await splitAudioFile(input, outputDir);
    const transcriptions: string[] = [];

    try {
      // Process chunks in parallel (Gemini can handle concurrent requests)
      const promises = chunks.map(async (chunk) => {
        console.log(`[Gemini] Processing chunk ${chunk.index + 1}/${chunks.length}`);
        const result = await this.transcribeSingle({
          ...options,
          input: chunk.path
        });
        return { index: chunk.index, text: result.text };
      });

      const results = await Promise.all(promises);

      // Sort by index and extract texts
      results.sort((a, b) => a.index - b.index);
      transcriptions.push(...results.map(r => r.text));

      // Merge transcriptions
      const mergedText = mergeTranscriptions(transcriptions);

      return {
        text: mergedText,
        model,
        provider: 'gemini'
      };
    } finally {
      // Cleanup chunks
      const chunkDir = join(outputDir, '.chunks');
      await cleanupChunks(chunkDir);
    }
  }
}
