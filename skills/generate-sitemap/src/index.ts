#!/usr/bin/env bun

/**
 * Generate Sitemap Skill
 *
 * Generates XML sitemaps for websites with support for:
 * - Automated website crawling
 * - Manual URL input from file or CLI
 * - Priority and change frequency settings
 * - Sitemap indexes for large sites (>50k URLs)
 * - Last modified dates
 */

import { parseArgs } from "util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { gzipSync } from "zlib";

// ============================================================================
// Types
// ============================================================================

interface SitemapURL {
  loc: string;
  lastmod?: string;
  changefreq?: ChangeFrequency;
  priority?: number;
}

type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

interface CrawlOptions {
  maxDepth?: number;
  maxUrls?: number;
  excludePatterns?: string[];
  includePatterns?: string[];
  followExternal?: boolean;
  timeout?: number;
  userAgent?: string;
}

interface GenerateOptions {
  file?: string;
  crawl?: boolean;
  depth?: number;
  maxUrls?: number;
  priority?: number;
  changefreq?: ChangeFrequency;
  lastmod?: string;
  output?: string;
  index?: boolean;
  compress?: boolean;
  pretty?: boolean;
  exclude?: string[];
  include?: string[];
  followExternal?: boolean;
  timeout?: number;
  userAgent?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SITEMAP_XMLNS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const MAX_URLS_PER_SITEMAP = 50000;
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_USER_AGENT = "skills.md-sitemap-generator/1.0";
const RATE_LIMIT_DELAY = 200; // 5 requests per second

// ============================================================================
// URL Parser & Validator
// ============================================================================

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash except for root
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    // Remove hash
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function matchesPattern(url: string, pattern: string): boolean {
  const regex = new RegExp(
    pattern
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")
  );
  return regex.test(url);
}

// ============================================================================
// File Parser
// ============================================================================

function parseUrlsFile(filePath: string, defaultOptions: Partial<SitemapURL>): SitemapURL[] {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#");
  });

  const urls: SitemapURL[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 0) continue;

    const url = parts[0];
    if (!isValidUrl(url)) {
      console.warn(`⚠️  Skipping invalid URL: ${url}`);
      continue;
    }

    const sitemapUrl: SitemapURL = {
      loc: normalizeUrl(url),
      priority: parts[1] ? parseFloat(parts[1]) : defaultOptions.priority,
      changefreq: (parts[2] as ChangeFrequency) || defaultOptions.changefreq,
      lastmod: parts[3] || defaultOptions.lastmod,
    };

    urls.push(sitemapUrl);
  }

  return urls;
}

// ============================================================================
// Web Crawler
// ============================================================================

class WebCrawler {
  private visited = new Set<string>();
  private baseUrl: URL;
  private options: CrawlOptions;

  constructor(baseUrl: string, options: CrawlOptions = {}) {
    this.baseUrl = new URL(baseUrl);
    this.options = {
      maxDepth: options.maxDepth,
      maxUrls: options.maxUrls || MAX_URLS_PER_SITEMAP,
      excludePatterns: options.excludePatterns || [],
      includePatterns: options.includePatterns || [],
      followExternal: options.followExternal || false,
      timeout: options.timeout || DEFAULT_TIMEOUT,
      userAgent: options.userAgent || DEFAULT_USER_AGENT,
    };
  }

  async crawl(): Promise<SitemapURL[]> {
    console.log(`🕷️  Starting crawl of ${this.baseUrl.toString()}`);
    console.log(`   Max depth: ${this.options.maxDepth || "unlimited"}`);
    console.log(`   Max URLs: ${this.options.maxUrls}`);

    const urls: SitemapURL[] = [];
    await this.crawlRecursive(this.baseUrl.toString(), 0, urls);

    console.log(`✅ Crawl complete: ${urls.length} URLs discovered`);
    return urls;
  }

  private async crawlRecursive(
    url: string,
    depth: number,
    urls: SitemapURL[]
  ): Promise<void> {
    // Check limits
    if (this.options.maxDepth && depth > this.options.maxDepth) return;
    if (urls.length >= this.options.maxUrls!) return;

    const normalizedUrl = normalizeUrl(url);

    // Check if already visited
    if (this.visited.has(normalizedUrl)) return;
    this.visited.add(normalizedUrl);

    // Check domain (unless followExternal is enabled)
    const urlObj = new URL(url);
    if (!this.options.followExternal && urlObj.hostname !== this.baseUrl.hostname) {
      return;
    }

    // Apply filters
    if (!this.shouldIncludeUrl(url)) return;

    // Add to sitemap
    urls.push({
      loc: normalizedUrl,
      lastmod: new Date().toISOString().split("T")[0],
      changefreq: "weekly",
      priority: depth === 0 ? 1.0 : Math.max(0.1, 1.0 - depth * 0.2),
    });

    console.log(`   [${depth}] ${normalizedUrl}`);

    // Fetch and parse links
    try {
      const links = await this.fetchLinks(url);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

      // Crawl children
      for (const link of links) {
        if (urls.length >= this.options.maxUrls!) break;
        await this.crawlRecursive(link, depth + 1, urls);
      }
    } catch (error) {
      console.warn(`   ⚠️  Failed to crawl ${url}:`, (error as Error).message);
    }
  }

  private async fetchLinks(url: string): Promise<string[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": this.options.userAgent!,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        return [];
      }

      const html = await response.text();
      return this.extractLinks(html, url);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const linkRegex = /<a[^>]+href=["']([^"']+)["']/gi;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const href = match[1];
        const absoluteUrl = new URL(href, baseUrl).toString();

        if (isValidUrl(absoluteUrl)) {
          links.push(absoluteUrl);
        }
      } catch {
        // Skip invalid URLs
      }
    }

    return [...new Set(links)]; // Remove duplicates
  }

  private shouldIncludeUrl(url: string): boolean {
    // Check exclude patterns
    for (const pattern of this.options.excludePatterns!) {
      if (matchesPattern(url, pattern)) {
        return false;
      }
    }

    // Check include patterns (if any)
    if (this.options.includePatterns!.length > 0) {
      return this.options.includePatterns!.some(pattern =>
        matchesPattern(url, pattern)
      );
    }

    return true;
  }
}

// ============================================================================
// XML Generator
// ============================================================================

function generateSitemapXML(urls: SitemapURL[], pretty: boolean = false): string {
  const indent = pretty ? "  " : "";
  const newline = pretty ? "\n" : "";

  let xml = `<?xml version="1.0" encoding="UTF-8"?>${newline}`;
  xml += `<urlset xmlns="${SITEMAP_XMLNS}">${newline}`;

  for (const url of urls) {
    xml += `${indent}<url>${newline}`;
    xml += `${indent}${indent}<loc>${escapeXml(url.loc)}</loc>${newline}`;

    if (url.lastmod) {
      xml += `${indent}${indent}<lastmod>${url.lastmod}</lastmod>${newline}`;
    }

    if (url.changefreq) {
      xml += `${indent}${indent}<changefreq>${url.changefreq}</changefreq>${newline}`;
    }

    if (url.priority !== undefined) {
      xml += `${indent}${indent}<priority>${url.priority.toFixed(1)}</priority>${newline}`;
    }

    xml += `${indent}</url>${newline}`;
  }

  xml += `</urlset>`;
  return xml;
}

function generateSitemapIndexXML(
  sitemaps: Array<{ loc: string; lastmod: string }>,
  pretty: boolean = false
): string {
  const indent = pretty ? "  " : "";
  const newline = pretty ? "\n" : "";

  let xml = `<?xml version="1.0" encoding="UTF-8"?>${newline}`;
  xml += `<sitemapindex xmlns="${SITEMAP_XMLNS}">${newline}`;

  for (const sitemap of sitemaps) {
    xml += `${indent}<sitemap>${newline}`;
    xml += `${indent}${indent}<loc>${escapeXml(sitemap.loc)}</loc>${newline}`;
    xml += `${indent}${indent}<lastmod>${sitemap.lastmod}</lastmod>${newline}`;
    xml += `${indent}</sitemap>${newline}`;
  }

  xml += `</sitemapindex>`;
  return xml;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================================
// File Writer
// ============================================================================

function writeOutput(
  content: string,
  outputPath: string,
  compress: boolean = false
): void {
  // Ensure directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (compress) {
    const compressed = gzipSync(Buffer.from(content));
    const gzPath = outputPath.endsWith(".gz") ? outputPath : `${outputPath}.gz`;
    writeFileSync(gzPath, compressed);
    console.log(`💾 Saved compressed sitemap: ${gzPath}`);
  } else {
    writeFileSync(outputPath, content, "utf-8");
    console.log(`💾 Saved sitemap: ${outputPath}`);
  }
}

// ============================================================================
// Main Generator
// ============================================================================

async function generateSitemap(
  inputUrls: string[],
  options: GenerateOptions
): Promise<void> {
  console.log("🗺️  Generate Sitemap v1.0.0\n");

  let urls: SitemapURL[] = [];

  // Parse input from file
  if (options.file) {
    console.log(`📂 Reading URLs from file: ${options.file}`);
    urls = parseUrlsFile(options.file, {
      priority: options.priority,
      changefreq: options.changefreq,
      lastmod: options.lastmod,
    });
  }
  // Or from manual input
  else if (inputUrls.length > 0) {
    for (const url of inputUrls) {
      if (isValidUrl(url)) {
        urls.push({
          loc: normalizeUrl(url),
          priority: options.priority,
          changefreq: options.changefreq,
          lastmod: options.lastmod,
        });
      }
    }
  }

  // If first URL and crawl enabled (or no file provided)
  if (inputUrls.length > 0 && (options.crawl || !options.file)) {
    const baseUrl = inputUrls[0];
    if (isValidUrl(baseUrl)) {
      const crawler = new WebCrawler(baseUrl, {
        maxDepth: options.depth,
        maxUrls: options.maxUrls,
        excludePatterns: options.exclude,
        includePatterns: options.include,
        followExternal: options.followExternal,
        timeout: options.timeout,
        userAgent: options.userAgent,
      });

      const crawledUrls = await crawler.crawl();

      // Merge with manual URLs (deduplicate)
      const urlMap = new Map<string, SitemapURL>();

      for (const url of urls) {
        urlMap.set(url.loc, url);
      }

      for (const url of crawledUrls) {
        if (!urlMap.has(url.loc)) {
          urlMap.set(url.loc, url);
        }
      }

      urls = Array.from(urlMap.values());
    }
  }

  if (urls.length === 0) {
    console.error("❌ No URLs to generate sitemap. Provide URLs via file, CLI, or enable crawling.");
    process.exit(1);
  }

  console.log(`\n📊 Total URLs: ${urls.length}`);

  // Determine output path
  const outputPath = options.output || join(
    process.env.SKILLS_OUTPUT_DIR || "./",
    "sitemap.xml"
  );

  // Generate sitemap(s)
  if (options.index && urls.length > options.maxUrls!) {
    // Generate multiple sitemaps with index
    console.log(`📑 Generating sitemap index (${Math.ceil(urls.length / options.maxUrls!)} sitemaps)`);

    const baseDir = dirname(outputPath);
    const baseName = basename(outputPath, ".xml");
    const sitemapFiles: Array<{ loc: string; lastmod: string }> = [];

    for (let i = 0; i < urls.length; i += options.maxUrls!) {
      const chunk = urls.slice(i, i + options.maxUrls!);
      const chunkIndex = Math.floor(i / options.maxUrls!) + 1;
      const chunkPath = join(baseDir, `${baseName}_${chunkIndex}.xml`);

      const xml = generateSitemapXML(chunk, options.pretty);
      writeOutput(xml, chunkPath, options.compress);

      // Get base URL for sitemap location
      const firstUrl = new URL(chunk[0].loc);
      const sitemapLoc = `${firstUrl.protocol}//${firstUrl.hostname}/${basename(chunkPath)}`;

      sitemapFiles.push({
        loc: sitemapLoc,
        lastmod: new Date().toISOString().split("T")[0],
      });
    }

    // Generate index
    const indexXml = generateSitemapIndexXML(sitemapFiles, options.pretty);
    const indexPath = join(baseDir, `${baseName}_index.xml`);
    writeOutput(indexXml, indexPath, options.compress);

    console.log(`\n✅ Generated sitemap index with ${sitemapFiles.length} sitemaps`);
  } else {
    // Generate single sitemap
    const xml = generateSitemapXML(urls, options.pretty);
    writeOutput(xml, outputPath, options.compress);

    console.log(`\n✅ Generated sitemap with ${urls.length} URLs`);
  }

  console.log("\n📍 Next steps:");
  console.log("   1. Upload sitemap to your website root");
  console.log("   2. Submit to search engines (Google Search Console, Bing Webmaster)");
  console.log("   3. Add sitemap location to robots.txt:");
  console.log(`      Sitemap: https://your-domain.com/${basename(outputPath)}`);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        file: { type: "string" },
        crawl: { type: "boolean", default: true },
        depth: { type: "string" },
        "max-urls": { type: "string", default: "50000" },
        priority: { type: "string", default: "0.5" },
        changefreq: { type: "string", default: "weekly" },
        lastmod: { type: "string" },
        output: { type: "string" },
        index: { type: "boolean", default: false },
        compress: { type: "boolean", default: false },
        pretty: { type: "boolean", default: true },
        exclude: { type: "string", multiple: true },
        include: { type: "string", multiple: true },
        "follow-external": { type: "boolean", default: false },
        timeout: { type: "string", default: "5000" },
        "user-agent": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Generate Sitemap v1.0.0

Usage:
  bun run src/index.ts [urls...] [options]

Examples:
  bun run src/index.ts https://example.com
  bun run src/index.ts --file urls.txt --output sitemap.xml
  bun run src/index.ts https://example.com --depth 3 --index

Options:
  --file <path>           Path to file with URLs
  --crawl                 Enable crawling (default: true)
  --depth <number>        Max crawl depth
  --max-urls <number>     Max URLs per sitemap (default: 50000)
  --priority <number>     Default priority 0.0-1.0 (default: 0.5)
  --changefreq <freq>     Change frequency (default: weekly)
  --lastmod <date>        Last modified date (ISO 8601)
  --output <path>         Output path (default: ./sitemap.xml)
  --index                 Generate sitemap index
  --compress              Compress to .xml.gz
  --pretty                Pretty print XML (default: true)
  --exclude <pattern>     Exclude URL pattern (can repeat)
  --include <pattern>     Include URL pattern (can repeat)
  --follow-external       Follow external links
  --timeout <ms>          Request timeout (default: 5000)
  --user-agent <string>   Custom User-Agent
  -h, --help              Show this help
      `);
      process.exit(0);
    }

    const options: GenerateOptions = {
      file: values.file as string | undefined,
      crawl: values.crawl as boolean,
      depth: values.depth ? parseInt(values.depth as string) : undefined,
      maxUrls: parseInt(values["max-urls"] as string),
      priority: parseFloat(values.priority as string),
      changefreq: values.changefreq as ChangeFrequency,
      lastmod: values.lastmod as string | undefined,
      output: values.output as string | undefined,
      index: values.index as boolean,
      compress: values.compress as boolean,
      pretty: values.pretty as boolean,
      exclude: values.exclude as string[] | undefined,
      include: values.include as string[] | undefined,
      followExternal: values["follow-external"] as boolean,
      timeout: parseInt(values.timeout as string),
      userAgent: values["user-agent"] as string | undefined,
    };

    await generateSitemap(positionals, options);

  } catch (error) {
    console.error("\n❌ Error:", (error as Error).message);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

export { generateSitemap, WebCrawler, generateSitemapXML, generateSitemapIndexXML };
