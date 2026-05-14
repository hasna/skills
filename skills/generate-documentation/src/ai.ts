import { log } from "./runtime";
import { autoDetectFormat } from "./code-parser";
import type { CodeElement, DocFormat, GenerateOptions } from "./types";

// Generate documentation using AI
export async function generateDocumentation(
  element: CodeElement,
  options: GenerateOptions
): Promise<string> {
  const apiKey = options.apiProvider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(`${options.apiProvider.toUpperCase()}_API_KEY environment variable is not set`);
  }

  // Build prompt based on format and language
  const format = options.format === "auto" ? autoDetectFormat(element.language) : options.format;

  const prompt = buildDocumentationPrompt(element, format, options.includeExamples);

  if (options.verbose) {
    log(`Analyzing ${element.type} "${element.name}" in ${element.language}...`);
  }

  // Call AI API
  if (options.apiProvider === "anthropic") {
    return await callAnthropicAPI(prompt, apiKey, options.model || "claude-3-5-sonnet-20241022");
  } else {
    return await callOpenAIAPI(prompt, apiKey, options.model || "gpt-4-turbo");
  }
}

// Build documentation prompt
function buildDocumentationPrompt(element: CodeElement, format: DocFormat, includeExamples: boolean): string {
  let prompt = `You are a technical documentation expert. Generate ${format} documentation for the following ${element.language} ${element.type}.\n\n`;

  prompt += `Code:\n\`\`\`${element.language}\n${element.code}\n\`\`\`\n\n`;

  prompt += `Requirements:\n`;

  if (format === "jsdoc" || format === "tsdoc") {
    prompt += `- Use JSDoc/TSDoc format with /** */ comment block\n`;
    prompt += `- Include a clear description of what the ${element.type} does\n`;
    prompt += `- Document all @param tags with types and descriptions\n`;
    prompt += `- Include @returns tag with return type and description\n`;
    prompt += `- Add @throws tags for any errors that may be thrown\n`;

    if (format === "tsdoc") {
      prompt += `- Use TypeScript-specific features (generics, union types, etc.)\n`;
      prompt += `- Leverage type information from signatures\n`;
    }

    if (includeExamples) {
      prompt += `- Include an @example block with realistic usage example\n`;
      prompt += `- Show expected input and output in the example\n`;
    }
  } else if (format === "python") {
    prompt += `- Use Python docstring format (Google or NumPy style)\n`;
    prompt += `- Include a clear description of what the ${element.type} does\n`;
    prompt += `- Document all Args: with types and descriptions\n`;
    prompt += `- Include Returns: section with return type and description\n`;
    prompt += `- Add Raises: section for any exceptions\n`;

    if (includeExamples) {
      prompt += `- Include an Example: section with realistic usage\n`;
      prompt += `- Use doctest-compatible format for examples\n`;
    }
  }

  prompt += `\nGenerate ONLY the documentation comment block without any additional explanation or the code itself.`;

  return prompt;
}

// Call Anthropic API
async function callAnthropicAPI(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: prompt,
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.content[0].text.trim();
}

// Call OpenAI API
async function callOpenAIAPI(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: prompt,
      }],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}
