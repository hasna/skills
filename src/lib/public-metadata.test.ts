import { describe, expect, test } from "bun:test";
import { containsProhibitedPublicIdentity, containsProhibitedPublicMetadata } from "./public-metadata";

describe("public metadata boundary", () => {
  test("detects separator and camel-case evasions", () => {
    for (const value of [
      "Open-AI",
      "open_ai",
      "openAi",
      "ＯｐｅｎＡＩ",
      "open.ai",
      "claude_code",
      "providerName",
      "vendor_id",
      "modelType",
      "routingId",
      "routeId",
      "providername",
      "costCents",
    ]) {
      expect(containsProhibitedPublicMetadata(value)).toBe(true);
    }
  });

  test("detects compact versioned runtime identities without rejecting ordinary product language", () => {
    for (const value of [
      "GPT4o",
      "Claude3Opus",
      "Gemini2.5",
      "Sora2",
      "Veo3",
      "Whisper1",
      "Anthropic2",
      "Exa",
      "Cerebras",
      "Firecrawl",
      "Lyria",
      "poweredbygpt4o",
      "serviceclaude3opus",
      "rungemini2.5",
      "vendorsora2",
      "imageveo3",
      "audiowhisper1",
      "vendoranthropic2",
    ]) {
      expect(containsProhibitedPublicMetadata(value)).toBe(true);
      expect(containsProhibitedPublicIdentity(value)).toBe(true);
    }

    for (const value of [
      "action-item-router",
      "financial-modeling",
      "Build route lists for the delivery team",
      "Compare the financial model with the baseline",
      "adopting a route-first workflow",
    ]) {
      expect(containsProhibitedPublicMetadata(value)).toBe(false);
      expect(containsProhibitedPublicIdentity(value)).toBe(false);
    }
  });

  test("allows ordinary customer credit and artifact language", () => {
    for (const value of [
      "Credit-backed image generation",
      "4 credits/image",
      "result.png",
      "Content Generation",
      "The skill is currently unavailable.",
    ]) {
      expect(containsProhibitedPublicMetadata(value)).toBe(false);
    }
  });

  test("keeps freeform detection structural instead of chasing an endless vendor-name list", () => {
    for (const value of [
      "Replicate",
      "Stability",
      "Deepgram",
      "FAL",
      "Mistral",
      "Groq",
      "Cohere",
      "DeepSeek",
      "Build route lists for financial modeling",
    ]) {
      expect(containsProhibitedPublicMetadata(value)).toBe(false);
    }
  });

  test("keeps opaque business IDs while rejecting execution identity IDs", () => {
    expect(containsProhibitedPublicIdentity("run_blog_price")).toBe(false);
    expect(containsProhibitedPublicIdentity("providerName-routeId")).toBe(true);
  });
});
