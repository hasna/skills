/**
 * AI Transformer
 * Uses Claude to perform intelligent content transformations
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  TransformType,
  InputFormat,
  OutputFormat,
  WritingStyle,
  TransformResult
} from '../types';
import { detectFormat, getFormatDescription } from './format-detector';

const anthropic = new Anthropic();

interface TransformParams {
  content: string;
  type: TransformType;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  style?: WritingStyle;
  language?: string;
  customPrompt?: string;
  preserveStructure?: boolean;
}

const TRANSFORM_PROMPTS: Record<TransformType, string> = {
  format: `Reformat the following content to improve readability and structure while preserving all information.`,

  convert: `Convert the following content from {inputFormat} to {outputFormat} format. Ensure all data and information is preserved accurately.`,

  summarize: `Summarize the following content concisely while capturing all key points and essential information.`,

  expand: `Expand and elaborate on the following content, adding more detail, examples, and explanations while maintaining the original meaning.`,

  rewrite: `Rewrite the following content in a {style} style. Maintain the core message but adjust tone, vocabulary, and structure appropriately.`,

  extract: `Extract the key information, facts, and data points from the following content. Present them in a clear, organized manner.`,

  translate: `Translate the following content to {language}. Maintain the original meaning, tone, and nuance as closely as possible.`,

  structure: `Add or improve the structure of the following content. Add headings, sections, lists, or other organizational elements as appropriate.`,

  custom: `{customPrompt}`
};

const STYLE_DESCRIPTIONS: Record<WritingStyle, string> = {
  formal: 'professional, polished, and appropriate for official communications',
  casual: 'relaxed, friendly, and conversational',
  technical: 'precise, detailed, using industry terminology',
  academic: 'scholarly, well-cited, objective',
  business: 'clear, action-oriented, professional',
  creative: 'engaging, imaginative, with vivid language',
  journalistic: 'factual, balanced, news-style',
  conversational: 'natural, like speaking to a friend'
};

export async function transformContent(params: TransformParams): Promise<TransformResult> {
  const {
    content,
    type,
    inputFormat,
    outputFormat,
    style,
    language,
    customPrompt,
    preserveStructure
  } = params;

  console.log(`[Transformer] Type: ${type}`);
  console.log(`[Transformer] Input format: ${getFormatDescription(inputFormat)}`);
  console.log(`[Transformer] Output format: ${getFormatDescription(outputFormat)}`);

  // Build the prompt
  let systemPrompt = TRANSFORM_PROMPTS[type];

  // Replace placeholders
  systemPrompt = systemPrompt
    .replace('{inputFormat}', getFormatDescription(inputFormat))
    .replace('{outputFormat}', getFormatDescription(outputFormat))
    .replace('{style}', style ? STYLE_DESCRIPTIONS[style] : 'appropriate')
    .replace('{language}', language || 'the target language')
    .replace('{customPrompt}', customPrompt || '');

  // Add format-specific instructions
  let formatInstructions = '';

  switch (outputFormat) {
    case 'json':
      formatInstructions = 'Output valid JSON only. No markdown code blocks, just the raw JSON.';
      break;
    case 'yaml':
      formatInstructions = 'Output valid YAML only. No markdown code blocks, just the raw YAML.';
      break;
    case 'html':
      formatInstructions = 'Output valid HTML. Include appropriate tags and structure.';
      break;
    case 'markdown':
      formatInstructions = 'Output well-formatted Markdown with appropriate headers, lists, and formatting.';
      break;
    case 'csv':
      formatInstructions = 'Output CSV format with headers in the first row. Use commas as delimiters.';
      break;
    case 'xml':
      formatInstructions = 'Output valid XML with appropriate element structure.';
      break;
    case 'code':
      formatInstructions = 'Output clean, well-formatted code. No markdown code blocks unless part of the content.';
      break;
  }

  if (preserveStructure) {
    formatInstructions += ' Preserve the original document structure as much as possible.';
  }

  const fullPrompt = `${systemPrompt}

${formatInstructions}

INPUT CONTENT:
${content}

Provide only the transformed output, no explanations or meta-commentary.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: fullPrompt
      }
    ]
  });

  const responseContent = response.content[0];
  if (responseContent.type !== 'text') {
    throw new Error('Unexpected response type from transformer');
  }

  const transformedContent = responseContent.text.trim();

  // Calculate stats
  const inputWords = content.split(/\s+/).filter(w => w.length > 0).length;
  const outputWords = transformedContent.split(/\s+/).filter(w => w.length > 0).length;

  console.log(`[Transformer] Transformation complete`);
  console.log(`[Transformer] Input: ${inputWords} words, Output: ${outputWords} words`);

  return {
    content: transformedContent,
    inputFormat,
    outputFormat,
    type,
    stats: {
      inputLength: content.length,
      outputLength: transformedContent.length,
      inputWords,
      outputWords
    }
  };
}

export async function batchTransform(
  items: Array<{ content: string; filename?: string }>,
  params: Omit<TransformParams, 'content' | 'inputFormat'>,
  parallel: number = 3
): Promise<TransformResult[]> {
  const results: TransformResult[] = [];
  const queue = [...items];
  const inProgress: Promise<TransformResult>[] = [];

  while (queue.length > 0 || inProgress.length > 0) {
    while (queue.length > 0 && inProgress.length < parallel) {
      const item = queue.shift()!;
      const inputFormat = detectFormat(item.content, item.filename);

      const promise = transformContent({
        ...params,
        content: item.content,
        inputFormat
      }).then(result => {
        const index = inProgress.indexOf(promise);
        if (index > -1) {
          inProgress.splice(index, 1);
        }
        return result;
      });

      inProgress.push(promise);
    }

    if (inProgress.length > 0) {
      const completed = await Promise.race(inProgress);
      results.push(completed);
    }
  }

  return results;
}
