import type { QueryOptions } from '../types/index.js';
import * as output from '../utils/output.js';
import { findLibrary, initStorage } from '../lib/storage.js';
import { semanticSearch, searchAsJson } from '../lib/search.js';
import { indexExists } from '../lib/vectors.js';

/**
 * Query documentation semantically
 */
export async function query(library: string, question: string, options: QueryOptions): Promise<void> {
  await initStorage();

  // Find the library
  const metadata = await findLibrary(library);

  if (!metadata) {
    output.error(`Library not found: ${library}`);
    output.info('Use `service-apidocs list` to see indexed libraries');
    process.exit(1);
  }

  const { indexName, id: libraryId } = metadata;

  // Verify index exists
  const exists = await indexExists(indexName);
  if (!exists) {
    output.error(`Index not found: ${indexName}`);
    output.info('The library may need to be re-indexed. Use `service-apidocs sync`');
    process.exit(1);
  }

  // Determine output format
  const maxTokens = options.tokens || 8000;
  const topK = options.topK || 10;

  if (options.json) {
    // JSON output
    try {
      const result = await searchAsJson(indexName, question, { topK, maxTokens });
      output.json(result);
    } catch (error) {
      output.error(`Search failed: ${(error as Error).message}`);
      process.exit(1);
    }
  } else {
    // Markdown output
    try {
      const result = await semanticSearch(indexName, question, { topK, maxTokens });

      // Print header
      console.log();
      console.log(`# ${metadata.config?.projectTitle || metadata.name}`);
      console.log(`> Query: "${question}"`);
      console.log();

      // Print content
      output.markdown(result.content);
    } catch (error) {
      output.error(`Search failed: ${(error as Error).message}`);
      process.exit(1);
    }
  }
}
