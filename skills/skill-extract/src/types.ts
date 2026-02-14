export type InputType = 'image' | 'pdf';
export type OutputFormat = 'text' | 'markdown' | 'json';

export interface ExtractOptions {
  input: string;
  output?: string;
  format?: OutputFormat;
  prompt?: string;
  model?: string;
  detail?: 'low' | 'high' | 'auto';
}

export interface ExtractionResult {
  text: string;
  format: OutputFormat;
  inputType: InputType;
  inputFile: string;
  metadata?: {
    pages?: number;
    model?: string;
    tokens?: number;
  };
}

export interface ExtractorProvider {
  name: string;
  extract(options: ExtractOptions): Promise<ExtractionResult>;
}

export interface OpenAIVisionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface PDFMetadata {
  pages: number;
  info?: {
    Title?: string;
    Author?: string;
    Subject?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  };
}
