/**
 * Voiceover generation using OpenAI and ElevenLabs
 */

import OpenAI from "openai";
import * as logger from "../utils/logger.js";
import { loadConfig, saveAudio } from "./storage.js";
import { sanitizeFilename } from "../utils/paths.js";
import type { VoiceoverOptions, VoiceoverResult, Provider } from "../types/index.js";
import { OPENAI_VOICES } from "../types/index.js";

/**
 * Generate voiceover using OpenAI TTS
 */
async function generateWithOpenAI(
  text: string,
  voice: string,
  speed: number = 1.0
): Promise<Buffer> {
  const openai = new OpenAI();

  const validVoice = OPENAI_VOICES.includes(voice) ? voice : "alloy";

  const response = await openai.audio.speech.create({
    model: "tts-1-hd",
    voice: validVoice as any,
    input: text,
    speed,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer;
}

/**
 * Generate voiceover using ElevenLabs
 */
async function generateWithElevenLabs(
  text: string,
  voiceId: string,
  options: { stability?: number; similarityBoost?: number } = {}
): Promise<Buffer> {
  const config = loadConfig();
  const apiKey = config.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  const stability = options.stability ?? 0.5;
  const similarityBoost = options.similarityBoost ?? 0.75;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${error}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer;
}

/**
 * Generate voiceover
 */
export async function generateVoiceover(
  text: string,
  options: Partial<VoiceoverOptions> = {}
): Promise<VoiceoverResult> {
  const config = loadConfig();
  const provider = options.provider || config.defaultProvider;
  const voice = options.voice || config.defaultVoice;

  logger.info(`Generating voiceover with ${provider}...`);
  logger.info(`Voice: ${voice}`);
  logger.info(`Text: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);

  let audioBuffer: Buffer;

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }
    audioBuffer = await generateWithOpenAI(text, voice, options.speed);
  } else if (provider === "elevenlabs") {
    audioBuffer = await generateWithElevenLabs(text, voice, {
      stability: options.stability,
      similarityBoost: options.similarityBoost,
    });
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Save the audio file
  const filename = `${sanitizeFilename(text)}_${Date.now()}.mp3`;
  const filepath = saveAudio(filename, audioBuffer);

  logger.success(`Generated: ${filepath}`);

  return {
    text,
    provider,
    voice,
    filepath,
    format: "mp3",
  };
}

/**
 * List available voices for a provider
 */
export async function listVoices(provider: Provider): Promise<{ id: string; name: string }[]> {
  if (provider === "openai") {
    return OPENAI_VOICES.map((v) => ({ id: v, name: v }));
  }

  if (provider === "elevenlabs") {
    const config = loadConfig();
    const apiKey = config.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY not set");
    }

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch ElevenLabs voices");
    }

    const data = await response.json() as { voices: { voice_id: string; name: string }[] };
    return data.voices.map((v) => ({ id: v.voice_id, name: v.name }));
  }

  return [];
}
