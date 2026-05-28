/**
 * Agentic docs URL discovery using Claude and Playwright MCP
 *
 * When a user provides a base URL (e.g., stripe.com), this agent
 * navigates the site to find the API documentation section.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { DiscoveryEvent, DiscoveryResult } from '../types/index.js';

const DISCOVERY_SYSTEM_PROMPT = `You are a documentation discovery agent. Your task is to find the API documentation section of a website.

STRATEGY:
1. First, analyze the current page for links to documentation
2. Look for links containing: docs, documentation, api, reference, developer, api-reference
3. Prioritize links that seem to be API references over general documentation
4. If you find an API documentation landing page, report it

IMPORTANT:
- Use browser_snapshot to see the current page content
- Use browser_click to click on promising links
- Look for navigation menus, footer links, and header links
- Common patterns: /docs, /api, /api-reference, /developers, /documentation

When you find the API documentation, respond with:
FOUND: <url>

If you cannot find API documentation after reasonable exploration, respond with:
NOT_FOUND: <reason>`;

/**
 * Check if a URL looks like it's already a documentation URL
 */
export function isLikelyDocsUrl(url: string): boolean {
  const docsPatterns = [
    /\/docs\/?/i,
    /\/documentation\/?/i,
    /\/api-reference\/?/i,
    /\/api\/?$/i,
    /\/api\/v\d/i,
    /\/reference\/?/i,
    /\/developers?\/?/i,
    /docs\./i,
    /developers?\./i,
    /api\./i,
  ];

  return docsPatterns.some((pattern) => pattern.test(url));
}

/**
 * Discover the documentation URL from a base website URL
 *
 * This agent uses Claude with Playwright MCP to navigate a website
 * and find the API documentation section.
 */
export async function discoverDocsUrl(
  baseUrl: string,
  onEvent: (event: DiscoveryEvent) => void = () => {}
): Promise<DiscoveryResult> {
  // If URL already looks like docs, return it directly
  if (isLikelyDocsUrl(baseUrl)) {
    onEvent({ type: 'found', docsUrl: baseUrl, message: 'URL already appears to be documentation' });
    return { success: true, docsUrl: baseUrl };
  }

  const client = new Anthropic();

  onEvent({ type: 'navigating', url: baseUrl, message: 'Starting documentation discovery' });

  try {
    // First, let's try common documentation URL patterns
    const commonDocsPatterns = ['/docs', '/api', '/api-reference', '/documentation', '/developers', '/reference'];

    const parsedUrl = new URL(baseUrl);
    const baseOrigin = parsedUrl.origin;

    // Try common patterns first (quick check)
    for (const pattern of commonDocsPatterns) {
      const testUrl = `${baseOrigin}${pattern}`;
      try {
        const response = await fetch(testUrl, {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (response.ok) {
          onEvent({ type: 'found', docsUrl: testUrl, message: `Found docs at common pattern: ${pattern}` });
          return { success: true, docsUrl: testUrl };
        }
      } catch {
        // Pattern doesn't exist, continue
      }
    }

    // Also check for subdomains
    const domain = parsedUrl.hostname.replace(/^www\./, '');
    const commonSubdomains = ['docs', 'api', 'developers', 'developer'];

    for (const subdomain of commonSubdomains) {
      const testUrl = `${parsedUrl.protocol}//${subdomain}.${domain}`;
      try {
        const response = await fetch(testUrl, {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (response.ok) {
          onEvent({ type: 'found', docsUrl: testUrl, message: `Found docs at subdomain: ${subdomain}` });
          return { success: true, docsUrl: testUrl };
        }
      } catch {
        // Subdomain doesn't exist, continue
      }
    }

    onEvent({ type: 'analyzing', url: baseUrl, message: 'Checking page content for documentation links' });

    // If common patterns fail, fetch the page and analyze links
    const pageResponse = await fetch(baseUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!pageResponse.ok) {
      return { success: false, error: `Failed to fetch base URL: ${pageResponse.status}` };
    }

    const html = await pageResponse.text();

    // Use Claude to analyze the page and find docs links
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Analyze this HTML page and find the URL to API documentation.

Look for:
1. Links with text containing: "API", "Docs", "Documentation", "Reference", "Developers"
2. Navigation links pointing to documentation sections
3. Footer links to developer resources

URL: ${baseUrl}

HTML (truncated to key sections):
${extractRelevantHtml(html)}

Respond in this exact format:
If found: DOCS_URL: <the full URL>
If not found: NOT_FOUND: <brief reason>`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const text = textBlock.text;

      if (text.includes('DOCS_URL:')) {
        const match = text.match(/DOCS_URL:\s*(\S+)/);
        if (match) {
          let docsUrl = match[1].trim();

          // Resolve relative URLs
          if (docsUrl.startsWith('/')) {
            docsUrl = `${baseOrigin}${docsUrl}`;
          } else if (!docsUrl.startsWith('http')) {
            docsUrl = `${baseOrigin}/${docsUrl}`;
          }

          onEvent({ type: 'found', docsUrl, message: 'Found documentation URL via page analysis' });
          return { success: true, docsUrl };
        }
      }

      if (text.includes('NOT_FOUND:')) {
        const reason = text.split('NOT_FOUND:')[1]?.trim() || 'Could not find documentation links';
        onEvent({ type: 'not_found', message: reason });
        return { success: false, error: reason };
      }
    }

    // Fallback: just use the base URL
    onEvent({ type: 'not_found', message: 'Could not find specific documentation URL, using base URL' });
    return { success: true, docsUrl: baseUrl };
  } catch (error) {
    const errorMsg = (error as Error).message;
    onEvent({ type: 'error', error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Extract relevant HTML sections for analysis (nav, header, footer, main links)
 */
function extractRelevantHtml(html: string): string {
  const sections: string[] = [];

  // Extract nav content
  const navMatch = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/gi);
  if (navMatch) {
    sections.push('=== Navigation ===');
    sections.push(navMatch.slice(0, 3).join('\n').substring(0, 3000));
  }

  // Extract header content
  const headerMatch = html.match(/<header[^>]*>([\s\S]*?)<\/header>/gi);
  if (headerMatch) {
    sections.push('=== Header ===');
    sections.push(headerMatch.slice(0, 2).join('\n').substring(0, 2000));
  }

  // Extract footer content
  const footerMatch = html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/gi);
  if (footerMatch) {
    sections.push('=== Footer ===');
    sections.push(footerMatch.slice(0, 2).join('\n').substring(0, 2000));
  }

  // Extract links with relevant text
  const linkPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*(?:doc|api|reference|developer)[^<]*)<\/a>/gi;
  const links: string[] = [];
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    links.push(`<a href="${match[1]}">${match[2]}</a>`);
  }
  if (links.length > 0) {
    sections.push('=== Relevant Links ===');
    sections.push(links.slice(0, 20).join('\n'));
  }

  return sections.join('\n\n').substring(0, 10000);
}
