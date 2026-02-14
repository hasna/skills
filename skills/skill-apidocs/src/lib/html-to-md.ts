import TurndownService from 'turndown';

/**
 * HTML to Markdown converter using Turndown
 */

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});

// Preserve code blocks with language
turndownService.addRule('fencedCodeBlock', {
  filter: (node) => {
    return (
      node.nodeName === 'PRE' &&
      node.firstChild !== null &&
      node.firstChild.nodeName === 'CODE'
    );
  },
  replacement: (_content, node) => {
    const codeNode = node.firstChild;
    const code = codeNode?.textContent || '';

    // Try to extract language from class using getAttribute if available
    const getAttr = (codeNode as { getAttribute?: (name: string) => string | null })?.getAttribute;
    const className = getAttr ? getAttr.call(codeNode, 'class') || '' : '';
    const langMatch = className.match(/language-(\w+)/);
    const language = langMatch ? langMatch[1] : '';

    return `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
  },
});

// Handle inline code
turndownService.addRule('inlineCode', {
  filter: (node) => {
    return node.nodeName === 'CODE' && node.parentNode?.nodeName !== 'PRE';
  },
  replacement: (content) => {
    if (content.includes('`')) {
      return `\`\`${content}\`\``;
    }
    return `\`${content}\``;
  },
});

// Remove navigation elements
turndownService.addRule('removeNav', {
  filter: (node) => {
    const tagName = node.nodeName.toLowerCase();
    return ['nav', 'header', 'footer', 'aside'].includes(tagName);
  },
  replacement: () => '',
});

// Remove scripts and styles
turndownService.addRule('removeScripts', {
  filter: ['script', 'style', 'noscript'],
  replacement: () => '',
});

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  // Pre-process: remove common non-content elements
  let cleaned = html
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove common cookie/banner divs
    .replace(/<div[^>]*class="[^"]*(?:cookie|banner|popup|modal|overlay)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    // Remove aria-hidden elements
    .replace(/<[^>]+aria-hidden="true"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  const markdown = turndownService.turndown(cleaned);

  // Post-process: clean up markdown
  return markdown
    // Remove excessive newlines
    .replace(/\n{4,}/g, '\n\n\n')
    // Remove trailing whitespace
    .replace(/[ \t]+$/gm, '')
    // Ensure file ends with single newline
    .trim() + '\n';
}

/**
 * Extract main content from HTML using common selectors
 */
export function extractMainContent(html: string): string {
  // Common documentation content selectors
  const contentSelectors = [
    'main article',
    'main .content',
    '[role="main"]',
    '.documentation',
    '.docs-content',
    '.markdown-body',
    '.prose',
    'article.content',
    'article',
    'main',
    '#content',
    '.content',
  ];

  // Try to match content area with simple regex patterns
  for (const selector of contentSelectors) {
    // Convert selector to basic regex pattern
    const pattern = selectorToPattern(selector);
    if (pattern) {
      const match = html.match(pattern);
      if (match) {
        return match[0];
      }
    }
  }

  // Fall back to body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

/**
 * Convert CSS selector to regex pattern (simplified)
 */
function selectorToPattern(selector: string): RegExp | null {
  // Handle class selectors
  if (selector.startsWith('.')) {
    const className = selector.slice(1).replace('.', '\\s+');
    return new RegExp(`<[^>]+class="[^"]*${className}[^"]*"[^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }

  // Handle ID selectors
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    return new RegExp(`<[^>]+id="${id}"[^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
  }

  // Handle attribute selectors
  if (selector.includes('[')) {
    const attrMatch = selector.match(/\[([^=]+)="([^"]+)"\]/);
    if (attrMatch) {
      return new RegExp(`<[^>]+${attrMatch[1]}="${attrMatch[2]}"[^>]*>[\\s\\S]*?<\\/[^>]+>`, 'i');
    }
  }

  // Handle tag selectors
  const tagMatch = selector.match(/^(\w+)(?:\s+\.(\w+))?$/);
  if (tagMatch) {
    const tag = tagMatch[1];
    const className = tagMatch[2];
    if (className) {
      return new RegExp(`<${tag}[^>]+class="[^"]*${className}[^"]*"[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
    }
    return new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'i');
  }

  return null;
}
