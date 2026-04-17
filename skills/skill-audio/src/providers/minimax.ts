import type { AudioProvider, GenerateOptions, Voice } from '../types';
import { writeFile } from 'fs/promises';

export class MinimaxProvider implements AudioProvider {
  name = 'Minimax Speech-02-HD';
  private apiKey: string;
  private baseUrl = 'https://api.minimax.chat/v1';

  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('MINIMAX_API_KEY environment variable is required');
    }
  }

  async generate(options: GenerateOptions): Promise<void> {
    console.log(`Generating audio with ${this.name}...`);

    const body: Record<string, unknown> = {
      model: options.model || 'speech-02-hd',
      text: options.text,
    };

    if (options.voice || options.speed) {
      const voiceSetting: Record<string, unknown> = {};
      if (options.voice) voiceSetting.voice_id = options.voice;
      if (options.speed) voiceSetting.speed = options.speed;
      body.voice_setting = voiceSetting;
    }

    const format = options.output.endsWith('.wav') ? 'wav' :
                   options.output.endsWith('.flac') ? 'flac' : 'mp3';
    body.audio_setting = { format };

    if (options.language) {
      body.language_boost = options.language;
    }

    const response = await fetch(`${this.baseUrl}/t2a_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Minimax API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as {
      data?: { audio?: string };
      base_resp?: { status_code: number; status_msg: string };
    };

    if (data.base_resp && data.base_resp.status_code !== 0) {
      throw new Error(`Minimax TTS error: ${data.base_resp.status_msg}`);
    }

    if (!data.data?.audio) {
      throw new Error('No audio data in response');
    }

    const audioBuffer = Buffer.from(data.data.audio, 'hex');
    await writeFile(options.output, audioBuffer);
    console.log(`Audio saved to: ${options.output}`);
  }

  async listVoices(): Promise<Voice[]> {
    return [
      { id: 'male-qn-qingse', name: 'Qingse (Male)', description: 'Young male, clear voice' },
      { id: 'female-shaonv', name: 'Shaonv (Female)', description: 'Young female voice' },
      { id: 'female-yujie', name: 'Yujie (Female)', description: 'Mature female voice' },
      { id: 'male-qn-jingying', name: 'Jingying (Male)', description: 'Male elite voice' },
      { id: 'presenter_male', name: 'Presenter Male', description: 'Professional male presenter' },
      { id: 'presenter_female', name: 'Presenter Female', description: 'Professional female presenter' },
      { id: 'audiobook_male_1', name: 'Audiobook Male', description: 'Audiobook narrator male' },
      { id: 'audiobook_female_1', name: 'Audiobook Female', description: 'Audiobook narrator female' },
    ];
  }
}
