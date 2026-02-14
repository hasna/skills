/**
 * Article Orchestrator
 * Coordinates multiple agents to produce complete articles
 */

import { mkdir } from 'fs/promises';
import { join } from 'path';
import { researchTopic } from './agents/researcher';
import { writeArticle } from './agents/writer';
import { generateArticleImage } from './agents/image-generator';
import type { ArticleRequest, ArticleResult, BatchRequest } from './types';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export async function generateArticle(request: ArticleRequest): Promise<ArticleResult> {
  const {
    topic,
    style = 'blog',
    length = 'medium',
    includeImage = false,
    imageProvider = 'openai',
    outputDir,
    filename
  } = request;

  console.log(`\n[Orchestrator] Starting article generation for: ${topic}`);

  try {
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    // Step 1: Research
    console.log('[Orchestrator] Phase 1: Research');
    const research = await researchTopic(topic);

    // Step 2: Write
    console.log('[Orchestrator] Phase 2: Writing');
    const article = await writeArticle(research, style, length);

    // Determine filename
    const baseFilename = filename || slugify(article.title);
    const articlePath = join(outputDir, `${baseFilename}.md`);

    // Step 3: Generate image (if requested)
    let imagePath: string | undefined;
    if (includeImage) {
      console.log('[Orchestrator] Phase 3: Image Generation');
      const imageFilename = `${baseFilename}-cover.png`;
      imagePath = join(outputDir, imageFilename);
      await generateArticleImage(article.title, topic, imageProvider, imagePath);

      // Prepend image to article content
      const imageMarkdown = `![${article.title}](./${imageFilename})\n\n`;
      article.content = imageMarkdown + article.content;
    }

    // Step 4: Save article
    console.log('[Orchestrator] Phase 4: Saving');
    const frontmatter = `---
title: "${article.title}"
topic: "${topic}"
style: "${style}"
generatedAt: "${article.metadata.generatedAt}"
wordCount: ${article.metadata.wordCount}
${imagePath ? `coverImage: "./${baseFilename}-cover.png"` : ''}
---

`;

    await Bun.write(articlePath, frontmatter + article.content);
    console.log(`[Orchestrator] Article saved to: ${articlePath}`);

    return {
      topic,
      filename: articlePath,
      imagePath,
      wordCount: article.metadata.wordCount,
      success: true
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Orchestrator] Error generating article for "${topic}": ${errorMessage}`);
    return {
      topic,
      filename: '',
      wordCount: 0,
      success: false,
      error: errorMessage
    };
  }
}

export async function generateArticlesBatch(request: BatchRequest): Promise<ArticleResult[]> {
  const {
    topics,
    style = 'blog',
    length = 'medium',
    includeImage = false,
    imageProvider = 'openai',
    outputDir,
    parallel = 3
  } = request;

  console.log(`\n[Orchestrator] Starting batch generation`);
  console.log(`[Orchestrator] Topics: ${topics.length}`);
  console.log(`[Orchestrator] Parallel agents: ${parallel}`);
  console.log(`[Orchestrator] Output directory: ${outputDir}`);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  const results: ArticleResult[] = [];
  const queue = [...topics];
  const inProgress: Promise<ArticleResult>[] = [];

  while (queue.length > 0 || inProgress.length > 0) {
    // Start new tasks up to the parallel limit
    while (queue.length > 0 && inProgress.length < parallel) {
      const topic = queue.shift()!;
      console.log(`\n[Orchestrator] Spawning agent for: ${topic}`);

      const promise = generateArticle({
        topic,
        style,
        length,
        includeImage,
        imageProvider,
        outputDir
      }).then(result => {
        // Remove from inProgress when done
        const index = inProgress.indexOf(promise);
        if (index > -1) {
          inProgress.splice(index, 1);
        }
        return result;
      });

      inProgress.push(promise);
    }

    // Wait for at least one to complete
    if (inProgress.length > 0) {
      const completed = await Promise.race(inProgress);
      results.push(completed);

      if (completed.success) {
        console.log(`[Orchestrator] Completed: ${completed.topic} (${completed.wordCount} words)`);
      } else {
        console.error(`[Orchestrator] Failed: ${completed.topic} - ${completed.error}`);
      }
    }
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalWords = results.reduce((sum, r) => sum + r.wordCount, 0);

  console.log(`\n[Orchestrator] Batch complete!`);
  console.log(`[Orchestrator] Successful: ${successful}/${topics.length}`);
  console.log(`[Orchestrator] Failed: ${failed}/${topics.length}`);
  console.log(`[Orchestrator] Total words: ${totalWords.toLocaleString()}`);

  return results;
}
