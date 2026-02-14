/**
 * Types for skill-write
 * Article generation with parallel AI agents
 */

export type Provider = 'anthropic' | 'openai';

export interface ArticleRequest {
  topic: string;
  style?: 'blog' | 'technical' | 'news' | 'academic' | 'casual';
  length?: 'short' | 'medium' | 'long';
  includeImage?: boolean;
  imageProvider?: 'openai' | 'google' | 'xai';
  outputDir: string;
  filename?: string;
}

export interface BatchRequest {
  topics: string[];
  style?: 'blog' | 'technical' | 'news' | 'academic' | 'casual';
  length?: 'short' | 'medium' | 'long';
  includeImage?: boolean;
  imageProvider?: 'openai' | 'google' | 'xai';
  outputDir: string;
  parallel?: number; // Max parallel agents
}

export interface ArticleResult {
  topic: string;
  filename: string;
  imagePath?: string;
  wordCount: number;
  success: boolean;
  error?: string;
}

export interface AgentConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface ResearchResult {
  topic: string;
  sources: string[];
  keyPoints: string[];
  summary: string;
}

export interface ArticleContent {
  title: string;
  content: string;
  metadata: {
    topic: string;
    style: string;
    generatedAt: string;
    wordCount: number;
  };
}

export interface ImageGenerationConfig {
  provider: 'openai' | 'google' | 'xai';
  prompt: string;
  outputPath: string;
}
