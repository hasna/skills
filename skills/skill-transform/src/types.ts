/**
 * Types for skill-transform
 * Content transformation and conversion
 */

export type TransformType =
  | 'format'      // Format/reformat content
  | 'convert'     // Convert between formats
  | 'summarize'   // Summarize content
  | 'expand'      // Expand/elaborate content
  | 'rewrite'     // Rewrite with different style/tone
  | 'extract'     // Extract specific information
  | 'translate'   // Translate to another language
  | 'structure'   // Add/change structure
  | 'custom';     // Custom transformation with prompt

export type InputFormat =
  | 'text'
  | 'markdown'
  | 'html'
  | 'json'
  | 'yaml'
  | 'csv'
  | 'xml'
  | 'code'
  | 'auto';       // Auto-detect

export type OutputFormat =
  | 'text'
  | 'markdown'
  | 'html'
  | 'json'
  | 'yaml'
  | 'csv'
  | 'xml'
  | 'code';

export type WritingStyle =
  | 'formal'
  | 'casual'
  | 'technical'
  | 'academic'
  | 'business'
  | 'creative'
  | 'journalistic'
  | 'conversational';

export interface TransformOptions {
  input: string;               // Input file path or text
  output?: string;             // Output file path
  type: TransformType;         // Type of transformation
  inputFormat?: InputFormat;   // Input format (auto-detect if not specified)
  outputFormat?: OutputFormat; // Output format
  style?: WritingStyle;        // Writing style for rewrites
  language?: string;           // Target language for translation
  prompt?: string;             // Custom prompt for transformation
  preserveStructure?: boolean; // Preserve original structure
  verbose?: boolean;           // Show detailed output
}

export interface TransformResult {
  content: string;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  type: TransformType;
  stats: {
    inputLength: number;
    outputLength: number;
    inputWords: number;
    outputWords: number;
  };
}

export interface BatchTransformOptions {
  inputs: string[];            // Input file paths
  outputDir: string;           // Output directory
  type: TransformType;
  outputFormat?: OutputFormat;
  style?: WritingStyle;
  language?: string;
  prompt?: string;
  parallel?: number;           // Max parallel transformations
}

export interface BatchResult {
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    input: string;
    output: string;
    success: boolean;
    error?: string;
  }>;
}
