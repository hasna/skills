import { writeFileSync } from "fs";
import { join } from "path";
import { PLATFORM_CONFIGS } from "./platforms";
import { log } from "./runtime";
import type { GeneratedContent, Platform, SocialPost } from "./types";

// Export as JSON
export function exportJSON(content: GeneratedContent, outputPath: string): void {
  const json = JSON.stringify(content, null, 2);
  writeFileSync(outputPath, json);
  log(`JSON exported to: ${outputPath}`);
}

// Export as Markdown
export function exportMarkdown(content: GeneratedContent, outputPath: string): void {
  let markdown = `# Social Media Posts\n\n`;
  markdown += `**Source:** ${content.sourceTitle}\n\n`;
  markdown += `**Summary:** ${content.sourceSummary}\n\n`;
  markdown += `**Generated:** ${new Date(content.generatedAt).toLocaleString()}\n\n`;
  markdown += `**Platforms:** ${content.platforms.join(", ")}\n\n`;
  markdown += `---\n\n`;

  // Group posts by platform
  const postsByPlatform: Record<Platform, SocialPost[]> = {
    twitter: [],
    linkedin: [],
    facebook: [],
    instagram: [],
    threads: [],
  };

  content.posts.forEach(post => {
    postsByPlatform[post.platform].push(post);
  });

  // Write posts for each platform
  for (const platform of content.platforms) {
    const posts = postsByPlatform[platform];
    if (posts.length === 0) continue;

    const config = PLATFORM_CONFIGS[platform];
    markdown += `## ${config.name}\n\n`;

    posts.forEach((post, index) => {
      markdown += `### Variant ${index + 1}\n\n`;
      markdown += `${post.content}\n\n`;

      if (post.hashtags.length > 0) {
        markdown += `**Hashtags:** ${post.hashtags.join(" ")}\n\n`;
      }

      if (post.hooks.length > 0) {
        markdown += `**Hook:** ${post.hooks[0]}\n\n`;
      }

      if (post.cta) {
        markdown += `**CTA:** ${post.cta}\n\n`;
      }

      if (post.threadPosts && post.threadPosts.length > 0) {
        markdown += `**Thread Version:**\n\n`;
        post.threadPosts.forEach((threadPost, i) => {
          markdown += `${i + 1}. ${threadPost}\n\n`;
        });
      }

      if (post.bestTime) {
        markdown += `**Best Time:** ${post.bestTime}\n\n`;
      }

      markdown += `**Character Count:** ${post.characterCount}\n\n`;
      markdown += `---\n\n`;
    });
  }

  writeFileSync(outputPath, markdown);
  log(`Markdown exported to: ${outputPath}`);
}

// Export as text files per platform
export function exportText(content: GeneratedContent, outputDir: string): void {
  const postsByPlatform: Record<Platform, SocialPost[]> = {
    twitter: [],
    linkedin: [],
    facebook: [],
    instagram: [],
    threads: [],
  };

  content.posts.forEach(post => {
    postsByPlatform[post.platform].push(post);
  });

  for (const platform of content.platforms) {
    const posts = postsByPlatform[platform];
    if (posts.length === 0) continue;

    let text = `${PLATFORM_CONFIGS[platform].name} Posts\n`;
    text += `${"=".repeat(50)}\n\n`;

    posts.forEach((post, index) => {
      text += `--- Variant ${index + 1} ---\n\n`;
      text += `${post.content}\n\n`;

      if (post.hashtags.length > 0) {
        text += `Hashtags: ${post.hashtags.join(" ")}\n\n`;
      }

      if (post.threadPosts && post.threadPosts.length > 0) {
        text += `Thread Version:\n`;
        post.threadPosts.forEach((threadPost, i) => {
          text += `${i + 1}. ${threadPost}\n`;
        });
        text += `\n`;
      }

      text += `Character Count: ${post.characterCount}\n`;
      text += `Best Time: ${post.bestTime || "N/A"}\n\n`;
      text += `${"=".repeat(50)}\n\n`;
    });

    const outputPath = join(outputDir, `${platform}.txt`);
    writeFileSync(outputPath, text);
    log(`${PLATFORM_CONFIGS[platform].name} posts exported to: ${outputPath}`);
  }
}
