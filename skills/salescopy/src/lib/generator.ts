import OpenAI from "openai";
import type {
  CopyRequest,
  CopyResult,
  CopyType,
  Tone,
  Length,
  Template,
  GeneratorConfig,
} from "../types/index.js";
import { loadTemplates } from "./storage.js";

export function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY environment variable is required. Set it in .env or export it."
    );
  }
  return key;
}

function getToneDescription(tone?: Tone): string {
  const tones: Record<Tone, string> = {
    professional:
      "professional, polished, and business-appropriate language",
    casual: "conversational, friendly, and approachable language",
    urgent: "urgent, time-sensitive language that creates FOMO",
    friendly: "warm, personable, and relatable language",
    authoritative: "confident, expert, and trustworthy language",
    empathetic: "understanding, compassionate, and supportive language",
    humorous: "witty, playful, and entertaining language",
  };
  return tone ? tones[tone] : tones.professional;
}

function getLengthInstruction(length?: Length): string {
  const lengths: Record<Length, string> = {
    short: "Keep it concise, around 100-200 words.",
    medium: "Write a moderate length piece, around 300-500 words.",
    long: "Write a comprehensive piece, around 800-1200 words.",
  };
  return length ? lengths[length] : lengths.medium;
}

function getCopyTypeDescription(copyType: CopyType): string {
  const descriptions: Record<CopyType, string> = {
    "sales-letter":
      "a persuasive sales letter that converts readers into customers",
    "landing-page": "landing page copy with headline, subheadline, benefits, and CTA",
    "email-sequence": "an email marketing sequence",
    headline: "compelling headline variations",
    "bullet-points": "persuasive bullet points highlighting benefits",
    "call-to-action": "powerful call-to-action buttons and phrases",
    "testimonial-request": "a request for customer testimonials",
    "product-description":
      "an engaging product description that sells",
  };
  return descriptions[copyType];
}

function buildPrompt(request: CopyRequest, template?: Template): string {
  const { product, copyType, tone, length, customInstructions } = request;

  let prompt = `You are an expert copywriter specializing in high-converting sales copy.

Product Information:
- Name: ${product.name}
- Description: ${product.description}`;

  if (product.features?.length) {
    prompt += `\n- Key Features: ${product.features.join(", ")}`;
  }

  if (product.benefits?.length) {
    prompt += `\n- Benefits: ${product.benefits.join(", ")}`;
  }

  if (product.price) {
    prompt += `\n- Price: ${product.price}`;
  }

  if (product.targetAudience) {
    prompt += `\n- Target Audience: ${product.targetAudience}`;
  }

  prompt += `\n\nTask: Write ${getCopyTypeDescription(copyType)}`;

  if (template) {
    prompt += `\n\nTemplate: ${template.name}
${template.prompt}

Structure to follow: ${template.structure.join(" → ")}`;
  }

  prompt += `\n\nTone: Use ${getToneDescription(tone)}
${getLengthInstruction(length)}`;

  if (customInstructions) {
    prompt += `\n\nAdditional Instructions: ${customInstructions}`;
  }

  prompt += `\n\nWrite the copy now. Be persuasive, clear, and focused on benefits. Do not include meta-commentary - just write the copy directly.`;

  return prompt;
}

export async function generateCopy(
  request: CopyRequest,
  config: GeneratorConfig = { provider: "openai" }
): Promise<CopyResult> {
  const apiKey = getApiKey();
  const openai = new OpenAI({ apiKey });

  let template: Template | undefined;
  if (request.template) {
    const templates = loadTemplates();
    template = templates.find((t) => t.id === request.template);
  }

  const prompt = buildPrompt(request, template);
  const model = config.model || "gpt-4o";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an expert copywriter who creates high-converting sales copy. You write clear, persuasive, benefit-focused copy that drives action.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens ?? 2000,
  });

  const content = completion.choices[0]?.message?.content || "";

  return {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    content,
    copyType: request.copyType,
    product: request.product,
    tone: request.tone,
    length: request.length,
    template: request.template,
    model,
    timestamp: new Date().toISOString(),
  };
}

export async function generateVariations(
  request: CopyRequest,
  count: number = 3,
  config: GeneratorConfig = { provider: "openai" }
): Promise<CopyResult[]> {
  const results: CopyResult[] = [];

  for (let i = 0; i < count; i++) {
    const result = await generateCopy(request, {
      ...config,
      temperature: 0.8 + i * 0.1, // Increase temperature for more variety
    });
    results.push(result);
  }

  return results;
}

export function listCopyTypes(): CopyType[] {
  return [
    "sales-letter",
    "landing-page",
    "email-sequence",
    "headline",
    "bullet-points",
    "call-to-action",
    "testimonial-request",
    "product-description",
  ];
}

export function listTones(): Tone[] {
  return [
    "professional",
    "casual",
    "urgent",
    "friendly",
    "authoritative",
    "empathetic",
    "humorous",
  ];
}
