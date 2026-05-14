import { createOpenAIClient } from "./dependencies";
import type { DocOptions } from "./types";

export async function generateWithAI(options: DocOptions, topic: string, isPrompt = false): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for AI generation");
  }

  const openai = await createOpenAIClient(apiKey);

  const lengthGuide = {
    short: "Keep it concise, around 500 words total.",
    medium: "Write a moderate length document, around 1000-1500 words.",
    long: "Write a comprehensive document, around 2000-3000 words.",
    comprehensive: "Write a very detailed document, around 4000+ words with thorough coverage.",
  };

  const styleGuide = {
    professional: "Use professional business language.",
    casual: "Use a casual, conversational tone.",
    formal: "Use formal, academic language.",
    academic: "Use scholarly, well-researched language with citations where appropriate.",
  };

  const systemPrompt = isPrompt
    ? `You are a professional document writer. Write in markdown format with proper headings, paragraphs, lists, and formatting. ${styleGuide[options.style]} ${lengthGuide[options.length]}`
    : `You are a professional document writer creating a ${options.template} document. Write in markdown format with:
- A clear title (# Title)
- ${options.sections} main sections (## Section headings)
- Proper paragraphs, bullet points, and formatting as needed
- ${styleGuide[options.style]}
- ${lengthGuide[options.length]}

Output ONLY the markdown content, no explanations.`;
  const userPrompt = isPrompt ? topic : `Write a document about: ${topic}`;

  console.log("Generating content with AI...");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || "";
}
