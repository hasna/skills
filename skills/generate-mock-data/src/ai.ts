import OpenAI from "openai";

import { log } from "./logger";
import type { Locale, SchemaField } from "./types";

export async function generateDataAI(
  schema: SchemaField,
  count: number,
  locale: Locale = "en-US"
): Promise<any[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for AI mode");
  }

  const openai = new OpenAI({ apiKey });

  log(`Generating ${count} records using AI (GPT-4o-mini)...`);

  const schemaDescription = Object.entries(schema)
    .map(([field, type]) => `- ${field}: ${type}`)
    .join("\n");

  const prompt = `Generate ${count} realistic mock data records as a JSON array.

Schema:
${schemaDescription}

Requirements:
- Return ONLY a valid JSON array of objects
- Each object must have all fields from the schema
- Data should be realistic and diverse
- Use ${locale} locale for localized data (names, addresses, phone numbers)
- No explanations, just the JSON array

Example format:
[
  { "field1": "value1", "field2": "value2" },
  { "field1": "value3", "field2": "value4" }
]`;

  try {
    // Split into batches if count > 50 to avoid token limits
    const batchSize = Math.min(count, 50);
    const batches = Math.ceil(count / batchSize);
    const allData: any[] = [];

    for (let batch = 0; batch < batches; batch++) {
      const currentBatchSize = Math.min(batchSize, count - allData.length);

      log(`Generating batch ${batch + 1}/${batches} (${currentBatchSize} records)...`);

      const batchPrompt = prompt.replace(`Generate ${count}`, `Generate ${currentBatchSize}`);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a data generator that returns only valid JSON arrays. No explanations, no markdown, just JSON.",
          },
          {
            role: "user",
            content: batchPrompt,
          },
        ],
        temperature: 0.8,
      });

      const content = completion.choices[0].message.content || "[]";

      // Clean up response (remove markdown code blocks if present)
      const cleanContent = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      const batchData = JSON.parse(cleanContent);

      if (!Array.isArray(batchData)) {
        throw new Error("AI response is not a JSON array");
      }

      allData.push(...batchData);

      // Log cost estimate
      const inputTokens = completion.usage?.prompt_tokens || 0;
      const outputTokens = completion.usage?.completion_tokens || 0;
      const cost = (inputTokens * 0.00015 / 1000) + (outputTokens * 0.0006 / 1000);
      log(`Batch ${batch + 1} cost: $${cost.toFixed(4)}`);
    }

    return allData.slice(0, count);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`AI generation failed: ${error.message}`);
    }
    throw error;
  }
}

// Format data as JSON
