/**
 * ElevenLabs Scribe Provider
 * High-accuracy speech-to-text with speaker diarization
 */

import type {
  TranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResult,
  TranscriptionSegment,
  ElevenLabsResponse
} from '../types';

// ElevenLabs supports up to 3GB files
const MAX_FILE_SIZE = 3 * 1024 * 1024 * 1024; // 3GB

export class ElevenLabsProvider implements TranscriptionProvider {
  name = 'ElevenLabs Scribe';
  maxFileSize = MAX_FILE_SIZE;
  supportedFormats = ['mp3', 'mp4', 'wav', 'webm', 'm4a', 'ogg', 'flac'];

  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async transcribe(options: TranscriptionOptions): Promise<TranscriptionResult> {
    const {
      input,
      language,
      model = 'scribe_v1',
      diarize = true,
      timestamps = true
    } = options;

    console.log(`[ElevenLabs] Transcribing: ${input}`);
    console.log(`[ElevenLabs] Model: ${model}`);
    console.log(`[ElevenLabs] Diarization: ${diarize}`);

    // Read the file
    const file = Bun.file(input);
    const fileBuffer = await file.arrayBuffer();

    // Create form data
    const formData = new FormData();
    formData.append('audio', new Blob([fileBuffer]), input.split('/').pop());
    formData.append('model_id', model);

    if (language) {
      formData.append('language_code', language);
    }

    if (diarize) {
      formData.append('diarize', 'true');
      formData.append('num_speakers', '32'); // Max supported speakers
    }

    if (timestamps) {
      formData.append('timestamps_granularity', 'word');
    }

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs transcription failed: ${error}`);
    }

    const data = await response.json() as ElevenLabsResponse;
    console.log(`[ElevenLabs] Transcription complete`);

    return this.formatResult(data, model);
  }

  private formatResult(data: ElevenLabsResponse, model: string): TranscriptionResult {
    const segments: TranscriptionSegment[] = [];

    if (data.words) {
      let currentSegment: TranscriptionSegment | null = null;
      let segmentId = 0;

      for (const word of data.words) {
        if (!currentSegment || word.speaker !== currentSegment.speaker) {
          if (currentSegment) {
            segments.push(currentSegment);
          }
          currentSegment = {
            id: segmentId++,
            start: word.start,
            end: word.end,
            text: word.word,
            speaker: word.speaker
          };
        } else {
          currentSegment.end = word.end;
          currentSegment.text += ' ' + word.word;
        }
      }

      if (currentSegment) {
        segments.push(currentSegment);
      }
    }

    const speakers = data.speakers?.map(s => ({
      id: s.speaker_id,
      name: s.name,
      segments: segments
        .filter(seg => seg.speaker === s.speaker_id)
        .map(seg => seg.id)
    }));

    return {
      text: data.text,
      segments: segments.length > 0 ? segments : undefined,
      speakers,
      model,
      provider: 'elevenlabs'
    };
  }
}
