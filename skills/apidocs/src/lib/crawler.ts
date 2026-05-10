/**
 * Web crawler for documentation sites
 *
 * Two-phase approach:
 * 1. Discovery: Aggressively crawl ALL pages within the domain
 * 2. Extraction: Extract and convert content from each page
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CrawledPage, CrawlConfig, CrawlEvent, CrawlResult } from '../types/index.js';
import { htmlToMarkdown } from './html-to-md.js';

/**
 * Normalize URL for deduplication
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash, hash, and common tracking params
    let normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
    // Keep meaningful query params (like ?tab=, ?section=) but remove tracking
    const dominated = ['utm_', 'ref', 'source', 'fbclid', 'gclid'];
    const params = new URLSearchParams(parsed.search);
    const cleanParams = new URLSearchParams();
    for (const [key, value] of params) {
      if (!dominated.some((d) => key.startsWith(d))) {
        cleanParams.set(key, value);
      }
    }
    const search = cleanParams.toString();
    if (search) {
      normalized += `?${search}`;
    }
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Check if URL should be skipped entirely (non-content URLs)
 */
function shouldSkipUrl(url: string): boolean {
  const skipPatterns = [
    // Static assets
    /\.(png|jpg|jpeg|gif|svg|ico|webp|pdf|zip|tar|gz|mp4|mp3|wav|woff|woff2|ttf|eot)$/i,
    /\.(css|js|mjs|jsx|ts|tsx)$/i,
    /\.(json|xml|yaml|yml)$/i,
    /\/assets\//i,
    /\/_next\//i,
    /\/static\//i,
    /\/chunks\//i,
    // Protocol handlers
    /^mailto:/i,
    /^tel:/i,
    /^javascript:/i,
    /^#/,
    // Feeds
    /\/feed\/?$/i,
    /\/rss\/?$/i,
    /\/atom\/?$/i,
    // Auth/account
    /\/(login|logout|signin|signout|signup|register|auth)\/?/i,
    /\/(account|profile|settings|dashboard)\/?$/i,
    // E-commerce
    /\/(cart|checkout|payment|order)\/?/i,
    // Search
    /\/search\?/i,
    /\/search\/?$/i,
  ];

  return skipPatterns.some((pattern) => pattern.test(url));
}

/**
 * Check if URL is likely a documentation page (loose check)
 */
function isLikelyDocPage(url: string): boolean {
  // Skip obvious non-doc pages
  const nonDocPatterns = [
    /\/blog\//i,
    /\/news\//i,
    /\/press\//i,
    /\/careers\//i,
    /\/jobs\//i,
    /\/about-us\/?$/i,
    /\/contact-us\/?$/i,
    /\/terms\/?$/i,
    /\/privacy\/?$/i,
    /\/legal\/?$/i,
    /\/cookie/i,
    /\/pricing\/?$/i,
    /\/enterprise\/?$/i,
    /\/customers\/?$/i,
    /\/case-studies\//i,
    /\/testimonials\//i,
  ];

  if (nonDocPatterns.some((p) => p.test(url))) {
    return false;
  }

  return true;
}

/**
 * Extract all links from HTML
 */
function extractLinks(html: string, baseUrl: string, baseDomain: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  // Match href attributes
  const hrefPattern = /href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefPattern.exec(html)) !== null) {
    let href = match[1];

    // Skip empty, anchors, javascript
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      continue;
    }

    // Resolve relative URLs
    try {
      const resolved = new URL(href, baseUrl);

      // Only follow same domain
      if (!resolved.hostname.endsWith(baseDomain) && resolved.hostname !== baseDomain) {
        continue;
      }

      const normalized = normalizeUrl(resolved.href);

      // Skip if already seen or should be skipped
      if (seen.has(normalized) || shouldSkipUrl(normalized)) {
        continue;
      }

      seen.add(normalized);
      links.push(resolved.href);
    } catch {
      // Invalid URL, skip
    }
  }

  return links;
}

/**
 * Fetch a URL and return HTML content
 */
async function fetchPage(url: string): Promise<{ html: string; finalUrl: string; title: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error(`Not HTML: ${contentType}`);
  }

  const html = await response.text();
  const finalUrl = response.url;

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  return { html, finalUrl, title };
}

/**
 * Extract main content from HTML
 */
function extractContent(html: string): string {
  // Try to find main content area
  const contentSelectors = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*(?:content|docs|documentation|markdown|prose)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="(?:content|main|docs)"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*role="main"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of contentSelectors) {
    const match = html.match(pattern);
    if (match && match[1] && match[1].length > 500) {
      return match[1];
    }
  }

  // Fall back to body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    // Remove obvious non-content elements
    let content = bodyMatch[1];
    content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    content = content.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');
    content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    content = content.replace(/<!--[\s\S]*?-->/g, '');
    return content;
  }

  return html;
}

/**
 * Check if content looks like documentation (has code, API references, etc.)
 */
function hasDocumentationContent(html: string): boolean {
  const docIndicators = [
    /<pre[^>]*>/i,
    /<code[^>]*>/i,
    /```/,
    /class="[^"]*(?:highlight|syntax|code)[^"]*"/i,
    /api/i,
    /endpoint/i,
    /parameter/i,
    /request/i,
    /response/i,
    /example/i,
    /usage/i,
    /installation/i,
    /getting.?started/i,
    /quickstart/i,
    /tutorial/i,
    /guide/i,
    /reference/i,
    /documentation/i,
  ];

  const matchCount = docIndicators.filter((p) => p.test(html)).length;
  return matchCount >= 2; // At least 2 indicators
}

/**
 * Main crawler function
 */
export async function crawlDocumentation(
  config: CrawlConfig,
  onEvent: (event: CrawlEvent) => void = () => {}
): Promise<CrawlResult> {
  const startTime = Date.now();

  // Parse base domain
  const startUrlParsed = new URL(config.startUrl);
  const baseDomain = startUrlParsed.hostname.replace(/^www\./, '');

  // State
  const visited = new Set<string>();
  const toVisit: string[] = [config.startUrl];
  const pages: CrawledPage[] = [];
  const errors: string[] = [];
  const contentHashes = new Set<string>(); // For deduplication

  onEvent({ type: 'navigating', url: config.startUrl });

  // Phase 1 & 2 combined: Crawl and extract in one pass
  while (toVisit.length > 0 && pages.length < config.maxPages) {
    const url = toVisit.shift()!;
    const normalizedUrl = normalizeUrl(url);

    // Skip if already visited
    if (visited.has(normalizedUrl)) {
      continue;
    }
    visited.add(normalizedUrl);

    // Skip non-doc URLs
    if (!isLikelyDocPage(url)) {
      onEvent({ type: 'skipped', url, reason: 'non-documentation URL pattern' });
      continue;
    }

    try {
      onEvent({ type: 'navigating', url });

      const { html, finalUrl, title } = await fetchPage(url);

      // Also mark final URL as visited (in case of redirects)
      visited.add(normalizeUrl(finalUrl));

      // Extract links for discovery (do this for ALL pages)
      const links = extractLinks(html, finalUrl, baseDomain);
      for (const link of links) {
        const normalizedLink = normalizeUrl(link);
        if (!visited.has(normalizedLink)) {
          toVisit.push(link);
        }
      }

      // Check if page has documentation content
      if (!hasDocumentationContent(html)) {
        onEvent({ type: 'skipped', url: finalUrl, reason: 'no documentation content detected' });
        continue;
      }

      // Extract main content
      const mainContent = extractContent(html);

      // Convert to markdown
      const markdown = htmlToMarkdown(mainContent);

      // Skip if markdown is too short (likely not useful)
      if (markdown.length < 100) {
        onEvent({ type: 'skipped', url: finalUrl, reason: 'content too short' });
        continue;
      }

      // Deduplicate by content hash (first 500 chars)
      const contentHash = markdown.substring(0, 500);
      if (contentHashes.has(contentHash)) {
        onEvent({ type: 'skipped', url: finalUrl, reason: 'duplicate content' });
        continue;
      }
      contentHashes.add(contentHash);

      // Parse path from URL
      const urlObj = new URL(finalUrl);
      const path = urlObj.pathname;

      // Save page
      const page: CrawledPage = {
        url: finalUrl,
        path,
        title: title || path,
        content: markdown,
        html: mainContent,
        crawledAt: new Date().toISOString(),
      };

      pages.push(page);
      onEvent({
        type: 'extracted',
        url: finalUrl,
        title: title || path,
        pageCount: pages.length,
        totalPages: config.maxPages,
      });

      // Small delay to be polite
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      const errorMsg = (error as Error).message;
      errors.push(`${url}: ${errorMsg}`);
      onEvent({ type: 'error', url, error: errorMsg });
    }
  }

  onEvent({ type: 'complete', pageCount: pages.length });

  return {
    pages,
    totalPages: pages.length,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Alias for backwards compatibility
 */
export const crawlSimple = crawlDocumentation;

/**
 * Use Claude to clean up and enhance extracted content
 * Call this after crawling to improve content quality
 */
export async function enhanceContentWithAgent(
  pages: CrawledPage[],
  onEvent: (event: CrawlEvent) => void = () => {}
): Promise<CrawledPage[]> {
  const client = new Anthropic();
  const enhanced: CrawledPage[] = [];

  for (const page of pages) {
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: `Clean up this documentation content. Remove navigation elements, ads, cookie notices, and other non-documentation content. Keep all code examples, API references, and explanatory text. Output clean markdown only, no explanation.

Title: ${page.title}
URL: ${page.url}

Content:
${page.content}`,
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        enhanced.push({
          ...page,
          content: textBlock.text,
        });
      } else {
        enhanced.push(page);
      }
    } catch (error) {
      // Keep original on error
      enhanced.push(page);
      onEvent({ type: 'error', url: page.url, error: (error as Error).message });
    }
  }

  return enhanced;
}
