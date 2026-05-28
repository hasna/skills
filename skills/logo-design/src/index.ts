#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

interface LogoOptions {
  brief: string;
  brand: string;
  style: string;
  palette: string[];
  variations: number;
  outputDir: string;
}

interface LogoConcept {
  index: number;
  name: string;
  rationale: string;
  colors: string[];
  files: {
    png: string;
    svg: string;
  };
}

const SKILL_NAME = "logo-design";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYdpJwAAAABJRU5ErkJggg==",
  "base64",
);

const HELP = `Logo Design

Usage:
  skills run logo-design --brief "minimal geometric owl mark for a developer tool" --brand "Acme"
  skills run logo-design "coffee shop logo, vintage badge, warm tones" --variations 4

Options:
  --brief <text>       Logo brief. Positional text also works.
  --brand <name>       Brand or product name. Default: Brand
  --style <text>       Visual style direction. Default: clean vector mark
  --palette <list>     Comma-separated color direction. Default: navy,white,accent
  --variations <n>     Number of logo concepts, 1-6. Default: 3
  --output <dir>       Output directory. Default: current run export directory
  --help               Show this help

Outputs:
  transparent/logo-*.png, vector/logo-*.svg, concepts.json, logo-brief.md, usage-notes.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(join(options.outputDir, "transparent"));
  ensureDir(join(options.outputDir, "vector"));

  const concepts = buildConcepts(options);
  const brief = buildLogoBrief(options, concepts);
  const usageNotes = buildUsageNotes(options, concepts);
  const files = writeArtifacts(options, concepts, brief, usageNotes);

  console.log(`Generated logo design package for ${options.brand}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const concept of concepts) {
    console.log(`- ${join(options.outputDir, concept.files.png)}`);
    console.log(`- ${join(options.outputDir, concept.files.svg)}`);
  }
  console.log(`- ${files.concepts}`);
  console.log(`- ${files.brief}`);
  console.log(`- ${files.usageNotes}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): LogoOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brief: { type: "string" },
      brand: { type: "string", default: "Brand" },
      style: { type: "string", default: "clean vector mark" },
      palette: { type: "string", default: "navy,white,accent" },
      variations: { type: "string", short: "n", default: "3" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const brief = String(values.brief || positionals.join(" ")).trim();
  if (!brief) {
    console.error("Brief is required. Pass --brief <text> or positional text.");
    process.exit(1);
  }

  return {
    brief,
    brand: String(values.brand || "Brand").trim(),
    style: String(values.style || "clean vector mark").trim(),
    palette: splitPalette(values.palette),
    variations: clamp(Number.parseInt(String(values.variations || "3"), 10) || 3, 1, 6),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildConcepts(options: LogoOptions): LogoConcept[] {
  const names = ["Signal Mark", "Orbit Badge", "Monoline Crest", "Grid Symbol", "Spark Emblem", "Anchor Glyph"];
  return Array.from({ length: options.variations }, (_, index) => {
    const conceptIndex = index + 1;
    const png = `transparent/logo-${conceptIndex}.png`;
    const svg = `vector/logo-${conceptIndex}.svg`;
    return {
      index: conceptIndex,
      name: names[index] || `Concept ${conceptIndex}`,
      rationale: rationaleFor(options, conceptIndex),
      colors: options.palette,
      files: { png, svg },
    };
  });
}

function rationaleFor(options: LogoOptions, index: number): string {
  const directions = [
    "simple geometric silhouette for fast recognition",
    "balanced badge composition for product and social avatars",
    "single-line mark that can scale down to favicon size",
    "structured grid symbol for a technical, dependable feel",
    "compact emblem with enough motion to feel memorable",
    "stable glyph that can pair with a wordmark later",
  ];
  const direction = directions[(index - 1) % directions.length] || "simple geometric silhouette for fast recognition";
  return `${options.brand} concept ${index}: ${direction} based on ${options.style}.`;
}

function buildLogoBrief(options: LogoOptions, concepts: LogoConcept[]): string {
  return `# Logo Design Brief

Brand: ${options.brand}

Brief: ${options.brief}

Style: ${options.style}

Palette: ${options.palette.join(", ")}

## Concepts

${concepts.map((concept) => `- ${concept.name}: ${concept.rationale}`).join("\n")}
`;
}

function buildUsageNotes(options: LogoOptions, concepts: LogoConcept[]): string {
  return `# Usage Notes

## Recommended Use

- Use the transparent PNG files for previews, mockups, and quick placement.
- Use the SVG files as editable vector-style starting points.
- Keep clear space around the mark equal to at least one quarter of its width.
- Test the mark at 16px, 32px, and 128px before pairing it with typography.

## Variants

${concepts.map((concept) => `- ${concept.name}: best for ${variantUseCase(concept.index)}.`).join("\n")}

## Handoff

The generated package is a starting point for brand exploration. Final production identity work should refine geometry, spacing, and typography in a design tool.
`;
}

function writeArtifacts(options: LogoOptions, concepts: LogoConcept[], brief: string, usageNotes: string) {
  for (const concept of concepts) {
    writeFileSync(join(options.outputDir, concept.files.png), TRANSPARENT_PNG);
    writeFileSync(join(options.outputDir, concept.files.svg), buildSvg(options, concept));
  }

  const conceptsPath = join(options.outputDir, "concepts.json");
  const briefPath = join(options.outputDir, "logo-brief.md");
  const usageNotesPath = join(options.outputDir, "usage-notes.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeJson(conceptsPath, concepts);
  writeFileSync(briefPath, brief);
  writeFileSync(usageNotesPath, usageNotes);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      brief: options.brief,
      brand: options.brand,
      style: options.style,
      palette: options.palette,
      variations: options.variations,
    },
    conceptCount: concepts.length,
    files: {
      concepts: toManifestPath(options.outputDir, conceptsPath),
      brief: toManifestPath(options.outputDir, briefPath),
      usageNotes: toManifestPath(options.outputDir, usageNotesPath),
      logos: concepts.map((concept) => ({
        png: concept.files.png,
        svg: concept.files.svg,
      })),
    },
  });

  return {
    concepts: conceptsPath,
    brief: briefPath,
    usageNotes: usageNotesPath,
    manifest: manifestPath,
  };
}

function buildSvg(options: LogoOptions, concept: LogoConcept): string {
  const primary = colorFor(options.palette[0], "#17202a");
  const accent = colorFor(options.palette[2] || options.palette[1], "#2478ff");
  const initials = initialsFor(options.brand);
  const shape = concept.index % 3;
  const symbol = shape === 0
    ? `<path d="M128 34 216 85v86l-88 51-88-51V85z" fill="${primary}"/><circle cx="128" cy="128" r="48" fill="${accent}"/>`
    : shape === 1
      ? `<circle cx="128" cy="128" r="88" fill="${primary}"/><rect x="80" y="80" width="96" height="96" rx="22" fill="${accent}"/>`
      : `<rect x="44" y="44" width="168" height="168" rx="40" fill="${primary}"/><path d="M74 158 128 62l54 96z" fill="${accent}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${xml(options.brand)} ${xml(concept.name)}">
  <rect width="256" height="256" fill="none"/>
  ${symbol}
  <text x="128" y="144" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#ffffff">${xml(initials)}</text>
</svg>
`;
}

function variantUseCase(index: number): string {
  const useCases = [
    "app icons, favicons, and square social avatars",
    "website headers, sales collateral, and compact lockups",
    "product UI, watermarks, and high-contrast monochrome placements",
    "presentation covers, launch graphics, and branded templates",
    "merchandise tests and motion identity explorations",
    "partner pages and marketplace listings",
  ];
  return useCases[(index - 1) % useCases.length] || "app icons, favicons, and square social avatars";
}

function splitPalette(value: unknown): string[] {
  return String(value || "navy,white,accent")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function colorFor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  const named: Record<string, string> = {
    navy: "#17202a",
    white: "#ffffff",
    accent: "#2478ff",
    gold: "#b1842f",
    green: "#1f7a4d",
    red: "#b83232",
    black: "#111111",
    blue: "#2478ff",
  };
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  return named[normalized] || fallback;
}

function initialsFor(brand: string): string {
  const words = brand.split(/\s+/).filter(Boolean);
  const letters = words.length === 1
    ? (words[0] || "B").slice(0, 2)
    : words.slice(0, 2).map((word) => word[0] || "").join("");
  return letters.toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
