import type { Chunk, VectorData, DocFile } from '../types/index.js';
import * as output from '../utils/output.js';
import {
  findLibrary,
  listLibraries,
  initStorage,
  saveLibraryMetadata,
  cacheChunks,
  saveCrawledPages,
  saveEndpoints,
} from '../lib/storage.js';
import { crawlSimple } from '../lib/crawler.js';
import { parseMarkdown } from '../lib/parser.js';
import { generateEmbeddings } from '../lib/embeddings.js';
import { deleteIndex, createIndex, upsertVectors, indexExists } from '../lib/vectors.js';
import { createIndexNameFromUrl } from '../utils/paths.js';
import { extractEndpoints } from '../lib/endpoint-extractor.js';

interface SyncOptions {
  all?: boolean;
  maxPages?: number;
}

/**
 * Sync a library's documentation
 */
export async function sync(library: string | undefined, options: SyncOptions): Promise<void> {
  await initStorage();

  if (options.all) {
    // Sync all libraries
    const libraries = await listLibraries();

    if (libraries.length === 0) {
      output.info('No libraries to sync');
      return;
    }

    output.info(`Syncing ${libraries.length} libraries...`);
    console.log();

    for (const lib of libraries) {
      try {
        await syncLibrary(lib.id, options.maxPages);
        console.log();
      } catch (error) {
        output.error(`Failed to sync ${lib.name}: ${(error as Error).message}`);
        console.log();
      }
    }

    output.success('Sync complete');
    return;
  }

  if (!library) {
    output.error('Please specify a library or use --all');
    process.exit(1);
  }

  // Find the library
  const metadata = await findLibrary(library);

  if (!metadata) {
    output.error(`Library not found: ${library}`);
    output.info('Use `service-apidocs list` to see indexed libraries');
    process.exit(1);
  }

  await syncLibrary(metadata.id, options.maxPages);
}

/**
 * Sync a single library by ID
 */
async function syncLibrary(libraryId: string, maxPages?: number): Promise<void> {
  const metadata = await findLibrary(libraryId);
  if (!metadata) {
    throw new Error(`Library not found: ${libraryId}`);
  }

  output.info(`Syncing: ${metadata.name}`);
  output.info(`URL: ${metadata.websiteUrl}`);

  const crawlMaxPages = maxPages || metadata.pageCount * 2 || 500;

  // Re-crawl the website
  output.step('Re-crawling documentation...');
  console.log();

  const crawlResult = await crawlSimple(
    {
      startUrl: metadata.websiteUrl,
      maxPages: crawlMaxPages,
    },
    (event) => {
      switch (event.type) {
        case 'navigating':
          output.step(`Navigating: ${event.url}`);
          break;
        case 'extracted':
          output.success(`[${event.pageCount}/${event.totalPages}] ${event.title || event.url}`);
          break;
        case 'error':
          output.warn(`Error: ${event.error}`);
          break;
        case 'complete':
          console.log();
          output.success(`Crawl complete: ${event.pageCount} pages`);
          break;
      }
    }
  );

  if (crawlResult.pages.length === 0) {
    output.warn('No documentation pages found during sync');
    return;
  }

  // Save crawled pages
  await saveCrawledPages(libraryId, crawlResult.pages);

  // Convert crawled pages to DocFiles for parsing
  const files: DocFile[] = crawlResult.pages.map((page) => ({
    path: page.path || new URL(page.url).pathname,
    content: page.content,
  }));

  // Parse and chunk files
  output.step('Parsing and chunking documentation...');
  const allChunks: Chunk[] = [];

  for (const file of files) {
    try {
      const chunks = parseMarkdown(file.content, file.path);
      allChunks.push(...chunks);
    } catch (error) {
      output.warn(`Failed to parse ${file.path}: ${(error as Error).message}`);
    }
  }

  output.success(`Created ${allChunks.length} chunks`);

  if (allChunks.length === 0) {
    output.error('No chunks created from documentation');
    return;
  }

  // Generate embeddings
  output.step('Generating embeddings...');
  const texts = allChunks.map((chunk) => chunk.content);
  const embeddings = await generateEmbeddings(texts, (processed, total) => {
    output.step(`Generating embeddings... ${processed}/${total}`);
  });
  output.success(`Generated ${embeddings.length} embeddings`);

  // Delete old index and recreate
  const indexName = metadata.indexName;
  output.step('Recreating vector index...');
  try {
    if (await indexExists(indexName)) {
      await deleteIndex(indexName);
    }
  } catch {
    // Index might not exist
  }
  await createIndex(indexName);
  output.success('Vector index recreated');

  // Prepare and upsert vectors
  output.step('Uploading vectors...');
  const vectors: VectorData[] = allChunks.map((chunk, i) => ({
    key: chunk.id,
    data: {
      float32: embeddings[i],
    },
    metadata: {
      libraryId,
      version: new Date().toISOString().split('T')[0],
      filePath: chunk.filePath,
      chunkIndex: i,
      title: chunk.title,
      type: chunk.type,
      content: chunk.content,
    },
  }));

  await upsertVectors(indexName, vectors);
  output.success(`Uploaded ${vectors.length} vectors`);

  // Extract API endpoints
  output.step('Extracting API endpoints...');
  let endpointCount = 0;
  try {
    const extractionResult = await extractEndpoints(crawlResult.pages, (event) => {
      if (event.type === 'extracted') {
        output.step(`Processed ${event.pageIndex}/${event.totalPages} pages, found ${event.endpointCount} endpoints`);
      } else if (event.type === 'complete') {
        output.success(`Extraction complete: ${event.endpointCount} endpoints`);
      }
    });

    if (extractionResult.endpoints.length > 0) {
      await saveEndpoints(libraryId, extractionResult.endpoints);
      endpointCount = extractionResult.endpoints.length;
    }
  } catch (error) {
    output.warn(`Endpoint extraction failed: ${(error as Error).message}`);
  }

  // Update metadata
  metadata.indexedAt = new Date().toISOString();
  metadata.chunkCount = allChunks.length;
  metadata.pageCount = crawlResult.pages.length;
  metadata.endpointCount = endpointCount > 0 ? endpointCount : undefined;
  metadata.crawledUrls = crawlResult.pages.map((p) => p.url);

  await saveLibraryMetadata(libraryId, metadata);
  await cacheChunks(libraryId, allChunks);

  output.success(`Synced ${metadata.name} successfully!`);
  output.info(`Pages: ${crawlResult.pages.length}`);
  output.info(`Chunks: ${allChunks.length}`);
  if (endpointCount > 0) {
    output.info(`Endpoints: ${endpointCount}`);
  }
}
