#!/usr/bin/env bun

/**
 * Deep Research Skill
 *
 * Performs comprehensive multi-step research using AI and web search.
 * Breaks down questions, searches sources, analyzes content, and generates
 * detailed reports with proper citations.
 */

import { parseArgs } from "util";
import { writeFile, mkdir, appendFile } from "fs/promises";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";

// ============================================================================
// Security: HTML Escaping to prevent XSS
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
 */
function escapeHtml(str: string | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ============================================================================
// Constants & Logging
// ============================================================================

const SKILL_NAME = "deep-research";
const SESSION_ID = randomUUID().slice(0, 8);
const SKILLS_OUTPUT_DIR = process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills");
const LOGS_DIR = join(SKILLS_OUTPUT_DIR, "logs", SKILL_NAME);
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "_").slice(0, 19);

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function log(message: string, level: "info" | "error" | "success" | "debug" = "info") {
  ensureDir(LOGS_DIR);
  const timestamp = new Date().toISOString();
  const logFile = join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`);
  const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  
  try {
    await appendFile(logFile, logEntry);
  } catch (e) {
    // Silent fail for logging
  }

  const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "debug" ? "🔍" : "ℹ️";
  if (level === "error") {
    console.error(`${prefix} ${message}`);
  } else if (level !== "debug") {
    console.log(`${prefix} ${message}`);
  }
}

// ============================================================================
// Types
// ============================================================================

type ResearchDepth = "quick" | "standard" | "deep" | "exhaustive";
type ResearchMode = "general" | "academic" | "news" | "technical" | "market";
type OutputFormat = "md" | "json" | "html" | "pdf";
type CitationStyle = "apa" | "mla" | "chicago" | "none";

interface ResearchOptions {
  query: string;
  depth: ResearchDepth;
  mode: ResearchMode;
  maxSources: number;
  output?: string;
  format: OutputFormat;
  citationStyle: CitationStyle;
  includeRaw: boolean;
  focusDomains?: string[];
  excludeDomains?: string[];
  dateRange?: { start: string; end: string };
  language: string;
  verbose: boolean;
}

interface Source {
  id: number;
  title: string;
  url: string;
  authors?: string[];
  date?: string;
  type: string;
  content: string;
  credibilityScore: number;
  domain: string;
}

interface Finding {
  finding: string;
  sources: number[];
  confidence: "high" | "medium" | "low";
  quotes?: string[];
}

interface ResearchResult {
  metadata: {
    topic: string;
    generatedAt: string;
    depth: ResearchDepth;
    mode: ResearchMode;
    sourcesAnalyzed: number;
    durationSeconds: number;
    tokenUsage: number;
  };
  executiveSummary: string;
  keyFindings: Finding[];
  sections: Array<{
    title: string;
    content: string;
    subsections?: Array<{ title: string; content: string }>;
  }>;
  sources: Source[];
  searchQueries: string[];
  rawData?: any;
}

// ============================================================================
// Configuration
// ============================================================================

const DEPTH_CONFIG = {
  quick: { sources: 10, iterations: 1, queries: 5 },
  standard: { sources: 20, iterations: 3, queries: 12 },
  deep: { sources: 50, iterations: 5, queries: 25 },
  exhaustive: { sources: 100, iterations: 7, queries: 40 },
};

const MODE_CONFIG = {
  general: {
    domains: [],
    keywords: [],
  },
  academic: {
    domains: ["arxiv.org", "scholar.google.com", "pubmed.ncbi.nlm.nih.gov", ".edu", ".gov"],
    keywords: ["research", "study", "paper", "journal", "peer-reviewed"],
  },
  news: {
    domains: ["reuters.com", "apnews.com", "bbc.com", "theguardian.com", "nytimes.com"],
    keywords: ["news", "breaking", "report", "announced"],
  },
  technical: {
    domains: ["github.com", "stackoverflow.com", "dev.to", "medium.com/tag/programming"],
    keywords: ["documentation", "tutorial", "guide", "implementation", "code"],
  },
  market: {
    domains: ["bloomberg.com", "reuters.com", "wsj.com", "forbes.com", "crunchbase.com"],
    keywords: ["market", "business", "company", "revenue", "industry"],
  },
};

// ============================================================================
// API Clients
// ============================================================================

class AIClient {
  private provider: "openai" | "anthropic";
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.provider = "openai";
      this.apiKey = process.env.OPENAI_API_KEY;
      this.baseURL = "https://api.openai.com/v1";
      this.model = "gpt-4o";
    } else if (process.env.ANTHROPIC_API_KEY) {
      this.provider = "anthropic";
      this.apiKey = process.env.ANTHROPIC_API_KEY;
      this.baseURL = "https://api.anthropic.com/v1";
      this.model = "claude-3-5-sonnet-20241022";
    } else {
      throw new Error("No AI API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY");
    }
  }

  async chat(messages: Array<{ role: string; content: string }>, options?: { maxTokens?: number }): Promise<string> {
    if (this.provider === "openai") {
      return this.chatOpenAI(messages, options);
    } else {
      return this.chatAnthropic(messages, options);
    }
  }

  private async chatOpenAI(messages: Array<{ role: string; content: string }>, options?: { maxTokens?: number }): Promise<string> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options?.maxTokens || 4000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  private async chatAnthropic(messages: Array<{ role: string; content: string }>, options?: { maxTokens?: number }): Promise<string> {
    // Convert messages format for Anthropic
    const systemMessage = messages.find((m) => m.role === "system")?.content || "";
    const userMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch(`${this.baseURL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options?.maxTokens || 4000,
        system: systemMessage,
        messages: userMessages,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.content[0].text;
  }
}

class SearchClient {
  private provider: "exa" | "tavily" | "serpapi";
  private apiKey: string;
  private baseURL: string;

  constructor() {
    if (process.env.EXA_API_KEY) {
      this.provider = "exa";
      this.apiKey = process.env.EXA_API_KEY;
      this.baseURL = "https://api.exa.ai";
    } else if (process.env.TAVILY_API_KEY) {
      this.provider = "tavily";
      this.apiKey = process.env.TAVILY_API_KEY;
      this.baseURL = "https://api.tavily.com";
    } else if (process.env.SERPAPI_KEY) {
      this.provider = "serpapi";
      this.apiKey = process.env.SERPAPI_KEY;
      this.baseURL = "https://serpapi.com";
    } else {
      throw new Error("No search API key found. Set EXA_API_KEY, TAVILY_API_KEY, or SERPAPI_KEY");
    }
  }

  async search(
    query: string,
    options: {
      numResults?: number;
      includeDomains?: string[];
      excludeDomains?: string[];
      dateRange?: { start: string; end: string };
    } = {}
  ): Promise<Array<{ title: string; url: string; snippet: string; date?: string }>> {
    if (this.provider === "exa") {
      return this.searchExa(query, options);
    } else if (this.provider === "tavily") {
      return this.searchTavily(query, options);
    } else {
      return this.searchSerpAPI(query, options);
    }
  }

  private async searchExa(
    query: string,
    options: {
      numResults?: number;
      includeDomains?: string[];
      excludeDomains?: string[];
      dateRange?: { start: string; end: string };
    }
  ): Promise<Array<{ title: string; url: string; snippet: string; date?: string }>> {
    const response = await fetch(`${this.baseURL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        query,
        num_results: options.numResults || 10,
        use_autoprompt: true,
        include_domains: options.includeDomains,
        exclude_domains: options.excludeDomains,
        start_published_date: options.dateRange?.start,
        end_published_date: options.dateRange?.end,
      }),
    });

    if (!response.ok) {
      throw new Error(`Exa API error: ${response.status}`);
    }

    const data = await response.json();
    return data.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.text || r.snippet || "",
      date: r.published_date,
    }));
  }

  private async searchTavily(
    query: string,
    options: {
      numResults?: number;
      includeDomains?: string[];
      excludeDomains?: string[];
    }
  ): Promise<Array<{ title: string; url: string; snippet: string; date?: string }>> {
    const response = await fetch(`${this.baseURL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: options.numResults || 10,
        include_domains: options.includeDomains,
        exclude_domains: options.excludeDomains,
        search_depth: "advanced",
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status}`);
    }

    const data = await response.json();
    return data.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }

  private async searchSerpAPI(
    query: string,
    options: {
      numResults?: number;
    }
  ): Promise<Array<{ title: string; url: string; snippet: string }>> {
    const params = new URLSearchParams({
      api_key: this.apiKey,
      q: query,
      num: String(options.numResults || 10),
      engine: "google",
    });

    const response = await fetch(`${this.baseURL}/search?${params}`);

    if (!response.ok) {
      throw new Error(`SerpAPI error: ${response.status}`);
    }

    const data = await response.json();
    return (data.organic_results || []).map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    }));
  }
}

// ============================================================================
// Content Fetcher
// ============================================================================

async function fetchContent(url: string): Promise<string> {
  try {
    // Try Jina AI Reader first if available
    if (process.env.JINA_API_KEY) {
      const response = await fetch(`https://r.jina.ai/${url}`, {
        headers: {
          Authorization: `Bearer ${process.env.JINA_API_KEY}`,
        },
      });
      if (response.ok) {
        return await response.text();
      }
    }

    // Fallback to direct fetch
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; skills.md-deep-research/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    // Basic text extraction (remove HTML tags)
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 10000); // Limit to 10k chars
  } catch (error) {
    log(`Failed to fetch ${url}: ${error}`, "error");
    return "";
  }
}

// ============================================================================
// Research Engine
// ============================================================================

class ResearchEngine {
  private ai: AIClient;
  private search: SearchClient;
  private options: ResearchOptions;
  private sources: Source[] = [];
  private allQueries: string[] = [];
  private tokenUsage = 0;

  constructor(options: ResearchOptions) {
    this.ai = new AIClient();
    this.search = new SearchClient();
    this.options = options;
  }

  async run(): Promise<ResearchResult> {
    const startTime = Date.now();

    if (this.options.verbose) {
      log(`Starting ${this.options.depth} research on: "${this.options.query}"`, "info");
      log(`Mode: ${this.options.mode}`, "info");
    }

    // Step 1: Break down the research question
    const subQuestions = await this.generateSubQuestions();
    if (this.options.verbose) {
      log(`Generated ${subQuestions.length} sub-questions`, "debug");
    }

    // Step 2: Generate search queries
    const searchQueries = await this.generateSearchQueries(subQuestions);
    if (this.options.verbose) {
      log(`Generated ${searchQueries.length} search queries`, "debug");
    }

    // Step 3: Search and fetch sources
    await this.searchAndFetchSources(searchQueries);
    if (this.options.verbose) {
      log(`Collected ${this.sources.length} sources`, "debug");
    }

    // Step 4: Analyze sources and extract findings
    const findings = await this.analyzeSourcesForFindings();
    if (this.options.verbose) {
      log(`Extracted ${findings.length} key findings`, "debug");
    }

    // Step 5: Generate executive summary
    const executiveSummary = await this.generateExecutiveSummary(findings);

    // Step 6: Generate detailed sections
    const sections = await this.generateDetailedSections(findings);

    // Step 7: Build result
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const result: ResearchResult = {
      metadata: {
        topic: this.options.query,
        generatedAt: new Date().toISOString(),
        depth: this.options.depth,
        mode: this.options.mode,
        sourcesAnalyzed: this.sources.length,
        durationSeconds: duration,
        tokenUsage: this.tokenUsage,
      },
      executiveSummary,
      keyFindings: findings,
      sections,
      sources: this.sources,
      searchQueries: this.allQueries,
      rawData: this.options.includeRaw ? { subQuestions, searchQueries } : undefined,
    };

    return result;
  }

  private async generateSubQuestions(): Promise<string[]> {
    const config = DEPTH_CONFIG[this.options.depth];
    const numQuestions = Math.ceil(config.iterations * 2);

    const prompt = `You are a research expert. Break down this research question into ${numQuestions} focused sub-questions that will help conduct comprehensive research.

Research Question: "${this.options.query}"
Research Mode: ${this.options.mode}

Generate ${numQuestions} specific, focused sub-questions. Each should explore a different aspect or angle.
Return ONLY the questions, one per line, numbered.`;

    const response = await this.ai.chat([
      { role: "system", content: "You are a research planning expert." },
      { role: "user", content: prompt },
    ]);

    this.tokenUsage += response.length;

    return response
      .split("\n")
      .filter((line) => line.trim().match(/^\d+\./))
      .map((line) => line.replace(/^\d+\.\s*/, "").trim())
      .slice(0, numQuestions);
  }

  private async generateSearchQueries(subQuestions: string[]): Promise<string[]> {
    const config = DEPTH_CONFIG[this.options.depth];
    const modeConfig = MODE_CONFIG[this.options.mode];

    const prompt = `Generate ${config.queries} search queries to find information about these questions:

${subQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Research Mode: ${this.options.mode}
${modeConfig.keywords.length > 0 ? `Focus Keywords: ${modeConfig.keywords.join(", ")}` : ""}

Generate diverse, specific search queries. Include different phrasings, technical terms, and related concepts.
Return ONLY the search queries, one per line.`;

    const response = await this.ai.chat([
      { role: "system", content: "You are a search query optimization expert." },
      { role: "user", content: prompt },
    ]);

    this.tokenUsage += response.length;

    const queries = response
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*|-\s*/, "").trim())
      .filter((q) => q.length > 0)
      .slice(0, config.queries);

    this.allQueries = queries;
    return queries;
  }

  private async searchAndFetchSources(queries: string[]): Promise<void> {
    const config = DEPTH_CONFIG[this.options.depth];
    const modeConfig = MODE_CONFIG[this.options.mode];
    const resultsPerQuery = Math.ceil(config.sources / queries.length);

    const searchOptions = {
      numResults: resultsPerQuery,
      includeDomains: this.options.focusDomains || modeConfig.domains,
      excludeDomains: this.options.excludeDomains,
      dateRange: this.options.dateRange,
    };

    let sourceId = 1;
    const seenUrls = new Set<string>();

    for (const query of queries) {
      if (this.sources.length >= this.options.maxSources) break;

      try {
        const results = await this.search.search(query, searchOptions);

        for (const result of results) {
          if (this.sources.length >= this.options.maxSources) break;
          if (seenUrls.has(result.url)) continue;

          seenUrls.add(result.url);

          if (this.options.verbose) {
            log(`Fetching: ${result.title.slice(0, 60)}...`, "debug");
          }

          const content = await fetchContent(result.url);
          if (!content) continue;

          const domain = new URL(result.url).hostname;
          const source: Source = {
            id: sourceId++,
            title: result.title,
            url: result.url,
            date: result.date,
            type: this.classifySourceType(domain),
            content,
            credibilityScore: this.calculateCredibilityScore(domain, content),
            domain,
          };

          this.sources.push(source);
        }
      } catch (error) {
        log(`Search failed for query "${query}": ${error}`, "error");
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private classifySourceType(domain: string): string {
    if (domain.includes("arxiv.org") || domain.includes("scholar.google")) return "academic_preprint";
    if (domain.endsWith(".edu")) return "academic";
    if (domain.endsWith(".gov")) return "government";
    if (domain.includes("github.com")) return "code_repository";
    if (domain.includes("stackoverflow.com")) return "technical_forum";
    if (domain.includes("medium.com") || domain.includes("dev.to")) return "blog";
    if (domain.includes("reuters.com") || domain.includes("bbc.com")) return "news";
    return "web";
  }

  private calculateCredibilityScore(domain: string, content: string): number {
    let score = 0.5; // Base score

    // Domain-based scoring
    if (domain.endsWith(".edu")) score += 0.2;
    if (domain.endsWith(".gov")) score += 0.3;
    if (domain.includes("arxiv.org") || domain.includes("scholar.google")) score += 0.25;
    if (domain.includes("reuters.com") || domain.includes("apnews.com")) score += 0.2;

    // Content-based scoring
    if (content.includes("peer-reviewed") || content.includes("published in")) score += 0.1;
    if (content.includes("citation") || content.includes("references")) score += 0.05;
    if (content.length > 5000) score += 0.05; // Substantial content

    return Math.min(score, 1.0);
  }

  private async analyzeSourcesForFindings(): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Group sources into batches for analysis
    const batchSize = 5;
    for (let i = 0; i < this.sources.length; i += batchSize) {
      const batch = this.sources.slice(i, i + batchSize);

      const sourcesText = batch
        .map(
          (s) =>
            `[Source ${s.id}] ${s.title}\nURL: ${s.url}\nContent: ${s.content.slice(0, 2000)}...`
        )
        .join("\n\n");

      const prompt = `Analyze these sources and extract key findings related to: "${this.options.query}"

${sourcesText}

For each finding:
1. State the finding clearly
2. List source IDs that support it
3. Rate confidence (high/medium/low)
4. Extract 1-2 key quotes if relevant

Return findings in JSON format:
[
  {
    "finding": "Finding text",
    "sources": [1, 2],
    "confidence": "high",
    "quotes": ["quote 1", "quote 2"]
  }
]`;

      try {
        const response = await this.ai.chat([
          { role: "system", content: "You are a research analyst expert at synthesizing information." },
          { role: "user", content: prompt },
        ]);

        this.tokenUsage += response.length;

        // Extract JSON from response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const batchFindings = JSON.parse(jsonMatch[0]);
          findings.push(...batchFindings);
        }
      } catch (error) {
        log(`Failed to analyze batch: ${error}`, "error");
      }
    }

    return findings.slice(0, 20); // Limit to top 20 findings
  }

  private async generateExecutiveSummary(findings: Finding[]): Promise<string> {
    const findingsText = findings
      .map((f) => `- ${f.finding} (Confidence: ${f.confidence})`)
      .join("\n");

    const prompt = `Write a comprehensive executive summary (2-3 paragraphs) for this research on: "${this.options.query}"

Key Findings:
${findingsText}

The summary should:
- Highlight the most important insights
- Provide context and implications
- Be clear and concise
- Use professional language`;

    const response = await this.ai.chat([
      { role: "system", content: "You are a professional research writer." },
      { role: "user", content: prompt },
    ]);

    this.tokenUsage += response.length;
    return response.trim();
  }

  private async generateDetailedSections(findings: Finding[]): Promise<Array<{ title: string; content: string }>> {
    // Group findings into sections
    const sectionsPrompt = `Given these findings about "${this.options.query}", suggest 3-5 main section titles for organizing them:

${findings.map((f, i) => `${i + 1}. ${f.finding}`).join("\n")}

Return ONLY the section titles, one per line.`;

    const sectionsResponse = await this.ai.chat([
      { role: "system", content: "You are a document structure expert." },
      { role: "user", content: sectionsPrompt },
    ]);

    this.tokenUsage += sectionsResponse.length;

    const sectionTitles = sectionsResponse
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*|-\s*/, "").trim())
      .filter((t) => t.length > 0)
      .slice(0, 5);

    // Generate content for each section
    const sections = [];
    for (const title of sectionTitles) {
      const relevantFindings = findings.slice(0, 4); // Use top findings

      const contentPrompt = `Write detailed content for the section "${title}" in a research report about "${this.options.query}".

Incorporate these findings:
${relevantFindings.map((f) => `- ${f.finding}`).join("\n")}

Include:
- Detailed analysis
- Evidence and supporting information
- Citations in format [Source N]
- 2-3 paragraphs

Write in clear, professional academic style.`;

      const content = await this.ai.chat([
        { role: "system", content: "You are a professional research writer." },
        { role: "user", content: contentPrompt },
      ]);

      this.tokenUsage += content.length;

      sections.push({
        title,
        content: content.trim(),
      });
    }

    return sections;
  }
}

// ============================================================================
// Output Formatters
// ============================================================================

function formatMarkdown(result: ResearchResult, citationStyle: CitationStyle): string {
  let md = `# Research Report: ${result.metadata.topic}\n\n`;
  md += `**Generated**: ${new Date(result.metadata.generatedAt).toLocaleString()}\n`;
  md += `**Depth**: ${result.metadata.depth}\n`;
  md += `**Sources Analyzed**: ${result.metadata.sourcesAnalyzed}\n`;
  md += `**Research Mode**: ${result.metadata.mode}\n\n`;
  md += `---\n\n`;

  // Executive Summary
  md += `## Executive Summary\n\n`;
  md += `${result.executiveSummary}\n\n`;
  md += `---\n\n`;

  // Table of Contents
  md += `## Table of Contents\n\n`;
  md += `1. Introduction\n`;
  md += `2. Key Findings\n`;
  md += `3. Detailed Analysis\n`;
  result.sections.forEach((section, i) => {
    md += `   3.${i + 1} ${section.title}\n`;
  });
  md += `4. Methodology\n`;
  md += `5. Conclusions\n`;
  md += `6. Sources\n\n`;
  md += `---\n\n`;

  // Introduction
  md += `## 1. Introduction\n\n`;
  md += `This report presents comprehensive research on "${result.metadata.topic}". `;
  md += `The research was conducted using ${result.metadata.mode} mode with ${result.metadata.depth} depth, `;
  md += `analyzing ${result.metadata.sourcesAnalyzed} sources over ${result.searchQueries.length} search queries.\n\n`;
  md += `---\n\n`;

  // Key Findings
  md += `## 2. Key Findings\n\n`;
  result.keyFindings.forEach((finding) => {
    const sourceRefs = finding.sources.map((id) => id).join(", ");
    md += `- **${finding.finding}** [Sources: ${sourceRefs}] _(Confidence: ${finding.confidence})_\n`;

    if (finding.quotes && finding.quotes.length > 0) {
      md += `  > "${finding.quotes[0]}"\n`;
    }
  });
  md += `\n---\n\n`;

  // Detailed Analysis
  md += `## 3. Detailed Analysis\n\n`;
  result.sections.forEach((section, i) => {
    md += `### 3.${i + 1} ${section.title}\n\n`;
    md += `${section.content}\n\n`;
  });
  md += `---\n\n`;

  // Methodology
  md += `## 4. Methodology\n\n`;
  md += `**Search Strategy**: Multi-iteration search with AI-generated queries\n`;
  md += `**Research Mode**: ${result.metadata.mode}\n`;
  md += `**Sources Consulted**: ${result.metadata.sourcesAnalyzed}\n`;
  md += `**Search Queries**: ${result.searchQueries.length}\n`;
  md += `**Quality Assessment**: Sources rated by domain credibility and content quality\n\n`;
  md += `---\n\n`;

  // Conclusions
  md += `## 5. Conclusions\n\n`;
  md += `This research on "${result.metadata.topic}" has revealed several key insights across ${result.sections.length} main areas. `;
  md += `The findings are supported by ${result.metadata.sourcesAnalyzed} diverse sources and provide a comprehensive overview of the current state of knowledge on this topic.\n\n`;
  md += `---\n\n`;

  // Sources
  md += `## 6. Sources\n\n`;
  result.sources.forEach((source) => {
    const citation = formatCitation(source, citationStyle);
    md += `${source.id}. ${citation}\n`;
  });
  md += `\n---\n\n`;

  // Footer
  md += `**Research completed in**: ${Math.floor(result.metadata.durationSeconds / 60)} minutes ${result.metadata.durationSeconds % 60} seconds\n`;
  md += `**Token usage**: ~${result.metadata.tokenUsage.toLocaleString()} tokens\n`;

  return md;
}

function formatCitation(source: Source, style: CitationStyle): string {
  if (style === "none") {
    return `${source.title}. ${source.url}`;
  }

  const domain = source.domain;
  const year = source.date ? new Date(source.date).getFullYear() : new Date().getFullYear();

  if (style === "apa") {
    return `${domain}. (${year}). ${source.title}. Retrieved from ${source.url}`;
  } else if (style === "mla") {
    return `"${source.title}." ${domain}, ${year}, ${source.url}.`;
  } else if (style === "chicago") {
    return `${domain}. "${source.title}." ${year}. ${source.url}.`;
  }

  return `${source.title}. ${source.url}`;
}

function formatJSON(result: ResearchResult): string {
  return JSON.stringify(result, null, 2);
}

function formatHTML(result: ResearchResult, citationStyle: CitationStyle): string {
  const md = formatMarkdown(result, citationStyle);

  // Convert markdown to HTML with proper escaping
  // Process line by line to maintain control over escaping
  const lines = md.split("\n");
  const htmlLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      htmlLines.push("");
      continue;
    }

    // Escape the content first, then apply formatting
    if (trimmed.startsWith("# ")) {
      htmlLines.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("## ")) {
      htmlLines.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("### ")) {
      htmlLines.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("- ")) {
      htmlLines.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
    } else if (trimmed === "---") {
      htmlLines.push("<hr>");
    } else {
      // Apply inline formatting to escaped content
      let escapedLine = escapeHtml(trimmed);
      // Bold: **text** - need to unescape the asterisks temporarily
      escapedLine = escapedLine.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      // Italic: *text*
      escapedLine = escapedLine.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      htmlLines.push(`<p>${escapedLine}</p>`);
    }
  }

  // Wrap consecutive list items in ul tags
  let html = htmlLines.join("\n");
  html = html.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (match) => `<ul>\n${match}</ul>\n`);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Research Report: ${escapeHtml(result.metadata.topic)}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 800px; margin: 50px auto; line-height: 1.6; }
    h1 { color: #2c3e50; }
    h2 { color: #34495e; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
    h3 { color: #7f8c8d; }
    hr { border: 0; border-top: 1px solid #ecf0f1; margin: 30px 0; }
    ul { margin: 1em 0; padding-left: 2em; }
    li { margin: 0.5em 0; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    // Parse arguments
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        depth: { type: "string", default: "standard" },
        mode: { type: "string", default: "general" },
        "max-sources": { type: "string", default: "20" },
        output: { type: "string" },
        format: { type: "string", default: "md" },
        "citation-style": { type: "string", default: "apa" },
        "include-raw": { type: "boolean", default: false },
        "focus-domains": { type: "string" },
        "exclude-domains": { type: "string" },
        "date-range": { type: "string" },
        language: { type: "string", default: "en" },
        verbose: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(`
Deep Research Skill

Usage:
  skills run deep-research -- "Your research question" [options]

Options:
  --depth <level>          Research depth: quick, standard, deep, exhaustive (default: standard)
  --mode <type>           Research mode: general, academic, news, technical, market (default: general)
  --max-sources <number>  Maximum sources to analyze (default: 20)
  --output <path>         Output file path
  --format <type>         Output format: md, json, html (default: md)
  --citation-style <style> Citation style: apa, mla, chicago, none (default: apa)
  --include-raw           Include raw source data
  --focus-domains <list>  Comma-separated domains to prioritize
  --exclude-domains <list> Comma-separated domains to exclude
  --date-range <range>    Date range: YYYY-MM-DD:YYYY-MM-DD
  --language <code>       Research language (default: en)
  --verbose               Show progress
  --help                  Show this help

Examples:
  skills run deep-research -- "What are the latest advances in quantum computing?" --depth quick
  skills run deep-research -- "Impact of microplastics" --mode academic --citation-style apa
  skills run deep-research -- "Best Kubernetes practices" --mode technical --verbose
`);
      return;
    }

    // Get query
    const query = positionals.join(" ").trim();
    if (!query) {
      log("Error: Research query is required", "error");
      console.error('Usage: skills run deep-research -- "Your research question"');
      process.exit(1);
    }

    // Validate options
    const depth = values.depth as ResearchDepth;
    if (!["quick", "standard", "deep", "exhaustive"].includes(depth)) {
      log("Error: Invalid depth. Use: quick, standard, deep, or exhaustive", "error");
      process.exit(1);
    }

    const mode = values.mode as ResearchMode;
    if (!["general", "academic", "news", "technical", "market"].includes(mode)) {
      log("Error: Invalid mode. Use: general, academic, news, technical, or market", "error");
      process.exit(1);
    }

    const format = values.format as OutputFormat;
    if (!["md", "json", "html", "pdf"].includes(format)) {
      log("Error: Invalid format. Use: md, json, html, or pdf", "error");
      process.exit(1);
    }

    if (format === "pdf") {
      log("Error: PDF format not yet implemented. Use md, json, or html", "error");
      process.exit(1);
    }

    const citationStyle = values["citation-style"] as CitationStyle;
    if (!["apa", "mla", "chicago", "none"].includes(citationStyle)) {
      log("Error: Invalid citation style. Use: apa, mla, chicago, or none", "error");
      process.exit(1);
    }

    // Parse optional fields
    const focusDomains = values["focus-domains"]?.split(",").map((d) => d.trim());
    const excludeDomains = values["exclude-domains"]?.split(",").map((d) => d.trim());

    let dateRange: { start: string; end: string } | undefined;
    if (values["date-range"]) {
      const [start, end] = values["date-range"].split(":");
      if (start && end) {
        dateRange = { start, end };
      }
    }

    const options: ResearchOptions = {
      query,
      depth,
      mode,
      maxSources: parseInt(values["max-sources"] || "20"),
      output: values.output,
      format,
      citationStyle,
      includeRaw: values["include-raw"] || false,
      focusDomains,
      excludeDomains,
      dateRange,
      language: values.language || "en",
      verbose: values.verbose || false,
    };

    // Run research
    log(`Starting ${SKILL_NAME} session: ${SESSION_ID}`, "debug");
    console.log(`\n🚀 Deep Research v1.0.0\n`);
    const engine = new ResearchEngine(options);
    const result = await engine.run();

    // Format output
    let output: string;
    if (format === "json") {
      output = formatJSON(result);
    } else if (format === "html") {
      output = formatHTML(result, citationStyle);
    } else {
      output = formatMarkdown(result, citationStyle);
    }

    // Save or print
    if (options.output) {
      await writeFile(options.output, output, "utf-8");
      log(`Research report saved to: ${options.output}`, "success");
    } else {
      // Auto-generate filename in exports directory
      const outputDir = process.env.SKILLS_OUTPUT_DIR || ".skills";
      const exportsDir = join(outputDir, "exports", "deep-research");
      await mkdir(exportsDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];
      const sanitizedQuery = query.slice(0, 50).replace(/[^a-z0-9]/gi, "-").toLowerCase();
      const filename = `research-${sanitizedQuery}-${timestamp}.${format}`;
      const filepath = join(exportsDir, filename);

      await writeFile(filepath, output, "utf-8");
      log(`Research report saved to: ${filepath}`, "success");
    }

    // Print summary
    console.log(`\n📊 Research Summary:`);
    console.log(`   Topic: ${result.metadata.topic}`);
    console.log(`   Sources: ${result.metadata.sourcesAnalyzed}`);
    console.log(`   Findings: ${result.keyFindings.length}`);
    console.log(`   Duration: ${Math.floor(result.metadata.durationSeconds / 60)}m ${result.metadata.durationSeconds % 60}s`);
    console.log(`   Tokens: ~${result.metadata.tokenUsage.toLocaleString()}`);
    console.log();
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
  }
}

main();
