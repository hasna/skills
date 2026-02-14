/**
 * Research Agent
 * Searches online and gathers information for article writing
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ResearchResult } from '../types';

const anthropic = new Anthropic();

export async function researchTopic(topic: string): Promise<ResearchResult> {
  console.log(`  [Researcher] Researching: ${topic}`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are a research specialist. Research the following topic and provide comprehensive information that can be used to write an article.

Topic: ${topic}

Please provide:
1. A list of key points about this topic (at least 5-7 points)
2. A summary of the most important information (2-3 paragraphs)
3. Suggested sources or references (list credible source types)

Format your response as JSON with this structure:
{
  "topic": "the topic",
  "keyPoints": ["point 1", "point 2", ...],
  "summary": "comprehensive summary",
  "sources": ["source type 1", "source type 2", ...]
}

Only respond with valid JSON, no additional text.`
      }
    ]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from research agent');
  }

  try {
    const result = JSON.parse(content.text) as ResearchResult;
    console.log(`  [Researcher] Found ${result.keyPoints.length} key points`);
    return result;
  } catch {
    // If JSON parsing fails, create a structured result from the text
    console.log(`  [Researcher] Parsing response as freeform text`);
    return {
      topic,
      keyPoints: [content.text.slice(0, 500)],
      summary: content.text,
      sources: ['AI-generated research']
    };
  }
}
