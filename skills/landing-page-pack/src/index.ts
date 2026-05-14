#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type Tone = "direct" | "premium" | "friendly" | "technical";

interface LandingPageOptions {
  product: string;
  audience: string;
  offer: string;
  goal: string;
  tone: Tone;
  proof: string;
  sections: string[];
  outputDir: string;
}

interface CopyBlock {
  section: string;
  headline: string;
  body: string;
  primaryCta: string;
  secondaryCta: string;
  trackingEvent: string;
}

const SKILL_NAME = "landing-page-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const DEFAULT_SECTIONS = ["hero", "problem", "solution", "proof", "faq", "cta"];

const HELP = `Landing Page Pack

Usage:
  skills run landing-page-pack "Usage-based billing for AI SaaS" --audience "founders"
  skills run landing-page-pack --product "API monitoring" --offer "Find broken API workflows before customers do"

Options:
  --product <text>    Product, service, or campaign brief. Positional text also works.
  --audience <text>   Primary buyer or user segment. Default: software teams
  --offer <text>      Core offer or promise. Default: derived from product
  --goal <text>       Main conversion goal. Default: book demos
  --tone <tone>       direct, premium, friendly, or technical. Default: direct
  --proof <text>      Proof points, metrics, or trust signals
  --sections <list>   Comma-separated section names
  --output <dir>      Output directory. Default: current run export directory
  --help              Show help

Outputs:
  landing-page.md, copy-blocks.json, wireframe.md, preview.html, style-guide.md, cta-map.csv, experiment-plan.md, implementation-notes.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const blocks = buildCopyBlocks(options);
  const files = writeArtifacts(options, blocks);

  console.log(`Generated landing page pack for ${options.product}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const file of Object.values(files)) {
    console.log(`- ${file}`);
  }
}

function parseCliOptions(): LandingPageOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      product: { type: "string" },
      audience: { type: "string", default: "software teams" },
      offer: { type: "string" },
      goal: { type: "string", default: "book demos" },
      tone: { type: "string", default: "direct" },
      proof: { type: "string", default: "case studies and testimonials" },
      sections: { type: "string" },
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
    tone,
    proof: String(values.proof || "case studies and testimonials").trim(),
    sections: splitList(values.sections, DEFAULT_SECTIONS),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildCopyBlocks(options: LandingPageOptions): CopyBlock[] {
  const normalized = options.sections.map((section) => slugify(section));
  const uniqueSections = Array.from(new Set(normalized.length ? normalized : DEFAULT_SECTIONS));
  return uniqueSections.map((section) => copyForSection(section, options));
}

function copyForSection(section: string, options: LandingPageOptions): CopyBlock {
  const product = titleCase(options.product);
  const voice = tonePhrase(options.tone);
  const cta = ctaForGoal(options.goal);

  if (section.includes("hero")) {
    return block(section, `${product} for ${options.audience}`, `${options.offer}. ${voice} Put the main outcome above the fold, name the audience clearly, and make the next step obvious.`, cta, "See how it works");
  }
  if (section.includes("problem")) {
    return block(section, `The old workflow costs attention and revenue`, `${options.audience} lose momentum when handoffs, decisions, or data stay scattered. The page should make the pain concrete before presenting the new path.`, cta, "Read the pain points");
  }
  if (section.includes("solution")) {
    return block(section, `A cleaner way to ship the outcome`, `${product} gives the buyer a repeatable path: understand the current state, act on the highest-value opportunity, and track the result.`, cta, "Review the workflow");
  }
  if (section.includes("feature") || section.includes("benefit")) {
    return block(section, `Built around the decisions buyers already make`, `Lead with three benefit groups: faster setup, clearer operations, and measurable improvement. Each benefit should connect to a screenshot, metric, or short proof line.`, cta, "Explore benefits");
  }
  if (section.includes("proof")) {
    return block(section, `Proof that lowers buying risk`, `Use ${options.proof} to show that the offer works in situations similar to the buyer's context. Keep each proof point short and specific.`, cta, "View proof");
  }
  if (section.includes("price")) {
    return block(section, `Pricing that is easy to evaluate`, `Present the recommended plan first, name what is included, and make the buying path clear. Use one comparison row for implementation effort and one for expected value.`, cta, "Compare options");
  }
  if (section.includes("faq")) {
    return block(section, `Questions buyers ask before they commit`, `Answer objections about setup time, ownership, data handling, support, and expected time to value. Keep every answer under three sentences.`, cta, "Talk to an expert");
  }
  if (section.includes("cta")) {
    return block(section, `Ready to ${options.goal}?`, `Close with the same promise from the hero, then ask for one concrete action. Remove extra links that compete with the conversion goal.`, cta, "Send the brief");
  }

  return block(section, `${titleCase(section)} for ${product}`, `Use this section to support ${options.goal} with a focused message for ${options.audience}. Keep the copy direct and tied to the page promise.`, cta, "Learn more");
}

function block(section: string, headline: string, body: string, primaryCta: string, secondaryCta: string): CopyBlock {
  return {
    section,
    headline,
    body,
    primaryCta,
    secondaryCta,
    trackingEvent: `landing_${slugify(section)}_${slugify(primaryCta)}`,
  };
}

function writeArtifacts(options: LandingPageOptions, blocks: CopyBlock[]) {
  const files = {
    landingPage: "landing-page.md",
    copyBlocks: "copy-blocks.json",
    wireframe: "wireframe.md",
    preview: "preview.html",
    styleGuide: "style-guide.md",
    ctaMap: "cta-map.csv",
    experimentPlan: "experiment-plan.md",
    implementationNotes: "implementation-notes.md",
    manifest: "manifest.json",
  };

  writeFile(join(options.outputDir, files.landingPage), renderLandingPage(options, blocks));
  writeJson(join(options.outputDir, files.copyBlocks), { schemaVersion: 1, blocks });
  writeFile(join(options.outputDir, files.wireframe), renderWireframe(options, blocks));
  writeFile(join(options.outputDir, files.preview), renderPreviewHtml(options, blocks));
  writeFile(join(options.outputDir, files.styleGuide), renderStyleGuide(options));
  writeFile(join(options.outputDir, files.ctaMap), renderCtaMap(blocks));
  writeFile(join(options.outputDir, files.experimentPlan), renderExperimentPlan(options, blocks));
  writeFile(join(options.outputDir, files.implementationNotes), renderImplementationNotes(options, blocks));
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
      tone: options.tone,
      proof: options.proof,
      sections: options.sections,
    },
    sectionCount: blocks.length,
    files,
  });

  return files;
}

function renderLandingPage(options: LandingPageOptions, blocks: CopyBlock[]): string {
  return `# Landing Page Pack: ${titleCase(options.product)}

## Campaign Brief

- Product: ${options.product}
- Audience: ${options.audience}
- Offer: ${options.offer}
- Conversion goal: ${options.goal}
- Tone: ${options.tone}

## Page Copy

${blocks.map((block) => `### ${titleCase(block.section)}

**Headline:** ${block.headline}

${block.body}

Primary CTA: ${block.primaryCta}

Secondary CTA: ${block.secondaryCta}
`).join("\n")}

## Messaging Notes

- Keep the hero promise and final CTA aligned.
- Use one primary conversion path throughout the page.
- Support every claim with proof, a product artifact, or an operational example.
- Remove copy that does not help ${options.audience} decide whether to ${options.goal}.
`;
}

function renderWireframe(options: LandingPageOptions, blocks: CopyBlock[]): string {
  return `# Wireframe: ${titleCase(options.product)}

${blocks.map((block, index) => `## ${index + 1}. ${titleCase(block.section)}

- Goal: ${wireframeGoal(block.section, options)}
- Content: headline, short body, proof or visual, primary CTA.
- CTA: ${block.primaryCta}
- Measurement: ${block.trackingEvent}
`).join("\n")}
`;
}

function renderPreviewHtml(options: LandingPageOptions, blocks: CopyBlock[]): string {
  const hero = blocks[0];
  const rest = blocks.slice(1);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(options.offer)}">
  <title>${escapeHtml(titleCase(options.product))}</title>
  <style>
    :root { color-scheme: light; --ink: #14213d; --muted: #53627c; --line: #d7dde8; --paper: #f7f9fc; --accent: #0f766e; --warm: #b45309; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: var(--ink); background: #ffffff; line-height: 1.6; }
    main { width: min(1080px, calc(100% - 32px)); margin: 0 auto; }
    section { padding: 44px 0; border-bottom: 1px solid var(--line); }
    .hero { min-height: 520px; display: grid; align-content: center; gap: 22px; }
    .eyebrow { color: var(--accent); font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; }
    h1 { font-size: clamp(40px, 8vw, 86px); line-height: 0.96; margin: 0; letter-spacing: 0; max-width: 920px; }
    h2 { font-size: clamp(28px, 4vw, 48px); line-height: 1.06; margin: 0 0 14px; letter-spacing: 0; }
    p { max-width: 720px; color: var(--muted); font-size: 18px; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
    .button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 18px; border-radius: 6px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 700; }
    .button.secondary { background: var(--paper); color: var(--ink); border: 1px solid var(--line); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
    .panel { border: 1px solid var(--line); background: var(--paper); border-radius: 8px; padding: 24px; }
    .event { color: var(--warm); font-size: 13px; font-weight: 700; }
    @media (max-width: 720px) { main { width: min(100% - 24px, 1080px); } .grid { grid-template-columns: 1fr; } .hero { min-height: 460px; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="eyebrow">${escapeHtml(options.audience)}</div>
      <h1>${escapeHtml(hero?.headline || titleCase(options.product))}</h1>
      <p>${escapeHtml(hero?.body || options.offer)}</p>
      <div class="actions">
        <a class="button" href="#cta">${escapeHtml(hero?.primaryCta || ctaForGoal(options.goal))}</a>
        <a class="button secondary" href="#proof">${escapeHtml(hero?.secondaryCta || "See proof")}</a>
      </div>
    </section>
    <div class="grid">
      ${rest.map((block) => `<section class="panel" id="${escapeHtml(slugify(block.section))}">
        <div class="eyebrow">${escapeHtml(block.section)}</div>
        <h2>${escapeHtml(block.headline)}</h2>
        <p>${escapeHtml(block.body)}</p>
        <div class="actions">
          <a class="button" href="#cta">${escapeHtml(block.primaryCta)}</a>
          <a class="button secondary" href="#${escapeHtml(slugify(block.section))}">${escapeHtml(block.secondaryCta)}</a>
        </div>
        <p class="event">${escapeHtml(block.trackingEvent)}</p>
      </section>`).join("\n      ")}
    </div>
    <section id="cta">
      <div class="eyebrow">Next step</div>
      <h2>Ready to ${escapeHtml(options.goal)}?</h2>
      <p>${escapeHtml(options.offer)}</p>
      <div class="actions"><a class="button" href="/contact">${escapeHtml(ctaForGoal(options.goal))}</a></div>
    </section>
  </main>
</body>
</html>
`;
}

function renderStyleGuide(options: LandingPageOptions): string {
  return `# Style Guide

## Voice

- Tone: ${options.tone}
- Audience language: use the nouns and workflows ${options.audience} already recognize.
- Sentence shape: lead with outcomes, then explain the proof.

## Visual Direction

- Layout: full-width sections with clear scanning rhythm.
- Color: one trustworthy accent, one warm highlight, neutral page background.
- Type: large hero headline, compact section headings, readable body copy.
- Imagery: product screenshots, workflow diagrams, customer proof, or concrete output samples.
`;
}

function renderCtaMap(blocks: CopyBlock[]): string {
  return [
    "section,primary_cta,secondary_cta,tracking_event",
    ...blocks.map((block) => [
      csvCell(block.section),
      csvCell(block.primaryCta),
      csvCell(block.secondaryCta),
      csvCell(block.trackingEvent),
    ].join(",")),
  ].join("\n") + "\n";
}

function renderExperimentPlan(options: LandingPageOptions, blocks: CopyBlock[]): string {
  return `# Experiment Plan

## Primary Metric

Measure the rate of visitors who complete: ${options.goal}.

## Tests

1. Hero promise: compare outcome-first headline against pain-first headline.
2. Proof placement: move ${options.proof} from the middle section to directly below the hero.
3. CTA language: compare "${ctaForGoal(options.goal)}" against a lower-friction action.
4. Section order: test proof before solution for buyers with high risk sensitivity.

## Events

${blocks.map((block) => `- ${block.trackingEvent}: ${block.primaryCta}`).join("\n")}
`;
}

function renderImplementationNotes(options: LandingPageOptions, blocks: CopyBlock[]): string {
  return `# Implementation Notes

## Build Notes

- Keep the page focused on ${options.goal}; avoid navigation paths that compete with the main action.
- Reuse the section IDs from the preview HTML for analytics and QA.
- Add screenshots, diagrams, or customer evidence where the copy references proof.
- Review every claim with product, sales, and legal owners before publishing.

## QA Checklist

- Mobile hero fits without horizontal overflow.
- CTA labels match the CTA map.
- Forms, calendar links, and analytics events are tested before launch.
- Page speed budget is agreed before adding media.

## Sections

${blocks.map((block) => `- ${block.section}: ${block.headline}`).join("\n")}
`;
}

function defaultOffer(product: string, audience: string): string {
  return `${titleCase(product)} helps ${audience} reach the next decision faster with less manual work`;
}

function ctaForGoal(goal: string): string {
  const normalized = goal.toLowerCase();
  if (normalized.includes("demo")) return "Book a demo";
  if (normalized.includes("signup") || normalized.includes("sign up")) return "Start signup";
  if (normalized.includes("trial")) return "Start a trial";
  if (normalized.includes("download")) return "Download the guide";
  if (normalized.includes("call")) return "Schedule a call";
  return `Start ${goal}`;
}

function wireframeGoal(section: string, options: LandingPageOptions): string {
  if (section.includes("hero")) return `make ${options.offer} clear in one screen`;
  if (section.includes("problem")) return "make the cost of inaction concrete";
  if (section.includes("solution")) return "show the new workflow";
  if (section.includes("proof")) return "reduce buying risk";
  if (section.includes("faq")) return "answer objections before sales contact";
  if (section.includes("cta")) return `convert visitors toward ${options.goal}`;
  return `support ${options.goal}`;
}

function tonePhrase(tone: Tone): string {
  if (tone === "premium") return "Use confident, restrained copy.";
  if (tone === "friendly") return "Use plain language and a helpful rhythm.";
  if (tone === "technical") return "Use specific workflow details and measurable outcomes.";
  return "Use direct language and short claims.";
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
    .replace(/^-+|-+$/g, "") || "section";
}

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
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
