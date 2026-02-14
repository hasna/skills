import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

let openai: OpenAI | null = null;

/**
 * Get or create OpenAI client
 */
function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAI();

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Estimate token count for a text (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Progress callback for embedding generation
 */
export type EmbeddingProgressCallback = (processed: number, total: number) => void;

/**
 * Generate embeddings for multiple texts in batch
 * Respects both input count limit (2048) and token limit (300k)
 */
export async function generateEmbeddings(
  texts: string[],
  onProgress?: EmbeddingProgressCallback
): Promise<number[][]> {
  const client = getOpenAI();

  // OpenAI limits
  const maxInputsPerRequest = 2048;
  const maxTokensPerRequest = 250000; // Use 250k to be safe (limit is 300k)

  const embeddings: number[][] = [];
  let currentBatch: string[] = [];
  let currentTokenCount = 0;
  let processedCount = 0;

  for (const text of texts) {
    const textTokens = estimateTokens(text);

    // Check if adding this text would exceed limits
    const wouldExceedInputs = currentBatch.length >= maxInputsPerRequest;
    const wouldExceedTokens = currentTokenCount + textTokens > maxTokensPerRequest;

    if (wouldExceedInputs || wouldExceedTokens) {
      // Process current batch
      if (currentBatch.length > 0) {
        const batchEmbeddings = await processBatch(client, currentBatch);
        embeddings.push(...batchEmbeddings);
        processedCount += currentBatch.length;
        onProgress?.(processedCount, texts.length);
      }

      // Reset batch
      currentBatch = [];
      currentTokenCount = 0;
    }

    currentBatch.push(text);
    currentTokenCount += textTokens;
  }

  // Process remaining batch
  if (currentBatch.length > 0) {
    const batchEmbeddings = await processBatch(client, currentBatch);
    embeddings.push(...batchEmbeddings);
    processedCount += currentBatch.length;
    onProgress?.(processedCount, texts.length);
  }

  return embeddings;
}

/**
 * Process a single batch of texts
 */
async function processBatch(client: OpenAI, batch: string[]): Promise<number[][]> {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: batch,
  });

  // Sort by index to ensure correct order
  const sorted = response.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
