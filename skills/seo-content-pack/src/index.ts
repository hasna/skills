#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

type Tone = "practical" | "executive" | "technical";

interface SeoOptions {
  topic: string;
  brand: string;
  audience: string;
  articles: number;
  tone: Tone;
  outputDir: string;
}

interface ArticlePlan {
  index: number;
  title: string;
  slug: string;
  keyword: string;
  searchIntent: string;
  summary: string;
  file: string;
}

const SKILL_NAME = "seo-content-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `SEO Content Pack

Usage:
  skills run seo-content-pack --topic "usage-based billing for AI SaaS" --audience "founders and operators"
  skills run seo-content-pack "developer onboarding automation" --brand "Acme" --articles 5

Options:
  --topic <text>      Core topic or search theme
  --brand <name>      Brand or product name. Default: Brand
  --audience <text>   Target audience. Default: SaaS buyers
  --articles <n>      Supporting article count, 3-8. Default: 5
  --tone <tone>       practical, executive, or technical. Default: practical
  --output <dir>      Output directory. Default: current run export directory
  --help              Show this help

Outputs:
  topic-cluster.md, pillar-article.md, supporting-articles/article-*.md, metadata.csv, internal-linking-plan.md, faqs.md, publishing-cadence.csv, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(join(options.outputDir, "supporting-articles"));

  const articles = buildArticlePlans(options);
  const topicCluster = buildTopicCluster(options, articles);
  const pillarArticle = buildPillarArticle(options, articles);
  const supportingArticles = articles.map((article) => ({
    ...article,
    body: buildSupportingArticle(options, article),
  }));
  const metadataCsv = buildMetadataCsv(options, articles);
  const internalLinks = buildInternalLinkingPlan(options, articles);
  const faqs = buildFaqs(options);
  const cadence = buildPublishingCadence(articles);
  const files = writeArtifacts(options, articles, {
    topicCluster,
    pillarArticle,
    supportingArticles,
    metadataCsv,
    internalLinks,
    faqs,
    cadence,
  });

  console.log(`Generated SEO content pack for ${options.topic}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.topicCluster}`);
  console.log(`- ${files.pillarArticle}`);
  for (const file of files.supportingArticles) console.log(`- ${file}`);
  console.log(`- ${files.metadata}`);
  console.log(`- ${files.internalLinks}`);
  console.log(`- ${files.faqs}`);
  console.log(`- ${files.cadence}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): SeoOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      topic: { type: "string" },
      brand: { type: "string", default: "Brand" },
      audience: { type: "string", default: "SaaS buyers" },
      articles: { type: "string", default: "5" },
      tone: { type: "string", default: "practical" },
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
    console.error("Topic is required. Pass --topic <text> or positional text.");
    process.exit(1);
  }

  const tone = String(values.tone || "practical");
  if (!isTone(tone)) {
    console.error("Invalid tone. Use practical, executive, or technical.");
    process.exit(1);
  }

  return {
    topic,
    brand: String(values.brand || "Brand").trim(),
    audience: String(values.audience || "SaaS buyers").trim(),
    articles: clamp(Number.parseInt(String(values.articles || "5"), 10) || 5, 3, 8),
    tone,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildArticlePlans(options: SeoOptions): ArticlePlan[] {
  const angles = [
    "implementation checklist",
    "buyer guide",
    "pricing mistakes",
    "migration roadmap",
    "metrics dashboard",
    "security and governance",
    "team workflow",
    "tool comparison",
  ];
  return Array.from({ length: options.articles }, (_, index) => {
    const angle = angles[index] || `angle ${index + 1}`;
    const title = `${titleCase(options.topic)}: ${titleCase(angle)}`;
    const slug = slugify(`${options.topic}-${angle}`);
    return {
      index: index + 1,
      title,
      slug,
      keyword: `${options.topic} ${angle}`,
      searchIntent: searchIntentFor(index),
      summary: `A ${options.tone} article for ${options.audience} covering ${angle} around ${options.topic}.`,
      file: `supporting-articles/article-${index + 1}-${slug}.md`,
    };
  });
}

function buildTopicCluster(options: SeoOptions, articles: ArticlePlan[]): string {
  return `# Topic Cluster: ${titleCase(options.topic)}

Brand: ${options.brand}

Audience: ${options.audience}

## Pillar Page

- Title: ${titleCase(options.topic)} Guide for ${options.audience}
- Primary keyword: ${options.topic}
- Intent: strategic evaluation and implementation planning

## Supporting Articles

${articles.map((article) => `- ${article.title}: ${article.keyword} (${article.searchIntent})`).join("\n")}

## Cluster Strategy

- Publish the pillar article first.
- Link every supporting article back to the pillar.
- Add lateral links between articles with adjacent intent.
- Refresh metadata every quarter based on search console data.
`;
}

function buildPillarArticle(options: SeoOptions, articles: ArticlePlan[]): string {
  return `# ${titleCase(options.topic)} Guide for ${options.audience}

${options.brand} helps teams approach ${options.topic} with a practical operating plan, clear buying criteria, and measurable rollout milestones.

## Why This Topic Matters

${titleCase(options.topic)} is no longer a side project for ${options.audience}. It affects acquisition quality, activation, retention, and the way teams prove operational leverage.

## Core Framework

1. Define the business outcome.
2. Map the current workflow.
3. Identify friction, risk, and manual work.
4. Choose a focused first use case.
5. Measure adoption and output quality.

## Supporting Reading

${articles.map((article) => `- [${article.title}](./${article.file})`).join("\n")}

## Next Step

Use the checklist from this cluster to prioritize the first article, internal owner, and conversion path.
`;
}

function buildSupportingArticle(options: SeoOptions, article: ArticlePlan): string {
  return `# ${article.title}

Target keyword: ${article.keyword}

Audience: ${options.audience}

## Summary

${article.summary}

## What Readers Need To Know

- The decision should be tied to a measurable workflow outcome.
- The fastest path is a narrow use case with clear success criteria.
- The rollout plan should include ownership, review, and reporting.

## Practical Steps

1. Document the current process.
2. Identify one high-friction handoff.
3. Define the minimum useful output.
4. Run a controlled pilot.
5. Review results and decide whether to expand.

## Call To Action

Use ${options.brand} to turn ${options.topic} from research into an executable plan.
`;
}

function buildMetadataCsv(options: SeoOptions, articles: ArticlePlan[]): string {
  const rows = [
    ["type", "title", "slug", "primary_keyword", "meta_title", "meta_description"],
    [
      "pillar",
      `${titleCase(options.topic)} Guide for ${options.audience}`,
      slugify(`${options.topic} guide`),
      options.topic,
      `${titleCase(options.topic)} Guide`,
      `A practical guide to ${options.topic} for ${options.audience}.`,
    ],
    ...articles.map((article) => [
      "supporting",
      article.title,
      article.slug,
      article.keyword,
      article.title.slice(0, 58),
      article.summary.slice(0, 150),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function buildInternalLinkingPlan(options: SeoOptions, articles: ArticlePlan[]): string {
  return `# Internal Linking Plan

## Pillar URL

/${slugify(`${options.topic} guide`)}

## Links

${articles.map((article, index) => {
    const next = articles[(index + 1) % articles.length];
    return `- ${article.title}: link to pillar with anchor "${options.topic} guide"${next ? ` and to "${next.title}"` : ""}.`;
  }).join("\n")}

## Rules

- Use descriptive anchors, not generic "read more" text.
- Keep each support article within two clicks of the pillar.
- Add conversion links after the first useful takeaway, not only at the end.
`;
}

function buildFaqs(options: SeoOptions): string {
  return `# FAQs

## What is ${options.topic}?

It is the set of decisions, workflows, and operating habits that help ${options.audience} improve a specific business outcome.

## Who should own this initiative?

Assign one accountable owner, one technical reviewer, and one business stakeholder.

## How should success be measured?

Measure activation, completion rate, quality of output, and business impact tied to the original use case.

## Where does ${options.brand} fit?

${options.brand} should be positioned as the practical path from strategy to execution.
`;
}

function buildPublishingCadence(articles: ArticlePlan[]): string {
  const rows = [
    ["week", "asset", "status", "distribution"],
    ["1", "pillar article", "draft and publish", "homepage, newsletter, sales enablement"],
    ...articles.map((article) => [
      String(article.index + 1),
      article.title,
      "publish supporting article",
      "search, social, internal links",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function writeArtifacts(
  options: SeoOptions,
  articles: ArticlePlan[],
  content: {
    topicCluster: string;
    pillarArticle: string;
    supportingArticles: Array<ArticlePlan & { body: string }>;
    metadataCsv: string;
    internalLinks: string;
    faqs: string;
    cadence: string;
  },
) {
  const topicClusterPath = join(options.outputDir, "topic-cluster.md");
  const pillarPath = join(options.outputDir, "pillar-article.md");
  const metadataPath = join(options.outputDir, "metadata.csv");
  const linksPath = join(options.outputDir, "internal-linking-plan.md");
  const faqsPath = join(options.outputDir, "faqs.md");
  const cadencePath = join(options.outputDir, "publishing-cadence.csv");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(topicClusterPath, content.topicCluster);
  writeFileSync(pillarPath, content.pillarArticle);
  for (const article of content.supportingArticles) {
    writeFileSync(join(options.outputDir, article.file), article.body);
  }
  writeFileSync(metadataPath, content.metadataCsv);
  writeFileSync(linksPath, content.internalLinks);
  writeFileSync(faqsPath, content.faqs);
  writeFileSync(cadencePath, content.cadence);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      topic: options.topic,
      brand: options.brand,
      audience: options.audience,
      articles: options.articles,
      tone: options.tone,
    },
    articleCount: articles.length,
    files: {
      topicCluster: toManifestPath(options.outputDir, topicClusterPath),
      pillarArticle: toManifestPath(options.outputDir, pillarPath),
      metadata: toManifestPath(options.outputDir, metadataPath),
      internalLinks: toManifestPath(options.outputDir, linksPath),
      faqs: toManifestPath(options.outputDir, faqsPath),
      cadence: toManifestPath(options.outputDir, cadencePath),
      supportingArticles: articles.map((article) => article.file),
    },
  });

  return {
    topicCluster: topicClusterPath,
    pillarArticle: pillarPath,
    supportingArticles: articles.map((article) => join(options.outputDir, article.file)),
    metadata: metadataPath,
    internalLinks: linksPath,
    faqs: faqsPath,
    cadence: cadencePath,
    manifest: manifestPath,
  };
}

function searchIntentFor(index: number): string {
  return ["informational", "commercial", "implementation", "comparison"][index % 4] || "informational";
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "article";
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isTone(value: string): value is Tone {
  return value === "practical" || value === "executive" || value === "technical";
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
