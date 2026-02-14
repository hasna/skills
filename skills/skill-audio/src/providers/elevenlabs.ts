/**
 * ElevenLabs Text-to-Speech Provider
 * Supports text-to-speech, voice cloning, and multiple languages
 */

import type {
  AudioProvider,
  GenerateOptions,
  Voice,
  ElevenLabsVoice,
  ElevenLabsGenerateRequest,
} from '../types';

export class ElevenLabsProvider implements AudioProvider {
  name = 'ElevenLabs';
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async generate(options: GenerateOptions): Promise<void> {
    const {
      text,
      voice = 'rachel',
      model = 'eleven_multilingual_v2',
      output,
    } = options;

    // Get voice ID from voice name
    const voiceId = await this.getVoiceId(voice);

    const requestBody: ElevenLabsGenerateRequest = {
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
      },
    };

    const url = `${this.baseUrl}/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    await Bun.write(output, audioBuffer);

    console.log(`Audio generated successfully: ${output}`);
  }

  async listVoices(): Promise<Voice[]> {
    const url = `${this.baseUrl}/voices`;

    const response = await fetch(url, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { voices: ElevenLabsVoice[] };

    return data.voices.map((voice) => ({
      id: voice.voice_id,
      name: voice.name,
      description: voice.description,
      previewUrl: voice.preview_url,
      category: voice.category,
    }));
  }

  private async getVoiceId(voiceName: string): Promise<string> {
    // If it's already a voice ID (long alphanumeric string), use it directly
    if (voiceName.length > 20) {
      return voiceName;
    }

    // Otherwise, look up the voice by name
    const voices = await this.listVoices();
    const voice = voices.find(
      (v) => v.name.toLowerCase() === voiceName.toLowerCase()
    );

    if (!voice) {
      throw new Error(
        `Voice "${voiceName}" not found. Use "voices" command to list available voices.`
      );
    }

    return voice.id;
  }
}
