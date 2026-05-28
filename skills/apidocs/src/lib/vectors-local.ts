/**
 * Local file-based vector store for testing without AWS S3 Vectors
 */

import { readFile, writeFile, rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { VectorData, SearchResult, IndexInfo, VectorMetadata } from '../types/index.js';
import { SERVICE_DIR } from '../utils/paths.js';
import { cosineSimilarity } from './embeddings.js';

const VECTORS_DIR = join(SERVICE_DIR, 'vectors');

interface StoredVector {
  key: string;
  embedding: number[];
  metadata: VectorMetadata;
}

interface IndexData {
  name: string;
  vectors: StoredVector[];
  createdAt: string;
}

/**
 * Get index file path
 */
function getIndexPath(indexName: string): string {
  return join(VECTORS_DIR, `${indexName}.json`);
}

/**
 * Ensure vectors directory exists
 */
async function ensureVectorsDir(): Promise<void> {
  if (!existsSync(VECTORS_DIR)) {
    await mkdir(VECTORS_DIR, { recursive: true });
  }
}

/**
 * Load index data
 */
async function loadIndex(indexName: string): Promise<IndexData | null> {
  const path = getIndexPath(indexName);
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save index data
 */
async function saveIndex(data: IndexData): Promise<void> {
  await ensureVectorsDir();
  const path = getIndexPath(data.name);
  await writeFile(path, JSON.stringify(data));
}

/**
 * Create a vector index
 */
export async function createIndex(indexName: string): Promise<void> {
  await ensureVectorsDir();

  const existing = await loadIndex(indexName);
  if (existing) {
    // Index already exists
    return;
  }

  const data: IndexData = {
    name: indexName,
    vectors: [],
    createdAt: new Date().toISOString(),
  };

  await saveIndex(data);
}

/**
 * Delete a vector index
 */
export async function deleteIndex(indexName: string): Promise<void> {
  const path = getIndexPath(indexName);
  if (existsSync(path)) {
    await rm(path);
  }
}

/**
 * Get index info
 */
export async function getIndex(indexName: string): Promise<IndexInfo | null> {
  const data = await loadIndex(indexName);
  if (!data) return null;

  return {
    name: data.name,
    vectorCount: data.vectors.length,
    createdAt: data.createdAt,
  };
}

/**
 * List all indexes
 */
export async function listIndexes(): Promise<IndexInfo[]> {
  await ensureVectorsDir();

  const { readdir } = await import('fs/promises');
  const files = await readdir(VECTORS_DIR);

  const indexes: IndexInfo[] = [];
  for (const file of files) {
    if (file.endsWith('.json')) {
      const indexName = file.replace('.json', '');
      const info = await getIndex(indexName);
      if (info) {
        indexes.push(info);
      }
    }
  }

  return indexes;
}

/**
 * Upsert vectors into an index
 */
export async function upsertVectors(indexName: string, vectors: VectorData[]): Promise<void> {
  let data = await loadIndex(indexName);

  if (!data) {
    data = {
      name: indexName,
      vectors: [],
      createdAt: new Date().toISOString(),
    };
  }

  // Create a map of existing vectors by key
  const existingMap = new Map<string, number>();
  data.vectors.forEach((v, i) => existingMap.set(v.key, i));

  // Upsert vectors
  for (const v of vectors) {
    const stored: StoredVector = {
      key: v.key,
      embedding: v.data.float32,
      metadata: v.metadata,
    };

    const existingIdx = existingMap.get(v.key);
    if (existingIdx !== undefined) {
      data.vectors[existingIdx] = stored;
    } else {
      data.vectors.push(stored);
    }
  }

  await saveIndex(data);
}

/**
 * Query vectors for similarity search
 */
export async function queryVectors(
  indexName: string,
  queryVector: number[],
  topK: number = 10
): Promise<SearchResult[]> {
  const data = await loadIndex(indexName);
  if (!data || data.vectors.length === 0) {
    return [];
  }

  // Calculate similarity for all vectors
  const scored = data.vectors.map((v) => ({
    key: v.key,
    score: cosineSimilarity(queryVector, v.embedding),
    metadata: v.metadata,
  }));

  // Sort by score descending and take top K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Delete vectors by keys
 */
export async function deleteVectors(indexName: string, keys: string[]): Promise<void> {
  const data = await loadIndex(indexName);
  if (!data) return;

  const keySet = new Set(keys);
  data.vectors = data.vectors.filter((v) => !keySet.has(v.key));

  await saveIndex(data);
}

/**
 * Check if an index exists
 */
export async function indexExists(indexName: string): Promise<boolean> {
  const info = await getIndex(indexName);
  return info !== null;
}

/**
 * Get vector store type
 */
export function getStoreType(): string {
  return 'local';
}
