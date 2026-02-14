/**
 * Types for web crawling service
 */

export interface ScrapeOptions {
  formats?: ("markdown" | "html" | "links")[];
  onlyMainContent?: boolean;
  waitFor?: number;
}

export interface CrawlOptions {
  maxDepth?: number;
  limit?: number;
  excludePaths?: string[];
  includePaths?: string[];
}

export interface ScrapeResult {
  url: string;
  markdown?: string;
  html?: string;
  links?: string[];
  metadata?: {
    title?: string;
    description?: string;
  };
}

export interface CrawlResult {
  url: string;
  pages: ScrapeResult[];
  totalPages: number;
}

export interface Session {
  id: string;
  url: string;
  createdAt: string;
  pages: number;
}

export interface Config {
  outputDir: string;
  firecrawlApiKey?: string;
}
