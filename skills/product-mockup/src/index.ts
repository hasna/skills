#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type Layout = "dashboard" | "mobile" | "campaign";

interface MockupOptions {
  product: string;
  audience: string;
  scene: string;
  style: string;
  variants: number;
  outputDir: string;
}

interface MockupVariant {
  index: number;
  layout: Layout;
  title: string;
  filename: string;
  headline: string;
  focus: string;
  palette: Palette;
}

interface Palette {
  ink: string;
  paper: string;
  accent: string;
  support: string;
  soft: string;
}

const SKILL_NAME = "product-mockup";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const LAYOUTS: Layout[] = ["dashboard", "mobile", "campaign"];

const HELP = `Product Mockup

Usage:
  skills run product-mockup "Usage-based billing dashboard" --audience "founders" --variants 3
  skills run product-mockup --product "AI meeting assistant" --scene "homepage hero" --style "quiet premium"

Options:
  --product <text>   Product, feature, or campaign description. Positional text also works.
  --audience <text>  Target audience. Default: software buyers
  --scene <text>     Desired context or surface. Default: SaaS marketing and product screens
  --style <text>     Visual direction. Default: polished SaaS, crisp product UI, restrained color
  --variants <n>     Number of mockup variants, 1-4. Default: 3
  --output <dir>     Output directory. Default: current run export directory
  --help             Show help

Outputs:
  mockup-brief.md, image-prompts.md, scene-plan.json, variants/*.svg, usage-notes.md, asset-metadata.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const variants = buildVariants(options);
  const files = writeArtifacts(options, variants);

  console.log(`Generated product mockup package for ${options.product}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`Variants: ${variants.length}`);
  for (const file of flattenFiles(files)) {
    console.log(`- ${file}`);
  }
}

function parseCliOptions(): MockupOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      product: { type: "string" },
      audience: { type: "string", default: "software buyers" },
      scene: { type: "string", default: "SaaS marketing and product screens" },
      style: { type: "string", default: "polished SaaS, crisp product UI, restrained color" },
      variants: { type: "string", default: "3" },
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

  return {
    product,
    audience: String(values.audience || "software buyers").trim(),
    scene: String(values.scene || "SaaS marketing and product screens").trim(),
    style: String(values.style || "polished SaaS, crisp product UI, restrained color").trim(),
    variants: clampNumber(Number(values.variants || 3), 1, 4),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildVariants(options: MockupOptions): MockupVariant[] {
  const palette = buildPalette(options.product);
  return Array.from({ length: options.variants }, (_, index) => {
    const layout = LAYOUTS[index % LAYOUTS.length] || "dashboard";
    return {
      index: index + 1,
      layout,
      title: variantTitle(layout, index + 1),
      filename: `variants/variant-${pad(index + 1)}.svg`,
      headline: headlineFor(layout, options),
      focus: focusFor(layout, options),
      palette: shiftPalette(palette, index),
    };
  });
}

function writeArtifacts(options: MockupOptions, variants: MockupVariant[]) {
  const files = {
    brief: "mockup-brief.md",
    prompts: "image-prompts.md",
    scenePlan: "scene-plan.json",
    variants: variants.map((variant) => variant.filename),
    usageNotes: "usage-notes.md",
    assetMetadata: "asset-metadata.json",
    manifest: "manifest.json",
  };

  writeFile(join(options.outputDir, files.brief), renderBrief(options, variants));
  writeFile(join(options.outputDir, files.prompts), renderPrompts(options, variants));
  writeFile(
    join(options.outputDir, files.scenePlan),
    JSON.stringify(
      {
        product: options.product,
        audience: options.audience,
        scene: options.scene,
        style: options.style,
        recommendedOrder: variants.map((variant) => ({
          file: variant.filename,
          title: variant.title,
          layout: variant.layout,
          focus: variant.focus,
        })),
      },
      null,
      2,
    ),
  );

  for (const variant of variants) {
    writeFile(join(options.outputDir, variant.filename), renderMockupSvg(options, variant));
  }

  writeFile(join(options.outputDir, files.usageNotes), renderUsageNotes(options, variants));
  writeFile(join(options.outputDir, files.assetMetadata), renderAssetMetadata(options, variants));
  writeFile(
    join(options.outputDir, files.manifest),
    JSON.stringify(
      {
        skill: SKILL_NAME,
        runId: RUN_ID,
        generatedAt: new Date().toISOString(),
        input: {
          product: options.product,
          audience: options.audience,
          scene: options.scene,
          style: options.style,
          variants: options.variants,
        },
        variantCount: variants.length,
        files,
      },
      null,
      2,
    ),
  );

  return files;
}

function renderBrief(options: MockupOptions, variants: MockupVariant[]) {
  return [
    `# Product Mockup Brief: ${titleCase(options.product)}`,
    "",
    `Audience: ${options.audience}`,
    `Scene: ${options.scene}`,
    `Style: ${options.style}`,
    "",
    "## Direction",
    "",
    `${titleCase(options.product)} should look immediately useful, credible, and ready to ship. The visuals should help ${options.audience} understand the core value without reading a long explanation.`,
    "",
    "## Variant Set",
    "",
    ...variants.map((variant) => `- ${variant.title}: ${variant.focus} (${variant.filename})`),
    "",
    "## Review Checklist",
    "",
    "- Product name or core promise is visible in the first screen.",
    "- Interface details look realistic enough for a landing page or sales deck.",
    "- Color, spacing, and hierarchy feel consistent across variants.",
    "- Assets can be used as direction for final rendered imagery or design handoff.",
  ].join("\n");
}

function renderPrompts(options: MockupOptions, variants: MockupVariant[]) {
  const lines = [
    `# Image Direction Prompts: ${titleCase(options.product)}`,
    "",
    "Use these prompts as creative direction for final visual production.",
    "",
  ];

  for (const variant of variants) {
    lines.push(
      `## ${variant.title}`,
      "",
      [
        `Create a ${variant.layout} product mockup for ${options.product}.`,
        `Audience: ${options.audience}.`,
        `Scene: ${options.scene}.`,
        `Visual direction: ${options.style}.`,
        `Focus: ${variant.focus}.`,
        "Keep the UI crisp, commercial, and believable with clean spacing and readable interface labels.",
      ].join(" "),
      "",
    );
  }

  return lines.join("\n");
}

function renderUsageNotes(options: MockupOptions, variants: MockupVariant[]) {
  return [
    `# Usage Notes: ${titleCase(options.product)}`,
    "",
    "## Best Uses",
    "",
    "- Landing page hero or feature section.",
    "- Pitch deck product slide.",
    "- Sales one-pager or launch announcement.",
    "- Creative direction for a designer building final assets.",
    "",
    "## Editing Guidance",
    "",
    "- Replace placeholder metrics with real product numbers before publishing.",
    "- Keep the first variant as the primary hero unless another layout better matches the campaign.",
    "- Use the campaign variant for ads, email headers, and social cards.",
    "- Convert SVG files to PNG only after the final copy and colors are approved.",
    "",
    "## Files",
    "",
    ...variants.map((variant) => `- ${variant.filename}: ${variant.title}`),
  ].join("\n");
}

function renderAssetMetadata(options: MockupOptions, variants: MockupVariant[]) {
  return JSON.stringify(
    {
      product: options.product,
      audience: options.audience,
      usage: ["marketing site", "sales deck", "campaign creative", "product direction"],
      assets: variants.map((variant) => ({
        file: variant.filename,
        title: variant.title,
        layout: variant.layout,
        dimensions: { width: 1200, height: 900 },
        focus: variant.focus,
        colors: variant.palette,
      })),
    },
    null,
    2,
  );
}

function renderMockupSvg(options: MockupOptions, variant: MockupVariant) {
  const { palette } = variant;
  const product = titleCase(options.product);
  const headline = titleCase(variant.headline);
  const subhead = `${variant.focus} for ${options.audience}`;

  if (variant.layout === "mobile") {
    return svgFrame(options, variant, [
      `<rect x="438" y="92" width="324" height="716" rx="46" fill="${palette.ink}"/>`,
      `<rect x="462" y="128" width="276" height="644" rx="34" fill="${palette.paper}"/>`,
      `<rect x="492" y="172" width="216" height="28" rx="14" fill="${palette.soft}"/>`,
      `<text x="492" y="258" font-family="Arial, sans-serif" font-size="31" font-weight="700" fill="${palette.ink}">${escapeXml(headline)}</text>`,
      `<text x="492" y="300" font-family="Arial, sans-serif" font-size="17" fill="${palette.ink}">${escapeXml(shorten(subhead, 43))}</text>`,
      `<rect x="492" y="350" width="216" height="118" rx="24" fill="${palette.accent}"/>`,
      `<text x="520" y="412" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${palette.paper}">${escapeXml(shorten(product, 22))}</text>`,
      `<rect x="492" y="506" width="216" height="56" rx="18" fill="${palette.soft}"/>`,
      `<rect x="492" y="584" width="96" height="112" rx="20" fill="${palette.support}"/>`,
      `<rect x="612" y="584" width="96" height="112" rx="20" fill="${palette.soft}"/>`,
    ]);
  }

  if (variant.layout === "campaign") {
    return svgFrame(options, variant, [
      `<rect x="110" y="150" width="980" height="600" rx="36" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="3"/>`,
      `<circle cx="940" cy="245" r="92" fill="${palette.accent}"/>`,
      `<circle cx="1010" cy="325" r="54" fill="${palette.support}"/>`,
      `<text x="172" y="285" font-family="Arial, sans-serif" font-size="58" font-weight="700" fill="${palette.ink}">${escapeXml(shorten(headline, 24))}</text>`,
      `<text x="176" y="342" font-family="Arial, sans-serif" font-size="25" fill="${palette.ink}">${escapeXml(shorten(subhead, 58))}</text>`,
      `<rect x="176" y="420" width="240" height="70" rx="22" fill="${palette.ink}"/>`,
      `<text x="296" y="466" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="${palette.paper}">See the workflow</text>`,
      `<rect x="500" y="430" width="430" height="190" rx="28" fill="${palette.soft}" stroke="${palette.ink}" stroke-width="2"/>`,
      `<rect x="538" y="470" width="180" height="26" rx="13" fill="${palette.accent}"/>`,
      `<rect x="538" y="520" width="330" height="22" rx="11" fill="${palette.ink}" opacity="0.78"/>`,
      `<rect x="538" y="565" width="250" height="22" rx="11" fill="${palette.support}"/>`,
    ]);
  }

  return svgFrame(options, variant, [
    `<rect x="90" y="128" width="1020" height="644" rx="34" fill="${palette.paper}" stroke="${palette.ink}" stroke-width="3"/>`,
    `<rect x="90" y="128" width="1020" height="68" rx="34" fill="${palette.ink}"/>`,
    `<circle cx="142" cy="162" r="10" fill="${palette.accent}"/>`,
    `<circle cx="176" cy="162" r="10" fill="${palette.support}"/>`,
    `<circle cx="210" cy="162" r="10" fill="${palette.soft}"/>`,
    `<text x="142" y="275" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="${palette.ink}">${escapeXml(shorten(headline, 30))}</text>`,
    `<text x="144" y="326" font-family="Arial, sans-serif" font-size="24" fill="${palette.ink}">${escapeXml(shorten(subhead, 64))}</text>`,
    `<rect x="144" y="390" width="300" height="230" rx="28" fill="${palette.soft}"/>`,
    `<rect x="490" y="390" width="250" height="230" rx="28" fill="${palette.accent}"/>`,
    `<rect x="786" y="390" width="250" height="230" rx="28" fill="${palette.support}"/>`,
    `<rect x="176" y="452" width="172" height="28" rx="14" fill="${palette.ink}" opacity="0.8"/>`,
    `<rect x="176" y="512" width="220" height="24" rx="12" fill="${palette.accent}"/>`,
    `<rect x="522" y="452" width="156" height="28" rx="14" fill="${palette.paper}"/>`,
    `<rect x="522" y="512" width="120" height="72" rx="18" fill="${palette.ink}" opacity="0.8"/>`,
    `<rect x="818" y="452" width="168" height="28" rx="14" fill="${palette.paper}"/>`,
    `<rect x="818" y="512" width="120" height="72" rx="18" fill="${palette.ink}" opacity="0.72"/>`,
  ]);
}

function svgFrame(options: MockupOptions, variant: MockupVariant, children: string[]) {
  const { palette } = variant;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-label="${escapeXml(variant.title)}">
  <rect width="1200" height="900" fill="${palette.soft}"/>
  <rect x="56" y="56" width="1088" height="788" rx="42" fill="${palette.paper}"/>
  <text x="96" y="112" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${palette.ink}">${escapeXml(titleCase(options.product))}</text>
  <text x="1104" y="112" text-anchor="end" font-family="Arial, sans-serif" font-size="18" fill="${palette.ink}">${escapeXml(variant.title)}</text>
  ${children.join("\n  ")}
</svg>
`;
}

function buildPalette(seedText: string): Palette {
  const seed = hash(seedText);
  const hue = seed % 360;
  return {
    ink: hslToHex(hue, 30, 17),
    paper: hslToHex((hue + 30) % 360, 34, 96),
    accent: hslToHex((hue + 88) % 360, 58, 48),
    support: hslToHex((hue + 174) % 360, 42, 58),
    soft: hslToHex(hue, 28, 88),
  };
}

function shiftPalette(palette: Palette, index: number): Palette {
  if (index === 0) return palette;
  return {
    ink: palette.ink,
    paper: palette.paper,
    accent: rotateHex(palette.accent, index * 18),
    support: rotateHex(palette.support, index * 24),
    soft: palette.soft,
  };
}

function rotateHex(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `#${[
    (r + amount) % 256,
    (g + amount * 2) % 256,
    (b + amount * 3) % 256,
  ].map((channel) => Math.max(0, channel).toString(16).padStart(2, "0")).join("")}`;
}

function variantTitle(layout: Layout, index: number) {
  if (layout === "mobile") return `Variant ${index}: Mobile Flow`;
  if (layout === "campaign") return `Variant ${index}: Campaign Card`;
  return `Variant ${index}: Product Dashboard`;
}

function headlineFor(layout: Layout, options: MockupOptions) {
  if (layout === "mobile") return `${options.product} in your pocket`;
  if (layout === "campaign") return `Launch ${options.product} with proof`;
  return `${options.product} workspace`;
}

function focusFor(layout: Layout, options: MockupOptions) {
  if (layout === "mobile") return `compact onboarding and daily use`;
  if (layout === "campaign") return `marketing promise, CTA, and proof surface`;
  return `core workflow, metrics, and decision panels`;
}

function flattenFiles(files: ReturnType<typeof writeArtifacts>) {
  return [
    files.brief,
    files.prompts,
    files.scenePlan,
    ...files.variants,
    files.usageNotes,
    files.assetMetadata,
    files.manifest,
  ];
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
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

function hash(value: string) {
  return Array.from(value).reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 23);
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function shorten(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
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
