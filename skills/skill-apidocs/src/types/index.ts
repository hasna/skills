/**
 * Configuration file structure (apidocs.json)
 */
export interface ApidocsConfig {
  projectTitle: string;
  description?: string;
  rules?: string[];
}

/**
 * Crawled page from documentation website
 */
export interface CrawledPage {
  url: string;
  path: string;
  title: string;
  content: string;
  html: string;
  crawledAt: string;
}

/**
 * Configuration for web crawler
 */
export interface CrawlConfig {
  startUrl: string;
  maxPages: number;
  allowedDomains?: string[];
  excludePatterns?: string[];
}

/**
 * Event emitted during crawling
 */
export interface CrawlEvent {
  type: 'navigating' | 'extracted' | 'skipped' | 'error' | 'complete';
  url?: string;
  title?: string;
  pageCount?: number;
  totalPages?: number;
  error?: string;
  reason?: string;
}

/**
 * Result from crawl operation
 */
export interface CrawlResult {
  pages: CrawledPage[];
  totalPages: number;
  duration: number;
  errors: string[];
}

/**
 * Website URL information
 */
export interface WebsiteInfo {
  url: string;
  domain: string;
  path: string;
  protocol: string;
}

/**
 * Documentation file (compatible with parser)
 */
export interface DocFile {
  path: string;
  content: string;
}

/**
 * Parsed chunk from documentation
 */
export interface Chunk {
  id: string;
  content: string;
  title: string;
  type: 'code' | 'text';
  filePath: string;
  headingHierarchy: string[];
  codeLanguage?: string;
  tokenCount: number;
}

/**
 * Vector data for S3 Vectors
 */
export interface VectorData {
  key: string;
  data: {
    float32: number[];
  };
  metadata: VectorMetadata;
}

/**
 * Metadata stored with each vector
 */
export interface VectorMetadata {
  libraryId: string;
  version: string;
  filePath: string;
  chunkIndex: number;
  title: string;
  type: 'code' | 'text';
  content: string;
}

/**
 * Search result from vector query
 */
export interface SearchResult {
  key: string;
  score: number;
  metadata: VectorMetadata;
}

/**
 * Library metadata stored locally
 */
export interface LibraryMetadata {
  id: string;
  name: string;
  websiteUrl: string;
  docsUrl?: string;                // Discovered documentation URL
  domain: string;
  indexedAt: string;
  chunkCount: number;
  pageCount: number;
  endpointCount?: number;          // Number of extracted API endpoints
  config?: ApidocsConfig;
  indexName: string;
  crawledUrls?: string[];
}

/**
 * Index information from S3 Vectors
 */
export interface IndexInfo {
  name: string;
  vectorCount: number;
  createdAt?: string;
}

/**
 * Add command options
 */
export interface AddOptions {
  name?: string;
  maxPages?: number;
}

/**
 * Code block extracted from markdown
 */
export interface CodeBlock {
  content: string;
  language: string;
  filePath: string;
  lineStart?: number;
}

/**
 * Query options
 */
export interface QueryOptions {
  library: string;
  question: string;
  tokens?: number;
  topK?: number;
  json?: boolean;
}


/**
 * Formatted query result
 */
export interface QueryResult {
  content: string;
  sources: string[];
  chunks: SearchResult[];
}

// ===== API Endpoint Types =====

/**
 * HTTP methods supported by API endpoints
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * API endpoint extracted from documentation
 */
export interface APIEndpoint {
  id: string;                      // Hash of method:path
  method: HTTPMethod;
  path: string;                    // /users, /posts/{id}, /v1/chat/completions
  title: string;                   // "Create a user", "List posts"
  description: string;             // Full description from docs
  resource: string;                // Grouped resource: "users", "posts", "chat"
  parameters?: EndpointParameter[];
  requestBody?: {
    contentType: string;
    schema?: Record<string, unknown>;
    example?: unknown;
  };
  responses?: EndpointResponse[];
  codeExamples?: CodeExample[];
  sourceUrl: string;               // URL where this was found
  sourcePageTitle: string;         // Page title
}

/**
 * Parameter for an API endpoint
 */
export interface EndpointParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
}

/**
 * Response from an API endpoint
 */
export interface EndpointResponse {
  status: number;
  description: string;
  example?: unknown;
}

/**
 * Code example for an API endpoint
 */
export interface CodeExample {
  language: string;               // curl, python, javascript, etc.
  code: string;
  title?: string;
}

// ===== Discovery Agent Types =====

/**
 * Event emitted during docs URL discovery
 */
export interface DiscoveryEvent {
  type: 'navigating' | 'analyzing' | 'found' | 'not_found' | 'error';
  url?: string;
  message?: string;
  docsUrl?: string;
  error?: string;
}

/**
 * Result from docs discovery
 */
export interface DiscoveryResult {
  success: boolean;
  docsUrl?: string;
  error?: string;
}

// ===== Extraction Agent Types =====

/**
 * Event emitted during endpoint extraction
 */
export interface ExtractionEvent {
  type: 'processing' | 'extracted' | 'complete' | 'error';
  pageIndex?: number;
  totalPages?: number;
  pageUrl?: string;
  endpointCount?: number;
  error?: string;
}

/**
 * Result from endpoint extraction
 */
export interface ExtractionResult {
  endpoints: APIEndpoint[];
  processedPages: number;
  errors: string[];
}

/**
 * Options for endpoints command
 */
export interface EndpointsOptions {
  json?: boolean;
  groupBy?: 'resource' | 'method';
  filter?: string;
}
