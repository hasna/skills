import type { ImageProvider } from '../types';

export class MinimaxProvider implements ImageProvider {
  private apiKey: string;
  private baseUrl = 'https://api.minimax.chat/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.MINIMAX_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('MINIMAX_API_KEY environment variable is required');
    }
  }

  async generate(
    prompt: string,
    options?: { model?: string; size?: string }
  ): Promise<Buffer> {
    const aspectRatio = this.sizeToAspectRatio(options?.size);

    console.log(`Generating image with Minimax image-01...`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Aspect ratio: ${aspectRatio}`);

    const response = await fetch(`${this.baseUrl}/image_generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || 'image-01',
        prompt,
        aspect_ratio: aspectRatio,
        n: 1,
        prompt_optimizer: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Minimax API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as { task_id: string };

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const statusRes = await fetch(
        `${this.baseUrl}/query/image_generation?task_id=${data.task_id}`,
        { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
      );
      const status = await statusRes.json() as {
        status: string;
        file_id?: string;
        base_resp?: { status_msg: string };
      };

      if (status.status === 'Success' && status.file_id) {
        const fileRes = await fetch(
          `${this.baseUrl}/files/retrieve?file_id=${status.file_id}`,
          { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
        );
        const fileData = await fileRes.json() as { file: { download_url: string } };

        console.log('Image generated. Downloading...');
        const imgRes = await fetch(fileData.file.download_url);
        if (!imgRes.ok) throw new Error(`Download failed: ${imgRes.status}`);
        return Buffer.from(await imgRes.arrayBuffer());
      }

      if (status.status === 'Fail') {
        throw new Error(`Image generation failed: ${status.base_resp?.status_msg || 'Unknown'}`);
      }
    }

    throw new Error('Image generation timed out');
  }

  private sizeToAspectRatio(size?: string): string {
    if (!size) return '1:1';
    const map: Record<string, string> = {
      '1024x1024': '1:1',
      '1792x1024': '16:9',
      '1024x1792': '9:16',
      '1:1': '1:1',
      '16:9': '16:9',
      '9:16': '9:16',
      '4:3': '4:3',
      '3:4': '3:4',
    };
    return map[size] || '1:1';
  }
}
