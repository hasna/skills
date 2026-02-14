import * as output from '../utils/output.js';
import { findLibrary, deleteLibrary, initStorage } from '../lib/storage.js';
import { deleteIndex } from '../lib/vectors.js';

/**
 * Remove a library from the index
 */
export async function remove(library: string): Promise<void> {
  await initStorage();

  // Find the library
  const metadata = await findLibrary(library);

  if (!metadata) {
    output.error(`Library not found: ${library}`);
    output.info('Use `service-apidocs list` to see indexed libraries');
    process.exit(1);
  }

  const { id: libraryId, indexName } = metadata;

  output.info(`Removing: ${libraryId}`);

  // Delete vector index
  output.step('Deleting vector index...');
  try {
    await deleteIndex(indexName);
    output.success('Vector index deleted');
  } catch (error) {
    output.warn(`Could not delete index: ${(error as Error).message}`);
  }

  // Delete local metadata
  output.step('Removing local data...');
  await deleteLibrary(libraryId);
  output.success('Local data removed');

  output.success(`Library ${libraryId} removed successfully`);
}
