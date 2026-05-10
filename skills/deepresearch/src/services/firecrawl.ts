import type { FirecrawlResult } from "../types";

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape";

export async function scrapeUrl(url: string): Promise<FirecrawlResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      url,
      markdown: "",
      success: false,
      error: "FIRECRAWL_API_KEY not configured",
    };
  }

  try {
    const response = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        url,
        markdown: "",
        success: false,
        error: `HTTP ${response.status}: ${error}`,
      };
    }

    const data = (await response.json()) as {
      success: boolean;
      data?: { markdown?: string };
      error?: string;
    };

    if (!data.success) {
      return {
        url,
        markdown: "",
        success: false,
        error: data.error || "Unknown error",
      };
    }

    return {
      url,
      markdown: data.data?.markdown || "",
      success: true,
    };
  } catch (error) {
    return {
      url,
      markdown: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function scrapeUrls(
  urls: string[],
  concurrentLimit: number = 3
): Promise<FirecrawlResult[]> {
  const results: FirecrawlResult[] = [];

  for (let i = 0; i < urls.length; i += concurrentLimit) {
    const batch = urls.slice(i, i + concurrentLimit);
    const batchResults = await Promise.all(batch.map((url) => scrapeUrl(url)));
    results.push(...batchResults);
  }

  return results;
}

export function isFirecrawlConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}
