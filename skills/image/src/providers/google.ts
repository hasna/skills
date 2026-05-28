import type { ImageProvider, GoogleImagenResponse } from '../types';

export class GoogleProvider implements ImageProvider {
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
      throw new Error('GOOGLE_PROJECT_ID environment variable is required');
    }
  }

  async generate(
    prompt: string,
    options?: {
      model?: string;
      size?: string;
    }
  ): Promise<Buffer> {
    // Gemini 3.0 (Nano Banana) - Google's latest image generation model
    const model = options?.model || 'gemini-3.0-generate-001';

    console.log(`Generating image with Google Gemini 3.0 (${model})...`);
    console.log(`Prompt: ${prompt}`);

    // Construct the Vertex AI endpoint
    const endpoint = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${model}:predict`;

    const requestBody = {
      instances: [
        {
          prompt,
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: '1:1', // Options: 1:1, 3:4, 4:3, 9:16, 16:9
        ...(options?.size && { aspectRatio: options.size }),
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Imagen API error: ${response.status} - ${error}`);
    }

    const data: GoogleImagenResponse = await response.json();

    if (
      !data.predictions ||
      data.predictions.length === 0 ||
      !data.predictions[0].bytesBase64Encoded
    ) {
      throw new Error('No image data returned from Google Imagen API');
    }

    console.log('Image generated successfully!');

    // Decode base64 image
    const base64Image = data.predictions[0].bytesBase64Encoded;
    return Buffer.from(base64Image, 'base64');
  }
}
