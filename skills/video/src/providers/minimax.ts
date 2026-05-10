import type { VideoProvider, GenerateOptions, VideoJob } from '../types';
import { writeFile } from 'fs/promises';

export class MinimaxProvider implements VideoProvider {
  name = 'Minimax Video-01';
  private apiKey: string;
  private baseUrl = 'https://api.minimax.chat/v1';

  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('MINIMAX_API_KEY environment variable is required');
    }
  }

  async generate(options: GenerateOptions): Promise<VideoJob> {
    console.log(`[${this.name}] Starting video generation...`);
    console.log(`Prompt: "${options.prompt}"`);

    const body: Record<string, unknown> = {
      model: 'T2V-01',
      prompt: options.prompt,
      prompt_optimizer: true,
    };

    const response = await fetch(`${this.baseUrl}/video_generation`, {
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

    const data = await response.json() as { task_id: string };

    return {
      jobId: data.task_id,
      status: 'processing',
      progress: 0,
    };
  }

  async getStatus(jobId: string): Promise<VideoJob> {
    const response = await fetch(
      `${this.baseUrl}/query/video_generation?task_id=${jobId}`,
      { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
    );

    const data = await response.json() as {
      task_id: string;
      status: string;
      file_id?: string;
      base_resp?: { status_msg: string };
    };

    if (data.status === 'Success' && data.file_id) {
      const fileRes = await fetch(
        `${this.baseUrl}/files/retrieve?file_id=${data.file_id}`,
        { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
      );
      const fileData = await fileRes.json() as { file: { download_url: string } };

      return {
        jobId,
        status: 'completed',
        progress: 100,
        videoUrl: fileData.file.download_url,
      };
    }

    if (data.status === 'Fail') {
      return {
        jobId,
        status: 'failed',
        error: data.base_resp?.status_msg || 'Unknown error',
      };
    }

    return {
      jobId,
      status: 'processing',
      progress: data.status === 'Processing' ? 50 : 10,
    };
  }

  async download(videoUrl: string, outputPath: string): Promise<void> {
    console.log(`[${this.name}] Downloading video to ${outputPath}...`);
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, buffer);
    console.log(`[${this.name}] Video downloaded.`);
  }
}
