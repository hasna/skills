/**
 * Writer Agent
 * Creates well-structured articles based on research
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ArticleContent, ResearchResult } from '../types';

const anthropic = new Anthropic();

type ArticleStyle = 'blog' | 'technical' | 'news' | 'academic' | 'casual';
type ArticleLength = 'short' | 'medium' | 'long';

const STYLE_PROMPTS: Record<ArticleStyle, string> = {
  blog: 'Write in a conversational, engaging blog style with personal touches and relatable examples.',
  technical: 'Write in a professional, technical style with precise terminology and detailed explanations.',
  news: 'Write in a journalistic style with an inverted pyramid structure, leading with the most important information.',
  academic: 'Write in a formal academic style with citations, objective analysis, and scholarly tone.',
  casual: 'Write in a friendly, casual tone that feels like a conversation with a knowledgeable friend.'
};

const LENGTH_TOKENS: Record<ArticleLength, { min: number; max: number }> = {
  short: { min: 300, max: 600 },
  medium: { min: 800, max: 1200 },
  long: { min: 1500, max: 2500 }
};

export async function writeArticle(
  research: ResearchResult,
  style: ArticleStyle = 'blog',
  length: ArticleLength = 'medium'
): Promise<ArticleContent> {
  console.log(`  [Writer] Writing ${length} ${style} article about: ${research.topic}`);

  const lengthGuide = LENGTH_TOKENS[length];
  const styleGuide = STYLE_PROMPTS[style];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `You are a professional content writer. Write a complete article based on the following research.

TOPIC: ${research.topic}

RESEARCH SUMMARY:
${research.summary}

KEY POINTS TO COVER:
${research.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

STYLE GUIDE:
${styleGuide}

LENGTH REQUIREMENTS:
Write between ${lengthGuide.min} and ${lengthGuide.max} words.

ARTICLE STRUCTURE:
1. Compelling title (without "Title:" prefix)
2. Engaging introduction that hooks the reader
3. Well-organized body with clear sections/subheadings
4. Conclusion with key takeaways or call to action

FORMAT:
Return ONLY the article content in Markdown format.
Start with the title as # heading.
Use ## for section headings.
Do not include any meta-commentary or explanations.`
      }
    ]
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from writer agent');
  }

  // Extract title from the content (first # heading)
  const titleMatch = content.text.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : research.topic;

  // Count words
  const wordCount = content.text.split(/\s+/).length;

  console.log(`  [Writer] Article complete: ${wordCount} words`);

  return {
    title,
    content: content.text,
    metadata: {
      topic: research.topic,
      style,
      generatedAt: new Date().toISOString(),
      wordCount
    }
  };
}
