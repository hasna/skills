#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-landing-page-copy";
const SESSION_ID = randomUUID().slice(0, 8);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

// Environment
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const EXPORTS_DIR = join(SKILLS_OUTPUT_DIR, "exports", SKILL_NAME, SESSION_ID);
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";

// Types
interface LandingPageCopy {
  hero: {
    headlines: string[];
    subheadline: string;
    cta: string;
    imagePrompt: string;
    imagePath?: string;
  };
  problem: {
    headline: string;
    body: string;
    painPoints: string[];
  };
  solution: {
    headline: string;
    body: string;
  };
  features: Array<{
    title: string;
    description: string;
    icon?: string;
  }>;
  socialProof: {
    headline: string;
    stats: Array<{ number: string; label: string }>;
    testimonialPlaceholder: string;
  };
  objections: Array<{
    question: string;
    answer: string;
  }>;
  finalCta: {
    headline: string;
    body: string;
    buttonText: string;
    supportingText: string;
  };
  meta: {
    title: string;
    description: string;
    keywords: string[];
  };
}

interface Options {
  product: string;
  framework: string;
  audience: string;
  benefits: string[];
  tone: string;
  headlines: number;
  cta: string;
  price: string;
  competitors: string;
  format: string;
  noImages: boolean;
  verbose: boolean;
}

// Copywriting frameworks
const FRAMEWORKS: Record<string, string> = {
  aida: "AIDA (Attention-Interest-Desire-Action): Grab attention, build interest, create desire, prompt action",
  pas: "PAS (Problem-Agitate-Solve): Present problem, agitate pain, offer solution",
  bab: "BAB (Before-After-Bridge): Show before state, paint after picture, bridge with product",
  "4ps": "4Ps (Promise-Picture-Proof-Push): Make promise, paint picture, provide proof, push to action",
  quest: "QUEST (Qualify-Understand-Educate-Stimulate-Transition): Qualify audience, understand needs, educate on solution, stimulate action",
};

// Utilities
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(message: string, level: "info" | "error" | "success" = "info"): void {
  ensureDir(LOGS_DIR);
  appendFileSync(join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`), `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`);
  console.log(`[${level.toUpperCase()}] ${message}`);
}

function parseArguments(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    product: "",
    framework: "aida",
    audience: "general",
    benefits: [],
    tone: "professional",
    headlines: 3,
    cta: "auto",
    price: "",
    competitors: "",
    format: "markdown",
    noImages: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--framework": options.framework = args[++i]; break;
      case "--audience": options.audience = args[++i]; break;
      case "--benefits": options.benefits = args[++i].split(",").map(b => b.trim()); break;
      case "--tone": options.tone = args[++i]; break;
      case "--headlines": options.headlines = parseInt(args[++i], 10); break;
      case "--cta": options.cta = args[++i]; break;
      case "--price": options.price = args[++i]; break;
      case "--competitors": options.competitors = args[++i]; break;
      case "--format": options.format = args[++i]; break;
      case "--no-images": options.noImages = true; break;
      case "--verbose": options.verbose = true; break;
      case "--help": case "-h": printHelp(); process.exit(0);
      default: if (!arg.startsWith("-") && !options.product) options.product = arg;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Landing Page Copy Generator - High-converting landing page content

Usage:
  skills run landing-page-copy -- "<product description>" [options]

Options:
  --framework <fw>      Framework: aida, pas, bab, 4ps, quest (default: aida)
  --audience <desc>     Target audience description
  --benefits <list>     Key benefits (comma-separated)
  --tone <tone>         Tone: professional, casual, urgent, friendly
  --headlines <n>       Number of headline variants (default: 3)
  --cta <text>          Primary call-to-action
  --price <context>     Pricing context
  --competitors <names> Competitor names for differentiation
  --format <format>     Output: markdown, json, html
  --no-images           Skip hero image generation
  --verbose             Show detailed progress

Examples:
  skills run landing-page-copy -- "AI writing assistant for marketers"
  skills run landing-page-copy -- "Online fitness coaching" --framework pas --audience "busy professionals"
`);
}

async function generateLandingPageCopy(options: Options): Promise<LandingPageCopy> {
  const frameworkDesc = FRAMEWORKS[options.framework] || FRAMEWORKS.aida;

  const systemPrompt = `You are an expert conversion copywriter. Create high-converting landing page copy using proven frameworks.
Framework: ${frameworkDesc}
Target audience: ${options.audience}
Tone: ${options.tone}

Best practices:
- Headlines: Clear value proposition, benefit-driven, specific outcomes
- Body: Scannable, bullet points, short paragraphs
- CTAs: Action-oriented, urgency when appropriate
- Social proof: Numbers, testimonials, trust signals
- Objections: Address top concerns proactively`;

  const userPrompt = `Create complete landing page copy for:
"${options.product}"

${options.benefits.length > 0 ? `Key benefits to highlight: ${options.benefits.join(", ")}` : ""}
${options.cta !== "auto" ? `Primary CTA: ${options.cta}` : ""}
${options.price ? `Pricing context: ${options.price}` : ""}
${options.competitors ? `Differentiate from: ${options.competitors}` : ""}

Generate ${options.headlines} headline variants.

Return JSON matching this structure:
{
  "hero": {
    "headlines": ["Headline 1", "Headline 2", "..."],
    "subheadline": "Supporting subheadline",
    "cta": "CTA button text",
    "imagePrompt": "DALL-E prompt for hero image"
  },
  "problem": {
    "headline": "Problem section headline",
    "body": "Problem description",
    "painPoints": ["Pain point 1", "Pain point 2", "..."]
  },
  "solution": {
    "headline": "Solution headline",
    "body": "How product solves the problem"
  },
  "features": [
    { "title": "Feature 1", "description": "Description", "icon": "suggested icon name" }
  ],
  "socialProof": {
    "headline": "Social proof headline",
    "stats": [{ "number": "10K+", "label": "Users" }],
    "testimonialPlaceholder": "Example testimonial quote"
  },
  "objections": [
    { "question": "Common objection?", "answer": "Response" }
  ],
  "finalCta": {
    "headline": "Closing headline",
    "body": "Final persuasion copy",
    "buttonText": "CTA text",
    "supportingText": "Risk reducers like 'No credit card required'"
  },
  "meta": {
    "title": "SEO page title",
    "description": "Meta description",
    "keywords": ["keyword1", "keyword2"]
  }
}`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const result = await response.json();
  let content = result.choices[0]?.message?.content || "{}";
  if (content.includes("```json")) content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "");

  return JSON.parse(content.trim());
}

async function generateImage(prompt: string, filename: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: `Landing page hero image: ${prompt}. Professional, modern, clean design, no text, suitable for website header.`,
      n: 1,
      size: "1536x1024",
      quality: "high",
      output_format: "png",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Image generation failed: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const b64Data = result.data[0]?.b64_json;

  if (b64Data) {
    const imageBuffer = Buffer.from(b64Data, "base64");
    const imagePath = join(EXPORTS_DIR, filename);
    writeFileSync(imagePath, imageBuffer);
    return imagePath;
  }
  throw new Error("No image data returned");
}

function formatAsMarkdown(copy: LandingPageCopy, options: Options): string {
  let output = `# Landing Page Copy: ${options.product}\n\n`;
  output += `**Framework:** ${options.framework.toUpperCase()}\n`;
  output += `**Target Audience:** ${options.audience}\n`;
  output += `**Generated:** ${new Date().toISOString()}\n\n---\n\n`;

  // Hero Section
  output += `## Hero Section\n\n`;
  output += `### Headlines (A/B Test Variants)\n`;
  copy.hero.headlines.forEach((h, i) => output += `${i + 1}. "${h}"\n`);
  output += `\n### Subheadline\n${copy.hero.subheadline}\n\n`;
  output += `### Primary CTA\n[${copy.hero.cta}]\n\n`;
  if (copy.hero.imagePath) output += `### Hero Image\n${copy.hero.imagePath}\n\n`;

  // Problem Section
  output += `---\n\n## Problem Section\n\n`;
  output += `### Headline\n${copy.problem.headline}\n\n`;
  output += `### Body Copy\n${copy.problem.body}\n\n`;
  output += `### Pain Points\n`;
  copy.problem.painPoints.forEach(p => output += `- ${p}\n`);

  // Solution Section
  output += `\n---\n\n## Solution Section\n\n`;
  output += `### Headline\n${copy.solution.headline}\n\n`;
  output += `### Body Copy\n${copy.solution.body}\n\n`;

  // Features
  output += `---\n\n## Features Section\n\n`;
  for (const f of copy.features) {
    output += `### ${f.title}\n${f.description}\n\n`;
  }

  // Social Proof
  output += `---\n\n## Social Proof Section\n\n`;
  output += `### Headline\n${copy.socialProof.headline}\n\n`;
  output += `### Stats\n`;
  for (const s of copy.socialProof.stats) {
    output += `- **${s.number}** ${s.label}\n`;
  }
  output += `\n### Testimonial Placeholder\n"${copy.socialProof.testimonialPlaceholder}"\n\n`;

  // Objections
  output += `---\n\n## Objection Handling\n\n`;
  for (const o of copy.objections) {
    output += `### "${o.question}"\n${o.answer}\n\n`;
  }

  // Final CTA
  output += `---\n\n## Final CTA Section\n\n`;
  output += `### Headline\n${copy.finalCta.headline}\n\n`;
  output += `### Body\n${copy.finalCta.body}\n\n`;
  output += `### CTA Button\n[${copy.finalCta.buttonText}]\n\n`;
  output += `### Supporting Text\n${copy.finalCta.supportingText}\n\n`;

  // Meta
  output += `---\n\n## SEO Meta Information\n\n`;
  output += `### Page Title\n${copy.meta.title}\n\n`;
  output += `### Meta Description\n${copy.meta.description}\n\n`;
  output += `### Keywords\n${copy.meta.keywords.join(", ")}\n`;

  return output;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  if (!OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    process.exit(1);
  }

  const options = parseArguments();
  if (!options.product) {
    console.error("Error: Please provide a product/service description.");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    log("Generating landing page copy...");
    const copy = await generateLandingPageCopy(options);
    log("Copy generated successfully", "success");

    if (!options.noImages && copy.hero.imagePrompt) {
      log("Generating hero image...");
      try {
        copy.hero.imagePath = await generateImage(copy.hero.imagePrompt, `hero-image-${SESSION_ID}.png`);
        log("Hero image saved", "success");
      } catch (err) {
        log(`Failed to generate hero image: ${err}`, "error");
      }
    }

    let output: string;
    let ext: string;

    if (options.format === "json") {
      output = JSON.stringify(copy, null, 2);
      ext = "json";
    } else {
      output = formatAsMarkdown(copy, options);
      ext = "md";
    }

    writeFileSync(join(EXPORTS_DIR, `landing-page-copy.${ext}`), output, "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
