export interface GenerateOptions {
  provider: 'openai' | 'google' | 'xai';
  prompt: string;
  output: string;
  model?: string;
  size?: string;
}

export interface ImageProvider {
  generate(prompt: string, options?: {
    model?: string;
    size?: string;
  }): Promise<Buffer>;
}

export interface OpenAIImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

export interface GoogleImagenResponse {
  predictions: Array<{
    bytesBase64Encoded: string;
    mimeType: string;
  }>;
}

export interface XAIImageResponse {
  data: Array<{
    url?: string;
    b64_json?: string;
  }>;
}
