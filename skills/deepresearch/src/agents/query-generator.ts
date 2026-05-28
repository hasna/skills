import type { ModelProvider, QueryGenerationResult } from "../types";
import * as anthropic from "../services/anthropic";
import * as openai from "../services/openai";

const SYSTEM_PROMPT = `You are a research query generation expert. Your task is to generate diverse, effective search queries that will help gather comprehensive information on a given topic.

Generate queries that cover different aspects:
- Definitions and fundamentals
- How it works / technical implementation
- Best practices and recommendations
- Common problems, challenges, and solutions
- Comparisons with alternatives
- Recent developments and trends
- Expert opinions and case studies
- Real-world applications and examples

Make each query specific and searchable. Avoid overly generic queries.`;

function buildUserPrompt(topic: string, queryCount: number): string {
  return `Research Topic: "${topic}"

Generate exactly ${queryCount} diverse search queries that will help gather comprehensive information on this topic. The queries should cover different angles and aspects to ensure thorough research.

Respond with a JSON object in this exact format:
{
  "queries": ["query1", "query2", ...],
  "reasoning": "Brief explanation of the query strategy"
}`;
}

export async function generateQueries(
  topic: string,
  queryCount: number,
  model: ModelProvider
): Promise<QueryGenerationResult> {
  const userPrompt = buildUserPrompt(topic, queryCount);

  if (model === "claude") {
    return anthropic.generateJson<QueryGenerationResult>(
      SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.5 }
    );
  } else {
    return openai.generateJson<QueryGenerationResult>(
      SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.5 }
    );
  }
}

export async function generateFollowUpQueries(
  topic: string,
  existingFindings: string,
  queryCount: number,
  model: ModelProvider
): Promise<QueryGenerationResult> {
  const followUpPrompt = `Research Topic: "${topic}"

Based on initial research findings, generate ${queryCount} follow-up queries to fill gaps and explore deeper.

Initial Findings Summary:
${existingFindings}

Generate queries that:
1. Explore areas not covered in initial findings
2. Go deeper into important subtopics
3. Find contradicting viewpoints or alternative perspectives
4. Discover more recent information

Respond with a JSON object in this exact format:
{
  "queries": ["query1", "query2", ...],
  "reasoning": "Brief explanation of what gaps these queries address"
}`;

  if (model === "claude") {
    return anthropic.generateJson<QueryGenerationResult>(
      SYSTEM_PROMPT,
      followUpPrompt,
      { temperature: 0.6 }
    );
  } else {
    return openai.generateJson<QueryGenerationResult>(
      SYSTEM_PROMPT,
      followUpPrompt,
      { temperature: 0.6 }
    );
  }
}
