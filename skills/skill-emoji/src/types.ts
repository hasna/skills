// CLI Options
export interface GenerateOptions {
  theme: string;
  count: number;
  provider: 'openai' | 'gemini';
  size: number;
  style: 'flat' | '3d' | 'outline' | 'gradient';
  output: string;
  format: 'zip' | 'directory';
  concurrency: number;
}

// Emoji prompt from AI
export interface EmojiPrompt {
  name: string;
  description: string;
  prompt: string;
}

// Generated emoji result
export interface EmojiResult {
  name: string;
  prompt: string;
  buffer: Buffer;
  path?: string;
}

// Image provider interface
export interface ImageProvider {
  generate(prompt: string): Promise<Buffer>;
}

// OpenAI API response
export interface OpenAIImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

// OpenAI Chat response for prompt generation
export interface OpenAIChatResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Gemini API response
export interface GeminiImageResponse {
  predictions?: Array<{
    bytesBase64Encoded: string;
  }>;
}

// Gemini Chat response for prompt generation
export interface GeminiChatResponse {
  candidates?: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
}

// Progress callback
export type ProgressCallback = (current: number, total: number, name: string) => void;
