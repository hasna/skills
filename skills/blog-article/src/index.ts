#!/usr/bin/env bun

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { parseArgs } from "util";

type Tone = "professional" | "casual" | "technical" | "friendly";
type Length = "short" | "medium" | "long";

interface ArticleOptions {
  topic: string;
  audience?: string;
  tone: Tone;
  length: Length;
  seo: boolean;
  outline?: string;
  count: number;
  outputDir: string;
}

interface ArticleSection {
  heading: string;
  content: string;
}

interface GeneratedArticle {
  title: string;
  metaDescription: string;
  introduction: string;
  sections: ArticleSection[];
  conclusion: string;
  keywords: string[];
  tags: string[];
}

const SKILL_NAME = "blog-article";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const MAX_ARTICLES_PER_RUN = 12;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `Blog Article

Usage:
  skills run create-blog-article -- "SaaS onboarding" --count 1
  skills run create-blog-article -- --topic "SaaS onboarding" --count 8 --length long --seo

Options:
  --topic <text>       Topic or theme. May also be passed as positional text.
  --audience <text>    Intended reader or buyer persona
  --count <number>     Number of articles to generate, 1-12. Default: 1
  --articles <number>  Alias for --count
  --tone <tone>        professional, casual, technical, friendly. Default: professional
  --length <length>    short, medium, long. Default: medium
  --seo                Include search metadata and keywords
  --outline <text>     Optional outline, angles, or required sections
  --output <dir>       Output directory. Default: current run export directory
  --help               Show help

Outputs:
  article.md, article.html, article.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const generatedAt = new Date().toISOString();
  const receipt = runReceipt();
  const manifest = {
    schemaVersion: 1,
    contract: "skills.blogArticle.outputs.v1",
    skill: SKILL_NAME,
    runId: RUN_ID,
    createdAt: generatedAt,
    generatedAt,
    prompt: promptSummary(options),
    inputs: {
      prompt: promptSummary(options),
      topic: options.topic,
      ...(options.audience ? { audience: options.audience } : {}),
      tone: options.tone,
      length: options.length,
      seo: options.seo,
      ...(options.outline ? { outline: options.outline } : {}),
      count: options.count,
    },
    ...(receipt ? { receipt } : {}),
    topic: options.topic,
    audience: options.audience,
    tone: options.tone,
    length: options.length,
    seo: options.seo,
    outline: options.outline,
    count: options.count,
    generatedAt: new Date().toISOString(),
    articles: [] as Array<{
      index: number;
      title: string;
      slug: string;
      summary: string;
      keywords: string[];
      featuredImage: string | null;
      wordCount: number;
      readingTime: number;
      files: {
        markdown: string;
        html: string;
        json: string;
      };
    }>,
  };

  for (let index = 1; index <= options.count; index++) {
    const article = await generateArticle(options, index);
    const wordCount = countWords(articleText(article));
    const readingTime = Math.max(1, Math.ceil(wordCount / 200));
    const slug = slugify(article.title || `${options.topic}-${index}`);
    const articleDir = options.count === 1
      ? options.outputDir
      : join(options.outputDir, `article-${String(index).padStart(2, "0")}-${slug}`);

    ensureDir(articleDir);
    const files = writeArticleFiles(article, articleDir, slug, wordCount, readingTime);

    manifest.articles.push({
      index,
      title: article.title,
      slug,
      summary: article.metaDescription,
      keywords: article.keywords,
      featuredImage: null,
      wordCount,
      readingTime,
      files: {
        markdown: toManifestPath(options.outputDir, files.markdown),
        html: toManifestPath(options.outputDir, files.html),
        json: toManifestPath(options.outputDir, files.json),
      },
    });
  }

  const manifestPath = join(options.outputDir, "manifest.json");
  writeJsonFile(manifestPath, manifest);

  console.log(`Generated ${options.count} blog article${options.count === 1 ? "" : "s"}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const article of manifest.articles) {
    console.log(`- ${article.title} (${article.wordCount} words): ${article.files.markdown}`);
  }
}

function parseCliOptions(): ArticleOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      topic: { type: "string" },
      audience: { type: "string" },
      tone: { type: "string", default: "professional" },
      length: { type: "string", default: "medium" },
      count: { type: "string" },
      articles: { type: "string" },
      n: { type: "string" },
      seo: { type: "boolean", default: false },
      outline: { type: "string" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const topic = String(values.topic || positionals.join(" ")).trim();
  if (!topic) {
    console.error("Topic is required. Pass it as positional text or --topic.");
    process.exit(1);
  }

  const tone = String(values.tone || "professional");
  if (!isTone(tone)) {
    console.error("Invalid tone. Use professional, casual, technical, or friendly.");
    process.exit(1);
  }

  const length = String(values.length || "medium");
  if (!isLength(length)) {
    console.error("Invalid length. Use short, medium, or long.");
    process.exit(1);
  }

  const count = parsePositiveInt(values.count || values.articles || values.n || "1");
  if (!Number.isFinite(count) || count < 1 || count > MAX_ARTICLES_PER_RUN) {
    console.error(`Count must be an integer between 1 and ${MAX_ARTICLES_PER_RUN}.`);
    process.exit(1);
  }

  return {
    topic,
    audience: trimOptional(values.audience),
    tone,
    length,
    seo: Boolean(values.seo),
    outline: trimOptional(values.outline),
    count,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

async function generateArticle(options: ArticleOptions, index: number): Promise<GeneratedArticle> {
  if (useLocalDeterministicGenerator()) {
    return deterministicArticle(options, index);
  }

  const apiKey = process.env.CEREBRAS_API_KEY || process.env.SKILL_TEXT_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Hosted article generation is not configured.");
  }

  const endpoint = `${(process.env.CEREBRAS_API_BASE_URL || process.env.SKILL_TEXT_API_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, "")}/chat/completions`;
  const model = process.env.CEREBRAS_MODEL || process.env.SKILL_TEXT_MODEL || "gpt-oss-120b";
  const prompt = articlePrompt(options, index);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You write useful, original blog articles. Return only valid JSON matching the requested schema.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: tokenBudgetForLength(options.length),
    }),
  });

  if (!response.ok) {
    throw new Error(`Hosted article generation failed with status ${response.status}.`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Hosted article generation returned no content.");
  }

  return normalizeArticle(parseJsonArticle(content), options, index);
}

function articlePrompt(options: ArticleOptions, index: number): string {
  return `Generate article ${index} of ${options.count} for this topic: ${options.topic}

Tone: ${options.tone}
Length: ${options.length}
Audience: ${options.audience || "general readers"}
SEO metadata: ${options.seo ? "yes" : "no"}
Outline: ${options.outline || "choose the strongest structure for the topic"}

Return a JSON object:
{
  "title": "string",
  "metaDescription": "string",
  "introduction": "string",
  "sections": [{"heading": "string", "content": "string"}],
  "conclusion": "string",
  "keywords": ["string"],
  "tags": ["string"]
}

Make each article in a batch use a distinct angle. Do not mention any model, vendor, or provider.`;
}

function deterministicArticle(options: ArticleOptions, index: number): GeneratedArticle {
  const angle = batchAngle(index);
  const sectionCount = options.length === "short" ? 3 : options.length === "long" ? 7 : 5;
  const title = options.count === 1
    ? titleCase(options.topic)
    : `${titleCase(options.topic)}: ${angle}`;
  const sections = [
    "Why it matters now",
    "The practical workflow",
    "Implementation details",
    "Metrics to watch",
    "Common mistakes",
    "A simple rollout plan",
    "Next steps",
  ].slice(0, sectionCount).map((heading, sectionIndex) => ({
    heading,
    content: paragraphFor(options, index, sectionIndex, heading),
  }));

  return {
    title,
    metaDescription: `${title} with practical guidance, examples, and next steps.`,
    introduction: `${title} is a practical guide for ${options.audience || "teams"} that need clear, actionable content without extra process. This article explains the core decisions, tradeoffs, and execution steps.`,
    sections,
    conclusion: `Treat ${options.topic} as a repeatable system: define the goal, keep the workflow visible, measure outcomes, and refine the pieces that slow people down.`,
    keywords: keywordList(options.topic),
    tags: ["blog", "article", "seo", slugify(options.topic)],
  };
}

function paragraphFor(options: ArticleOptions, articleIndex: number, sectionIndex: number, heading: string): string {
  const audience = options.audience ? ` for ${options.audience}` : "";
  const outline = options.outline ? ` Work from this outline: ${options.outline}.` : "";
  const base = `${heading} for ${options.topic}${audience} starts with a clear user outcome and a small set of constraints.`;
  const detail = `For article ${articleIndex}, focus on the decision a reader can make today, then support it with examples, risks, and checkpoints.`;
  const seo = options.seo ? " Include natural keyword usage, internal-link opportunities, and a concise call to action." : "";
  const depth = options.length === "long"
    ? " Add enough context for a reader to compare alternatives and choose a next step with confidence."
    : options.length === "short"
      ? " Keep the section direct and easy to scan."
      : " Balance explanation with a concrete checklist.";
  const repeated = sectionIndex % 2 === 0
    ? " Use specific nouns, avoid vague claims, and make the advice easy to reuse."
    : " Tie the recommendation back to business impact, customer value, or delivery speed.";
  return `${base} ${detail}${depth}${seo}${outline} ${repeated}`;
}

function normalizeArticle(value: unknown, options: ArticleOptions, index: number): GeneratedArticle {
  const fallback = deterministicArticle(options, index);
  if (!isRecord(value)) return fallback;

  const sections = Array.isArray(value.sections)
    ? value.sections
        .filter(isRecord)
        .map((section) => ({
          heading: stringOr(section.heading, "Section"),
          content: stringOr(section.content, ""),
        }))
        .filter((section) => section.content.trim())
    : fallback.sections;

  return {
    title: stringOr(value.title, fallback.title),
    metaDescription: stringOr(value.metaDescription, fallback.metaDescription),
    introduction: stringOr(value.introduction, fallback.introduction),
    sections: sections.length ? sections : fallback.sections,
    conclusion: stringOr(value.conclusion, fallback.conclusion),
    keywords: stringArray(value.keywords, fallback.keywords),
    tags: stringArray(value.tags, fallback.tags),
  };
}

function parseJsonArticle(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Hosted article generation returned invalid JSON.");
    return JSON.parse(match[0]);
  }
}

function writeArticleFiles(
  article: GeneratedArticle,
  articleDir: string,
  slug: string,
  wordCount: number,
  readingTime: number,
) {
  const markdownPath = join(articleDir, "article.md");
  const htmlPath = join(articleDir, "article.html");
  const jsonPath = join(articleDir, "article.json");

  writeFile(markdownPath, renderMarkdown(article, wordCount, readingTime));
  writeFile(htmlPath, renderHtml(article, wordCount, readingTime));
  writeJsonFile(jsonPath, {
    ...article,
    slug,
    summary: article.metaDescription,
    featuredImage: null,
    wordCount,
    readingTime,
    generatedAt: new Date().toISOString(),
  });

  return { markdown: markdownPath, html: htmlPath, json: jsonPath };
}

function renderMarkdown(article: GeneratedArticle, wordCount: number, readingTime: number): string {
  const lines = [
    "---",
    `title: ${yamlScalar(article.title)}`,
    `description: ${yamlScalar(article.metaDescription)}`,
    `keywords: ${yamlScalar(article.keywords.join(", "))}`,
    `tags: ${yamlScalar(article.tags.join(", "))}`,
    `readingTime: ${readingTime}`,
    `wordCount: ${wordCount}`,
    "---",
    "",
    `# ${article.title}`,
    "",
    article.introduction,
    "",
  ];

  for (const section of article.sections) {
    lines.push(`## ${section.heading}`, "", section.content, "");
  }

  lines.push("## Conclusion", "", article.conclusion, "");
  return `${lines.join("\n")}\n`;
}

function renderHtml(article: GeneratedArticle, wordCount: number, readingTime: number): string {
  const sections = article.sections.map((section) => `
    <section>
      <h2>${escapeHtml(section.heading)}</h2>
      ${paragraphs(section.content)}
    </section>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(article.metaDescription)}">
  <meta name="keywords" content="${escapeHtml(article.keywords.join(", "))}">
  <title>${escapeHtml(article.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.65; max-width: 760px; margin: 0 auto; padding: 32px; color: #1f2933; }
    h1, h2 { line-height: 1.2; }
    .meta { color: #52606d; margin-bottom: 28px; }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHtml(article.title)}</h1>
    <p class="meta">${readingTime} min read - ${wordCount} words</p>
    ${paragraphs(article.introduction)}
${sections}
    <section>
      <h2>Conclusion</h2>
      ${paragraphs(article.conclusion)}
    </section>
  </article>
</body>
</html>
`;
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((part) => `<p>${escapeHtml(part.trim())}</p>`)
    .join("\n      ");
}

function writeJsonFile(path: string, value: unknown) {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path: string, value: string) {
  ensureDir(dirname(path));
  writeFileSync(path, value);
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function useLocalDeterministicGenerator(): boolean {
  return process.env.SKILLS_TEST_MODE === "1" || process.env.SKILLS_FAKE_TEXT_PROVIDER === "1";
}

function articleText(article: GeneratedArticle): string {
  return [
    article.title,
    article.metaDescription,
    article.introduction,
    ...article.sections.flatMap((section) => [section.heading, section.content]),
    article.conclusion,
  ].join(" ");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path).split(/[\\/]+/).join("/") || ".";
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return slug || "article";
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function keywordList(topic: string): string[] {
  const parts = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 2);
  return Array.from(new Set([...parts, "guide", "strategy"])).slice(0, 8);
}

function batchAngle(index: number): string {
  const angles = [
    "Strategy Guide",
    "Implementation Playbook",
    "Executive Overview",
    "Practical Checklist",
    "Mistakes to Avoid",
    "Metrics and Measurement",
    "Customer-Focused Guide",
    "Operational Workflow",
    "Technical Primer",
    "Launch Plan",
    "Optimization Guide",
    "Future Trends",
  ];
  return angles[(index - 1) % angles.length];
}

function tokenBudgetForLength(length: Length): number {
  if (length === "short") return 1800;
  if (length === "long") return 5200;
  return 3200;
}

function promptSummary(options: ArticleOptions): string {
  return options.topic;
}

function runReceipt(): { costCents: number; formattedCost: string } | undefined {
  const costCents = parseOptionalCostCents(process.env.SKILLS_RUN_COST_CENTS);
  if (costCents === undefined) return undefined;
  return {
    costCents,
    formattedCost: `$${(costCents / 100).toFixed(2)}`,
  };
}

function parseOptionalCostCents(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parsePositiveInt(value: unknown): number {
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return NaN;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function trimOptional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isTone(value: string): value is Tone {
  return ["professional", "casual", "technical", "friendly"].includes(value);
}

function isLength(value: string): value is Length {
  return ["short", "medium", "long"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return result.length ? result : fallback;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Article generation failed.");
  process.exit(1);
});
