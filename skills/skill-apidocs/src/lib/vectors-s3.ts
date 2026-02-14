/**
 * AWS S3 Vectors implementation
 */

import {
  S3VectorsClient,
  CreateIndexCommand,
  DeleteIndexCommand,
  ListIndexesCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
} from '@aws-sdk/client-s3vectors';
import type { VectorData, SearchResult, IndexInfo, VectorMetadata } from '../types/index.js';
import { EMBEDDING_DIMENSIONS } from './embeddings.js';

const BUCKET_NAME = process.env.S3_VECTORS_BUCKET || 'service-apidocs-vectors';

let client: S3VectorsClient | null = null;

/**
 * Get or create S3 Vectors client
 */
function getClient(): S3VectorsClient {
  if (!client) {
    client = new S3VectorsClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return client;
}

/**
 * Create a vector index
 */
export async function createIndex(indexName: string): Promise<void> {
  const s3vectors = getClient();

  try {
    await s3vectors.send(
      new CreateIndexCommand({
        vectorBucketName: BUCKET_NAME,
        indexName,
        dimension: EMBEDDING_DIMENSIONS,
        distanceMetric: 'cosine',
        dataType: 'float32',
      })
    );
  } catch (error: unknown) {
    // Index might already exist
    const err = error as { name?: string };
    if (err?.name === 'ConflictException' || err?.name === 'ResourceAlreadyExistsException') {
      // Index already exists, that's fine
      return;
    }
    throw error;
  }
}

/**
 * Delete a vector index
 */
export async function deleteIndex(indexName: string): Promise<void> {
  const s3vectors = getClient();

  await s3vectors.send(
    new DeleteIndexCommand({
      vectorBucketName: BUCKET_NAME,
      indexName,
    })
  );
}

/**
 * Get index info
 */
export async function getIndex(indexName: string): Promise<IndexInfo | null> {
  const s3vectors = getClient();

  try {
    const response = await s3vectors.send(
      new GetIndexCommand({
        vectorBucketName: BUCKET_NAME,
        indexName,
      })
    );

    // Access properties that exist on the response
    const idx = response as unknown as Record<string, unknown>;
    return {
      name: (idx.indexName as string) || indexName,
      vectorCount: (idx.vectorCount as number) || 0,
      createdAt: idx.creationTime ? (idx.creationTime as Date).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * List all indexes
 */
export async function listIndexes(): Promise<IndexInfo[]> {
  const s3vectors = getClient();

  const response = await s3vectors.send(
    new ListIndexesCommand({
      vectorBucketName: BUCKET_NAME,
    })
  );

  return (response.indexes || []).map((idx) => {
    const index = idx as unknown as Record<string, unknown>;
    return {
      name: (index.indexName as string) || '',
      vectorCount: (index.vectorCount as number) || 0,
      createdAt: index.creationTime ? (index.creationTime as Date).toISOString() : undefined,
    };
  });
}

/**
 * Upsert vectors into an index
 */
export async function upsertVectors(indexName: string, vectors: VectorData[]): Promise<void> {
  const s3vectors = getClient();

  // S3 Vectors has a limit on batch size, process in batches
  const batchSize = 100;

  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);

    await s3vectors.send(
      new PutVectorsCommand({
        vectorBucketName: BUCKET_NAME,
        indexName,
        vectors: batch.map((v) => ({
          key: v.key,
          data: {
            float32: v.data.float32,
          },
          metadata: metadataToDocument(v.metadata),
        })),
      })
    );
  }
}

/**
 * Convert metadata to S3 Vectors document format
 * Note: S3 Vectors has a 2048 byte TOTAL limit for filterable metadata
 */
function metadataToDocument(metadata: VectorMetadata): Record<string, string | number | boolean> {
  // S3 Vectors limit is 2048 bytes total for ALL fields combined
  // Use very conservative limits to avoid edge cases with multi-byte chars
  const maxContentLength = 800;
  const truncatedContent = metadata.content.length > maxContentLength
    ? metadata.content.substring(0, maxContentLength) + '...'
    : metadata.content;

  return {
    libraryId: metadata.libraryId.substring(0, 40),
    version: metadata.version.substring(0, 20),
    filePath: metadata.filePath.substring(0, 100),
    chunkIndex: metadata.chunkIndex,
    title: metadata.title.substring(0, 80),
    type: metadata.type,
    content: truncatedContent,
  };
}

/**
 * Convert S3 Vectors document to metadata
 */
function documentToMetadata(doc: unknown): VectorMetadata {
  const d = doc as Record<string, unknown>;
  return {
    libraryId: String(d.libraryId || ''),
    version: String(d.version || ''),
    filePath: String(d.filePath || ''),
    chunkIndex: Number(d.chunkIndex || 0),
    title: String(d.title || ''),
    type: (d.type as 'code' | 'text') || 'text',
    content: String(d.content || ''),
  };
}

/**
 * Query vectors for similarity search
 */
export async function queryVectors(
  indexName: string,
  queryVector: number[],
  topK: number = 10
): Promise<SearchResult[]> {
  const s3vectors = getClient();

  const response = await s3vectors.send(
    new QueryVectorsCommand({
      vectorBucketName: BUCKET_NAME,
      indexName,
      queryVector: {
        float32: queryVector,
      },
      topK,
      returnMetadata: true,
      returnDistance: true,
    })
  );

  return (response.vectors || []).map((v) => ({
    key: v.key || '',
    score: v.distance !== undefined ? 1 - v.distance : 0, // Convert distance to similarity
    metadata: documentToMetadata(v.metadata),
  }));
}

/**
 * Delete vectors by keys
 */
export async function deleteVectors(indexName: string, keys: string[]): Promise<void> {
  const s3vectors = getClient();

  // Process in batches
  const batchSize = 100;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);

    await s3vectors.send(
      new DeleteVectorsCommand({
        vectorBucketName: BUCKET_NAME,
        indexName,
        keys: batch,
      })
    );
  }
}

/**
 * Check if an index exists
 */
export async function indexExists(indexName: string): Promise<boolean> {
  const info = await getIndex(indexName);
  return info !== null;
}

/**
 * Get vector bucket name
 */
export function getBucketName(): string {
  return BUCKET_NAME;
}
