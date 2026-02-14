#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { parseArgs } from "util";

// Constants
const SKILL_NAME = "skill-email-campaign";
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
interface Email {
  sequence: number;
  subject: string[];
  previewText: string;
  body: string;
  cta: { primary: string; secondary?: string };
  imagePrompt: string;
  imagePath?: string;
  sendTiming?: string;
}

interface Campaign {
  type: string;
  emailCount: number;
  emails: Email[];
}

interface Options {
  topic: string;
  type: string;
  emails: number;
  variants: number;
  brand: string;
  tone: string;
  cta: string;
  audience: string;
  format: string;
  noImages: boolean;
  verbose: boolean;
}

// Campaign type configs
const CAMPAIGN_TYPES: Record<string, { emails: number; timing: string[] }> = {
  single: { emails: 1, timing: ["immediately"] },
  launch: { emails: 5, timing: ["Day -3", "Day -1", "Day 0", "Day 2", "Day 5"] },
  welcome: { emails: 4, timing: ["Day 0", "Day 2", "Day 4", "Day 7"] },
  nurture: { emails: 6, timing: ["Day 0", "Day 3", "Day 7", "Day 14", "Day 21", "Day 30"] },
  reengagement: { emails: 3, timing: ["Day 0", "Day 3", "Day 7"] },
  newsletter: { emails: 1, timing: ["weekly"] },
  sale: { emails: 3, timing: ["Day 0", "Day 2", "Last day"] },
  abandoned: { emails: 3, timing: ["1 hour", "24 hours", "48 hours"] },
};

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
      type: { type: "string", default: "single" },
      emails: { type: "string", default: "0" },
      variants: { type: "string", default: "2" },
      brand: { type: "string", default: "neutral" },
      tone: { type: "string", default: "friendly" },
      cta: { type: "string", default: "auto" },
      audience: { type: "string", default: "general" },
      format: { type: "string", default: "markdown" },
      "no-images": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const topic = positionals.join(" ");
  
  let emails = parseInt(values.emails as string, 10);
  const type = values.type as string;

  // Set default email count based on type
  if (emails === 0) {
    emails = CAMPAIGN_TYPES[type]?.emails || 1;
  }

  return {
    topic,
    type,
    emails,
    variants: parseInt(values.variants as string, 10),
    brand: values.brand as string,
    tone: values.tone as string,
    cta: values.cta as string,
    audience: values.audience as string,
    format: values.format as string,
    noImages: values["no-images"] as boolean,
    verbose: values.verbose as boolean,
  };
}

function printHelp(): void {
  console.log(`
Email Campaign Generator - Create email sequences with copy and images

Usage:
  skills run email-campaign -- "<campaign topic>" [options]

Options:
  --type <type>         Campaign type: single, launch, welcome, nurture, reengagement, newsletter, sale, abandoned
  --emails <n>          Number of emails in sequence
  --variants <n>        Subject line variants for A/B testing (default: 2)
  --brand <desc>        Brand voice description
  --tone <tone>         Tone: professional, friendly, urgent, exclusive
  --cta <text>          Primary call-to-action
  --audience <desc>     Target audience description
  --format <format>     Output: markdown, json, html
  --no-images           Skip hero image generation
  --verbose             Show detailed progress
  --help, -h            Show this help

Examples:
  skills run email-campaign -- "Summer sale: 30% off all products"
  skills run email-campaign -- "New product launch" --type launch
  skills run email-campaign -- "Welcome to membership" --type welcome --emails 4
`);
}

async function generateEmailCampaign(options: Options): Promise<Campaign> {
  const typeConfig = CAMPAIGN_TYPES[options.type] || CAMPAIGN_TYPES.single;

  const systemPrompt = `You are an expert email marketing copywriter. Create compelling email campaigns that convert.
Brand voice: ${options.brand}
Target audience: ${options.audience}
Tone: ${options.tone}

Best practices:
- Subject lines: 30-50 characters, curiosity-inducing
- Preview text: Complements subject, 40-90 characters
- Body: Scannable, benefit-focused, single CTA focus
- Avoid spam trigger words`;

  const userPrompt = `Create a ${options.type} email campaign for:
"${options.topic}"

Campaign details:
- Number of emails: ${options.emails}
- Subject line variants per email: ${options.variants}
- Timing: ${typeConfig.timing.slice(0, options.emails).join(", ")}
${options.cta !== "auto" ? `- Preferred CTA: ${options.cta}` : ""}

Return JSON:
{
  "type": "${options.type}",
  "emailCount": ${options.emails},
  "emails": [{
    "sequence": 1,
    "subject": ["Subject A", "Subject B"],
    "previewText": "Preview text here",
    "body": "Full email body with [Name] merge tags, formatted with paragraphs",
    "cta": { "primary": "CTA text", "secondary": "Optional secondary" },
    "imagePrompt": "DALL-E prompt for hero image",
    "sendTiming": "timing description"
  }]
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
      prompt: `Email hero image: ${prompt}. Professional marketing visual, clean design, no text, suitable for email header at 600px wide.`,
      n: 1,
      size: "1024x1024", // DALL-E 3 standard size
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

function formatOutput(campaign: Campaign, options: Options): string {
  if (options.format === "json") return JSON.stringify(campaign, null, 2);

  let output = `# Email Campaign: ${options.topic}\n\n`;
  output += `**Type:** ${campaign.type}\n`;
  output += `**Emails:** ${campaign.emailCount}\n`;
  output += `**Generated:** ${new Date().toISOString()}\n\n---\n\n`;

  for (const email of campaign.emails) {
    output += `## Email ${email.sequence}${email.sendTiming ? ` (${email.sendTiming})` : ""}\n\n`;

    output += `### Subject Lines (A/B Test)\n`;
    email.subject.forEach((subj, i) => {
      output += `- ${String.fromCharCode(65 + i)}: "${subj}"\n`;
    });
    output += `\n`;

    output += `### Preview Text\n"${email.previewText}"\n\n`;

    if (email.imagePath) {
      output += `### Hero Image\n${email.imagePath}\n\n`;
    }

    output += `### Email Body\n\n${email.body}\n\n`;

    output += `### CTA\n`;
    output += `- **Primary:** [${email.cta.primary}]\n`;
    if (email.cta.secondary) output += `- **Secondary:** [${email.cta.secondary}]\n`;
    output += `\n---\n\n`;
  }

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

  if (!options.topic) {
    log("Error: Please provide a campaign topic.", "error");
    process.exit(1);
  }

  ensureDir(EXPORTS_DIR);

  try {
    log("Generating email campaign...");
    const campaign = await generateEmailCampaign(options);
    log(`Generated ${campaign.emails.length} emails`, "success");

    if (!options.noImages) {
      log("Generating hero images...");
      for (const email of campaign.emails) {
        try {
          const filename = `email-${email.sequence}-hero-${SESSION_ID}.png`;
          email.imagePath = await generateImage(email.imagePrompt, filename);
          log(`Image saved: ${filename}`, "success");
        } catch (err) {
          log(`Failed to generate image: ${err}`, "error");
        }
      }
    }

    const output = formatOutput(campaign, options);
    const ext = options.format === "json" ? "json" : "md";
    writeFileSync(join(EXPORTS_DIR, `email-campaign.${ext}`), output, "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
