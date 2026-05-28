#!/usr/bin/env bun
/**
 * Generate Social Posts Skill
 * Transform blog posts and articles into engaging social media content.
 */

import { join } from "path";
import { parseGenerateOptions } from "./cli";
import { exportJSON, exportMarkdown, exportText } from "./exporters";
import { generateAllPosts } from "./generator";
import { PLATFORM_CONFIGS } from "./platforms";
import { getContent, slugify } from "./source";
import { EXPORTS_DIR, LOGS_DIR, SESSION_ID, SESSION_TIMESTAMP, ensureDir, log } from "./runtime";

async function main() {
  const options = parseGenerateOptions();
  const { source, sourceType, platforms, count, tone, maxLength, format } = options;

  try {
    log(`Session ID: ${SESSION_ID}`);
    log(`Source: ${source} (${sourceType})`);
    log(`Platforms: ${platforms.join(", ")}`);
    log(`Options: ${tone} tone, ${count} variants per platform, hashtags: ${options.includeHashtags}, threads: ${options.threads}`);

    const content = await getContent(source, sourceType, maxLength);

    if (content.length < 50) {
      log("Content is too short. Please provide more substantial content (minimum 50 characters)", "error");
      process.exit(1);
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "_")
      .replace(/-/g, "_")
      .slice(0, 19)
      .toLowerCase();
    const sourceSlug = slugify(sourceType === "url" ? new URL(source).pathname : sourceType === "file" ? source : content.slice(0, 50));
    const outputDir = options.output || join(EXPORTS_DIR, `export_${timestamp}_${sourceSlug}`);
    ensureDir(outputDir);

    log(`Output directory: ${outputDir}`);

    const generatedContent = await generateAllPosts(content, options);

    if (format === "json" || format === "text") {
      exportJSON(generatedContent, join(outputDir, "posts.json"));
    }

    if (format === "markdown" || format === "text") {
      exportMarkdown(generatedContent, join(outputDir, "posts.md"));
    }

    if (format === "text") {
      exportText(generatedContent, outputDir);
    }

    console.log(`\n✨ Social media posts generated successfully!`);
    console.log(`   📁 Output: ${outputDir}`);
    console.log(`   🌐 Platforms: ${platforms.map((platform) => PLATFORM_CONFIGS[platform].name).join(", ")}`);
    console.log(`   📝 Total Posts: ${generatedContent.posts.length}`);
    console.log(`   📋 Log: ${join(LOGS_DIR, `log_${SESSION_TIMESTAMP}_${SESSION_ID}.log`)}`);
    console.log(`\n📊 Posts by Platform:`);

    platforms.forEach((platform) => {
      const postCount = generatedContent.posts.filter((post) => post.platform === platform).length;
      console.log(`   ${PLATFORM_CONFIGS[platform].name}: ${postCount} posts`);
    });
  } catch (error) {
    log(`Error: ${error instanceof Error ? error.message : "Unknown error"}`, "error");
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`, "error");
    }
    process.exit(1);
  }
}

main();
