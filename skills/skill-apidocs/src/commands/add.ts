import type { AddOptions, Chunk, VectorData, LibraryMetadata, DocFile } from '../types/index.js';
import { parseWebsiteUrl, createLibraryIdFromUrl, createIndexNameFromUrl } from '../utils/paths.js';
import * as output from '../utils/output.js';
import { crawlDocumentation, crawlSimple } from '../lib/crawler.js';
import { parseMarkdown } from '../lib/parser.js';
import { generateEmbeddings } from '../lib/embeddings.js';
import { createIndex, upsertVectors, indexExists, deleteIndex } from '../lib/vectors.js';
import {
  initStorage,
  saveLibraryMetadata,
  cacheChunks,
  getLibraryMetadata,
  saveCrawledPages,
  saveEndpoints,
} from '../lib/storage.js';
import { discoverDocsUrl, isLikelyDocsUrl } from '../lib/discovery.js';
import { extractEndpoints } from '../lib/endpoint-extractor.js';

/**
 * Add a library from a documentation website
 */
export async function add(websiteUrl: string, options: AddOptions): Promise<void> {
  // Parse website URL
  const parsed = parseWebsiteUrl(websiteUrl);
  if (!parsed) {
    output.error(`Invalid URL: ${websiteUrl}`);
    process.exit(1);
  }

  const libraryId = createLibraryIdFromUrl(websiteUrl, options.name);
  const libraryName = options.name || parsed.domain.replace(/^(www\.|docs\.|api\.|platform\.)/, '');

  output.info(`Adding library: ${libraryName}`);
  output.info(`URL: ${websiteUrl}`);

  // Initialize storage
  await initStorage();

  // Check if already indexed
  const existing = await getLibraryMetadata(libraryId);
  if (existing) {
    output.warn(`Library ${libraryName} is already indexed`);
    output.info('Use `service-apidocs sync` to update the index');
    return;
  }

  // Discover documentation URL if needed
  let docsUrl = websiteUrl;
  if (!isLikelyDocsUrl(websiteUrl)) {
    output.step('Discovering documentation URL...');
    const discovery = await discoverDocsUrl(websiteUrl, (event) => {
      switch (event.type) {
        case 'navigating':
          output.step(`Checking: ${event.url || event.message}`);
          break;
        case 'analyzing':
          output.step(event.message || 'Analyzing page...');
          break;
        case 'found':
          output.success(`Found docs: ${event.docsUrl}`);
          break;
        case 'not_found':
          output.warn(event.message || 'Could not find specific documentation URL');
          break;
        case 'error':
          output.warn(`Discovery error: ${event.error}`);
          break;
      }
    });

    if (discovery.success && discovery.docsUrl) {
      docsUrl = discovery.docsUrl;
    }
    console.log();
  } else {
    output.info('URL appears to be documentation, skipping discovery');
  }

  // Set max pages
  const maxPages = options.maxPages || 500;
  output.info(`Max pages: ${maxPages}`);

  // Crawl documentation
  output.step('Crawling documentation...');
  console.log();

  const crawlResult = await crawlSimple(
    {
      startUrl: docsUrl,
      maxPages,
    },
    (event) => {
      switch (event.type) {
        case 'navigating':
          output.step(`Navigating: ${event.url}`);
          break;
        case 'extracted':
          output.success(`[${event.pageCount}/${event.totalPages}] ${event.title || event.url}`);
          break;
        case 'skipped':
          // Don't log skipped pages to reduce noise
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
    output.error('No documentation pages found');
    output.info('The crawler could not find any documentation content at this URL');
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
  let embeddings: number[][];

  try {
    embeddings = await generateEmbeddings(texts, (processed, total) => {
      output.step(`Generating embeddings... ${processed}/${total}`);
    });
    output.success(`Generated ${embeddings.length} embeddings`);
  } catch (error) {
    output.error(`Failed to generate embeddings: ${(error as Error).message}`);
    output.info('Make sure OPENAI_API_KEY is set');
    process.exit(1);
  }

  // Create vector index
  const indexName = createIndexNameFromUrl(websiteUrl, options.name);
  output.step(`Creating vector index: ${indexName}`);

  try {
    // Delete existing index if it exists
    if (await indexExists(indexName)) {
      await deleteIndex(indexName);
    }
    await createIndex(indexName);
    output.success('Vector index created');
  } catch (error) {
    output.error(`Failed to create index: ${(error as Error).message}`);
    process.exit(1);
  }

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

  try {
    await upsertVectors(indexName, vectors);
    output.success(`Uploaded ${vectors.length} vectors`);
  } catch (error) {
    output.error(`Failed to upload vectors: ${(error as Error).message}`);
    process.exit(1);
  }

  // Extract API endpoints
  output.step('Extracting API endpoints...');
  console.log();

  let endpointCount = 0;
  try {
    const extractionResult = await extractEndpoints(crawlResult.pages, (event) => {
      switch (event.type) {
        case 'processing':
          if (event.pageUrl) {
            output.step(`[${event.pageIndex}/${event.totalPages}] Processing: ${event.pageUrl}`);
          }
          break;
        case 'extracted':
          output.success(`Processed ${event.pageIndex}/${event.totalPages} pages, found ${event.endpointCount} endpoints`);
          break;
        case 'complete':
          console.log();
          output.success(`Extraction complete: ${event.endpointCount} endpoints`);
          break;
        case 'error':
          output.warn(`Extraction error: ${event.error}`);
          break;
      }
    });

    if (extractionResult.endpoints.length > 0) {
      await saveEndpoints(libraryId, extractionResult.endpoints);
      endpointCount = extractionResult.endpoints.length;
    }
  } catch (error) {
    output.warn(`Endpoint extraction failed: ${(error as Error).message}`);
    output.info('Continuing without endpoint data...');
  }

  // Save metadata locally
  output.step('Saving metadata...');
  const metadata: LibraryMetadata = {
    id: libraryId,
    name: libraryName,
    websiteUrl,
    docsUrl: docsUrl !== websiteUrl ? docsUrl : undefined,
    domain: parsed.domain,
    indexedAt: new Date().toISOString(),
    chunkCount: allChunks.length,
    pageCount: crawlResult.pages.length,
    endpointCount: endpointCount > 0 ? endpointCount : undefined,
    indexName,
    crawledUrls: crawlResult.pages.map((p) => p.url),
  };

  await saveLibraryMetadata(libraryId, metadata);
  await cacheChunks(libraryId, allChunks);

  console.log();
  output.success(`Library "${libraryName}" indexed successfully!`);
  output.info(`Pages: ${crawlResult.pages.length}`);
  output.info(`Chunks: ${allChunks.length}`);
  if (endpointCount > 0) {
    output.info(`Endpoints: ${endpointCount}`);
  }
  output.info(`Index: ${indexName}`);
  output.info(`Duration: ${(crawlResult.duration / 1000).toFixed(1)}s`);

  if (crawlResult.errors.length > 0) {
    console.log();
    output.warn(`${crawlResult.errors.length} errors during crawl:`);
    crawlResult.errors.slice(0, 5).forEach((err) => output.info(`  - ${err}`));
    if (crawlResult.errors.length > 5) {
      output.info(`  ... and ${crawlResult.errors.length - 5} more`);
    }
  }
}
