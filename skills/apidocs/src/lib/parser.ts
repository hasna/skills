import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import { visit } from 'unist-util-visit';
import type { Root, Heading, Code, Text, Paragraph } from 'mdast';
import type { Chunk } from '../types/index.js';
import { createHash } from 'crypto';

const MAX_CHUNK_TOKENS = 500;
const CHARS_PER_TOKEN = 4; // Rough estimate

/**
 * Create a unique chunk ID
 */
function createChunkId(filePath: string, index: number, content: string): string {
  const hash = createHash('md5').update(`${filePath}:${index}:${content}`).digest('hex').slice(0, 8);
  return `${filePath.replace(/[\/\.]/g, '-')}-${index}-${hash}`;
}

/**
 * Estimate token count for text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Extract text content from AST node
 */
function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  const n = node as Record<string, unknown>;

  if (n.type === 'text' && typeof n.value === 'string') {
    return n.value;
  }

  if (n.type === 'code' && typeof n.value === 'string') {
    return n.value;
  }

  if (Array.isArray(n.children)) {
    return n.children.map((child) => extractText(child)).join('');
  }

  return '';
}

/**
 * Get heading text
 */
function getHeadingText(node: Heading): string {
  return extractText(node);
}

/**
 * Parse markdown content into chunks
 */
export function parseMarkdown(content: string, filePath: string): Chunk[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMdx);

  let ast: Root;
  try {
    ast = processor.parse(content);
  } catch {
    // If MDX parsing fails, try plain markdown
    ast = unified().use(remarkParse).use(remarkGfm).parse(content);
  }

  return chunkByHeadings(ast, filePath, MAX_CHUNK_TOKENS);
}

/**
 * Chunk content by headings
 */
function chunkByHeadings(ast: Root, filePath: string, maxTokens: number): Chunk[] {
  const chunks: Chunk[] = [];
  const headingStack: { level: number; text: string }[] = [];

  let currentContent: string[] = [];
  let currentTitle = '';
  let chunkIndex = 0;

  // Get title from first heading or filename
  let documentTitle = filePath.split('/').pop()?.replace(/\.(md|mdx)$/, '') || 'Document';

  function flushChunk(type: 'text' | 'code' = 'text', codeLanguage?: string): void {
    const content = currentContent.join('\n\n').trim();
    if (!content) return;

    const tokens = estimateTokens(content);

    // If chunk is too large, split it
    if (tokens > maxTokens) {
      const subChunks = splitLargeChunk(content, maxTokens);
      for (const subContent of subChunks) {
        chunks.push({
          id: createChunkId(filePath, chunkIndex, subContent),
          content: subContent,
          title: currentTitle || documentTitle,
          type,
          filePath,
          headingHierarchy: headingStack.map((h) => h.text),
          codeLanguage,
          tokenCount: estimateTokens(subContent),
        });
        chunkIndex++;
      }
    } else {
      chunks.push({
        id: createChunkId(filePath, chunkIndex, content),
        content,
        title: currentTitle || documentTitle,
        type,
        filePath,
        headingHierarchy: headingStack.map((h) => h.text),
        codeLanguage,
        tokenCount: tokens,
      });
      chunkIndex++;
    }

    currentContent = [];
  }

  visit(ast, (node) => {
    if (node.type === 'heading') {
      const heading = node as Heading;
      const text = getHeadingText(heading);

      // Set document title from first h1
      if (heading.depth === 1 && !documentTitle) {
        documentTitle = text;
      }

      // Flush previous content
      if (currentContent.length > 0) {
        flushChunk();
      }

      // Update heading stack
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= heading.depth) {
        headingStack.pop();
      }
      headingStack.push({ level: heading.depth, text });
      currentTitle = text;

      // Add heading to content
      currentContent.push('#'.repeat(heading.depth) + ' ' + text);
    } else if (node.type === 'code') {
      const code = node as Code;
      // Flush any previous text content
      if (currentContent.length > 0) {
        flushChunk();
      }

      // Create separate chunk for code
      const codeContent = code.lang ? `\`\`\`${code.lang}\n${code.value}\n\`\`\`` : `\`\`\`\n${code.value}\n\`\`\``;

      currentContent.push(codeContent);
      flushChunk('code', code.lang || undefined);
    } else if (node.type === 'paragraph') {
      const text = extractText(node);
      if (text.trim()) {
        currentContent.push(text);
      }
    } else if (node.type === 'list') {
      const text = stringifyList(node);
      if (text.trim()) {
        currentContent.push(text);
      }
    } else if (node.type === 'blockquote') {
      const text = '> ' + extractText(node).split('\n').join('\n> ');
      if (text.trim()) {
        currentContent.push(text);
      }
    } else if (node.type === 'table') {
      const text = stringifyTable(node);
      if (text.trim()) {
        currentContent.push(text);
      }
    }
  });

  // Flush remaining content
  if (currentContent.length > 0) {
    flushChunk();
  }

  return chunks;
}

/**
 * Split a large chunk into smaller pieces
 */
function splitLargeChunk(content: string, maxTokens: number): string[] {
  const chunks: string[] = [];
  const lines = content.split('\n');
  let current: string[] = [];
  let currentTokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);

    if (currentTokens + lineTokens > maxTokens && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [];
      currentTokens = 0;
    }

    current.push(line);
    currentTokens += lineTokens;
  }

  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }

  return chunks;
}

/**
 * Stringify list node
 */
function stringifyList(node: unknown): string {
  const n = node as Record<string, unknown>;
  if (!Array.isArray(n.children)) return '';

  const ordered = n.ordered === true;
  return n.children
    .map((item, i) => {
      const prefix = ordered ? `${i + 1}. ` : '- ';
      const text = extractText(item);
      return prefix + text;
    })
    .join('\n');
}

/**
 * Stringify table node
 */
function stringifyTable(node: unknown): string {
  const n = node as Record<string, unknown>;
  if (!Array.isArray(n.children)) return '';

  const rows = n.children.map((row) => {
    const r = row as Record<string, unknown>;
    if (!Array.isArray(r.children)) return '';
    return '| ' + r.children.map((cell) => extractText(cell)).join(' | ') + ' |';
  });

  if (rows.length > 0) {
    // Add header separator after first row
    const headerCells = (n.children[0] as Record<string, unknown>).children as unknown[];
    const separator = '| ' + headerCells.map(() => '---').join(' | ') + ' |';
    rows.splice(1, 0, separator);
  }

  return rows.join('\n');
}

/**
 * Extract all code blocks from content
 */
export function extractCodeBlocks(
  content: string,
  filePath: string
): { content: string; language: string; filePath: string }[] {
  const blocks: { content: string; language: string; filePath: string }[] = [];

  const processor = unified().use(remarkParse).use(remarkGfm);
  const ast = processor.parse(content);

  visit(ast, 'code', (node: Code) => {
    blocks.push({
      content: node.value,
      language: node.lang || '',
      filePath,
    });
  });

  return blocks;
}
