/**
 * hosted-runtime-skills.ts — the hosted-vs-local RUNTIME classifier.
 *
 * ## Why this module exists
 *
 * "Does this skill run from bundled source on the user's machine, or does it
 * need an off-repo runtime?" is a *deployment* question. Until this module
 * existed, the only thing that answered it was `isPremiumSkill()` in
 * `pricing.ts` — a price-table lookup. Thirteen call sites across discovery,
 * validation, skillinfo, the CLI run path and the MCP hot path asked a BILLING
 * question and used the answer to make a RUNTIME decision.
 *
 * That coupling is load-bearing and wrong in both directions:
 *
 *   - It cannot be removed without breaking runtime behaviour, so the price
 *     table is undeletable for reasons unrelated to pricing.
 *   - A skill's runtime class silently changes when someone edits a price.
 *
 * This module is the classifier, extracted with no behaviour change. It carries
 * no cost, no tier, no currency, and no billing vocabulary. Whether a hosted
 * skill also costs money is a separate question that a separate layer may ask.
 *
 * ## Why a literal list and not a filesystem scan
 *
 * `hosted-skill-set.ts` derives the same set from each skill's own
 * `package.json` and is the AUTHORITATIVE definition. It is the right answer for
 * packaging guards, which run once against a checkout.
 *
 * This module cannot use it. `isHostedRuntimeSkill` is called per-skill inside
 * the MCP `run_skill`/`quote_skill` path and inside discovery loops that run
 * over the whole catalog; making it stat and parse a `package.json` per call
 * would put synchronous disk I/O on a hot path, and it must also answer for
 * skills whose directory is not present (a registry entry consulted from a
 * consumer that installed only `dist/`).
 *
 * So this is a literal projection, kept honest by
 * `hosted-runtime-skills.test.ts`, which asserts it is exactly equal to the
 * filesystem-derived set. Drift fails the suite; it cannot rot silently.
 */

import { resolveSkillAlias } from "./skill-aliases.js";

/**
 * Skills whose implementation does not ship in this package: their directory
 * carries `package.json` + docs, and `skills.runtime: "hosted"` marks the
 * implementation as living off-repo.
 *
 * Sorted. Equal by construction to `listHostedMetadataSlugs("skills")` — see
 * the drift test. Canonical slugs only; callers are alias-resolved for you.
 */
export const HOSTED_RUNTIME_SLUGS: readonly string[] = [
  "ad-creative-pack",
  "api-docs-portal",
  "audio-transcript-pack",
  "blog-article",
  "brand-assets",
  "brand-kit",
  "contract-review-report",
  "customer-feedback-report",
  "email-sequence",
  "invoice-reconciliation",
  "landing-page-pack",
  "logo-design",
  "market-research-report",
  "meeting-pack",
  "migration-plan-pack",
  "one-page-website",
  "pdf-to-dataset",
  "pdf-to-markdown",
  "performance-audit-report",
  "pitch-deck",
  "product-mockup",
  "proposal-pack",
  "repo-onboarding-report",
  "sdk-generator",
  "security-audit-report",
  "seo-content-pack",
  "slide-deck-generator",
  "social-content-calendar",
  "test-suite-generator",
  "video-highlight-pack",
];

const hostedRuntimeSlugs = new Set(HOSTED_RUNTIME_SLUGS);

/**
 * Does this skill require an off-repo runtime to execute?
 *
 * Accepts aliases (`create-blog-article`, `read-document`, …) and resolves them the
 * same way the registry does, so a caller never has to canonicalise first.
 */
export function isHostedRuntimeSkill(slug: string): boolean {
  return hostedRuntimeSlugs.has(resolveSkillAlias(slug));
}
