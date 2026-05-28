import OpenAI from "openai";

import type { BuildOptions } from "./types";

export async function generateDescriptions(options: BuildOptions): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("Warning: OPENAI_API_KEY not set, skipping AI descriptions");
    return;
  }

  const openai = new OpenAI({ apiKey });

  console.log("Generating AI descriptions...");

  for (const tool of options.tools) {
    if (tool.description.startsWith("TODO:")) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Generate a concise, clear description for an MCP tool. One sentence, no markdown.",
          },
          {
            role: "user",
            content: `Tool name: ${tool.name}\nParameters: ${JSON.stringify(tool.parameters)}`,
          },
        ],
        max_tokens: 100,
      });
      tool.description = response.choices[0]?.message?.content || tool.description;
    }
  }
}

// Convert name to various formats
