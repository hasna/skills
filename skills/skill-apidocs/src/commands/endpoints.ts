import chalk from 'chalk';
import type { EndpointsOptions, APIEndpoint } from '../types/index.js';
import * as output from '../utils/output.js';
import { initStorage, findLibrary, loadEndpoints } from '../lib/storage.js';
import { groupByResource, groupByMethod } from '../lib/endpoint-extractor.js';

/**
 * Display API endpoints from indexed documentation
 */
export async function endpoints(library: string, options: EndpointsOptions): Promise<void> {
  await initStorage();

  // Find library
  const meta = await findLibrary(library);
  if (!meta) {
    output.error(`Library not found: ${library}`);
    output.info('Use `service-apidocs list` to see indexed libraries');
    process.exit(1);
  }

  // Load endpoints
  const allEndpoints = await loadEndpoints(meta.id);

  if (allEndpoints.length === 0) {
    output.warn(`No API endpoints found for library: ${meta.name}`);
    output.info('Endpoints are extracted during indexing. Try re-indexing with `service-apidocs sync`.');
    return;
  }

  // Apply filter if specified
  let filteredEndpoints = allEndpoints;
  if (options.filter) {
    const filterMethod = options.filter.toUpperCase();
    filteredEndpoints = allEndpoints.filter((e) => e.method === filterMethod);

    if (filteredEndpoints.length === 0) {
      output.warn(`No ${filterMethod} endpoints found`);
      return;
    }
  }

  // JSON output
  if (options.json) {
    output.json({
      library: meta.name,
      libraryId: meta.id,
      docsUrl: meta.docsUrl || meta.websiteUrl,
      endpointCount: filteredEndpoints.length,
      endpoints: filteredEndpoints,
    });
    return;
  }

  // Header
  const docsUrl = meta.docsUrl || meta.websiteUrl;
  console.log();
  console.log(chalk.bold(`${meta.name} API Endpoints`) + chalk.dim(` (${filteredEndpoints.length} total)`));
  console.log(chalk.dim(`Docs: ${docsUrl}`));
  console.log();

  // Group and display
  const groupBy = options.groupBy || 'resource';

  if (groupBy === 'method') {
    displayGroupedByMethod(filteredEndpoints);
  } else {
    displayGroupedByResource(filteredEndpoints);
  }
}

/**
 * Display endpoints grouped by resource
 */
function displayGroupedByResource(endpoints: APIEndpoint[]): void {
  const grouped = groupByResource(endpoints);

  for (const [resource, resourceEndpoints] of grouped) {
    // Resource header
    console.log(chalk.bold.cyan(capitalizeFirst(resource)));

    // Endpoints in this resource
    for (const endpoint of resourceEndpoints) {
      const methodColor = getMethodColor(endpoint.method);
      const method = chalk[methodColor](endpoint.method.padEnd(7));
      const path = endpoint.path;
      const title = chalk.dim(truncate(endpoint.title, 50));

      console.log(`  ${method} ${path}  ${title}`);
    }

    console.log(); // Space between resources
  }
}

/**
 * Display endpoints grouped by HTTP method
 */
function displayGroupedByMethod(endpoints: APIEndpoint[]): void {
  const grouped = groupByMethod(endpoints);

  for (const [method, methodEndpoints] of grouped) {
    if (methodEndpoints.length === 0) continue;

    // Method header
    const methodColor = getMethodColor(method);
    console.log(chalk.bold[methodColor](`${method}`) + chalk.dim(` (${methodEndpoints.length} endpoints)`));

    // Endpoints with this method
    for (const endpoint of methodEndpoints) {
      const path = endpoint.path.padEnd(40);
      const title = chalk.dim(truncate(endpoint.title, 40));

      console.log(`  ${path} ${title}`);
    }

    console.log(); // Space between methods
  }
}

/**
 * Get chalk color for HTTP method
 */
function getMethodColor(method: string): 'green' | 'blue' | 'yellow' | 'red' | 'magenta' | 'cyan' {
  switch (method) {
    case 'GET':
      return 'green';
    case 'POST':
      return 'blue';
    case 'PUT':
      return 'yellow';
    case 'PATCH':
      return 'yellow';
    case 'DELETE':
      return 'red';
    case 'HEAD':
      return 'magenta';
    case 'OPTIONS':
      return 'cyan';
    default:
      return 'cyan';
  }
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
