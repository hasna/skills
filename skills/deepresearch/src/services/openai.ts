import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY not found. Please set it in ~/.secrets or environment."
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
  }
): Promise<string> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: options?.maxTokens || 8192,
    temperature: options?.temperature ?? 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  return content;
}

export async function generateJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    maxTokens?: number;
    temperature?: number;
  }
): Promise<T> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: options?.maxTokens || 8192,
    temperature: options?.temperature ?? 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt + "\n\nRespond with valid JSON only." },
      { role: "user", content: userPrompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Failed to parse JSON from OpenAI response: ${content.slice(0, 200)}`);
  }
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
