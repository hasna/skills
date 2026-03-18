/**
 * Unified vision client for AI providers.
 * Follows @hasna/connectors pattern — auto-detects from env vars.
 * Providers: anthropic, openai, xai, gemini
 *
 * Uses built-in fetch only — no external SDK dependencies.
 */

export type VisionProvider = "anthropic" | "openai" | "xai" | "gemini";

export interface VisionOptions {
  provider?: VisionProvider;
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  jsonMode?: boolean; // wrap prompt to request JSON response
}

export interface VisionResult {
  text: string;
  provider: VisionProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

// Default models per provider (vision-capable)
export const DEFAULT_MODELS: Record<VisionProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  xai: "grok-2-vision-1212",
  gemini: "gemini-2.0-flash",
};

// API key env vars per provider
export const API_KEY_VARS: Record<VisionProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

// Base URLs
const BASE_URLS: Record<VisionProvider, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
};

/**
 * Auto-detect provider from env vars.
 * Priority: ANTHROPIC_API_KEY → OPENAI_API_KEY → XAI_API_KEY → GEMINI_API_KEY
 */
export function detectProvider(): VisionProvider | null {
  const order: VisionProvider[] = ["anthropic", "openai", "xai", "gemini"];
  for (const provider of order) {
    if (process.env[API_KEY_VARS[provider]]) {
      return provider;
    }
  }
  return null;
}

/**
 * Get API key for a provider. Throws if not set.
 */
export function getApiKey(provider: VisionProvider): string {
  const key = process.env[API_KEY_VARS[provider]];
  if (!key) {
    throw new Error(
      `${API_KEY_VARS[provider]} is not set. Run: connectors setup ${provider}`
    );
  }
  return key;
}

/**
 * Strip markdown code fences and JSON.parse.
 * Throws with raw text on failure.
 */
export function parseJsonResponse(text: string): unknown {
  let str = text.trim();
  if (str.startsWith("```")) {
    str = str
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }
  try {
    return JSON.parse(str);
  } catch {
    throw new Error(
      `Failed to parse response as JSON.\nRaw response:\n${text}`
    );
  }
}

/**
 * Returns all providers that have an API key set.
 */
export function listAvailableProviders(): VisionProvider[] {
  return (["anthropic", "openai", "xai", "gemini"] as VisionProvider[]).filter(
    (p) => !!process.env[API_KEY_VARS[p]]
  );
}

/**
 * Returns availability status for all providers.
 */
export function getProviderInfo(): Record<
  VisionProvider,
  { available: boolean; model: string; keyVar: string }
> {
  return {
    anthropic: {
      available: !!process.env[API_KEY_VARS.anthropic],
      model: DEFAULT_MODELS.anthropic,
      keyVar: API_KEY_VARS.anthropic,
    },
    openai: {
      available: !!process.env[API_KEY_VARS.openai],
      model: DEFAULT_MODELS.openai,
      keyVar: API_KEY_VARS.openai,
    },
    xai: {
      available: !!process.env[API_KEY_VARS.xai],
      model: DEFAULT_MODELS.xai,
      keyVar: API_KEY_VARS.xai,
    },
    gemini: {
      available: !!process.env[API_KEY_VARS.gemini],
      model: DEFAULT_MODELS.gemini,
      keyVar: API_KEY_VARS.gemini,
    },
  };
}

// ============================================================================
// Provider implementations
// ============================================================================

async function analyzeWithAnthropic(
  imageBase64: string,
  mediaType: string,
  prompt: string,
  model: string,
  options: VisionOptions
): Promise<VisionResult> {
  const apiKey = getApiKey("anthropic");
  const body: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  };
  if (options.systemPrompt) {
    body.system = options.systemPrompt;
  }

  const response = await fetch(BASE_URLS.anthropic, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    text: data.content[0].text,
    provider: "anthropic",
    model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  };
}

async function analyzeWithOpenAICompat(
  provider: "openai" | "xai",
  imageBase64: string,
  mediaType: string,
  prompt: string,
  model: string,
  options: VisionOptions
): Promise<VisionResult> {
  const apiKey = getApiKey(provider);
  const messages: unknown[] = [];

  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }

  messages.push({
    role: "user",
    content: [
      {
        type: "image_url",
        image_url: {
          url: `data:${mediaType};base64,${imageBase64}`,
          detail: "high",
        },
      },
      { type: "text", text: prompt },
    ],
  });

  const body = {
    model,
    max_tokens: options.maxTokens ?? 1024,
    messages,
  };

  const response = await fetch(BASE_URLS[provider], {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `${provider.toUpperCase()} API error ${response.status}: ${err}`
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    text: data.choices[0].message.content,
    provider,
    model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

async function analyzeWithGemini(
  imageBase64: string,
  mediaType: string,
  prompt: string,
  model: string,
  options: VisionOptions
): Promise<VisionResult> {
  const apiKey = getApiKey("gemini");
  const url = `${BASE_URLS.gemini}/${model}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: mediaType, data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? 1024,
      ...(options.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  if (options.systemPrompt) {
    body.systemInstruction = { parts: [{ text: options.systemPrompt }] };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    candidates: Array<{
      content: { parts: Array<{ text: string }> };
    }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };

  return {
    text: data.candidates[0].content.parts[0].text,
    provider: "gemini",
    model,
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Analyze an image with a vision-capable model.
 * Auto-detects provider from env vars unless options.provider is specified.
 */
export async function analyzeImage(
  imageBase64: string,
  mediaType: string,
  prompt: string,
  options: VisionOptions = {}
): Promise<VisionResult> {
  const provider = options.provider ?? detectProvider();
  if (!provider) {
    throw new Error(
      "No AI provider API key found. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY"
    );
  }

  const model = options.model ?? DEFAULT_MODELS[provider];
  const jsonPrompt =
    options.jsonMode
      ? `${prompt}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no commentary.`
      : prompt;

  switch (provider) {
    case "anthropic":
      return analyzeWithAnthropic(
        imageBase64,
        mediaType,
        jsonPrompt,
        model,
        options
      );
    case "openai":
    case "xai":
      return analyzeWithOpenAICompat(
        provider,
        imageBase64,
        mediaType,
        jsonPrompt,
        model,
        options
      );
    case "gemini":
      return analyzeWithGemini(imageBase64, mediaType, jsonPrompt, model, options);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}
