/**
 * Document conversion utilities (DOCX, HTML, Markdown)
 */

import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { marked } from 'marked';
import { htmlToText } from 'html-to-text';
import { readFile, writeFile, stat } from 'fs/promises';
import { extname, basename, dirname, join } from 'path';
import type { ConvertOptions, ConvertResult } from '../types';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

/**
 * Convert DOCX to HTML
 */
export async function docxToHtml(docxPath: string): Promise<string> {
  const buffer = await readFile(docxPath);
  const result = await mammoth.convertToHtml({ buffer });
  return result.value;
}

/**
 * Convert DOCX to plain text
 */
export async function docxToText(docxPath: string): Promise<string> {
  const buffer = await readFile(docxPath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Convert DOCX to Markdown
 */
export async function docxToMarkdown(docxPath: string): Promise<string> {
  const html = await docxToHtml(docxPath);
  return turndownService.turndown(html);
}

/**
 * Convert HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}

/**
 * Convert Markdown to HTML
 */
export async function markdownToHtml(markdown: string): Promise<string> {
  return await marked(markdown);
}

/**
 * Convert HTML to plain text
 */
export function htmlToPlainText(html: string): string {
  return htmlToText(html, {
    wordwrap: 80,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  });
}

/**
 * Convert document to another format
 */
export async function convertDocument(options: ConvertOptions): Promise<ConvertResult> {
  const startTime = Date.now();
  const inputStat = await stat(options.input);
  const inputExt = extname(options.input).slice(1).toLowerCase();

  const outputPath = options.output || join(
    dirname(options.input),
    `${basename(options.input, extname(options.input))}.${options.format}`
  );

  try {
    let content: string;

    // Convert based on input format
    if (inputExt === 'docx' || inputExt === 'doc') {
      switch (options.format) {
        case 'html':
        case 'htm':
          content = await docxToHtml(options.input);
          break;
        case 'md':
        case 'markdown':
          content = await docxToMarkdown(options.input);
          break;
        case 'txt':
          content = await docxToText(options.input);
          break;
        default:
          throw new Error(`Cannot convert DOCX to ${options.format}`);
      }
    } else if (inputExt === 'html' || inputExt === 'htm') {
      const html = await readFile(options.input, 'utf-8');
      switch (options.format) {
        case 'md':
        case 'markdown':
          content = htmlToMarkdown(html);
          break;
        case 'txt':
          content = htmlToPlainText(html);
          break;
        default:
          throw new Error(`Cannot convert HTML to ${options.format}`);
      }
    } else if (inputExt === 'md' || inputExt === 'markdown') {
      const markdown = await readFile(options.input, 'utf-8');
      switch (options.format) {
        case 'html':
        case 'htm':
          content = await markdownToHtml(markdown);
          break;
        case 'txt':
          // Strip markdown formatting
          content = markdown
            .replace(/#{1,6}\s/g, '')
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/`/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
          break;
        default:
          throw new Error(`Cannot convert Markdown to ${options.format}`);
      }
    } else if (inputExt === 'txt') {
      const text = await readFile(options.input, 'utf-8');
      switch (options.format) {
        case 'md':
        case 'markdown':
          // Wrap plain text in markdown (basic formatting)
          content = text;
          break;
        case 'html':
        case 'htm':
          // Wrap in basic HTML
          content = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<pre>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;
          break;
        default:
          throw new Error(`Cannot convert TXT to ${options.format}`);
      }
    } else {
      throw new Error(`Unsupported input format: ${inputExt}`);
    }

    await writeFile(outputPath, content);
    const outputStat = await stat(outputPath);

    return {
      success: true,
      input: options.input,
      output: outputPath,
      inputFormat: inputExt,
      outputFormat: options.format,
      inputSize: inputStat.size,
      outputSize: outputStat.size,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      input: options.input,
      output: outputPath,
      inputFormat: inputExt,
      outputFormat: options.format,
      inputSize: inputStat.size,
      outputSize: 0,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}
