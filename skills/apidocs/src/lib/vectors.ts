/**
 * Vector store abstraction - uses local storage by default, S3 Vectors when configured
 */

import type { VectorData, SearchResult, IndexInfo } from '../types/index.js';

// Check if we should use S3 Vectors
const USE_S3_VECTORS = process.env.USE_S3_VECTORS === 'true';

// Dynamic imports based on configuration
let vectorStore: typeof import('./vectors-s3.js') | typeof import('./vectors-local.js');

async function getStore() {
  if (!vectorStore) {
    if (USE_S3_VECTORS) {
      vectorStore = await import('./vectors-s3.js');
    } else {
      vectorStore = await import('./vectors-local.js');
    }
  }
  return vectorStore;
}

/**
 * Create a vector index
 */
export async function createIndex(indexName: string): Promise<void> {
  const store = await getStore();
  return store.createIndex(indexName);
}

/**
 * Delete a vector index
 */
export async function deleteIndex(indexName: string): Promise<void> {
  const store = await getStore();
  return store.deleteIndex(indexName);
}

/**
 * Get index info
 */
export async function getIndex(indexName: string): Promise<IndexInfo | null> {
  const store = await getStore();
  return store.getIndex(indexName);
}

/**
 * List all indexes
 */
export async function listIndexes(): Promise<IndexInfo[]> {
  const store = await getStore();
  return store.listIndexes();
}

/**
 * Upsert vectors into an index
 */
export async function upsertVectors(indexName: string, vectors: VectorData[]): Promise<void> {
  const store = await getStore();
  return store.upsertVectors(indexName, vectors);
}

/**
 * Query vectors for similarity search
 */
export async function queryVectors(
  indexName: string,
  queryVector: number[],
  topK?: number
): Promise<SearchResult[]> {
  const store = await getStore();
  return store.queryVectors(indexName, queryVector, topK);
}

/**
 * Delete vectors by keys
 */
export async function deleteVectors(indexName: string, keys: string[]): Promise<void> {
  const store = await getStore();
  return store.deleteVectors(indexName, keys);
}

/**
 * Check if an index exists
 */
export async function indexExists(indexName: string): Promise<boolean> {
  const store = await getStore();
  return store.indexExists(indexName);
}

/**
 * Get current store type
 */
export function getStoreType(): string {
  return USE_S3_VECTORS ? 's3-vectors' : 'local';
}
