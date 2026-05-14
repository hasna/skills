import type { WebsiteOptions, WebsiteSection } from "./types";
import { DEFAULT_SECTIONS } from "./constants";
import { detectKind, plainBrief, slugify, titleCase } from "./utils";

export function buildSections(options: WebsiteOptions): WebsiteSection[] {
  const unique = Array.from(new Set(options.sections.map(slugify).filter(Boolean)));
  const sectionNames = unique.length ? unique : DEFAULT_SECTIONS;
  return sectionNames.map((section) => sectionFor(section, options));
}

function sectionFor(section: string, options: WebsiteOptions): WebsiteSection {
  const kind = detectKind(section);
  const cta = titleCase(options.goal);

  if (kind === "hero") {
    return {
      id: "hero",
      kind,
      eyebrow: `Built for ${options.audience}`,
      headline: `${options.name} turns ${plainBrief(options.brief)} into a clearer workflow`,
      body: `${options.style}. The page leads with a concrete promise, one visible next step, and enough context for ${options.audience} to understand why it matters.`,
      bullets: ["Fast to evaluate", "Clear value proof", "Ready for launch copy"],
      primaryCta: cta,
    };
  }

  if (kind === "features") {
    return {
      id: "features",
      kind,
      eyebrow: "Product Value",
      headline: "A page organized around the decision your visitor needs to make",
      body: `${options.name} should show the workflow, not just describe it. Each feature card ties a capability to a buyer concern and a visible outcome.`,
      bullets: ["Show the first useful screen", "Name the operational win", "Connect every claim to the goal"],
      primaryCta: cta,
    };
  }

  if (kind === "proof") {
    return {
      id: "proof",
      kind,
      eyebrow: "Proof",
      headline: "Trust signals that reduce hesitation",
      body: `Use ${options.proof} to make the offer feel specific, real, and easier to approve. Keep proof close to the claim it supports.`,
      bullets: ["Concrete results", "Workflow screenshots", "Short customer quotes"],
      primaryCta: cta,
    };
  }

  if (kind === "pricing") {
    return {
      id: "pricing",
      kind,
      eyebrow: "Simple Path",
      headline: "Pricing and packaging that visitors can scan quickly",
      body: "Present one recommended path, one lighter path, and a direct contact option. Keep plan names simple and avoid hidden qualifiers.",
      bullets: ["Starter for trying it", "Growth for active teams", "Scale for custom needs"],
      primaryCta: cta,
    };
  }

  if (kind === "faq") {
    return {
      id: "faq",
      kind,
      eyebrow: "Questions",
      headline: "Answer the objections before the form",
      body: "Use concise answers for setup, data handling, migration, support, and expected time to value.",
      bullets: ["How long setup takes", "What data is needed", "How success is measured"],
      primaryCta: cta,
    };
  }

  if (kind === "cta") {
    return {
      id: "cta",
      kind,
      eyebrow: "Next Step",
      headline: `Ready to ${options.goal}?`,
      body: `Close with the same promise from the hero and ask for one action. Remove competing links so ${options.audience} know exactly what to do.`,
      bullets: ["One form", "One promise", "One follow-up path"],
      primaryCta: cta,
    };
  }

  return {
    id: slugify(section),
    kind,
    eyebrow: titleCase(section),
    headline: `${titleCase(section)} for ${options.name}`,
    body: `Use this section to support ${options.goal} for ${options.audience}. Keep the copy concrete and connected to the page promise.`,
    bullets: ["Specific detail", "Visible proof", "Clear next step"],
    primaryCta: cta,
  };
}
