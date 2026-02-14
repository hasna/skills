/**
 * API endpoint extraction using Claude
 *
 * Extracts structured API endpoint information from crawled documentation pages.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import type {
  CrawledPage,
  APIEndpoint,
  ExtractionEvent,
  ExtractionResult,
  HTTPMethod,
} from '../types/index.js';

const EXTRACTION_SYSTEM_PROMPT = `You are an API endpoint extraction agent. Analyze documentation content and extract structured API endpoint information.

For each endpoint found, extract:
- method: HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- path: The endpoint path (e.g., /users, /posts/{id}, /v1/chat/completions)
- title: A short title/name for the endpoint
- description: What the endpoint does
- parameters: Path, query, header parameters with name, type, required, description
- requestBody: Content type and example if available
- responses: Status codes and descriptions
- codeExamples: Any code examples (curl, python, javascript, etc.)

Output a JSON array of endpoints. Only include endpoints that are clearly documented with at least method and path.

If no API endpoints are found on a page, output an empty array: []`;

const EXTRACTION_BATCH_SIZE = 5; // Process pages in batches

/**
 * Generate a unique ID for an endpoint based on method and path
 */
function generateEndpointId(method: string, path: string): string {
  const hash = createHash('md5').update(`${method}:${path}`).digest('hex');
  return hash.substring(0, 12);
}

/**
 * Extract resource name from path
 * /users/{id} -> users
 * /v1/chat/completions -> chat
 * /api/posts/{postId}/comments -> posts
 */
function extractResource(path: string): string {
  // Remove version prefixes
  let cleanPath = path.replace(/^\/?(v\d+|api)\/?/i, '/');

  // Get first meaningful segment
  const segments = cleanPath.split('/').filter(Boolean);

  for (const segment of segments) {
    // Skip path parameters
    if (segment.startsWith('{') || segment.startsWith(':')) {
      continue;
    }
    // Return first non-parameter segment
    return segment.toLowerCase();
  }

  return 'general';
}

/**
 * Validate and normalize extracted endpoints
 */
function validateEndpoint(raw: unknown, sourceUrl: string, sourceTitle: string): APIEndpoint | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  // Must have method and path
  if (!obj.method || !obj.path) return null;

  const method = String(obj.method).toUpperCase();
  const validMethods: HTTPMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  if (!validMethods.includes(method as HTTPMethod)) return null;

  const path = String(obj.path);
  if (!path.startsWith('/')) return null;

  return {
    id: generateEndpointId(method, path),
    method: method as HTTPMethod,
    path,
    title: String(obj.title || `${method} ${path}`),
    description: String(obj.description || ''),
    resource: extractResource(path),
    parameters: Array.isArray(obj.parameters)
      ? obj.parameters.map((p: unknown) => {
          const param = p as Record<string, unknown>;
          return {
            name: String(param.name || ''),
            in: (['path', 'query', 'header', 'cookie'].includes(String(param.in))
              ? String(param.in)
              : 'query') as 'path' | 'query' | 'header' | 'cookie',
            type: String(param.type || 'string'),
            required: Boolean(param.required),
            description: param.description ? String(param.description) : undefined,
            default: param.default,
          };
        })
      : undefined,
    requestBody: obj.requestBody
      ? {
          contentType: String((obj.requestBody as Record<string, unknown>).contentType || 'application/json'),
          schema: (obj.requestBody as Record<string, unknown>).schema as Record<string, unknown> | undefined,
          example: (obj.requestBody as Record<string, unknown>).example,
        }
      : undefined,
    responses: Array.isArray(obj.responses)
      ? obj.responses.map((r: unknown) => {
          const resp = r as Record<string, unknown>;
          return {
            status: Number(resp.status) || 200,
            description: String(resp.description || ''),
            example: resp.example,
          };
        })
      : undefined,
    codeExamples: Array.isArray(obj.codeExamples)
      ? obj.codeExamples.map((e: unknown) => {
          const ex = e as Record<string, unknown>;
          return {
            language: String(ex.language || 'text'),
            code: String(ex.code || ''),
            title: ex.title ? String(ex.title) : undefined,
          };
        })
      : undefined,
    sourceUrl,
    sourcePageTitle: sourceTitle,
  };
}

/**
 * Extract endpoints from a single page using Claude
 */
async function extractEndpointsFromPage(
  client: Anthropic,
  page: CrawledPage
): Promise<APIEndpoint[]> {
  // Skip pages that don't look like API documentation
  const apiIndicators = [
    /\bGET\b/,
    /\bPOST\b/,
    /\bPUT\b/,
    /\bDELETE\b/,
    /\bPATCH\b/,
    /endpoint/i,
    /api/i,
    /request/i,
    /response/i,
    /curl/i,
    /http/i,
  ];

  const hasApiContent = apiIndicators.filter((p) => p.test(page.content)).length >= 2;
  if (!hasApiContent) {
    return [];
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Extract API endpoints from this documentation page.

Title: ${page.title}
URL: ${page.url}

Content:
${page.content.substring(0, 30000)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return [];
    }

    // Parse JSON from response
    const text = textBlock.text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return [];
      }

      const endpoints: APIEndpoint[] = [];
      for (const item of parsed) {
        const validated = validateEndpoint(item, page.url, page.title);
        if (validated) {
          endpoints.push(validated);
        }
      }

      return endpoints;
    } catch {
      // JSON parse error
      return [];
    }
  } catch (error) {
    console.error(`Error extracting from ${page.url}:`, (error as Error).message);
    return [];
  }
}

/**
 * Extract API endpoints from crawled documentation pages
 *
 * Processes pages in batches and uses Claude to extract structured endpoint data.
 */
export async function extractEndpoints(
  pages: CrawledPage[],
  onEvent: (event: ExtractionEvent) => void = () => {}
): Promise<ExtractionResult> {
  const client = new Anthropic();
  const allEndpoints: APIEndpoint[] = [];
  const errors: string[] = [];
  const seenEndpoints = new Set<string>(); // For deduplication by id

  onEvent({ type: 'processing', pageIndex: 0, totalPages: pages.length });

  // Process pages in batches
  for (let i = 0; i < pages.length; i += EXTRACTION_BATCH_SIZE) {
    const batch = pages.slice(i, i + EXTRACTION_BATCH_SIZE);

    // Process batch in parallel
    const batchPromises = batch.map(async (page, batchIndex) => {
      const pageIndex = i + batchIndex;
      onEvent({
        type: 'processing',
        pageIndex,
        totalPages: pages.length,
        pageUrl: page.url,
      });

      try {
        const endpoints = await extractEndpointsFromPage(client, page);
        return { endpoints, error: null };
      } catch (error) {
        return { endpoints: [], error: `${page.url}: ${(error as Error).message}` };
      }
    });

    const results = await Promise.all(batchPromises);

    for (const result of results) {
      if (result.error) {
        errors.push(result.error);
      }

      for (const endpoint of result.endpoints) {
        // Deduplicate by endpoint ID (method:path hash)
        if (!seenEndpoints.has(endpoint.id)) {
          seenEndpoints.add(endpoint.id);
          allEndpoints.push(endpoint);
        }
      }
    }

    onEvent({
      type: 'extracted',
      pageIndex: Math.min(i + EXTRACTION_BATCH_SIZE, pages.length),
      totalPages: pages.length,
      endpointCount: allEndpoints.length,
    });

    // Small delay between batches
    if (i + EXTRACTION_BATCH_SIZE < pages.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Sort endpoints by resource then path
  allEndpoints.sort((a, b) => {
    if (a.resource !== b.resource) {
      return a.resource.localeCompare(b.resource);
    }
    return a.path.localeCompare(b.path);
  });

  onEvent({
    type: 'complete',
    endpointCount: allEndpoints.length,
  });

  return {
    endpoints: allEndpoints,
    processedPages: pages.length,
    errors,
  };
}

/**
 * Get unique resources from endpoints
 */
export function getUniqueResources(endpoints: APIEndpoint[]): string[] {
  const resources = new Set(endpoints.map((e) => e.resource));
  return Array.from(resources).sort();
}

/**
 * Group endpoints by resource
 */
export function groupByResource(endpoints: APIEndpoint[]): Map<string, APIEndpoint[]> {
  const grouped = new Map<string, APIEndpoint[]>();

  for (const endpoint of endpoints) {
    const existing = grouped.get(endpoint.resource) || [];
    existing.push(endpoint);
    grouped.set(endpoint.resource, existing);
  }

  return grouped;
}

/**
 * Group endpoints by HTTP method
 */
export function groupByMethod(endpoints: APIEndpoint[]): Map<string, APIEndpoint[]> {
  const grouped = new Map<string, APIEndpoint[]>();
  const methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  // Initialize in order
  for (const method of methodOrder) {
    grouped.set(method, []);
  }

  for (const endpoint of endpoints) {
    const existing = grouped.get(endpoint.method) || [];
    existing.push(endpoint);
    grouped.set(endpoint.method, existing);
  }

  // Remove empty methods
  for (const [method, list] of grouped) {
    if (list.length === 0) {
      grouped.delete(method);
    }
  }

  return grouped;
}
