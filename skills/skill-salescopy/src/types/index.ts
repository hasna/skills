export interface Product {
  name: string;
  description: string;
  features?: string[];
  benefits?: string[];
  price?: string;
  targetAudience?: string;
}

export interface CopyRequest {
  product: Product;
  copyType: CopyType;
  tone?: Tone;
  length?: Length;
  template?: string;
  customInstructions?: string;
}

export type CopyType =
  | "sales-letter"
  | "landing-page"
  | "email-sequence"
  | "headline"
  | "bullet-points"
  | "call-to-action"
  | "testimonial-request"
  | "product-description";

export type Tone =
  | "professional"
  | "casual"
  | "urgent"
  | "friendly"
  | "authoritative"
  | "empathetic"
  | "humorous";

export type Length = "short" | "medium" | "long";

export interface CopyResult {
  id: string;
  content: string;
  copyType: CopyType;
  product: Product;
  tone?: Tone;
  length?: Length;
  template?: string;
  model: string;
  timestamp: string;
}

export interface Session {
  id: string;
  product: Product;
  results: CopyResult[];
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  copyType: CopyType;
  structure: string[];
  prompt: string;
}

export interface GeneratorConfig {
  provider: "openai" | "anthropic";
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
