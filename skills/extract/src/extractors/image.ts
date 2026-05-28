import { OpenAIProvider } from '../providers/openai';
import type { ExtractOptions, ExtractionResult } from '../types';
import { existsSync } from 'fs';
import { extname } from 'path';

const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'];

export function isImageFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export async function extractFromImage(options: ExtractOptions): Promise<ExtractionResult> {
  const { input, prompt, model, format = 'text', detail = 'auto' } = options;

  // Validate file exists
  if (!existsSync(input)) {
    throw new Error(`Image file not found: ${input}`);
  }

  // Validate file extension
  if (!isImageFile(input)) {
    throw new Error(
      `Unsupported image format. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
  }

  const provider = new OpenAIProvider();

  const result = await provider.extractFromImage(input, {
    prompt,
    model,
    format,
    detail,
  });

  return result;
}

export function getSupportedImageExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}
