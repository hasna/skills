/**
 * Types for skill-transcript
 * Audio/video transcription with automatic chunking
 */

export type Provider = 'elevenlabs' | 'openai' | 'gemini';

export interface TranscriptionOptions {
  input: string;
  output?: string;
  provider: Provider;
  language?: string;
  model?: string;
  diarize?: boolean; // Speaker diarization
  timestamps?: boolean;
  format?: 'text' | 'srt' | 'vtt' | 'json';
}

export interface TranscriptionResult {
  text: string;
  segments?: TranscriptionSegment[];
  speakers?: Speaker[];
  duration?: number;
  language?: string;
  model?: string;
  provider: Provider;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface Speaker {
  id: string;
  name?: string;
  segments: number[];
}

export interface ChunkInfo {
  index: number;
  startTime: number;
  endTime: number;
  path: string;
  size: number;
}

export interface TranscriptionProvider {
  name: string;
  maxFileSize: number; // in bytes
  supportedFormats: string[];
  transcribe(options: TranscriptionOptions): Promise<TranscriptionResult>;
}

// Provider-specific response types
export interface ElevenLabsResponse {
  text: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
    speaker?: string;
  }>;
  speakers?: Array<{
    speaker_id: string;
    name?: string;
  }>;
}

export interface OpenAITranscriptionResponse {
  text: string;
  task?: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
  }>;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
}
