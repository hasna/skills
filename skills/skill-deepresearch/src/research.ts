import type { ResearchConfig, ResearchReport, Source, DepthLevel } from "./types";
import { DEPTH_CONFIG } from "./types";
import { generateQueries, generateFollowUpQueries } from "./agents/query-generator";
import { synthesizeReport, generateFindingsSummary } from "./agents/synthesizer";
import { searchInBatches, isExaConfigured } from "./services/exa";
import { scrapeUrls, isFirecrawlConfigured } from "./services/firecrawl";
import { isAnthropicConfigured } from "./services/anthropic";
import { isOpenAIConfigured } from "./services/openai";
import { saveReport, saveSourcesJson } from "./utils/file";
import logger from "./utils/logger";

export function validateConfig(config: ResearchConfig): void {
  if (!isExaConfigured()) {
    throw new Error("EXA_API_KEY is required for search. Set it in ~/.secrets");
  }

  if (config.model === "claude" && !isAnthropicConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude synthesis. Set it in ~/.secrets");
  }

  if (config.model === "openai" && !isOpenAIConfigured()) {
    throw new Error("OPENAI_API_KEY is required for OpenAI synthesis. Set it in ~/.secrets");
  }

  if (config.firecrawl && !isFirecrawlConfigured()) {
    logger.warn("FIRECRAWL_API_KEY not set. Skipping deep scraping.");
  }
}

async function runSearchIteration(
  topic: string,
  depth: DepthLevel,
  model: ResearchConfig["model"],
  existingSources: Source[],
  iterationNum: number
): Promise<Source[]> {
  const settings = DEPTH_CONFIG[depth];
  const queryCount = iterationNum === 1
    ? settings.queryCount
    : Math.floor(settings.queryCount / 2);

  logger.startSpinner(`Generating ${queryCount} search queries (iteration ${iterationNum})...`);

  let queries: string[];
  if (iterationNum === 1) {
    const result = await generateQueries(topic, queryCount, model);
    queries = result.queries;
  } else {
    const summary = await generateFindingsSummary(existingSources, model);
    const result = await generateFollowUpQueries(topic, summary, queryCount, model);
    queries = result.queries;
  }

  logger.succeedSpinner(`Generated ${queries.length} queries`);

  logger.startSpinner("Searching...");
  const newSources = await searchInBatches(queries, settings.resultsPerQuery);
  logger.succeedSpinner(`Found ${newSources.length} unique sources`);

  return newSources;
}

async function deepScrapeTopSources(
  sources: Source[],
  maxScrape: number = 5
): Promise<Source[]> {
  if (!isFirecrawlConfigured()) {
    return sources;
  }

  const topSources = sources
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, maxScrape);

  logger.startSpinner(`Deep scraping top ${topSources.length} sources with Firecrawl...`);

  const scrapeResults = await scrapeUrls(topSources.map((s) => s.url));

  let enhancedCount = 0;
  for (const result of scrapeResults) {
    if (result.success && result.markdown) {
      const source = sources.find((s) => s.url === result.url);
      if (source && result.markdown.length > source.content.length) {
        source.content = result.markdown.slice(0, 8000);
        enhancedCount++;
      }
    }
  }

  logger.succeedSpinner(`Enhanced ${enhancedCount} sources with deeper content`);

  return sources;
}

export async function runResearch(config: ResearchConfig): Promise<ResearchReport> {
  const { topic, depth, model, firecrawl, output, json } = config;
  const settings = DEPTH_CONFIG[depth];

  logger.header("Deep Research");
  logger.stats("Topic", topic);
  logger.stats("Depth", `${depth} (${settings.queryCount} queries, ${settings.iterations} iteration${settings.iterations > 1 ? "s" : ""})`);
  logger.stats("Model", model);
  logger.divider();

  validateConfig(config);

  let allSources: Source[] = [];

  for (let iteration = 1; iteration <= settings.iterations; iteration++) {
    if (settings.iterations > 1) {
      logger.info(`Starting iteration ${iteration} of ${settings.iterations}`);
    }

    const newSources = await runSearchIteration(
      topic,
      depth,
      model,
      allSources,
      iteration
    );

    const existingUrls = new Set(allSources.map((s) => s.url));
    const uniqueNewSources = newSources.filter((s) => !existingUrls.has(s.url));

    let nextId = allSources.length + 1;
    for (const source of uniqueNewSources) {
      source.id = nextId++;
    }

    allSources = [...allSources, ...uniqueNewSources];
    logger.info(`Total unique sources: ${allSources.length}`);
  }

  if (firecrawl !== false && isFirecrawlConfigured()) {
    allSources = await deepScrapeTopSources(allSources);
  }

  logger.startSpinner("Synthesizing report...");
  const synthesis = await synthesizeReport(topic, allSources, model);
  logger.succeedSpinner("Report synthesized");

  const report: ResearchReport = {
    topic,
    depth,
    generatedAt: new Date().toISOString(),
    queryCount: settings.queryCount * settings.iterations,
    sourceCount: allSources.length,
    report: synthesis.report,
    sources: allSources,
  };

  const reportPath = await saveReport(report, output);
  logger.success(`Report saved: ${reportPath}`);

  if (json) {
    const sourcesPath = await saveSourcesJson(allSources, topic, output);
    logger.success(`Sources JSON saved: ${sourcesPath}`);
  }

  logger.divider();
  logger.header("Research Complete");
  logger.stats("Sources analyzed", allSources.length);
  logger.stats("Output", reportPath);

  return report;
}
