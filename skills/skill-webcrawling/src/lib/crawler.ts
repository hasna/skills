/**
 * Web crawler using Firecrawl API
 */

import * as logger from "../utils/logger.js";
import { loadConfig, createSession, saveSession } from "./storage.js";
import type { ScrapeOptions, CrawlOptions, ScrapeResult, CrawlResult } from "../types/index.js";

/**
 * Get Firecrawl API key
 */
function getApiKey(): string {
  const config = loadConfig();
  const apiKey = config.firecrawlApiKey || process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY not set. Set it in environment or config.");
  }

  return apiKey;
}

/**
 * Scrape a single URL
 */
export async function scrapeUrl(
  url: string,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const apiKey = getApiKey();

  logger.info(`Scraping: ${url}`);

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: options.formats || ["markdown"],
      onlyMainContent: options.onlyMainContent ?? true,
      waitFor: options.waitFor,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firecrawl API error: ${error}`);
  }

  const data = (await response.json()) as any;

  if (!data.success) {
    throw new Error(data.error || "Scrape failed");
  }

  return {
    url,
    markdown: data.data?.markdown,
    html: data.data?.html,
    links: data.data?.links,
    metadata: data.data?.metadata,
  };
}

/**
 * Crawl an entire website
 */
export async function crawlWebsite(
  url: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const apiKey = getApiKey();

  logger.info(`Starting crawl: ${url}`);
  logger.info(`Max depth: ${options.maxDepth || 2}, Limit: ${options.limit || 10}`);

  // Start crawl job
  const startResponse = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      maxDepth: options.maxDepth || 2,
      limit: options.limit || 10,
      excludePaths: options.excludePaths,
      includePaths: options.includePaths,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    }),
  });

  if (!startResponse.ok) {
    const error = await startResponse.text();
    throw new Error(`Failed to start crawl: ${error}`);
  }

  const startData = (await startResponse.json()) as any;

  if (!startData.success) {
    throw new Error(startData.error || "Failed to start crawl");
  }

  const jobId = startData.id;
  logger.info(`Crawl job started: ${jobId}`);

  // Poll for results
  const pages: ScrapeResult[] = [];
  let completed = false;

  while (!completed) {
    await new Promise((r) => setTimeout(r, 2000));

    const statusResponse = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      throw new Error("Failed to check crawl status");
    }

    const statusData = (await statusResponse.json()) as any;

    if (statusData.status === "completed") {
      completed = true;

      for (const page of statusData.data || []) {
        pages.push({
          url: page.url,
          markdown: page.markdown,
          html: page.html,
          metadata: page.metadata,
        });
      }
    } else if (statusData.status === "failed") {
      throw new Error(statusData.error || "Crawl failed");
    } else {
      logger.info(`Crawling... (${statusData.completed || 0}/${statusData.total || "?"} pages)`);
    }
  }

  logger.success(`Crawl complete: ${pages.length} pages`);

  return {
    url,
    pages,
    totalPages: pages.length,
  };
}

/**
 * Crawl and save to session
 */
export async function crawlAndSave(
  url: string,
  options: CrawlOptions = {}
): Promise<{ sessionId: string; result: CrawlResult }> {
  const { sessionId, sessionDir } = createSession(url);

  const result = await crawlWebsite(url, options);

  saveSession(sessionDir, result);

  return { sessionId, result };
}
