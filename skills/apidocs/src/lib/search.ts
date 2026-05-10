import type { SearchResult, QueryResult, VectorMetadata } from '../types/index.js';
import { generateEmbedding } from './embeddings.js';
import { queryVectors } from './vectors.js';

const DEFAULT_TOP_K = 10;
const DEFAULT_MAX_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;

/**
 * Perform semantic search on an index
 */
export async function semanticSearch(
  indexName: string,
  query: string,
  options: {
    topK?: number;
    maxTokens?: number;
  } = {}
): Promise<QueryResult> {
  const { topK = DEFAULT_TOP_K, maxTokens = DEFAULT_MAX_TOKENS } = options;

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);

  // Query vectors
  const results = await queryVectors(indexName, queryEmbedding, topK * 2); // Get more to filter

  // Deduplicate and rank results
  const uniqueChunks = deduplicateResults(results);

  // Build response within token limit
  const { content, sources, chunks } = buildResponse(uniqueChunks, maxTokens);

  return { content, sources, chunks };
}

/**
 * Deduplicate results by content similarity
 */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const unique: SearchResult[] = [];

  for (const result of results) {
    const contentKey = result.metadata.content?.substring(0, 100);
    if (!seen.has(contentKey)) {
      seen.add(contentKey);
      unique.push(result);
    }
  }

  return unique;
}

/**
 * Build formatted response from search results
 */
function buildResponse(
  results: SearchResult[],
  maxTokens: number
): { content: string; sources: string[]; chunks: SearchResult[] } {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const sources = new Set<string>();
  const includedChunks: SearchResult[] = [];

  let content = '';
  let totalChars = 0;

  // Group results by file for better organization
  const byFile = new Map<string, SearchResult[]>();
  for (const result of results) {
    const file = result.metadata.filePath;
    if (!byFile.has(file)) {
      byFile.set(file, []);
    }
    byFile.get(file)!.push(result);
  }

  // Build content from grouped results
  for (const [file, chunks] of byFile) {
    // Sort chunks by score within each file
    chunks.sort((a, b) => b.score - a.score);

    for (const chunk of chunks) {
      const chunkContent = formatChunk(chunk);
      const chunkChars = chunkContent.length;

      if (totalChars + chunkChars > maxChars) {
        // Check if we have at least some content
        if (includedChunks.length > 0) {
          break;
        }
        // Truncate if this is the first chunk
        const truncated = chunkContent.substring(0, maxChars - totalChars - 50);
        content += truncated + '\n\n...(truncated)';
        sources.add(file);
        includedChunks.push(chunk);
        break;
      }

      content += chunkContent + '\n\n';
      totalChars += chunkChars;
      sources.add(file);
      includedChunks.push(chunk);
    }

    if (totalChars >= maxChars) break;
  }

  // Add sources section
  const sourcesList = Array.from(sources);
  if (sourcesList.length > 0) {
    content += '---\nSources:\n';
    for (const source of sourcesList) {
      content += `- ${source}\n`;
    }
  }

  return {
    content: content.trim(),
    sources: sourcesList,
    chunks: includedChunks,
  };
}

/**
 * Format a single chunk for display
 */
function formatChunk(result: SearchResult): string {
  const { metadata } = result;
  let formatted = '';

  // Add title if available
  if (metadata.title) {
    const headingLevel = metadata.type === 'code' ? '###' : '##';
    formatted += `${headingLevel} ${metadata.title}\n\n`;
  }

  // Add content
  formatted += metadata.content;

  return formatted;
}

/**
 * Search and format results as JSON
 */
export async function searchAsJson(
  indexName: string,
  query: string,
  options: {
    topK?: number;
    maxTokens?: number;
  } = {}
): Promise<{
  query: string;
  results: Array<{
    title: string;
    content: string;
    filePath: string;
    type: string;
    score: number;
  }>;
  totalResults: number;
}> {
  const { topK = DEFAULT_TOP_K, maxTokens = DEFAULT_MAX_TOKENS } = options;

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);

  // Query vectors
  const results = await queryVectors(indexName, queryEmbedding, topK);

  // Deduplicate
  const unique = deduplicateResults(results);

  // Format as JSON
  return {
    query,
    results: unique.slice(0, topK).map((r) => ({
      title: r.metadata.title,
      content: r.metadata.content,
      filePath: r.metadata.filePath,
      type: r.metadata.type,
      score: r.score,
    })),
    totalResults: unique.length,
  };
}
