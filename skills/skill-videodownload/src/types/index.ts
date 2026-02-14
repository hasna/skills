/**
 * Types for video download service
 */

export interface DownloadOptions {
  output: string;
  format: string;
  quality: string;
  audioOnly: boolean;
  subtitles: boolean;
  thumbnail: boolean;
  metadata: boolean;
}

export interface VideoInfo {
  id: string;
  url: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  formats: VideoFormat[];
  platform: string;
  uploader?: string;
  uploadDate?: string;
  viewCount?: number;
}

export interface VideoFormat {
  formatId: string;
  ext: string;
  quality: string;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
  resolution?: string;
  fps?: number;
}

export interface DownloadResult {
  success: boolean;
  videoId: string;
  title: string;
  filepath?: string;
  format?: string;
  filesize?: number;
  duration?: number;
  error?: string;
}

export interface BulkDownloadResult {
  url: string;
  videosFound: number;
  videosDownloaded: number;
  results: DownloadResult[];
  errors: string[];
}

export interface Config {
  outputDir: string;
  defaultFormat: string;
  defaultQuality: string;
  ytDlpPath: string;
}
