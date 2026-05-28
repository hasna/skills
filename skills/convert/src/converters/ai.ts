/**
 * AI-powered conversion utilities
 * Uses Claude/GPT-4o for OCR, extraction, and intelligent conversions
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { readFile, writeFile, stat } from 'fs/promises';
import { extname, basename, dirname, join } from 'path';
import type { AIModel, ConvertOptions, ConvertResult } from '../types';
import { MAX_SINGLE_PASS_SIZE, DEFAULT_CHUNK_SIZE } from '../types';
import { extractPdfText, splitPdfIntoChunks, getPdfPageCount } from './pdf';

// Initialize clients lazily
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

/**
 * Convert image to markdown using AI vision
 */
export async function imageToMarkdownAI(
  imagePath: string,
  model: AIModel = 'claude',
  clean: boolean = false
): Promise<string> {
  const imageBuffer = await readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = extname(imagePath).slice(1).toLowerCase();
  const mediaType = ext === 'png' ? 'image/png' :
                    ext === 'gif' ? 'image/gif' :
                    ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const cleanPrompt = clean
    ? ' Clean up and format the content properly, fixing any OCR errors or formatting issues.'
    : '';

  if (model === 'claude') {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `Extract all text and content from this image and convert it to well-formatted Markdown.${cleanPrompt} Preserve the structure, headings, lists, tables, and any other formatting visible in the image. Return only the Markdown content, no explanations.`,
            },
          ],
        },
      ],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    return textContent ? textContent.text : '';
  } else {
    // OpenAI GPT-4o
    const response = await getOpenAIClient().chat.completions.create({
      model: model === 'gpt-4o-mini' ? 'gpt-4o-mini' : 'gpt-4o',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaType};base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: `Extract all text and content from this image and convert it to well-formatted Markdown.${cleanPrompt} Preserve the structure, headings, lists, tables, and any other formatting visible in the image. Return only the Markdown content, no explanations.`,
            },
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content || '';
  }
}

/**
 * Convert image to JSON (structured data extraction) using AI
 */
export async function imageToJsonAI(
  imagePath: string,
  model: AIModel = 'claude'
): Promise<string> {
  const imageBuffer = await readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = extname(imagePath).slice(1).toLowerCase();
  const mediaType = ext === 'png' ? 'image/png' :
                    ext === 'gif' ? 'image/gif' :
                    ext === 'webp' ? 'image/webp' : 'image/jpeg';

  if (model === 'claude') {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: 'Extract all structured data from this image and return it as a well-organized JSON object. Include any tables, lists, key-value pairs, or structured information visible in the image. Return only valid JSON, no explanations.',
            },
          ],
        },
      ],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    return textContent ? textContent.text : '{}';
  } else {
    const response = await getOpenAIClient().chat.completions.create({
      model: model === 'gpt-4o-mini' ? 'gpt-4o-mini' : 'gpt-4o',
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaType};base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: 'Extract all structured data from this image and return it as a well-organized JSON object. Include any tables, lists, key-value pairs, or structured information visible in the image.',
            },
          ],
        },
      ],
    });

    return response.choices[0]?.message?.content || '{}';
  }
}

/**
 * Convert PDF to Markdown using AI (with chunking for large files)
 */
export async function pdfToMarkdownAI(
  pdfPath: string,
  model: AIModel = 'claude',
  clean: boolean = false,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ content: string; chunksProcessed: number }> {
  const fileStat = await stat(pdfPath);
  const pageCount = await getPdfPageCount(pdfPath);

  const cleanPrompt = clean
    ? ' Clean up and format the content properly, fixing any OCR errors, formatting issues, or extraction artifacts. Remove page numbers, headers/footers if they repeat, and organize the content logically.'
    : '';

  // For small files, process directly
  if (fileStat.size <= MAX_SINGLE_PASS_SIZE) {
    const text = await extractPdfText(pdfPath);

    if (model === 'claude') {
      const response = await getAnthropicClient().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: `Convert the following PDF text content to well-formatted Markdown.${cleanPrompt} Preserve the structure including headings, lists, tables, and paragraphs.\n\n${text}`,
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      return { content: textContent?.text || '', chunksProcessed: 1 };
    } else {
      const response = await getOpenAIClient().chat.completions.create({
        model: model === 'gpt-4o-mini' ? 'gpt-4o-mini' : 'gpt-4o',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: `Convert the following PDF text content to well-formatted Markdown.${cleanPrompt} Preserve the structure including headings, lists, tables, and paragraphs.\n\n${text}`,
          },
        ],
      });

      return { content: response.choices[0]?.message?.content || '', chunksProcessed: 1 };
    }
  }

  // For large files, split into chunks
  const pagesPerChunk = Math.ceil(chunkSize / (fileStat.size / pageCount));
  const chunks = await splitPdfIntoChunks(pdfPath, pagesPerChunk);
  const results: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    // Extract text from chunk
    const pdfParse = await import('pdf-parse');
    const data = await pdfParse.default(chunks[i]);
    const text = data.text;

    const chunkPrompt = `Convert the following PDF text content (part ${i + 1} of ${chunks.length}) to well-formatted Markdown.${cleanPrompt} Preserve the structure including headings, lists, tables, and paragraphs.\n\n${text}`;

    if (model === 'claude') {
      const response = await getAnthropicClient().messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: chunkPrompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      results.push(textContent?.text || '');
    } else {
      const response = await getOpenAIClient().chat.completions.create({
        model: model === 'gpt-4o-mini' ? 'gpt-4o-mini' : 'gpt-4o',
        max_tokens: 8192,
        messages: [{ role: 'user', content: chunkPrompt }],
      });

      results.push(response.choices[0]?.message?.content || '');
    }
  }

  return { content: results.join('\n\n---\n\n'), chunksProcessed: chunks.length };
}

/**
 * Clean/sanitize text content using AI
 */
export async function cleanTextAI(
  text: string,
  model: AIModel = 'claude'
): Promise<string> {
  if (model === 'claude') {
    const response = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `Clean and sanitize the following text. Fix any typos, formatting issues, and improve readability while preserving the original meaning and structure. Return only the cleaned text.\n\n${text}`,
        },
      ],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    return textContent?.text || text;
  } else {
    const response = await getOpenAIClient().chat.completions.create({
      model: model === 'gpt-4o-mini' ? 'gpt-4o-mini' : 'gpt-4o',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `Clean and sanitize the following text. Fix any typos, formatting issues, and improve readability while preserving the original meaning and structure. Return only the cleaned text.\n\n${text}`,
        },
      ],
    });

    return response.choices[0]?.message?.content || text;
  }
}

/**
 * AI-powered conversion
 */
export async function convertWithAI(options: ConvertOptions): Promise<ConvertResult> {
  const startTime = Date.now();
  const inputStat = await stat(options.input);
  const inputExt = extname(options.input).slice(1).toLowerCase();
  const model = options.model || 'claude';

  const outputPath = options.output || join(
    dirname(options.input),
    `${basename(options.input, extname(options.input))}.${options.format}`
  );

  try {
    let content: string;
    let chunksProcessed = 1;

    // Image to Markdown/Text
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'bmp'].includes(inputExt)) {
      if (options.format === 'json') {
        content = await imageToJsonAI(options.input, model);
      } else {
        content = await imageToMarkdownAI(options.input, model, options.clean);
      }
    }
    // PDF to Markdown
    else if (inputExt === 'pdf' && (options.format === 'md' || options.format === 'markdown')) {
      const result = await pdfToMarkdownAI(
        options.input,
        model,
        options.clean,
        options.chunkSize
      );
      content = result.content;
      chunksProcessed = result.chunksProcessed;
    }
    // Document to Markdown with cleaning
    else if (['docx', 'doc'].includes(inputExt) && options.clean) {
      const mammoth = await import('mammoth');
      const buffer = await readFile(options.input);
      const result = await mammoth.extractRawText({ buffer });
      content = await cleanTextAI(result.value, model);
    }
    else {
      throw new Error(`AI conversion not supported for ${inputExt} to ${options.format}`);
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
      chunksProcessed,
      aiProcessed: true,
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
      aiProcessed: true,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}
