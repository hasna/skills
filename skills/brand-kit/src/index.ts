#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type Tone = "direct" | "premium" | "friendly" | "technical";

interface BrandOptions {
  brand: string;
  category: string;
  audience: string;
  personality: string;
  tone: Tone;
  outputDir: string;
}

interface ColorToken {
  name: string;
  hex: string;
  use: string;
}

const SKILL_NAME = "brand-kit";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `Brand Kit

Usage:
  skills run brand-kit "Usage-based billing for AI SaaS" --audience "founders"
  skills run brand-kit --brand "Acme Ledger" --category "developer tools" --personality "precise, calm, pragmatic"

Options:
  --brand <text>        Brand, product, or company name. Positional text also works.
  --category <text>     Market category or product type. Default: software product
  --audience <text>     Primary audience. Default: software teams
  --personality <text>  Brand personality words. Default: clear, capable, direct
  --tone <tone>         direct, premium, friendly, or technical. Default: direct
  --output <dir>        Output directory. Default: current run export directory
  --help                Show help

Outputs:
  brand-guide.md, brand-guide.pdf, palette.json, typography.md, voice-guide.md, logo-usage.md, sample-applications.md, brand-assets.svg, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const palette = buildPalette(options);
  const guide = renderBrandGuide(options, palette);
  const files = writeArtifacts(options, palette, guide);

  console.log(`Generated brand kit for ${options.brand}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const file of Object.values(files)) {
    console.log(`- ${file}`);
  }
}

function parseCliOptions(): BrandOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brand: { type: "string" },
      category: { type: "string", default: "software product" },
      audience: { type: "string", default: "software teams" },
      personality: { type: "string", default: "clear, capable, direct" },
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

  const brand = String(values.brand || positionals.join(" ")).trim();
  if (!brand) {
    console.error("Brand is required. Pass --brand <text> or positional text.");
    process.exit(1);
  }

  const tone = String(values.tone || "direct");
  if (!isTone(tone)) {
    console.error("Invalid tone. Use direct, premium, friendly, or technical.");
    process.exit(1);
  }

  return {
    brand,
    category: String(values.category || "software product").trim(),
    audience: String(values.audience || "software teams").trim(),
    personality: String(values.personality || "clear, capable, direct").trim(),
    tone,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildPalette(options: BrandOptions): ColorToken[] {
  const seed = hash(options.brand);
  const hue = seed % 360;
  const accentHue = (hue + 72) % 360;
  const supportHue = (hue + 180) % 360;
  return [
    {
      name: "ink",
      hex: hslToHex(hue, 28, 15),
      use: "Primary text, wordmark, high-contrast UI anchors.",
    },
    {
      name: "paper",
      hex: hslToHex((hue + 24) % 360, 30, 96),
      use: "Backgrounds, quiet cards, and printable guide surfaces.",
    },
    {
      name: "accent",
      hex: hslToHex(accentHue, 62, 48),
      use: "Primary actions, active states, and campaign highlights.",
    },
    {
      name: "support",
      hex: hslToHex(supportHue, 46, 58),
      use: "Charts, secondary illustrations, and comparison states.",
    },
    {
      name: "mist",
      hex: hslToHex(hue, 24, 88),
      use: "Subtle panels, dividers, empty states, and diagrams.",
    },
  ];
}

function renderBrandGuide(options: BrandOptions, palette: ColorToken[]) {
  return [
    `# ${titleCase(options.brand)} Brand Guide`,
    "",
    `Category: ${options.category}`,
    `Audience: ${options.audience}`,
    `Personality: ${options.personality}`,
    `Tone: ${options.tone}`,
    "",
    "## Positioning",
    "",
    `${titleCase(options.brand)} should feel ${voicePhrase(options)}. The brand should make ${options.audience} feel that the product is practical enough to adopt and polished enough to trust.`,
    "",
    "## Logo System",
    "",
    "- Use the primary mark on light backgrounds for product, docs, and sales surfaces.",
    "- Use the reversed mark only on dark or saturated backgrounds.",
    "- Keep clear space equal to the mark height on every side.",
    "- Do not stretch, rotate, outline, add shadows, or recolor the mark outside the palette.",
    "",
    "## Palette",
    "",
    "| Token | Hex | Use |",
    "| --- | --- | --- |",
    ...palette.map((color) => `| ${color.name} | ${color.hex} | ${color.use} |`),
    "",
    "## Typography",
    "",
    "- Display: Sora or a similarly geometric sans for concise headlines.",
    "- Interface: Manrope, Inter, or a comparable readable sans for dense product surfaces.",
    "- Mono: JetBrains Mono or IBM Plex Mono for commands, snippets, and technical labels.",
    "- Keep headings confident but not oversized inside product UI.",
    "",
    "## Voice",
    "",
    `Write in a ${tonePhrase(options.tone)} style. Favor concrete claims, specific nouns, and visible proof. Avoid vague acceleration language unless it is tied to an observable workflow improvement.`,
    "",
    "## Sample Applications",
    "",
    "- Website hero with one proof-led headline, one compact paragraph, and one primary action.",
    "- Product dashboard with muted backgrounds, strong labels, and restrained accent color.",
    "- Sales one-pager with a short positioning statement, proof bullets, and implementation notes.",
    "- Social launch card with one outcome, one screenshot area, and one direct CTA.",
  ].join("\n");
}

function renderTypography(options: BrandOptions) {
  return [
    `# Typography: ${titleCase(options.brand)}`,
    "",
    "## Type Stack",
    "",
    "| Role | Recommendation | Usage |",
    "| --- | --- | --- |",
    "| Display | Sora SemiBold | Homepage headline, campaign title, major report headers. |",
    "| UI | Manrope Medium/Regular | Buttons, tables, forms, dashboard labels. |",
    "| Body | Manrope Regular | Documentation, guides, long-form pages. |",
    "| Code | JetBrains Mono | Commands, snippets, IDs, and technical metadata. |",
    "",
    "## Rules",
    "",
    `- For ${options.audience}, prioritize scannability over drama.`,
    "- Use sentence case for interface labels.",
    "- Keep body text between 65 and 78 characters per line in long-form pages.",
    "- Reserve all caps for tiny metadata labels only.",
  ].join("\n");
}

function renderVoiceGuide(options: BrandOptions) {
  return [
    `# Voice Guide: ${titleCase(options.brand)}`,
    "",
    "## Voice Attributes",
    "",
    ...options.personality.split(",").map((item) => `- ${item.trim()}`).filter((line) => line !== "-"),
    "",
    "## Say This",
    "",
    `- "${titleCase(options.brand)} helps ${options.audience} make the next operational step clear."`,
    `- "Replace a fragile workflow with a repeatable one."`,
    `- "Show the proof, then ask for the next action."`,
    "",
    "## Avoid This",
    "",
    "- Generic claims without an example.",
    "- Overpromising outcomes that depend on user setup or process maturity.",
    "- Jargon that hides the actual work being done.",
    "",
    "## Messaging Formula",
    "",
    "Problem -> operational consequence -> clearer workflow -> proof point -> next step.",
  ].join("\n");
}

function renderLogoUsage(options: BrandOptions, palette: ColorToken[]) {
  const ink = palette.find((color) => color.name === "ink")?.hex || "#1f2933";
  const accent = palette.find((color) => color.name === "accent")?.hex || "#2f8f62";
  return [
    `# Logo Usage: ${titleCase(options.brand)}`,
    "",
    "## Primary Lockup",
    "",
    `Use the wordmark in ${ink} with the accent mark in ${accent}. Keep it crisp and unadorned.`,
    "",
    "## Clear Space",
    "",
    "Minimum clear space equals the height of the symbol. Increase it on social graphics and slide covers.",
    "",
    "## Minimum Sizes",
    "",
    "| Surface | Minimum width |",
    "| --- | --- |",
    "| Web header | 120px |",
    "| App sidebar | 96px |",
    "| Social avatar | 48px symbol only |",
    "| Print | 32mm |",
    "",
    "## Misuse",
    "",
    "- Do not place the mark on low-contrast photos.",
    "- Do not add outlines, glows, shadows, or novelty textures.",
    "- Do not use unapproved colors for the symbol or wordmark.",
  ].join("\n");
}

function renderApplications(options: BrandOptions, palette: ColorToken[]) {
  return [
    `# Sample Applications: ${titleCase(options.brand)}`,
    "",
    "## Website Hero",
    "",
    `Headline: ${titleCase(options.brand)} turns ${options.category} work into a clearer operating rhythm.`,
    `Body: Built for ${options.audience} who need trustworthy outputs, reviewable steps, and fewer handoff gaps.`,
    "CTA: See the workflow",
    "",
    "## Product Dashboard",
    "",
    `Use ${token(palette, "paper")} for page background, ${token(palette, "ink")} for high-priority text, and ${token(palette, "accent")} for the main action.`,
    "",
    "## Sales One-Pager",
    "",
    "- Top: one-line positioning.",
    "- Middle: three proof bullets and workflow diagram.",
    "- Bottom: implementation notes and direct next step.",
    "",
    "## Social Launch Card",
    "",
    `Use a clean product frame, one outcome sentence, and a compact ${options.category} proof point.`,
  ].join("\n");
}

function renderBrandAssetsSvg(options: BrandOptions, palette: ColorToken[]) {
  const ink = token(palette, "ink");
  const paper = token(palette, "paper");
  const accent = token(palette, "accent");
  const support = token(palette, "support");
  const mist = token(palette, "mist");
  const initials = options.brand
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "BK";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img" aria-label="${escapeXml(options.brand)} brand assets">
  <rect width="1200" height="800" fill="${paper}"/>
  <rect x="80" y="80" width="1040" height="640" rx="28" fill="${mist}" stroke="${ink}" stroke-width="3"/>
  <circle cx="170" cy="180" r="56" fill="${accent}"/>
  <text x="170" y="196" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="${paper}">${escapeXml(initials)}</text>
  <text x="250" y="170" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="${ink}">${escapeXml(titleCase(options.brand))}</text>
  <text x="252" y="220" font-family="Arial, sans-serif" font-size="24" fill="${ink}">${escapeXml(options.category)} for ${escapeXml(options.audience)}</text>
  <rect x="120" y="320" width="180" height="120" rx="18" fill="${ink}"/>
  <rect x="330" y="320" width="180" height="120" rx="18" fill="${accent}"/>
  <rect x="540" y="320" width="180" height="120" rx="18" fill="${support}"/>
  <rect x="750" y="320" width="180" height="120" rx="18" fill="${paper}" stroke="${ink}" stroke-width="3"/>
  <text x="120" y="510" font-family="Arial, sans-serif" font-size="22" fill="${ink}">Logo lockup, color swatches, and social card direction</text>
  <rect x="120" y="560" width="380" height="92" rx="18" fill="${paper}" stroke="${ink}" stroke-width="2"/>
  <text x="150" y="616" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${ink}">Primary CTA</text>
  <rect x="540" y="560" width="300" height="92" rx="18" fill="${accent}"/>
  <text x="690" y="616" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${paper}">Action</text>
</svg>
`;
}

function writeArtifacts(options: BrandOptions, palette: ColorToken[], guide: string) {
  const files = {
    guide: "brand-guide.md",
    pdf: "brand-guide.pdf",
    palette: "palette.json",
    typography: "typography.md",
    voiceGuide: "voice-guide.md",
    logoUsage: "logo-usage.md",
    sampleApplications: "sample-applications.md",
    assets: "brand-assets.svg",
    manifest: "manifest.json",
  };

  writeFile(join(options.outputDir, files.guide), guide);
  writeFile(join(options.outputDir, files.pdf), buildPdf(guide));
  writeFile(join(options.outputDir, files.palette), JSON.stringify({ colors: palette }, null, 2));
  writeFile(join(options.outputDir, files.typography), renderTypography(options));
  writeFile(join(options.outputDir, files.voiceGuide), renderVoiceGuide(options));
  writeFile(join(options.outputDir, files.logoUsage), renderLogoUsage(options, palette));
  writeFile(join(options.outputDir, files.sampleApplications), renderApplications(options, palette));
  writeFile(join(options.outputDir, files.assets), renderBrandAssetsSvg(options, palette));
  writeFile(
    join(options.outputDir, files.manifest),
    JSON.stringify(
      {
        skill: SKILL_NAME,
        runId: RUN_ID,
        generatedAt: new Date().toISOString(),
        input: {
          brand: options.brand,
          category: options.category,
          audience: options.audience,
          personality: options.personality,
          tone: options.tone,
        },
        paletteCount: palette.length,
        files,
      },
      null,
      2,
    ),
  );

  return files;
}

function buildPdf(markdown: string): string {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 52);
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    ...text.map((line, index) => `${index === 0 ? "" : "0 -14 Td"} (${escapePdf(line.slice(0, 96))}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
  ];
  return `%PDF-1.4\n${objects.join("\n")}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
}

function voicePhrase(options: BrandOptions) {
  switch (options.tone) {
    case "premium":
      return `quietly confident, precise, and credible for ${options.category}`;
    case "friendly":
      return `approachable, practical, and easy for ${options.audience} to repeat`;
    case "technical":
      return `specific, implementation-aware, and grounded in workflow reality`;
    default:
      return `direct, useful, and free of decorative claims`;
  }
}

function tonePhrase(tone: Tone) {
  switch (tone) {
    case "premium":
      return "restrained, confident, and evidence-led";
    case "friendly":
      return "warm, plainspoken, and helpful";
    case "technical":
      return "precise, concrete, and operational";
    default:
      return "direct, concise, and practical";
  }
}

function isTone(value: string): value is Tone {
  return ["direct", "premium", "friendly", "technical"].includes(value);
}

function token(palette: ColorToken[], name: string) {
  return palette.find((color) => color.name === name)?.hex || "#111827";
}

function hash(value: string) {
  return Array.from(value).reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 17);
}

function hslToHex(h: number, s: number, l: number) {
  const saturation = s / 100;
  const lightness = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((value) => Math.round(255 * value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function escapePdf(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, content: string) {
  ensureDir(dirname(path));
  writeFileSync(path, content);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
