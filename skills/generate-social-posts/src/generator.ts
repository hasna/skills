import { callAI } from "./ai";
import { PLATFORM_CONFIGS } from "./platforms";
import { log } from "./runtime";
import type { GeneratedContent, GenerateOptions, Platform, SocialPost } from "./types";

// Generate posts for a specific platform
export async function generatePlatformPosts(
  content: string,
  platform: Platform,
  options: GenerateOptions
): Promise<SocialPost[]> {
  const config = PLATFORM_CONFIGS[platform];

  log(`Generating ${options.count} post(s) for ${config.name}...`);

  const systemPrompt = `You are an expert social media content creator specializing in ${config.name}. Create engaging, platform-optimized posts that drive engagement and conversions.`;

  const toneDescriptions = {
    professional: "formal, authoritative, business-appropriate",
    casual: "friendly, approachable, conversational",
    witty: "clever, humorous, attention-grabbing",
    inspiring: "motivational, uplifting, aspirational",
    educational: "informative, clear, teaching-focused",
  };

  const userPrompt = `Transform the following content into ${options.count} engaging ${config.name} post(s).

CONTENT:
${content.slice(0, 3000)}...

REQUIREMENTS:
- Platform: ${config.name}
- Character limit: ${config.charLimit}
- Tone: ${toneDescriptions[options.tone]}
- Style: ${config.style}
- Emoji usage: ${config.emojiUsage}
${options.includeHashtags ? `- Include ${config.hashtagLimit} relevant hashtags` : "- No hashtags"}
${options.threads ? "- Create thread version if content is long" : ""}

Return a JSON array with ${options.count} post objects in this format:
[
  {
    "content": "The post content (respecting character limit)",
    "hashtags": ["hashtag1", "hashtag2"],
    "hook": "Attention-grabbing opening line",
    "cta": "Call to action",
    ${options.threads ? '"threadPosts": ["post 1/5", "post 2/5", ...],' : ""}
    "bestTime": "Optimal posting time (e.g., 'Weekday mornings 9-11am')"
  }
]

Make each post variant unique and engaging. Ensure character counts are within limits.`;

  const response = await callAI(userPrompt, systemPrompt);

  // Parse JSON response
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Could not parse ${platform} posts JSON from response`);
  }

  const postsData = JSON.parse(jsonMatch[0]);

  const posts: SocialPost[] = postsData.map((post: any) => ({
    platform,
    content: post.content,
    hashtags: post.hashtags || [],
    hooks: [post.hook].filter(Boolean),
    cta: post.cta,
    threadPosts: post.threadPosts,
    bestTime: post.bestTime,
    characterCount: post.content.length,
  }));

  log(`Generated ${posts.length} ${config.name} post(s)`, "success");

  return posts;
}

// Generate all posts
export async function generateAllPosts(
  content: string,
  options: GenerateOptions
): Promise<GeneratedContent> {
  log(`Generating posts for ${options.platforms.length} platform(s)...`);

  // First, get a summary and title from the content
  const summaryPrompt = `Analyze this content and provide a title and brief summary.

CONTENT:
${content.slice(0, 2000)}...

Return JSON:
{
  "title": "Content title or main topic",
  "summary": "2-3 sentence summary"
}`;

  const summaryResponse = await callAI(
    summaryPrompt,
    "You are a content analyst. Provide concise, accurate summaries."
  );

  const summaryMatch = summaryResponse.match(/\{[\s\S]*\}/);
  const summaryData = summaryMatch ? JSON.parse(summaryMatch[0]) : {
    title: "Generated Content",
    summary: "Social media posts generated from content",
  };

  // Generate posts for each platform
  const allPosts: SocialPost[] = [];

  for (const platform of options.platforms) {
    const posts = await generatePlatformPosts(content, platform, options);
    allPosts.push(...posts);
  }

  const result: GeneratedContent = {
    sourceTitle: summaryData.title,
    sourceSummary: summaryData.summary,
    platforms: options.platforms,
    posts: allPosts,
    generatedAt: new Date().toISOString(),
    options,
  };

  log(`Generated ${allPosts.length} total posts across all platforms`, "success");

  return result;
}
