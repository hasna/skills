export type DepthLevel = "quick" | "normal" | "deep";
export type ModelProvider = "claude" | "openai";

export interface ResearchConfig {
  topic: string;
  depth: DepthLevel;
  model: ModelProvider;
  output?: string;
  json?: boolean;
  firecrawl?: boolean;
}

export interface DepthSettings {
  queryCount: number;
  iterations: number;
  resultsPerQuery: number;
}

export const DEPTH_CONFIG: Record<DepthLevel, DepthSettings> = {
  quick: { queryCount: 6, iterations: 1, resultsPerQuery: 3 },
  normal: { queryCount: 15, iterations: 1, resultsPerQuery: 5 },
  deep: { queryCount: 30, iterations: 2, resultsPerQuery: 5 },
};

export interface ExaSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  autopromptString?: string;
}

export interface Source {
  id: number;
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
  author?: string;
  relevanceScore?: number;
}

export interface ResearchReport {
  topic: string;
  depth: DepthLevel;
  generatedAt: string;
  queryCount: number;
  sourceCount: number;
  report: string;
  sources: Source[];
}

export interface QueryGenerationResult {
  queries: string[];
  reasoning?: string;
}

export interface SynthesisResult {
  report: string;
  summary?: string;
}

export interface FirecrawlResult {
  url: string;
  markdown: string;
  success: boolean;
  error?: string;
}
