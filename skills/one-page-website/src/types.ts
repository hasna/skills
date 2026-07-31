export const KNOWN_SECTIONS = ["hero", "features", "proof", "pricing", "faq", "cta"] as const;
export type KnownSection = (typeof KNOWN_SECTIONS)[number];

export interface CliOptions {
  name?: string;
  tagline?: string;
  sections: string;
  style: string;
  copy?: string;
  goal: string;
  audience: string;
  features?: string;
  accent?: string;
  output: string;
  json: boolean;
}

export interface Tokens {
  preset: string;
  hue: number;
  accent: string;
  accentContrast: string;
  fontDisplay: string;
  fontSans: string;
  fontMono: string;
  radius: string;
  radiusLg: string;
  headingWeight: number;
  headingTracking: string;
  measure: string;
}

export interface CopyOverride {
  slug: string;
  title: string;
  html: string;
  known: boolean;
}

/* ------------------------------------------------------------------ */
/* deterministic randomness                                            */
/* ------------------------------------------------------------------ */

export interface Content {
  name: string;
  tagline: string;
  lead: string;
  eyebrow: string;
  goal: string;
  audience: string;
  features: Array<{ title: string; body: string }>;
  stats: Array<{ value: string; label: string }>;
  quote: { text: string; author: string; role: string };
  tiers: Array<{ name: string; price: string; cadence: string; blurb: string; items: string[]; featured: boolean }>;
  faqs: Array<{ q: string; a: string }>;
  ctaHeading: string;
  ctaBody: string;
  year: number;
}

const FEATURE_BANK: Array<{ title: string; body: string }> = [
  { title: "Set up in minutes", body: "Connect your stack, pick the defaults that fit, and go live the same afternoon. No migration project, no professional services line item." },
  { title: "Answers, not dashboards", body: "Every view leads with the number that changes a decision, then lets you drill into the rows behind it when you need the detail." },
  { title: "Built for the whole team", body: "Roles, shared views, and comment threads mean the people who own the outcome do not have to file a ticket to see the data." },
  { title: "Auditable by default", body: "Every change is recorded with who, what, and when. Export the log whenever finance, security, or a customer asks for it." },
  { title: "Fits your workflow", body: "A documented API, webhooks, and a CLI so the thing you already built keeps working instead of being replaced." },
  { title: "Predictable pricing", body: "Usage is metered transparently and shown before it bills. No surprise overage invoice at the end of the quarter." },
];

const FAQ_BANK: Array<{ q: string; a: string }> = [
  { q: "How long does setup take?", a: "Most teams are live the same day. The guided setup walks through connecting a data source, inviting your team, and turning on the first workflow." },
  { q: "Can we try it before committing?", a: "Yes. Every plan starts with a full-feature trial, no card required. Nothing is deleted if you decide not to continue — you can export everything." },
  { q: "How does pricing work?", a: "You pay for the plan tier plus metered usage above the included allowance. Usage is shown live in the app so there is never a surprise invoice." },
  { q: "Where is our data stored?", a: "Data is encrypted in transit and at rest. You choose the storage region during setup, and you can request a full export or deletion at any time." },
  { q: "Do you integrate with what we already use?", a: "There is a documented REST API, outbound webhooks, and a CLI. If a first-party integration is missing, the API covers the same surface." },
  { q: "What does support look like?", a: "Email support on every plan, shared Slack or Teams channel on the higher tiers, and a public status page with incident history." },
];

