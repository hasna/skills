export type Platform = "twitter" | "linkedin" | "facebook" | "instagram" | "threads";
export type Tone = "professional" | "casual" | "witty" | "inspiring" | "educational";
export type OutputFormat = "json" | "markdown" | "text";

export interface GenerateOptions {
  source: string; // URL, file path, or direct text
  sourceType: "url" | "file" | "text";
  platforms: Platform[];
  count: number;
  tone: Tone;
  includeHashtags: boolean;
  threads: boolean;
  maxLength: number;
  output?: string;
  format: OutputFormat;
}

export interface PlatformConfig {
  name: string;
  charLimit: number;
  hashtagLimit: number;
  emojiUsage: "minimal" | "moderate" | "heavy";
  style: string;
}

export interface SocialPost {
  platform: Platform;
  content: string;
  hashtags: string[];
  hooks: string[];
  cta?: string;
  threadPosts?: string[];
  bestTime?: string;
  characterCount: number;
}

export interface GeneratedContent {
  sourceTitle: string;
  sourceSummary: string;
  platforms: Platform[];
  posts: SocialPost[];
  generatedAt: string;
  options: GenerateOptions;
}

export interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface AnthropicResponse {
  content: Array<{
    text: string;
  }>;
}
