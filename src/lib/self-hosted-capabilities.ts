import type { PublicCreditQuote } from "./public-credits.js";
import { resolveSkillAlias } from "./skill-aliases.js";
import type { SkillAvailabilityMetadata } from "./registry-types.js";

export interface SelfHostedExecutionCapability {
  slug: string;
  handler: "deterministic-text-artifacts";
  providerFree: true;
}

export const SELF_HOSTED_EXECUTION_CAPABILITIES: readonly SelfHostedExecutionCapability[] = Object.freeze([
  { slug: "audio-transcript-pack", handler: "deterministic-text-artifacts", providerFree: true },
  { slug: "transcript", handler: "deterministic-text-artifacts", providerFree: true },
  { slug: "video-highlight-pack", handler: "deterministic-text-artifacts", providerFree: true },
]);

const capabilityBySlug = new Map(SELF_HOSTED_EXECUTION_CAPABILITIES.map((capability) => [capability.slug, capability]));

export function getSelfHostedExecutionCapability(slug: string): SelfHostedExecutionCapability | null {
  return capabilityBySlug.get(resolveSkillAlias(slug)) ?? null;
}

export function getSelfHostedAvailability(slug: string): SkillAvailabilityMetadata {
  if (getSelfHostedExecutionCapability(slug)) return { status: "available" };
  return {
    status: "unavailable",
    code: "HANDLER_UNAVAILABLE",
    message: "This self-hosted deployment has no executable handler for that skill.",
    details: ["Install or configure an operator extension that implements this skill before submitting a run."],
  };
}

export function getProviderFreeSelfHostedCreditQuote(): PublicCreditQuote {
  return {
    tier: "free",
    creditUnit: "run",
    credits: 0,
    formattedCredits: "0 credits",
    estimated: false,
    quoteDependsOnInput: false,
    quoteRequired: false,
    description: "Provider-free execution in this self-hosted server requires no credits.",
  };
}
