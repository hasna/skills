import { log } from "./runtime";
import type { AnthropicResponse, OpenAIChatResponse } from "./types";

// Call AI API
export async function callAI(prompt: string, systemPrompt: string): Promise<string> {
  // Try OpenAI first
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openaiKey) {
    return await callOpenAI(prompt, systemPrompt, openaiKey);
  } else if (anthropicKey) {
    return await callAnthropic(prompt, systemPrompt, anthropicKey);
  } else {
    throw new Error("No AI API key found. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variable");
  }
}

// Call OpenAI API
async function callOpenAI(prompt: string, systemPrompt: string, apiKey: string): Promise<string> {
  log("Using OpenAI API...");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data: OpenAIChatResponse = await response.json();

  if (!data.choices?.[0]?.message?.content) {
    throw new Error("No content returned from OpenAI");
  }

  return data.choices[0].message.content;
}

// Call Anthropic API
async function callAnthropic(prompt: string, systemPrompt: string, apiKey: string): Promise<string> {
  log("Using Anthropic Claude API...");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
  }

  const data: AnthropicResponse = await response.json();

  if (!data.content?.[0]?.text) {
    throw new Error("No content returned from Anthropic");
  }

  return data.content[0].text;
}
