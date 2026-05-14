#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type Audience = "team" | "customers" | "executives" | "students";
type DeckFormat = "general" | "training" | "sales" | "report" | "proposal";

interface DeckOptions {
  brief: string;
  title: string;
  audience: Audience;
  format: DeckFormat;
  slideCount: number;
  outputDir: string;
}

interface Slide {
  number: number;
  title: string;
  subtitle: string;
  bullets: string[];
  speakerNotes: string;
  visualDirection: string;
}

interface ZipEntry {
  path: string;
  data: Buffer;
}

const SKILL_NAME = "slide-deck-generator";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const AUDIENCES: Audience[] = ["team", "customers", "executives", "students"];
const FORMATS: DeckFormat[] = ["general", "training", "sales", "report", "proposal"];

const HELP = `Slide Deck Generator

Usage:
  skills run slide-deck-generator --brief "Q2 launch review for AI billing" --title "Q2 Launch Review" --audience executives
  skills run slide-deck-generator ./outline.md --format training --slides 12

Options:
  --brief <text>      Brief, outline, or source text
  --source <path>     Read brief text from a file
  --title <text>      Deck title. Default: Slide Deck
  --audience <type>   team, customers, executives, or students
  --format <type>     general, training, sales, report, or proposal
  --slides <number>   Number of slides, 4-20. Default: 8
  --output <dir>      Output directory. Default: current run export directory
  --help              Show this help

Outputs:
  deck.md, deck.pdf, deck.pptx, slides.json, speaker-notes.md, theme-guide.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const slides = buildSlides(options);
  const deckMarkdown = buildDeckMarkdown(options, slides);
  const speakerNotes = buildSpeakerNotes(options, slides);
  const themeGuide = buildThemeGuide(options, slides);
  const files = writeArtifacts(options, slides, {
    deckMarkdown,
    speakerNotes,
    themeGuide,
    pdf: buildPdf(deckMarkdown),
    pptx: buildPptx(options, slides),
  });

  console.log(`Generated slide deck package for ${options.title}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.deck}`);
  console.log(`- ${files.pdf}`);
  console.log(`- ${files.pptx}`);
  console.log(`- ${files.slides}`);
  console.log(`- ${files.speakerNotes}`);
  console.log(`- ${files.themeGuide}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): DeckOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brief: { type: "string" },
      source: { type: "string" },
      title: { type: "string", default: "Slide Deck" },
      audience: { type: "string", default: "team" },
      format: { type: "string", default: "general" },
      slides: { type: "string", default: "8" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const sourceText = values.source ? readSourceFile(String(values.source)) : "";
  const brief = String(values.brief || sourceText || positionals.join(" ")).trim();
  if (!brief) {
    console.error("Brief is required. Pass --brief <text>, --source <path>, or positional text.");
    process.exit(1);
  }

  const audience = String(values.audience || "team").toLowerCase();
  if (!AUDIENCES.includes(audience as Audience)) {
    console.error(`Invalid audience. Use one of: ${AUDIENCES.join(", ")}.`);
    process.exit(1);
  }

  const format = String(values.format || "general").toLowerCase();
  if (!FORMATS.includes(format as DeckFormat)) {
    console.error(`Invalid format. Use one of: ${FORMATS.join(", ")}.`);
    process.exit(1);
  }

  return {
    brief,
    title: String(values.title || "Slide Deck").trim(),
    audience: audience as Audience,
    format: format as DeckFormat,
    slideCount: clamp(Number.parseInt(String(values.slides || "8"), 10) || 8, 4, 20),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function readSourceFile(path: string): string {
  if (!existsSync(path)) {
    console.error(`Source file does not exist: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8");
}

function buildSlides(options: DeckOptions): Slide[] {
  const points = extractPoints(options.brief);
  const templates = slideTemplates(options);
  const slides: Slide[] = [];
  for (let index = 0; index < options.slideCount; index++) {
    const template = templates[index % templates.length];
    const point = points[index % points.length] || options.brief;
    slides.push({
      number: index + 1,
      title: index === 0 ? options.title : template.title,
      subtitle: index === 0 ? subtitleFor(options) : template.subtitle,
      bullets: buildBullets(template.intent, point, options),
      speakerNotes: buildSlideNotes(template.intent, point, options),
      visualDirection: visualDirection(template.intent, options),
    });
  }
  slides[slides.length - 1] = {
    ...slides[slides.length - 1],
    title: "Next Steps",
    subtitle: "Make the deck actionable.",
    bullets: [
      "Confirm the owner, deadline, and decision needed.",
      "Turn open questions into a follow-up checklist.",
      "Share the deck with context, not as a standalone artifact.",
    ],
    speakerNotes: "Close by naming the decision or action this deck should create.",
    visualDirection: "Three-step checklist with owner, date, and success marker.",
  };
  return slides;
}

function slideTemplates(options: DeckOptions): Array<{ title: string; subtitle: string; intent: string }> {
  const shared = [
    { title: "Context", subtitle: "Why this matters now.", intent: "context" },
    { title: "Audience Need", subtitle: `What ${options.audience} need to understand.`, intent: "audience" },
    { title: "Core Idea", subtitle: "The strongest message in the brief.", intent: "idea" },
    { title: "Evidence", subtitle: "Proof, examples, and supporting details.", intent: "evidence" },
    { title: "Plan", subtitle: "How to move from narrative to action.", intent: "plan" },
    { title: "Risks", subtitle: "What could block success.", intent: "risks" },
  ];
  if (options.format === "training") {
    return [
      { title: "Learning Goal", subtitle: "What the audience should be able to do.", intent: "goal" },
      { title: "Concept", subtitle: "The idea in plain language.", intent: "idea" },
      { title: "Example", subtitle: "A concrete walkthrough.", intent: "evidence" },
      { title: "Exercise", subtitle: "Practice and reinforcement.", intent: "plan" },
      { title: "Common Mistakes", subtitle: "What to watch for.", intent: "risks" },
    ];
  }
  if (options.format === "sales" || options.format === "proposal") {
    return [
      { title: "Customer Problem", subtitle: "The pain worth solving.", intent: "context" },
      { title: "Proposed Solution", subtitle: "The offer and outcome.", intent: "idea" },
      { title: "Proof", subtitle: "Why the buyer should trust this.", intent: "evidence" },
      { title: "Rollout", subtitle: "Plan, timeline, and responsibilities.", intent: "plan" },
      { title: "Commercials", subtitle: "Scope and buying path.", intent: "audience" },
    ];
  }
  if (options.format === "report") {
    return [
      { title: "Executive Summary", subtitle: "The headline finding.", intent: "idea" },
      { title: "Current State", subtitle: "What the evidence shows.", intent: "context" },
      { title: "Findings", subtitle: "Patterns and implications.", intent: "evidence" },
      { title: "Recommendations", subtitle: "The practical path forward.", intent: "plan" },
      { title: "Risks", subtitle: "Tradeoffs and dependencies.", intent: "risks" },
    ];
  }
  return shared;
}

function extractPoints(brief: string): string[] {
  const points = brief
    .split(/\n+|[.;]\s+/)
    .map((item) => item.trim().replace(/^[-*]\s*/, ""))
    .filter((item) => item.length > 0)
    .slice(0, 24);
  return points.length > 0 ? points : [brief];
}

function buildBullets(intent: string, point: string, options: DeckOptions): string[] {
  const focus = shorten(point, 96);
  if (intent === "risks") {
    return [
      `Risk to watch: ${focus}`,
      "Name the dependency, owner, and decision point.",
      "Add one mitigation before presenting.",
    ];
  }
  if (intent === "plan") {
    return [
      `Action path: ${focus}`,
      "Sequence the next three moves in order.",
      "Keep the owner and timeline visible.",
    ];
  }
  if (intent === "evidence") {
    return [
      `Proof point: ${focus}`,
      "Use numbers, screenshots, quotes, or concrete examples where possible.",
      "Separate confirmed facts from assumptions.",
    ];
  }
  if (intent === "audience") {
    return [
      `Audience lens: ${options.audience}`,
      `What they need to know: ${focus}`,
      "Remove details that do not support their decision.",
    ];
  }
  return [
    focus,
    `Frame it for ${options.audience}.`,
    "Keep the slide to one idea and one action.",
  ];
}

function buildSlideNotes(intent: string, point: string, options: DeckOptions): string {
  return `Talk track: explain ${intent} for ${options.audience}. Anchor the slide on this point: ${point}`;
}

function visualDirection(intent: string, options: DeckOptions): string {
  const base = {
    context: "Timeline or before-state diagram.",
    audience: "Persona strip or audience decision map.",
    idea: "Large headline with one supporting diagram.",
    evidence: "Metric cards, screenshot callouts, or source table.",
    plan: "Three-step roadmap with owner markers.",
    risks: "Risk matrix with mitigation callouts.",
    goal: "Learning objective card with completion criteria.",
  } as Record<string, string>;
  return `${base[intent] || "Clean slide with strong hierarchy."} Style for ${options.format} deck.`;
}

function subtitleFor(options: DeckOptions): string {
  return `${titleCase(options.format)} deck for ${options.audience}`;
}

function buildDeckMarkdown(options: DeckOptions, slides: Slide[]): string {
  return `# ${options.title}

Audience: ${options.audience}
Format: ${options.format}

Brief: ${options.brief}

${slides.map((slide) => `## ${slide.number}. ${slide.title}

${slide.subtitle}

${slide.bullets.map((bullet) => `- ${bullet}`).join("\n")}

Visual direction: ${slide.visualDirection}
`).join("\n")}
`;
}

function buildSpeakerNotes(options: DeckOptions, slides: Slide[]): string {
  return `# Speaker Notes

Deck: ${options.title}

${slides.map((slide) => `## Slide ${slide.number}: ${slide.title}

${slide.speakerNotes}
`).join("\n")}
`;
}

function buildThemeGuide(options: DeckOptions, slides: Slide[]): string {
  return `# Theme Guide

## Style

- Audience: ${options.audience}
- Format: ${options.format}
- Layout: dense but readable, one clear message per slide
- Color: neutral foundation with one high-signal accent
- Typography: large titles, compact bullets, generous line height

## Slide Visuals

${slides.map((slide) => `- Slide ${slide.number}, ${slide.title}: ${slide.visualDirection}`).join("\n")}
`;
}

function writeArtifacts(
  options: DeckOptions,
  slides: Slide[],
  content: {
    deckMarkdown: string;
    speakerNotes: string;
    themeGuide: string;
    pdf: string;
    pptx: Buffer;
  },
) {
  const deckPath = join(options.outputDir, "deck.md");
  const pdfPath = join(options.outputDir, "deck.pdf");
  const pptxPath = join(options.outputDir, "deck.pptx");
  const slidesPath = join(options.outputDir, "slides.json");
  const speakerNotesPath = join(options.outputDir, "speaker-notes.md");
  const themeGuidePath = join(options.outputDir, "theme-guide.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(deckPath, content.deckMarkdown);
  writeFileSync(pdfPath, content.pdf);
  writeFileSync(pptxPath, content.pptx);
  writeJson(slidesPath, slides);
  writeFileSync(speakerNotesPath, content.speakerNotes);
  writeFileSync(themeGuidePath, content.themeGuide);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      brief: options.brief,
      title: options.title,
      audience: options.audience,
      format: options.format,
      slideCount: options.slideCount,
    },
    slideCount: slides.length,
    files: {
      deck: toManifestPath(options.outputDir, deckPath),
      pdf: toManifestPath(options.outputDir, pdfPath),
      pptx: toManifestPath(options.outputDir, pptxPath),
      slides: toManifestPath(options.outputDir, slidesPath),
      speakerNotes: toManifestPath(options.outputDir, speakerNotesPath),
      themeGuide: toManifestPath(options.outputDir, themeGuidePath),
      manifest: toManifestPath(options.outputDir, manifestPath),
    },
  });

  return {
    deck: deckPath,
    pdf: pdfPath,
    pptx: pptxPath,
    slides: slidesPath,
    speakerNotes: speakerNotesPath,
    themeGuide: themeGuidePath,
    manifest: manifestPath,
  };
}

function buildPdf(markdown: string): string {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    ...text.map((line, index) => `${index === 0 ? "" : "0 -14 Td"} (${escapePdf(line.slice(0, 95))}) Tj`),
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

function buildPptx(options: DeckOptions, slides: Slide[]): Buffer {
  const entries: ZipEntry[] = [
    zipEntry("[Content_Types].xml", contentTypesXml(slides)),
    zipEntry("ppt/presentation.xml", presentationXml(options, slides)),
    zipEntry("docProps/core.xml", coreXml(options)),
    ...slides.map((slide) => zipEntry(`ppt/slides/slide${slide.number}.xml`, slideXml(slide))),
  ];
  return buildZip(entries);
}

function contentTypesXml(slides: Slide[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
${slides.map((slide) => `  <Override PartName="/ppt/slides/slide${slide.number}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n")}
</Types>`;
}

function presentationXml(options: DeckOptions, slides: Slide[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<presentation title="${xml(options.title)}" slides="${slides.length}">
${slides.map((slide) => `  <slide ref="ppt/slides/slide${slide.number}.xml" title="${xml(slide.title)}"/>`).join("\n")}
</presentation>`;
}

function coreXml(options: DeckOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<core title="${xml(options.title)}" audience="${xml(options.audience)}" format="${xml(options.format)}"/>`;
}

function slideXml(slide: Slide): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<slide number="${slide.number}">
  <title>${xml(slide.title)}</title>
  <subtitle>${xml(slide.subtitle)}</subtitle>
  <bullets>
${slide.bullets.map((bullet) => `    <bullet>${xml(bullet)}</bullet>`).join("\n")}
  </bullets>
  <notes>${xml(slide.speakerNotes)}</notes>
</slide>`;
}

function zipEntry(path: string, text: string): ZipEntry {
  return { path, data: Buffer.from(text) };
}

function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + entry.data.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDir, end]);
}

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = new Int32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shorten(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trim()}...`;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
