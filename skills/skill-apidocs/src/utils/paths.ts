import { join } from 'path';
import { homedir } from 'os';
import type { WebsiteInfo } from '../types/index.js';

/**
 * Base directory for service-apidocs data
 */
export const SERVICE_DIR = join(homedir(), '.service', 'service-apidocs');

/**
 * Libraries metadata directory
 */
export const LIBRARIES_DIR = join(SERVICE_DIR, 'libraries');

/**
 * Global config file path
 */
export const CONFIG_FILE = join(SERVICE_DIR, 'config.json');

/**
 * Get library directory path
 */
export function getLibraryDir(libraryId: string): string {
  const sanitized = libraryId.replace(/[^a-zA-Z0-9.-]/g, '-');
  return join(LIBRARIES_DIR, sanitized);
}

/**
 * Get library metadata file path
 */
export function getLibraryMetadataPath(libraryId: string): string {
  return join(getLibraryDir(libraryId), 'metadata.json');
}

/**
 * Get library cache directory
 */
export function getLibraryCacheDir(libraryId: string): string {
  return join(getLibraryDir(libraryId), 'cache');
}

/**
 * Parse website URL to extract domain and path
 * Only allows http and https protocols for security
 */
export function parseWebsiteUrl(url: string): WebsiteInfo | null {
  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return {
      url: parsed.href,
      domain: parsed.hostname,
      path: parsed.pathname,
      protocol: parsed.protocol.replace(':', ''),
    };
  } catch {
    return null;
  }
}

/**
 * Create library ID from URL and optional custom name
 */
export function createLibraryIdFromUrl(url: string, customName?: string): string {
  if (customName) {
    return customName.toLowerCase().replace(/[^a-zA-Z0-9.-]/g, '-');
  }

  const parsed = parseWebsiteUrl(url);
  if (!parsed) {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Use domain without common prefixes
  let domain = parsed.domain.replace(/^(www\.|docs\.|api\.|platform\.)/, '');

  // Include path if it's meaningful (e.g., /docs)
  const pathPart = parsed.path.replace(/^\/+|\/+$/g, '').split('/')[0];
  if (pathPart && pathPart !== 'docs' && pathPart !== 'documentation') {
    domain = `${domain}-${pathPart}`;
  }

  return domain.toLowerCase().replace(/[^a-zA-Z0-9.-]/g, '-');
}

/**
 * Create index name for S3 Vectors from URL
 */
export function createIndexNameFromUrl(url: string, customName?: string): string {
  const libraryId = createLibraryIdFromUrl(url, customName);
  const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
  return `${libraryId}-${timestamp}`.toLowerCase();
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dir: string): Promise<void> {
  const fs = await import('fs/promises');
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Check if file matches exclude patterns
 */
export function matchesPattern(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$|/${regexPattern}$|^${regexPattern}/|/${regexPattern}/`);
    if (regex.test(path)) {
      return true;
    }
  }
  return false;
}
