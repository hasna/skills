/**
 * Shared types and interfaces for audio generation providers
 */

export type Provider = 'elevenlabs' | 'openai' | 'google';

export interface GenerateOptions {
  text: string;
  voice?: string;
  model?: string;
  output: string;
  language?: string;
  speed?: number;
}

export interface Voice {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  category?: string;
}

export interface AudioProvider {
  name: string;
  generate(options: GenerateOptions): Promise<void>;
  listVoices(): Promise<Voice[]>;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

export interface ElevenLabsGenerateRequest {
  text: string;
  model_id?: string;
  voice_settings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
}

export interface OpenAIGenerateRequest {
  model: string;
  input: string;
  voice: string;
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac';
  speed?: number;
}

export interface GoogleTTSRequest {
  input: {
    text: string;
  };
  voice: {
    languageCode: string;
    name?: string;
    ssmlGender?: 'MALE' | 'FEMALE' | 'NEUTRAL';
  };
  audioConfig: {
    audioEncoding: string;
    speakingRate?: number;
    pitch?: number;
  };
}

export interface GoogleTTSVoice {
  languageCodes: string[];
  name: string;
  ssmlGender: string;
  naturalSampleRateHertz: number;
}
