import { readFile, writeFile, readdir, rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import type { LibraryMetadata, Chunk, ApidocsConfig, CrawledPage, APIEndpoint } from '../types/index.js';
import {
  SERVICE_DIR,
  LIBRARIES_DIR,
  CONFIG_FILE,
  getLibraryDir,
  getLibraryMetadataPath,
  getLibraryCacheDir,
  ensureDir,
} from '../utils/paths.js';

/**
 * Initialize storage directories
 */
export async function initStorage(): Promise<void> {
  await ensureDir(SERVICE_DIR);
  await ensureDir(LIBRARIES_DIR);
}

/**
 * Get global config
 */
export async function getConfig(): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save global config
 */
export async function saveConfig(config: Record<string, unknown>): Promise<void> {
  await ensureDir(SERVICE_DIR);
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get library metadata
 */
export async function getLibraryMetadata(libraryId: string): Promise<LibraryMetadata | null> {
  const metadataPath = getLibraryMetadataPath(libraryId);
  try {
    const content = await readFile(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save library metadata
 */
export async function saveLibraryMetadata(libraryId: string, metadata: LibraryMetadata): Promise<void> {
  const libraryDir = getLibraryDir(libraryId);
  await ensureDir(libraryDir);
  const metadataPath = getLibraryMetadataPath(libraryId);
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Delete library metadata and cache
 */
export async function deleteLibrary(libraryId: string): Promise<void> {
  const libraryDir = getLibraryDir(libraryId);
  if (existsSync(libraryDir)) {
    await rm(libraryDir, { recursive: true });
  }
}

/**
 * List all indexed libraries
 */
export async function listLibraries(): Promise<LibraryMetadata[]> {
  await initStorage();

  const libraries: LibraryMetadata[] = [];

  try {
    const dirs = await readdir(LIBRARIES_DIR);
    for (const dir of dirs) {
      // Try to load metadata using the directory name as ID
      const metadata = await getLibraryMetadata(dir);
      if (metadata) {
        libraries.push(metadata);
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  return libraries;
}

/**
 * Find library by name (partial match)
 */
export async function findLibrary(name: string): Promise<LibraryMetadata | null> {
  const libraries = await listLibraries();
  const searchLower = name.toLowerCase();

  // Try exact match on id or name first
  let match = libraries.find(
    (lib) =>
      lib.id === name ||
      lib.name === name ||
      lib.id?.toLowerCase() === searchLower ||
      lib.name?.toLowerCase() === searchLower
  );

  if (match) return match;

  // Try partial match on name or domain
  match = libraries.find(
    (lib) =>
      lib.name?.toLowerCase().includes(searchLower) ||
      lib.domain?.toLowerCase().includes(searchLower) ||
      lib.id?.toLowerCase().includes(searchLower)
  );

  return match || null;
}

/**
 * Save crawled pages to cache
 */
export async function saveCrawledPages(libraryId: string, pages: CrawledPage[]): Promise<void> {
  const cacheDir = getLibraryCacheDir(libraryId);
  await ensureDir(cacheDir);

  // Save pages in batches of 50
  const batchSize = 50;
  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);
    const batchFile = `${cacheDir}/pages-${Math.floor(i / batchSize)}.json`;
    await writeFile(batchFile, JSON.stringify(batch, null, 2));
  }
}

/**
 * Load cached crawled pages
 */
export async function loadCrawledPages(libraryId: string): Promise<CrawledPage[]> {
  const cacheDir = getLibraryCacheDir(libraryId);
  const pages: CrawledPage[] = [];

  try {
    const files = await readdir(cacheDir);
    for (const file of files.filter((f) => f.startsWith('pages-'))) {
      const content = await readFile(`${cacheDir}/${file}`, 'utf-8');
      pages.push(...JSON.parse(content));
    }
  } catch {
    // No cache
  }

  return pages;
}

/**
 * Cache chunks locally
 */
export async function cacheChunks(libraryId: string, chunks: Chunk[]): Promise<void> {
  const cacheDir = getLibraryCacheDir(libraryId);
  await ensureDir(cacheDir);

  // Save chunks in batches of 100
  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchFile = `${cacheDir}/chunks-${Math.floor(i / batchSize)}.json`;
    await writeFile(batchFile, JSON.stringify(batch, null, 2));
  }
}

/**
 * Load cached chunks
 */
export async function loadCachedChunks(libraryId: string): Promise<Chunk[]> {
  const cacheDir = getLibraryCacheDir(libraryId);
  const chunks: Chunk[] = [];

  try {
    const files = await readdir(cacheDir);
    for (const file of files.filter((f) => f.startsWith('chunks-'))) {
      const content = await readFile(`${cacheDir}/${file}`, 'utf-8');
      chunks.push(...JSON.parse(content));
    }
  } catch {
    // No cache
  }

  return chunks;
}

/**
 * Save apidocs config
 */
export async function saveApidocsConfig(libraryId: string, config: ApidocsConfig): Promise<void> {
  const libraryDir = getLibraryDir(libraryId);
  await ensureDir(libraryDir);
  await writeFile(`${libraryDir}/apidocs.json`, JSON.stringify(config, null, 2));
}

/**
 * Load apidocs config
 */
export async function loadApidocsConfig(libraryId: string): Promise<ApidocsConfig | null> {
  const libraryDir = getLibraryDir(libraryId);
  try {
    const content = await readFile(`${libraryDir}/apidocs.json`, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save extracted API endpoints
 */
export async function saveEndpoints(libraryId: string, endpoints: APIEndpoint[]): Promise<void> {
  const libraryDir = getLibraryDir(libraryId);
  await ensureDir(libraryDir);
  await writeFile(`${libraryDir}/endpoints.json`, JSON.stringify(endpoints, null, 2));
}

/**
 * Load extracted API endpoints
 */
export async function loadEndpoints(libraryId: string): Promise<APIEndpoint[]> {
  const libraryDir = getLibraryDir(libraryId);
  try {
    const content = await readFile(`${libraryDir}/endpoints.json`, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}
