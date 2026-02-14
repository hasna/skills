/**
 * OpenAI Text-to-Speech Provider
 * Supports high-quality TTS with multiple voices
 */

import type {
  AudioProvider,
  GenerateOptions,
  Voice,
  OpenAIGenerateRequest,
} from '../types';

export class OpenAIProvider implements AudioProvider {
  name = 'OpenAI TTS';
  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';

  // Available voices in OpenAI TTS
  private availableVoices: Voice[] = [
    {
      id: 'alloy',
      name: 'Alloy',
      description: 'Neutral and balanced voice',
    },
    {
      id: 'echo',
      name: 'Echo',
      description: 'Warm and expressive voice',
    },
    {
      id: 'fable',
      name: 'Fable',
      description: 'Storytelling voice with British accent',
    },
    {
      id: 'onyx',
      name: 'Onyx',
      description: 'Deep and authoritative voice',
    },
    {
      id: 'nova',
      name: 'Nova',
      description: 'Energetic and youthful voice',
    },
    {
      id: 'shimmer',
      name: 'Shimmer',
      description: 'Soft and gentle voice',
    },
  ];

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async generate(options: GenerateOptions): Promise<void> {
    const {
      text,
      voice = 'nova',
      model = 'tts-1',
      output,
      speed = 1.0,
    } = options;

    // Validate voice
    const validVoice = this.availableVoices.find(
      (v) => v.id === voice.toLowerCase() || v.name.toLowerCase() === voice.toLowerCase()
    );

    if (!validVoice) {
      throw new Error(
        `Voice "${voice}" not found. Available voices: ${this.availableVoices
          .map((v) => v.id)
          .join(', ')}`
      );
    }

    const requestBody: OpenAIGenerateRequest = {
      model,
      input: text,
      voice: validVoice.id,
      response_format: 'mp3',
      speed: Math.max(0.25, Math.min(4.0, speed)), // Clamp between 0.25 and 4.0
    };

    const url = `${this.baseUrl}/audio/speech`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    await Bun.write(output, audioBuffer);

    console.log(`Audio generated successfully: ${output}`);
  }

  async listVoices(): Promise<Voice[]> {
    return this.availableVoices;
  }
}
