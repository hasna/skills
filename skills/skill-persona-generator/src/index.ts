#!/usr/bin/env bun

import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Constants
const SKILL_NAME = "skill-persona-generator";
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
interface Persona {
  name: string;
  role: string;
  bio: string;
  avatarPrompt: string;
  avatarPath?: string;
  demographics: {
    ageRange: string;
    gender: string;
    education: string;
    income: string;
    location: string;
    familyStatus: string;
  };
  psychographics: {
    values: string[];
    personality: string[];
    interests: string[];
  };
  professional: {
    responsibilities: string[];
    tools: string[];
    reportsTo: string;
    successMetrics: string[];
  };
  painPoints: {
    frustrations: string[];
    quotes: string[];
  };
  goals: {
    professional: string[];
    personal: string[];
    successLooksLike: string;
  };
  buyingBehavior: {
    researchProcess: string[];
    decisionFactors: string[];
    triggers: string[];
    objections: string[];
  };
  content: {
    preferredFormats: string[];
    preferredChannels: string[];
    trustedSources: string[];
  };
  messaging: {
    primaryMessage: string;
    valueProps: string[];
    emotionalAppeals: string[];
    wordsResonate: string[];
    wordsAvoid: string[];
  };
  marketing: {
    bestChannels: string[];
    contentToCreate: string[];
    campaignIdeas: string[];
  };
}

interface Options {
  product: string;
  count: number;
  industry: string;
  segment: string;
  data: string;
  b2b: boolean;
  b2c: boolean;
  includeNegative: boolean;
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
  console.log(`[${level.toUpperCase()}] ${message}`);
}

function parseArguments(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    product: "",
    count: 1,
    industry: "auto",
    segment: "auto",
    data: "",
    b2b: false,
    b2c: false,
    includeNegative: false,
    format: "markdown",
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--count": options.count = parseInt(args[++i], 10); break;
      case "--industry": options.industry = args[++i]; break;
      case "--segment": options.segment = args[++i]; break;
      case "--data": options.data = args[++i]; break;
      case "--b2b": options.b2b = true; break;
      case "--b2c": options.b2c = true; break;
      case "--include-negative": options.includeNegative = true; break;
      case "--format": options.format = args[++i]; break;
      case "--verbose": options.verbose = true; break;
      case "--help": case "-h": printHelp(); process.exit(0);
      default: if (!arg.startsWith("-") && !options.product) options.product = arg;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`
Persona Generator - Create detailed buyer personas

Usage:
  skills run persona-generator -- "<product/service description>" [options]

Options:
  --count <n>           Number of personas (default: 1)
  --industry <industry> Industry context
  --segment <segment>   Target segment description
  --data <hints>        Existing customer data hints
  --b2b                 Generate B2B personas
  --b2c                 Generate B2C personas
  --include-negative    Include anti-persona
  --format <format>     Output: markdown, json
  --verbose             Show detailed progress

Examples:
  skills run persona-generator -- "B2B project management software"
  skills run persona-generator -- "Online fitness coaching" --count 3 --b2c
`);
}

async function generatePersona(options: Options, index: number): Promise<Persona> {
  const businessType = options.b2b ? "B2B" : options.b2c ? "B2C" : "general";

  const systemPrompt = `You are an expert market researcher and customer insights specialist. Create detailed, realistic buyer personas based on market analysis and customer research best practices.

Business type: ${businessType}
${options.industry !== "auto" ? `Industry: ${options.industry}` : ""}
${options.segment !== "auto" ? `Target segment: ${options.segment}` : ""}
${options.data ? `Customer data hints: ${options.data}` : ""}

Create personas that are:
- Specific and actionable
- Based on realistic demographics
- Useful for marketing and sales alignment
- Include both rational and emotional drivers`;

  const userPrompt = `Create a detailed buyer persona for:
"${options.product}"

This is persona ${index + 1} of ${options.count}. ${options.count > 1 ? "Make this persona distinct from others." : ""}

Return JSON:
{
  "name": "Persona Name (e.g., 'Marketing Manager Maya')",
  "role": "Job title",
  "bio": "2-3 sentence bio",
  "avatarPrompt": "DALL-E prompt for professional headshot avatar (describe appearance, age, style, professional setting)",
  "demographics": {
    "ageRange": "e.g., 28-35",
    "gender": "e.g., Female (but persona applies to all)",
    "education": "e.g., Bachelor's + MBA",
    "income": "e.g., $85K-$110K",
    "location": "e.g., Urban tech hub cities",
    "familyStatus": "e.g., DINK or young family"
  },
  "psychographics": {
    "values": ["value 1", "value 2"],
    "personality": ["trait 1", "trait 2"],
    "interests": ["interest 1", "interest 2"]
  },
  "professional": {
    "responsibilities": ["responsibility 1", "responsibility 2"],
    "tools": ["tool 1", "tool 2"],
    "reportsTo": "e.g., VP of Marketing",
    "successMetrics": ["metric 1", "metric 2"]
  },
  "painPoints": {
    "frustrations": ["frustration 1", "frustration 2"],
    "quotes": ["Quote they would say", "Another quote"]
  },
  "goals": {
    "professional": ["goal 1", "goal 2"],
    "personal": ["goal 1", "goal 2"],
    "successLooksLike": "Description of success"
  },
  "buyingBehavior": {
    "researchProcess": ["step 1", "step 2"],
    "decisionFactors": ["factor 1", "factor 2"],
    "triggers": ["trigger 1", "trigger 2"],
    "objections": ["objection 1", "objection 2"]
  },
  "content": {
    "preferredFormats": ["format 1", "format 2"],
    "preferredChannels": ["channel 1", "channel 2"],
    "trustedSources": ["source 1", "source 2"]
  },
  "messaging": {
    "primaryMessage": "Key message that resonates",
    "valueProps": ["value prop 1", "value prop 2"],
    "emotionalAppeals": ["appeal 1", "appeal 2"],
    "wordsResonate": ["word 1", "word 2"],
    "wordsAvoid": ["word 1", "word 2"]
  },
  "marketing": {
    "bestChannels": ["channel 1", "channel 2"],
    "contentToCreate": ["content idea 1", "content idea 2"],
    "campaignIdeas": ["campaign 1", "campaign 2"]
  }
}`;

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      max_tokens: 4096,
      temperature: 0.8,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const result = await response.json();
  let content = result.choices[0]?.message?.content || "{}";
  if (content.includes("```json")) content = content.replace(/```json\n?/g, "").replace(/```\n?/g, "");

  return JSON.parse(content.trim());
}

async function generateAvatar(prompt: string, filename: string): Promise<string> {
  const response = await fetch(OPENAI_IMAGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt: `Professional headshot portrait: ${prompt}. Corporate photography style, neutral background, warm lighting, professional appearance, suitable for business persona profile.`,
      n: 1,
      size: "1024x1024",
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

function formatAsMarkdown(personas: Persona[]): string {
  let output = `# Buyer Personas\n\n`;
  output += `**Generated:** ${new Date().toISOString()}\n`;
  output += `**Total Personas:** ${personas.length}\n\n`;

  for (const p of personas) {
    output += `---\n\n# ${p.name}\n\n`;
    if (p.avatarPath) output += `![Avatar](${p.avatarPath})\n\n`;

    output += `## Overview\n\n`;
    output += `**Role:** ${p.role}\n`;
    output += `**Bio:** ${p.bio}\n\n`;

    output += `## Demographics\n\n`;
    output += `| Attribute | Detail |\n|-----------|--------|\n`;
    output += `| Age Range | ${p.demographics.ageRange} |\n`;
    output += `| Education | ${p.demographics.education} |\n`;
    output += `| Income | ${p.demographics.income} |\n`;
    output += `| Location | ${p.demographics.location} |\n`;
    output += `| Family | ${p.demographics.familyStatus} |\n\n`;

    output += `## Psychographics\n\n`;
    output += `### Values\n`;
    p.psychographics.values.forEach(v => output += `- ${v}\n`);
    output += `\n### Personality\n`;
    p.psychographics.personality.forEach(t => output += `- ${t}\n`);
    output += `\n### Interests\n`;
    p.psychographics.interests.forEach(i => output += `- ${i}\n`);

    output += `\n## Professional Context\n\n`;
    output += `**Reports To:** ${p.professional.reportsTo}\n\n`;
    output += `### Responsibilities\n`;
    p.professional.responsibilities.forEach(r => output += `- ${r}\n`);
    output += `\n### Tools\n`;
    p.professional.tools.forEach(t => output += `- ${t}\n`);
    output += `\n### Success Metrics\n`;
    p.professional.successMetrics.forEach(m => output += `- ${m}\n`);

    output += `\n## Pain Points\n\n`;
    output += `### Frustrations\n`;
    p.painPoints.frustrations.forEach(f => output += `- ${f}\n`);
    output += `\n### Quotes\n`;
    p.painPoints.quotes.forEach(q => output += `> "${q}"\n\n`);

    output += `## Goals\n\n`;
    output += `### Professional\n`;
    p.goals.professional.forEach(g => output += `- ${g}\n`);
    output += `\n### Personal\n`;
    p.goals.personal.forEach(g => output += `- ${g}\n`);
    output += `\n### Success Looks Like\n${p.goals.successLooksLike}\n`;

    output += `\n## Buying Behavior\n\n`;
    output += `### Research Process\n`;
    p.buyingBehavior.researchProcess.forEach((s, i) => output += `${i + 1}. ${s}\n`);
    output += `\n### Decision Factors\n`;
    p.buyingBehavior.decisionFactors.forEach((f, i) => output += `${i + 1}. ${f}\n`);
    output += `\n### Triggers\n`;
    p.buyingBehavior.triggers.forEach(t => output += `- ${t}\n`);
    output += `\n### Objections\n`;
    p.buyingBehavior.objections.forEach(o => output += `- "${o}"\n`);

    output += `\n## Content Preferences\n\n`;
    output += `### Formats\n`;
    p.content.preferredFormats.forEach(f => output += `- ${f}\n`);
    output += `\n### Channels\n`;
    p.content.preferredChannels.forEach(c => output += `- ${c}\n`);
    output += `\n### Trusted Sources\n`;
    p.content.trustedSources.forEach(s => output += `- ${s}\n`);

    output += `\n## Messaging Framework\n\n`;
    output += `**Primary Message:** "${p.messaging.primaryMessage}"\n\n`;
    output += `### Value Props\n`;
    p.messaging.valueProps.forEach(v => output += `- ${v}\n`);
    output += `\n### Words That Resonate\n${p.messaging.wordsResonate.join(", ")}\n`;
    output += `\n### Words to Avoid\n${p.messaging.wordsAvoid.join(", ")}\n`;

    output += `\n## Marketing Recommendations\n\n`;
    output += `### Best Channels\n`;
    p.marketing.bestChannels.forEach(c => output += `- ${c}\n`);
    output += `\n### Content to Create\n`;
    p.marketing.contentToCreate.forEach(c => output += `- ${c}\n`);
    output += `\n### Campaign Ideas\n`;
    p.marketing.campaignIdeas.forEach(c => output += `- ${c}\n`);
    output += `\n`;
  }

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
    const personas: Persona[] = [];

    for (let i = 0; i < options.count; i++) {
      log(`Generating persona ${i + 1}/${options.count}...`);
      const persona = await generatePersona(options, i);

      // Generate avatar
      try {
        const filename = `persona-${i + 1}-avatar-${SESSION_ID}.png`;
        persona.avatarPath = await generateAvatar(persona.avatarPrompt, filename);
        log(`Avatar saved: ${filename}`, "success");
      } catch (err) {
        log(`Failed to generate avatar: ${err}`, "error");
      }

      personas.push(persona);
      log(`Persona "${persona.name}" created`, "success");
    }

    let output: string;
    let ext: string;

    if (options.format === "json") {
      output = JSON.stringify(personas, null, 2);
      ext = "json";
    } else {
      output = formatAsMarkdown(personas);
      ext = "md";
    }

    writeFileSync(join(EXPORTS_DIR, `buyer-personas.${ext}`), output, "utf-8");

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(output);

    log(`Completed in ${Date.now() - startTime}ms`, "success");
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
