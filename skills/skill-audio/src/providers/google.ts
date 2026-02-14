/**
 * Google Cloud Text-to-Speech Provider
 * Supports multiple languages and voices
 */

import type {
  AudioProvider,
  GenerateOptions,
  Voice,
  GoogleTTSRequest,
  GoogleTTSVoice,
} from '../types';

export class GoogleProvider implements AudioProvider {
  name = 'Google Text-to-Speech';
  private apiKey: string;
  private baseUrl = 'https://texttospeech.googleapis.com/v1';

  constructor() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async generate(options: GenerateOptions): Promise<void> {
    const {
      text,
      voice,
      language = 'en-US',
      output,
      speed = 1.0,
    } = options;

    // Default voice settings
    let voiceName = voice;
    let ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL' = 'NEUTRAL';

    // If voice is specified, try to find it in available voices
    if (voice) {
      const voices = await this.listVoices();
      const selectedVoice = voices.find(
        (v) => v.name.toLowerCase().includes(voice.toLowerCase()) ||
               v.id === voice
      );

      if (selectedVoice) {
        voiceName = selectedVoice.id;
      }
    }

    // If no voice specified or not found, use default for language
    if (!voiceName) {
      voiceName = `${language}-Standard-A`;
    }

    const requestBody: GoogleTTSRequest = {
      input: {
        text,
      },
      voice: {
        languageCode: language,
        name: voiceName,
        ssmlGender,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Math.max(0.25, Math.min(4.0, speed)),
      },
    };

    const url = `${this.baseUrl}/text:synthesize?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { audioContent: string };

    // Decode base64 audio content
    const audioBuffer = Buffer.from(data.audioContent, 'base64');
    await Bun.write(output, audioBuffer);

    console.log(`Audio generated successfully: ${output}`);
  }

  async listVoices(): Promise<Voice[]> {
    const url = `${this.baseUrl}/voices?key=${this.apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { voices: GoogleTTSVoice[] };

    return data.voices.map((voice) => ({
      id: voice.name,
      name: voice.name,
      description: `${voice.languageCodes.join(', ')} - ${voice.ssmlGender}`,
      category: voice.languageCodes[0],
    }));
  }
}
