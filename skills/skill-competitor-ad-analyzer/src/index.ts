#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { parseArgs } from "util";

// Constants
const SKILL_NAME = "skill-competitor-ad-analyzer";
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
interface AdAnalysis {
  original: {
    copy: string;
    platform?: string;
  };
  messaging: {
    valueProp: string[];
    emotionalTriggers: string[];
    framework: string;
  };
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  improvedVariants: Array<{
    name: string;
    headline: string;
    body: string;
    cta: string;
    whyBetter: string;
    imagePrompt: string;
    imagePath?: string;
  }>;
  recommendations: string[];
}

interface Options {
  adCopy: string;
  image: string;
  generate: number;
  yourBrand: string;
  platform: string;
  focus: string;
  file: string;
  includeImages: boolean;
  format: string;
  verbose: boolean;
}

// Utilities
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(message: string, level: "info" | "error" | "success" = "info"): void {
  ensureDir(LOGS_DIR);
  appendFileSync(join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`), `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`);
  
  const prefixes = { 
    info: "ℹ️ ", 
    error: "❌ ", 
    success: "✅ " 
  };

  if (level === "error") {
    console.error(`${prefixes[level]} ${message}`);
  } else {
    console.log(`${prefixes[level]} ${message}`);
  }
}

function parseArguments(): Options {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      image: { type: "string" },
      generate: { type: "string", default: "2" },
      "your-brand": { type: "string" },
      platform: { type: "string", default: "general" },
      focus: { type: "string", default: "all" },
      file: { type: "string" },
      "include-images": { type: "boolean", default: true },
      "no-images": { type: "boolean", default: false },
      format: { type: "string", default: "markdown" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const adCopy = positionals.join(" ");
  
  return {
    adCopy,
    image: values.image as string,
    generate: parseInt(values.generate as string, 10),
    yourBrand: values["your-brand"] as string,
    platform: values.platform as string,
    focus: values.focus as string,
    file: values.file as string,
    includeImages: (values["include-images"] as boolean) && !(values["no-images"] as boolean),
    format: values.format as string,
    verbose: values.verbose as boolean,
  };
}

function printHelp(): void {
  console.log(`
Competitor Ad Analyzer - Analyze ads and generate improved versions

Usage:
  skills run competitor-ad-analyzer -- "<competitor ad copy>" [options]

Options:
  --image <path>        Path to competitor ad image
  --generate <n>        Number of improved variants (default: 2)
  --your-brand <desc>   Your brand positioning
  --platform <platform> Ad platform: facebook, google, linkedin, instagram
  --focus <focus>       Analysis focus: messaging, visual, emotional, all
  --file <path>         JSON file with multiple ads
  --no-images           Skip image generation
  --format <format>     Output: markdown, json
  --verbose             Show detailed analysis
  --help, -h            Show this help

Examples:
  skills run competitor-ad-analyzer -- "Get fit in 30 days. Join 10,000 members."
  skills run competitor-ad-analyzer -- "The #1 CRM" --your-brand "Enterprise CRM at SMB prices"
`);
}

async function analyzeAd(options: Options): Promise<AdAnalysis> {
  const systemPrompt = `You are an expert advertising strategist and copywriter. Analyze competitor advertisements to extract insights and create superior alternatives.

Your analysis should:
1. Identify the messaging strategy and framework used
2. Extract value propositions and emotional triggers
3. Identify strengths to learn from
4. Find weaknesses and missed opportunities
5. Generate improved ad variants that outperform the original

${options.yourBrand ? `Your brand positioning: ${options.yourBrand}` : ""}
Platform context: ${options.platform}`;

  const userPrompt = `Analyze this competitor ad and generate ${options.generate} improved variants:

COMPETITOR AD:
"${options.adCopy}"

${options.platform !== "general" ? `Platform: ${options.platform}` : ""}

Return JSON:
{
  "original": {
    "copy": "original ad copy",
    "platform": "platform if known"
  },
  "messaging": {
    "valueProp": ["primary value prop", "secondary value prop"],
    "emotionalTriggers": ["trigger 1", "trigger 2"],
    "framework": "identified framework (e.g., Promise-Proof-CTA)"
  },
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "opportunities": ["opportunity 1", "opportunity 2"],
  "improvedVariants": [
    {
      "name": "Variant name/theme",
      "headline": "Improved headline",
      "body": "Improved body copy",
      "cta": "Call to action",
      "whyBetter": "Why this variant is better",
      "imagePrompt": "DALL-E prompt for ad visual"
    }
  ],
  "recommendations": ["strategic recommendation 1", "recommendation 2"]
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
      model: "dall-e-3", // Updated to dall-e-3
      prompt: `Digital advertisement visual: ${prompt}. Professional advertising design, eye-catching, modern, suitable for social media ads.`,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      response_format: "b64_json",
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

function formatAsMarkdown(analysis: AdAnalysis, options: Options): string {
  let output = `# Competitor Ad Analysis\n\n`;
  output += `**Generated:** ${new Date().toISOString()}\n\n`;

  output += `## Original Ad\n`;
  output += `**Platform:** ${analysis.original.platform || options.platform}\n`;
  output += `**Copy:** "${analysis.original.copy}"\n\n---\n\n`;

  output += `## Messaging Analysis\n\n`;
  output += `### Value Propositions\n`;
  analysis.messaging.valueProp.forEach(v => output += `- ${v}\n`);
  output += `\n### Emotional Triggers\n`;
  analysis.messaging.emotionalTriggers.forEach(t => output += `- ${t}\n`);
  output += `\n### Copy Framework\n${analysis.messaging.framework}\n\n---\n\n`;

  output += `## Strengths\n`;
  analysis.strengths.forEach((s, i) => output += `${i + 1}. ${s}\n`);

  output += `\n## Weaknesses & Opportunities\n\n`;
  output += `### Weaknesses\n`;
  analysis.weaknesses.forEach((w, i) => output += `${i + 1}. ${w}\n`);
  output += `\n### Opportunities\n`;
  analysis.opportunities.forEach((o, i) => output += `${i + 1}. ${o}\n`);

  output += `\n---\n\n## Improved Ad Variants\n\n`;
  for (let i = 0; i < analysis.improvedVariants.length; i++) {
    const v = analysis.improvedVariants[i];
    output += `### Variant ${i + 1}: ${v.name}\n\n`;
    output += `**Headline:** ${v.headline}\n\n`;
    output += `**Body:**\n${v.body}\n\n`;
    output += `**CTA:** [${v.cta}]\n\n`;
    output += `**Why It's Better:**\n${v.whyBetter}\n\n`;
    if (v.imagePath) output += `**Image:** ${v.imagePath}\n\n`;
    output += `---\n\n`;
  }

  output += `## Strategic Recommendations\n\n`;
  analysis.recommendations.forEach((r, i) => output += `${i + 1}. ${r}\n`);

  return output;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  
  // Parse args first to check for help
  const options = parseArguments();

  log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`);

  if (!OPENAI_API_KEY) {
    log("Error: OPENAI_API_KEY environment variable is required.", "error");
    process.exit(1);
  }

  if (!options.adCopy && !options.file) {
    log("Error: Please provide competitor ad copy or a file.", "error");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    log("Analyzing competitor ad...");
    const analysis = await analyzeAd(options);
    log("Analysis complete", "success");

    if (options.includeImages) {
      log("Generating improved ad images...");
      for (let i = 0; i < analysis.improvedVariants.length; i++) {
        const variant = analysis.improvedVariants[i];
        try {
          const filename = `improved-ad-variant-${i + 1}-${SESSION_ID}.png`;
          variant.imagePath = await generateImage(variant.imagePrompt, filename);
          log(`Image saved: ${filename}`, "success");
        } catch (err) {
          log(`Failed to generate image: ${err}`, "error");
        }
      }
    }

    let output: string;
    let ext: string;

    if (options.format === "json") {
      output = JSON.stringify(analysis, null, 2);
      ext = "json";
    } else {
      output = formatAsMarkdown(analysis, options);
      ext = "md";
    }

    writeFileSync(join(EXPORTS_DIR, `ad-analysis.${ext}`), output, "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
