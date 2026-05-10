import Exa from "exa-js";
import type { ExaSearchResponse, Source } from "../types";
import logger from "../utils/logger";

const EXA_CONCURRENT_LIMIT = 5;

let client: Exa | null = null;

function getClient(): Exa {
  if (!client) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "EXA_API_KEY not found. Please set it in ~/.secrets or environment."
      );
    }
    client = new Exa(apiKey);
  }
  return client;
}

export async function searchWithContent(
  query: string,
  numResults: number = 5
): Promise<ExaSearchResponse> {
  const exa = getClient();

  const response = await exa.searchAndContents(query, {
    type: "neural",
    useAutoprompt: true,
    numResults,
    text: {
      maxCharacters: 3000,
      includeHtmlTags: false,
    },
    highlights: {
      numSentences: 3,
      highlightsPerUrl: 3,
    },
  });

  return {
    results: response.results.map((r) => ({
      title: r.title || "Untitled",
      url: r.url,
      publishedDate: r.publishedDate,
      author: r.author,
      score: r.score,
      text: r.text,
      highlights: r.highlights,
      highlightScores: r.highlightScores,
    })),
    autopromptString: response.autopromptString,
  };
}

export async function searchInBatches(
  queries: string[],
  resultsPerQuery: number = 5
): Promise<Source[]> {
  const allSources: Source[] = [];
  const seenUrls = new Set<string>();
  let sourceId = 1;

  for (let i = 0; i < queries.length; i += EXA_CONCURRENT_LIMIT) {
    const batch = queries.slice(i, i + EXA_CONCURRENT_LIMIT);
    const batchNum = Math.floor(i / EXA_CONCURRENT_LIMIT) + 1;
    const totalBatches = Math.ceil(queries.length / EXA_CONCURRENT_LIMIT);

    logger.updateSpinner(
      `Searching batch ${batchNum}/${totalBatches} (${batch.length} queries)...`
    );

    const batchResults = await Promise.all(
      batch.map(async (query) => {
        try {
          return await searchWithContent(query, resultsPerQuery);
        } catch (error) {
          logger.warn(`Search failed for query: "${query.slice(0, 50)}..."`);
          return { results: [] };
        }
      })
    );

    for (const response of batchResults) {
      for (const result of response.results) {
        if (!seenUrls.has(result.url) && result.text) {
          seenUrls.add(result.url);
          allSources.push({
            id: sourceId++,
            title: result.title,
            url: result.url,
            content: result.text,
            publishedDate: result.publishedDate,
            author: result.author,
            relevanceScore: result.score,
          });
        }
      }
    }
  }

  return allSources;
}

export function isExaConfigured(): boolean {
  return !!process.env.EXA_API_KEY;
}
