import type { ImageProvider } from '../types';

interface GeminiImageResponse {
  predictions?: Array<{
    bytesBase64Encoded: string;
  }>;
}

export class GeminiProvider implements ImageProvider {
  private apiKey: string;
  private projectId: string;
  private location = 'us-central1';

  constructor(apiKey?: string, projectId?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.projectId = projectId || process.env.GOOGLE_PROJECT_ID || '';

    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    if (!this.projectId) {
      throw new Error('GOOGLE_PROJECT_ID environment variable is required for image generation');
    }
  }

  async generate(prompt: string): Promise<Buffer> {
    const model = 'imagen-3.0-generate-001';
    const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:predict`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as GeminiImageResponse;

    if (!data.predictions || data.predictions.length === 0 || !data.predictions[0].bytesBase64Encoded) {
      throw new Error('No image data returned from Gemini API');
    }

    return Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
  }
}
