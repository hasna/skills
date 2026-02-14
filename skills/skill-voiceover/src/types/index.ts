/**
 * Types for voiceover generation service
 */

export type Provider = "elevenlabs" | "openai";

export interface VoiceoverOptions {
  provider: Provider;
  voice: string;
  model?: string;
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}

export interface VoiceoverResult {
  text: string;
  provider: Provider;
  voice: string;
  filepath: string;
  duration?: number;
  format: string;
}

export interface Voice {
  id: string;
  name: string;
  provider: Provider;
  description?: string;
  previewUrl?: string;
}

export interface Config {
  outputDir: string;
  defaultProvider: Provider;
  defaultVoice: string;
  elevenLabsApiKey?: string;
  openaiApiKey?: string;
}

// OpenAI voices
export const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

// ElevenLabs default voices
export const ELEVENLABS_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam" },
];
