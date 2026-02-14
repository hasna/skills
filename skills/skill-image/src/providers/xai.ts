import type { ImageProvider, XAIImageResponse } from '../types';

export class XAIProvider implements ImageProvider {
  private apiKey: string;
  private baseUrl = 'https://api.x.ai/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.XAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('XAI_API_KEY environment variable is required');
    }
  }

  async generate(
    prompt: string,
    options?: {
      model?: string;
      size?: string;
    }
  ): Promise<Buffer> {
    const model = options?.model || 'grok-2-image-1212';

    console.log(`Generating image with xAI ${model}...`);
    console.log(`Prompt: ${prompt}`);

    // xAI Grok-2 Image API endpoint (following OpenAI-compatible format)
    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        ...(options?.size && { size: options.size }),
        response_format: 'url',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`xAI API error: ${response.status} - ${error}`);
    }

    const data: XAIImageResponse = await response.json();

    if (!data.data || data.data.length === 0) {
      throw new Error('No image data returned from xAI API');
    }

    console.log('Image generated successfully!');

    // Handle both URL and base64 responses
    if (data.data[0].url) {
      const imageUrl = data.data[0].url;
      console.log('Downloading image...');

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download image: ${imageResponse.status}`);
      }

      const arrayBuffer = await imageResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else if (data.data[0].b64_json) {
      return Buffer.from(data.data[0].b64_json, 'base64');
    } else {
      throw new Error('No image URL or base64 data in response');
    }
  }
}
