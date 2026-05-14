import type { Platform, PlatformConfig } from "./types";

export const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = {
  twitter: {
    name: "Twitter/X",
    charLimit: 280,
    hashtagLimit: 3,
    emojiUsage: "moderate",
    style: "Concise, punchy, attention-grabbing. Use strategic line breaks. Include hooks that stop the scroll.",
  },
  linkedin: {
    name: "LinkedIn",
    charLimit: 3000,
    hashtagLimit: 5,
    emojiUsage: "minimal",
    style: "Professional, value-driven, business-focused. Multi-paragraph format. Start with a strong hook.",
  },
  facebook: {
    name: "Facebook",
    charLimit: 63206,
    hashtagLimit: 3,
    emojiUsage: "moderate",
    style: "Conversational, story-driven, community-oriented. Personal and relatable.",
  },
  instagram: {
    name: "Instagram",
    charLimit: 2200,
    hashtagLimit: 30,
    emojiUsage: "heavy",
    style: "Visual-first descriptions, emoji-rich, inspirational. Hashtag-heavy at the end.",
  },
  threads: {
    name: "Threads",
    charLimit: 500,
    hashtagLimit: 2,
    emojiUsage: "moderate",
    style: "Brief, authentic, conversational. Similar to Twitter but more personal.",
  },
};
