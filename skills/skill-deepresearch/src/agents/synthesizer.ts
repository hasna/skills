import type { ModelProvider, Source, SynthesisResult } from "../types";
import * as anthropic from "../services/anthropic";
import * as openai from "../services/openai";

const SYSTEM_PROMPT = `You are an expert research analyst who synthesizes information from multiple sources into comprehensive, well-structured reports.

Your reports should:
- Be factual and objective
- Cite sources using [1], [2], etc. notation
- Present multiple perspectives when they exist
- Highlight areas of consensus and disagreement
- Use clear markdown formatting
- Be thorough but concise`;

function formatSources(sources: Source[]): string {
  return sources
    .map(
      (s) => `
[Source ${s.id}] ${s.title}
URL: ${s.url}
${s.publishedDate ? `Published: ${s.publishedDate}` : ""}
${s.author ? `Author: ${s.author}` : ""}

Content:
${s.content.slice(0, 2500)}${s.content.length > 2500 ? "..." : ""}
`
    )
    .join("\n---\n");
}

function buildSynthesisPrompt(topic: string, sources: Source[]): string {
  return `Create a comprehensive research report on: "${topic}"

Based on the following ${sources.length} sources:

${formatSources(sources)}

Write a research report with these sections:

## Executive Summary
A 2-3 paragraph overview of the key findings.

## Key Findings
Bullet points of the most important discoveries.

## Detailed Analysis
Organized by subtopic, with in-depth coverage. Use headers for each major subtopic.

## Conclusions
Summary of insights and any recommendations.

Requirements:
- Cite sources inline using [1], [2], etc.
- Be objective and factual
- Present conflicting viewpoints if they exist
- Use markdown formatting
- Aim for thoroughness while staying focused`;
}

export async function synthesizeReport(
  topic: string,
  sources: Source[],
  model: ModelProvider
): Promise<SynthesisResult> {
  if (sources.length === 0) {
    return {
      report:
        "## No Sources Found\n\nNo relevant sources were found for this research topic. Please try refining your query or using different search terms.",
    };
  }

  const userPrompt = buildSynthesisPrompt(topic, sources);

  const report =
    model === "claude"
      ? await anthropic.generateText(SYSTEM_PROMPT, userPrompt, {
          maxTokens: 16384,
          temperature: 0.4,
        })
      : await openai.generateText(SYSTEM_PROMPT, userPrompt, {
          maxTokens: 16384,
          temperature: 0.4,
        });

  return { report };
}

export async function generateFindingsSummary(
  sources: Source[],
  model: ModelProvider
): Promise<string> {
  if (sources.length === 0) {
    return "No findings yet.";
  }

  const prompt = `Summarize the key themes and findings from these sources in 2-3 paragraphs:

${sources.slice(0, 15).map((s) => `- ${s.title}: ${s.content.slice(0, 500)}`).join("\n")}

Focus on:
1. Main themes covered
2. Key facts and findings
3. Any gaps or areas needing more research`;

  const systemPrompt =
    "You are a research assistant. Provide concise summaries of research findings.";

  return model === "claude"
    ? anthropic.generateText(systemPrompt, prompt, { maxTokens: 1000 })
    : openai.generateText(systemPrompt, prompt, { maxTokens: 1000 });
}
