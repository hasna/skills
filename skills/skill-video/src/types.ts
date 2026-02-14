export type Provider = 'google' | 'openai' | 'runway';

export interface GenerateOptions {
  provider: Provider;
  prompt: string;
  output?: string;
  duration?: number; // seconds
  resolution?: '720p' | '1080p' | '4k';
  aspectRatio?: '16:9' | '9:16' | '1:1';
}

export interface StatusOptions {
  provider: Provider;
  jobId: string;
}

export interface VideoJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  videoUrl?: string;
  error?: string;
  metadata?: {
    duration?: number;
    resolution?: string;
    size?: number;
  };
}

export interface VideoProvider {
  name: string;
  generate(options: GenerateOptions): Promise<VideoJob>;
  getStatus(jobId: string): Promise<VideoJob>;
  download(videoUrl: string, outputPath: string): Promise<void>;
}
