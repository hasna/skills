import type { VideoProvider, GenerateOptions, VideoJob } from '../types';
import { writeFile } from 'fs/promises';

export class OpenAISoraProvider implements VideoProvider {
  name = 'OpenAI Sora';
  private apiKey: string;
  private baseUrl = 'https://api.openai.com/v1';
  private jobs: Map<string, VideoJob> = new Map();

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
  }

  async generate(options: GenerateOptions): Promise<VideoJob> {
    console.log(`[${this.name}] Starting video generation...`);
    console.log(`Prompt: "${options.prompt}"`);

    try {
      // Generate a unique job ID
      const jobId = `sora_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Note: OpenAI Sora API structure is not publicly documented yet
      // This is a reference implementation based on expected patterns
      const response = await fetch(`${this.baseUrl}/videos/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sora-1.0', // Placeholder model name
          prompt: options.prompt,
          duration: options.duration || 5,
          resolution: options.resolution || '1080p',
          aspect_ratio: options.aspectRatio || '16:9',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API request failed: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        id: string;
        status: string;
        video_url?: string;
      };

      const job: VideoJob = {
        jobId: data.id || jobId,
        status: this.mapStatus(data.status),
        progress: data.status === 'completed' ? 100 : 0,
        videoUrl: data.video_url,
      };

      this.jobs.set(job.jobId, job);

      console.log(`[${this.name}] Video generation initiated. Job ID: ${job.jobId}`);
      console.log(`Note: OpenAI Sora API access may be limited. Check API availability.`);

      return job;

    } catch (error) {
      console.error(`[${this.name}] Error:`, error);

      // If API is not available, provide helpful message
      if (error instanceof Error && error.message.includes('404')) {
        throw new Error('OpenAI Sora API is not yet publicly available. Please check API access or try another provider.');
      }

      throw new Error(`Failed to generate video: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getStatus(jobId: string): Promise<VideoJob> {
    console.log(`[${this.name}] Checking status for job ${jobId}...`);

    try {
      const response = await fetch(`${this.baseUrl}/videos/generations/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
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
        video_url?: string;
        error?: string;
      };

      const job: VideoJob = {
        jobId: data.id,
        status: this.mapStatus(data.status),
        progress: data.progress || (data.status === 'completed' ? 100 : 0),
        videoUrl: data.video_url,
        error: data.error,
      };

      this.jobs.set(jobId, job);

      return job;

    } catch (error) {
      // Return cached job if API fails
      const cachedJob = this.jobs.get(jobId);
      if (cachedJob) {
        return cachedJob;
      }

      throw new Error(`Failed to get status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async download(videoUrl: string, outputPath: string): Promise<void> {
    console.log(`[${this.name}] Downloading video to ${outputPath}...`);

    try {
      const response = await fetch(videoUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await writeFile(outputPath, buffer);

      console.log(`[${this.name}] Video downloaded successfully!`);
    } catch (error) {
      throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private mapStatus(status: string): VideoJob['status'] {
    const statusMap: Record<string, VideoJob['status']> = {
      'pending': 'pending',
      'processing': 'processing',
      'in_progress': 'processing',
      'completed': 'completed',
      'succeeded': 'completed',
      'failed': 'failed',
      'error': 'failed',
    };

    return statusMap[status.toLowerCase()] || 'pending';
  }
}
