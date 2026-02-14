/**
 * Type definitions for skill-convert
 * File format conversion with AI-powered extraction
 */

// Image formats
export type ImageFormat = 'png' | 'jpg' | 'jpeg' | 'webp' | 'gif' | 'avif' | 'tiff' | 'bmp' | 'ico';

// Document formats
export type DocumentFormat = 'pdf' | 'docx' | 'doc' | 'txt' | 'rtf' | 'odt';

// Data formats
export type DataFormat = 'csv' | 'xlsx' | 'xls' | 'json' | 'yaml' | 'xml' | 'tsv';

// Markup formats
export type MarkupFormat = 'md' | 'markdown' | 'html' | 'htm';

// All supported formats
export type FileFormat = ImageFormat | DocumentFormat | DataFormat | MarkupFormat;

// Image quality presets
export type ImageQuality = 'lossless' | 'high' | 'medium' | 'low' | 'web';

// Quality settings for each preset
export const QUALITY_SETTINGS: Record<ImageQuality, { quality: number; effort?: number }> = {
  lossless: { quality: 100 },
  high: { quality: 90 },
  medium: { quality: 75 },
  low: { quality: 50 },
  web: { quality: 60, effort: 6 }, // Optimized for web
};

// AI model options
export type AIModel = 'claude' | 'gpt-4o' | 'gpt-4o-mini';

export interface ConvertOptions {
  /** Input file path */
  input: string;
  /** Output file path (optional - auto-generated if not specified) */
  output?: string;
  /** Target format */
  format: FileFormat;
  /** Image quality preset */
  quality?: ImageQuality;
  /** Custom quality value (0-100) */
  qualityValue?: number;
  /** Clean/sanitize output with AI */
  clean?: boolean;
  /** AI model to use for AI-powered conversions */
  model?: AIModel;
  /** Maximum chunk size in MB for large files */
  chunkSize?: number;
  /** DPI for PDF to image conversion */
  dpi?: number;
  /** Resize dimensions for images */
  resize?: {
    width?: number;
    height?: number;
    fit?: 'contain' | 'cover' | 'fill' | 'inside' | 'outside';
  };
  /** Preserve original aspect ratio */
  preserveAspect?: boolean;
  /** Pages to convert (for PDFs) - e.g., "1-5" or "1,3,5" */
  pages?: string;
  /** Verbose output */
  verbose?: boolean;
}

export interface ConvertResult {
  success: boolean;
  input: string;
  output: string;
  inputFormat: string;
  outputFormat: FileFormat;
  inputSize: number;
  outputSize: number;
  compressionRatio?: number;
  pagesProcessed?: number;
  chunksProcessed?: number;
  aiProcessed?: boolean;
  error?: string;
  duration: number;
}

export interface BatchConvertOptions {
  /** Input files or directory */
  inputs: string[];
  /** Output directory */
  outputDir: string;
  /** Target format */
  format: FileFormat;
  /** Image quality preset */
  quality?: ImageQuality;
  /** Clean/sanitize output with AI */
  clean?: boolean;
  /** AI model to use */
  model?: AIModel;
  /** Number of parallel conversions */
  parallel?: number;
  /** Recursive directory processing */
  recursive?: boolean;
  /** File patterns to include (glob) */
  include?: string[];
  /** File patterns to exclude (glob) */
  exclude?: string[];
}

export interface BatchConvertResult {
  success: boolean;
  totalFiles: number;
  converted: number;
  failed: number;
  results: ConvertResult[];
  totalInputSize: number;
  totalOutputSize: number;
  duration: number;
}

/** Format detection mapping */
export const FORMAT_EXTENSIONS: Record<string, FileFormat> = {
  // Images
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.gif': 'gif',
  '.avif': 'avif',
  '.tiff': 'tiff',
  '.bmp': 'bmp',
  '.ico': 'ico',
  // Documents
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.txt': 'txt',
  '.rtf': 'rtf',
  '.odt': 'odt',
  // Data
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.tsv': 'tsv',
  // Markup
  '.md': 'md',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'htm',
};

/** Format categories */
export const FORMAT_CATEGORIES = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'tiff', 'bmp', 'ico'] as ImageFormat[],
  document: ['pdf', 'docx', 'doc', 'txt', 'rtf', 'odt'] as DocumentFormat[],
  data: ['csv', 'xlsx', 'xls', 'json', 'yaml', 'xml', 'tsv'] as DataFormat[],
  markup: ['md', 'markdown', 'html', 'htm'] as MarkupFormat[],
};

/** Conversions that require AI */
export const AI_REQUIRED_CONVERSIONS: Array<{ from: string[]; to: string[] }> = [
  // Image to text formats (OCR/recognition)
  { from: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'bmp'], to: ['md', 'markdown', 'txt', 'json'] },
  // PDF to markdown/text with clean extraction
  { from: ['pdf'], to: ['md', 'markdown'] },
  // Complex document conversions needing AI understanding
  { from: ['docx', 'doc'], to: ['md', 'markdown'] },
];

/** Maximum file size for single-pass processing (in bytes) */
export const MAX_SINGLE_PASS_SIZE = 10 * 1024 * 1024; // 10MB

/** Default chunk size for large files (in bytes) */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

/** Check if conversion requires AI */
export function requiresAI(inputFormat: string, outputFormat: string): boolean {
  return AI_REQUIRED_CONVERSIONS.some(
    (conv) => conv.from.includes(inputFormat) && conv.to.includes(outputFormat)
  );
}

/** Get format category */
export function getFormatCategory(format: FileFormat): 'image' | 'document' | 'data' | 'markup' | 'unknown' {
  if (FORMAT_CATEGORIES.image.includes(format as ImageFormat)) return 'image';
  if (FORMAT_CATEGORIES.document.includes(format as DocumentFormat)) return 'document';
  if (FORMAT_CATEGORIES.data.includes(format as DataFormat)) return 'data';
  if (FORMAT_CATEGORIES.markup.includes(format as MarkupFormat)) return 'markup';
  return 'unknown';
}
