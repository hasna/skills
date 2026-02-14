import type { VideoProvider, GenerateOptions, VideoJob } from '../types';
import { writeFile } from 'fs/promises';

export class RunwayProvider implements VideoProvider {
  name = 'Runway';
  private apiKey: string;
  private baseUrl = 'https://api.runwayml.com/v1';

  constructor() {
    const apiKey = process.env.RUNWAY_API_KEY;
    if (!apiKey) {
      throw new Error('RUNWAY_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async generate(options: GenerateOptions): Promise<VideoJob> {
    console.log(`[${this.name}] Starting video generation...`);
    console.log(`Prompt: "${options.prompt}"`);

    try {
      // Create generation request
      const response = await fetch(`${this.baseUrl}/text_to_video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify({
          model: 'gen3a_turbo',
          prompt_text: options.prompt,
          duration: options.duration || 5,
          ratio: this.mapAspectRatio(options.aspectRatio),
          watermark: false,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API request failed: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        id: string;
        status: string;
      };

      const job: VideoJob = {
        jobId: data.id,
        status: 'processing',
        progress: 0,
      };

      console.log(`[${this.name}] Video generation initiated. Job ID: ${job.jobId}`);
      console.log(`Use "status" command to check progress.`);

      return job;

    } catch (error) {
      console.error(`[${this.name}] Error:`, error);
      throw new Error(`Failed to generate video: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getStatus(jobId: string): Promise<VideoJob> {
    console.log(`[${this.name}] Checking status for job ${jobId}...`);

    try {
      const response = await fetch(`${this.baseUrl}/tasks/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Runway-Version': '2024-11-06',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API request failed: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        id: string;
        status: string;
        progress?: number;
        output?: string[];
        failure?: string;
        failure_code?: string;
      };

      const job: VideoJob = {
        jobId: data.id,
        status: this.mapStatus(data.status),
        progress: data.progress ? Math.round(data.progress * 100) : undefined,
        videoUrl: data.output?.[0],
        error: data.failure || data.failure_code,
      };

      // Display progress
      if (job.progress !== undefined) {
        console.log(`Progress: ${job.progress}%`);
      }
      console.log(`Status: ${job.status}`);

      if (job.status === 'completed' && job.videoUrl) {
        console.log(`Video ready! URL: ${job.videoUrl}`);
      }

      return job;

    } catch (error) {
      throw new Error(`Failed to get status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async download(videoUrl: string, outputPath: string): Promise<void> {
    console.log(`[${this.name}] Downloading video to ${outputPath}...`);

    try {
      const response = await fetch(videoUrl);

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await writeFile(outputPath, buffer);

      const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
      console.log(`[${this.name}] Video downloaded successfully! (${sizeMB} MB)`);
    } catch (error) {
      throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private mapStatus(status: string): VideoJob['status'] {
    const statusMap: Record<string, VideoJob['status']> = {
      'PENDING': 'pending',
      'RUNNING': 'processing',
      'SUCCEEDED': 'completed',
      'FAILED': 'failed',
      'CANCELLED': 'failed',
    };

    return statusMap[status.toUpperCase()] || 'pending';
  }

  private mapAspectRatio(ratio?: string): string {
    const ratioMap: Record<string, string> = {
      '16:9': '1280:768',
      '9:16': '768:1280',
      '1:1': '1024:1024',
    };

    return ratioMap[ratio || '16:9'] || '1280:768';
  }
}
