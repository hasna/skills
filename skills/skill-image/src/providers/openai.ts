import type { ImageProvider, OpenAIImageResponse } from '../types';

export class OpenAIProvider implements ImageProvider {
  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
  }

  async generate(
    prompt: string,
    options?: {
      model?: string;
      size?: string;
    }
  ): Promise<Buffer> {
    const model = options?.model || 'dall-e-3';
    const size = options?.size || '1024x1024';

    // Validate size for DALL-E 3
    const validSizes = ['1024x1024', '1792x1024', '1024x1792'];
    if (!validSizes.includes(size)) {
      throw new Error(
        `Invalid size for DALL-E 3. Valid sizes: ${validSizes.join(', ')}`
      );
    }

    console.log(`Generating image with OpenAI ${model}...`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Size: ${size}`);

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
        size,
        response_format: 'url',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data: OpenAIImageResponse = await response.json();

    if (!data.data || data.data.length === 0 || !data.data[0].url) {
      throw new Error('No image URL returned from OpenAI API');
    }

    const imageUrl = data.data[0].url;
    console.log(`Image generated successfully!`);

    if (data.data[0].revised_prompt) {
      console.log(`Revised prompt: ${data.data[0].revised_prompt}`);
    }

    // Download the image
    console.log('Downloading image...');
    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status}`);
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
