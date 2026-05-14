#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type Tone = "direct" | "premium" | "friendly" | "technical";

interface AdOptions {
  product: string;
  audience: string;
  offer: string;
  goal: string;
  platforms: string[];
  tone: Tone;
  outputDir: string;
}

interface PlatformCopy {
  platform: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
}

interface CreativeConcept {
  name: string;
  angle: string;
  visual: string;
  hook: string;
}

const SKILL_NAME = "ad-creative-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const DEFAULT_PLATFORMS = ["Meta", "Google", "LinkedIn"];

const HELP = `Ad Creative Pack

Usage:
  skills run ad-creative-pack "Usage-based billing for AI SaaS" --audience "founders"
  skills run ad-creative-pack --product "API monitoring" --offer "Find broken API workflows before customers do"

Options:
  --product <text>    Product, service, or campaign brief. Positional text also works.
  --audience <text>   Target buyer or segment. Default: software teams
  --offer <text>      Campaign promise or offer. Default: derived from product
  --goal <text>       Conversion goal. Default: book demos
  --platforms <list>  Comma-separated platforms. Default: Meta, Google, LinkedIn
  --tone <tone>       direct, premium, friendly, or technical. Default: direct
  --output <dir>      Output directory. Default: current run export directory
  --help              Show help

Outputs:
  platform-copy.md, ad-copy.json, creative-concepts.md, image-prompts.md, audience-angles.csv, test-matrix.csv, launch-checklist.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const copy = options.platforms.flatMap((platform) => copyForPlatform(platform, options));
  const concepts = buildConcepts(options);
  const files = writeArtifacts(options, copy, concepts);

  console.log(`Generated ad creative pack for ${options.product}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const file of Object.values(files)) {
    console.log(`- ${file}`);
  }
}

function parseCliOptions(): AdOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      product: { type: "string" },
      audience: { type: "string", default: "software teams" },
      offer: { type: "string" },
      goal: { type: "string", default: "book demos" },
      platforms: { type: "string" },
      tone: { type: "string", default: "direct" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const product = String(values.product || positionals.join(" ")).trim();
  if (!product) {
    console.error("Product is required. Pass --product <text> or positional text.");
    process.exit(1);
  }

  const tone = String(values.tone || "direct");
  if (!isTone(tone)) {
    console.error("Invalid tone. Use direct, premium, friendly, or technical.");
    process.exit(1);
  }

  const audience = String(values.audience || "software teams").trim();
  return {
    product,
    audience,
    offer: String(values.offer || defaultOffer(product, audience)).trim(),
    goal: String(values.goal || "book demos").trim(),
    platforms: splitList(values.platforms, DEFAULT_PLATFORMS),
    tone,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function copyForPlatform(platform: string, options: AdOptions): PlatformCopy[] {
  const cta = ctaForGoal(options.goal);
  const product = titleCase(options.product);
  const platformKey = platform.toLowerCase();
  const voice = tonePhrase(options.tone);
  const base = `${options.offer}. ${voice}`;

  if (platformKey.includes("google")) {
    return [
      {
        platform,
        headline: `${product} for ${options.audience}`,
        primaryText: `Search ad: ${base} Capture demand from buyers already looking for a better workflow.`,
        description: `Turn ${options.goal} into a clear next step.`,
        cta,
      },
      {
        platform,
        headline: `Fix ${shortProblem(options.product)}`,
        primaryText: `Search ad: reduce manual work, improve handoffs, and move faster with ${product}.`,
        description: `Built for ${options.audience}.`,
        cta,
      },
    ];
  }

  if (platformKey.includes("linkedin")) {
    return [
      {
        platform,
        headline: `${product}: a clearer path for ${options.audience}`,
        primaryText: `${base} Use this ad for decision makers comparing operational impact, time to value, and implementation lift.`,
        description: `A practical way to ${options.goal}.`,
        cta,
      },
      {
        platform,
        headline: `The hidden cost of slow ${shortProblem(options.product)}`,
        primaryText: `Show the business cost, then position ${product} as the next accountable workflow for ${options.audience}.`,
        description: `Make the case in one click.`,
        cta,
      },
    ];
  }

  return [
    {
      platform,
      headline: `${product} without the usual drag`,
      primaryText: `${base} Use a bold visual, one concrete pain point, and a single action.`,
      description: `For ${options.audience} who need momentum.`,
      cta,
    },
    {
      platform,
      headline: `Before and after: ${product}`,
      primaryText: `Show the messy current state next to the cleaner outcome. Keep the message simple and action-oriented.`,
      description: `Move from friction to flow.`,
      cta,
    },
  ];
}

function buildConcepts(options: AdOptions): CreativeConcept[] {
  const product = titleCase(options.product);
  return [
    {
      name: "Before / After Workflow",
      angle: `Show the old workflow against the cleaner path enabled by ${product}.`,
      visual: `Split-screen product workflow, left side cluttered manual steps, right side clean progress view for ${options.audience}.`,
      hook: `Stop losing time to ${shortProblem(options.product)}.`,
    },
    {
      name: "Outcome Receipt",
      angle: `Turn the promised outcome into a tangible proof card tied to ${options.goal}.`,
      visual: `A crisp dashboard-style receipt showing saved time, fewer handoffs, and a completed next step.`,
      hook: `${options.offer}.`,
    },
    {
      name: "Decision Moment",
      angle: `Focus on the moment a buyer realizes the current process is no longer enough.`,
      visual: `Founder or operator reviewing a clear checklist with one highlighted next action.`,
      hook: `The next decision should not take another week.`,
    },
  ];
}

function writeArtifacts(options: AdOptions, copy: PlatformCopy[], concepts: CreativeConcept[]) {
  const files = {
    platformCopy: "platform-copy.md",
    adCopy: "ad-copy.json",
    creativeConcepts: "creative-concepts.md",
    imagePrompts: "image-prompts.md",
    audienceAngles: "audience-angles.csv",
    testMatrix: "test-matrix.csv",
    launchChecklist: "launch-checklist.md",
    manifest: "manifest.json",
  };

  writeFile(join(options.outputDir, files.platformCopy), renderPlatformCopy(options, copy));
  writeJson(join(options.outputDir, files.adCopy), { schemaVersion: 1, ads: copy });
  writeFile(join(options.outputDir, files.creativeConcepts), renderConcepts(options, concepts));
  writeFile(join(options.outputDir, files.imagePrompts), renderImagePrompts(options, concepts));
  writeFile(join(options.outputDir, files.audienceAngles), renderAudienceAngles(options));
  writeFile(join(options.outputDir, files.testMatrix), renderTestMatrix(options, copy, concepts));
  writeFile(join(options.outputDir, files.launchChecklist), renderLaunchChecklist(options));
  writeJson(join(options.outputDir, files.manifest), {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      product: options.product,
      audience: options.audience,
      offer: options.offer,
      goal: options.goal,
      platforms: options.platforms,
      tone: options.tone,
    },
    adCount: copy.length,
    conceptCount: concepts.length,
    files,
  });

  return files;
}

function renderPlatformCopy(options: AdOptions, copy: PlatformCopy[]): string {
  return `# Ad Creative Pack: ${titleCase(options.product)}

## Campaign Brief

- Product: ${options.product}
- Audience: ${options.audience}
- Offer: ${options.offer}
- Conversion goal: ${options.goal}
- Platforms: ${options.platforms.join(", ")}

## Platform Copy

${copy.map((ad) => `### ${ad.platform}: ${ad.headline}

${ad.primaryText}

Description: ${ad.description}

CTA: ${ad.cta}
`).join("\n")}
`;
}

function renderConcepts(options: AdOptions, concepts: CreativeConcept[]): string {
  return `# Creative Concepts

${concepts.map((concept, index) => `## ${index + 1}. ${concept.name}

- Angle: ${concept.angle}
- Visual: ${concept.visual}
- Hook: ${concept.hook}
- Best fit: ${bestFit(options.platforms, index)}
`).join("\n")}
`;
}

function renderImagePrompts(options: AdOptions, concepts: CreativeConcept[]): string {
  return `# Image Prompts

${concepts.map((concept) => `## ${concept.name}

Prompt: Create a polished paid-ad visual for ${titleCase(options.product)}. ${concept.visual} Use clear composition, no text embedded in the image, realistic product context, and a style suitable for ${options.audience}.

Negative prompt: avoid fake UI details, crowded layouts, illegible text, and generic office stock imagery.
`).join("\n")}
`;
}

function renderAudienceAngles(options: AdOptions): string {
  const rows = [
    ["segment", "pain", "promise", "proof_needed"],
    [options.audience, `too much friction around ${shortProblem(options.product)}`, options.offer, "workflow screenshot or short customer quote"],
    ["economic buyer", "unclear payback", `connect ${options.goal} to financial impact`, "before and after metric"],
    ["technical evaluator", "implementation risk", `show a clean setup path for ${options.product}`, "architecture note or checklist"],
    ["operator", "manual follow-up work", "reduce handoffs and make ownership visible", "operations dashboard example"],
  ];
  return renderCsv(rows);
}

function renderTestMatrix(options: AdOptions, copy: PlatformCopy[], concepts: CreativeConcept[]): string {
  const rows = [
    ["platform", "audience_angle", "copy_variant", "creative_concept", "primary_metric", "success_signal"],
    ...copy.map((ad, index) => [
      ad.platform,
      angleForIndex(index),
      ad.headline,
      concepts[index % concepts.length].name,
      eventForGoal(options.goal),
      "qualified click rate improves and conversion cost decreases",
    ]),
  ];
  return renderCsv(rows);
}

function renderLaunchChecklist(options: AdOptions): string {
  return `# Launch Checklist

## Before Launch

- Confirm offer, landing page, and CTA all point to: ${options.goal}.
- Match each ad to one audience angle and one creative concept.
- Review claims for accuracy with product and sales owners.
- Create separate tracking links for each platform and variant.
- Exclude existing customers unless the campaign is for expansion.

## First 72 Hours

- Check spend pacing, rejected ads, and broken links twice per day.
- Pause variants with high spend and no qualified engagement.
- Keep one control ad live while testing new hooks.
- Save learnings into the next creative brief.
`;
}

function defaultOffer(product: string, audience: string): string {
  return `${titleCase(product)} helps ${audience} act faster with a clearer workflow`;
}

function ctaForGoal(goal: string): string {
  const normalized = goal.toLowerCase();
  if (normalized.includes("demo")) return "Book a demo";
  if (normalized.includes("trial")) return "Start a trial";
  if (normalized.includes("signup") || normalized.includes("sign up")) return "Start signup";
  if (normalized.includes("download")) return "Download now";
  return `Start ${goal}`;
}

function eventForGoal(goal: string): string {
  return `ad_${slugify(goal)}_conversion`;
}

function shortProblem(product: string): string {
  const words = product.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.slice(0, 4).join(" ") || "the workflow";
}

function bestFit(platforms: string[], index: number): string {
  return platforms[index % platforms.length] || "Meta";
}

function angleForIndex(index: number): string {
  return ["pain aware", "outcome aware", "risk aware", "comparison aware"][index % 4];
}

function tonePhrase(tone: Tone): string {
  if (tone === "premium") return "Keep the claim confident and restrained.";
  if (tone === "friendly") return "Use helpful language and low-friction wording.";
  if (tone === "technical") return "Name the workflow, constraints, and measurable result.";
  return "Make the value clear in the first sentence.";
}

function splitList(value: unknown, fallback: string[]): string[] {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
}

function isTone(value: string): value is Tone {
  return ["direct", "premium", "friendly", "technical"].includes(value);
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "event";
}

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function renderCsv(rows: string[][]): string {
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  return [
    header.join(","),
    ...body.map((row) => row.map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function writeJson(path: string, value: unknown) {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path: string, value: string) {
  ensureDir(dirname(path));
  writeFileSync(path, value);
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
