#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "fs/promises";
import { join, resolve, relative } from "path";

const VERSION = "0.1.0";

const KNOWN_SECTIONS = ["hero", "features", "proof", "pricing", "faq", "cta"] as const;
type KnownSection = (typeof KNOWN_SECTIONS)[number];

interface CliOptions {
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

interface Tokens {
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

interface CopyOverride {
  slug: string;
  title: string;
  html: string;
  known: boolean;
}

/* ------------------------------------------------------------------ */
/* deterministic randomness                                            */
/* ------------------------------------------------------------------ */

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function titleCase(value: string): string {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const lit = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function normalizeHex(token: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(token.trim());
  if (!match) return null;
  const body = match[1];
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return `#${full.toUpperCase()}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function readableOn(hex: string): string {
  return relativeLuminance(hex) > 0.5 ? "#10131A" : "#FFFFFF";
}

/* ------------------------------------------------------------------ */
/* style presets                                                       */
/* ------------------------------------------------------------------ */

interface StylePreset {
  name: string;
  hue: number;
  keywords: string[];
  fontDisplay: string;
  fontSans: string;
  radius: string;
  radiusLg: string;
  headingWeight: number;
  headingTracking: string;
  measure: string;
}

const SYSTEM_SANS =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
const SYSTEM_SERIF = "Georgia, Cambria, 'Times New Roman', 'Noto Serif', serif";
const SYSTEM_MONO =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

const STYLE_PRESETS: StylePreset[] = [
  {
    name: "editorial",
    hue: 8,
    keywords: ["editorial", "magazine", "serif", "print", "sharp"],
    fontDisplay: SYSTEM_SERIF,
    fontSans: SYSTEM_SANS,
    radius: "4px",
    radiusLg: "8px",
    headingWeight: 700,
    headingTracking: "-0.01em",
    measure: "68ch",
  },
  {
    name: "bold",
    hue: 288,
    keywords: ["bold", "loud", "playful", "vivid", "energetic", "startup"],
    fontDisplay: SYSTEM_SANS,
    fontSans: SYSTEM_SANS,
    radius: "14px",
    radiusLg: "26px",
    headingWeight: 800,
    headingTracking: "-0.035em",
    measure: "60ch",
  },
  {
    name: "warm",
    hue: 24,
    keywords: ["warm", "human", "friendly", "approachable", "amber"],
    fontDisplay: SYSTEM_SANS,
    fontSans: SYSTEM_SANS,
    radius: "12px",
    radiusLg: "20px",
    headingWeight: 700,
    headingTracking: "-0.02em",
    measure: "64ch",
  },
  {
    name: "technical",
    hue: 172,
    keywords: ["technical", "developer", "mono", "terminal", "engineering", "infra"],
    fontDisplay: SYSTEM_MONO,
    fontSans: SYSTEM_SANS,
    radius: "6px",
    radiusLg: "10px",
    headingWeight: 700,
    headingTracking: "-0.02em",
    measure: "66ch",
  },
  {
    name: "clean",
    hue: 222,
    keywords: ["clean", "polished", "quiet", "refined", "saas", "minimal", "crisp"],
    fontDisplay: SYSTEM_SANS,
    fontSans: SYSTEM_SANS,
    radius: "10px",
    radiusLg: "18px",
    headingWeight: 700,
    headingTracking: "-0.025em",
    measure: "64ch",
  },
];

function selectPreset(style: string): StylePreset {
  const lower = style.toLowerCase();
  for (const preset of STYLE_PRESETS) {
    if (preset.keywords.some((keyword) => lower.includes(keyword))) return preset;
  }
  return STYLE_PRESETS[STYLE_PRESETS.length - 1];
}

function buildTokens(preset: StylePreset, accentOverride?: string): Tokens {
  const accent = accentOverride ?? hslToHex(preset.hue, 0.68, 0.44);
  return {
    preset: preset.name,
    hue: preset.hue,
    accent,
    accentContrast: readableOn(accent),
    fontDisplay: preset.fontDisplay,
    fontSans: preset.fontSans,
    fontMono: SYSTEM_MONO,
    radius: preset.radius,
    radiusLg: preset.radiusLg,
    headingWeight: preset.headingWeight,
    headingTracking: preset.headingTracking,
    measure: preset.measure,
  };
}

/* ------------------------------------------------------------------ */
/* copy generation                                                     */
/* ------------------------------------------------------------------ */

interface Content {
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

function buildContent(options: CliOptions, seed: number): Content {
  const rng = mulberry32(seed);
  const name = options.name!.trim();
  const audience = options.audience.trim();
  const goal = options.goal.trim();
  const tagline = (options.tagline ?? `${name} makes the hard part of your workflow routine`).trim();

  const featureTitles = options.features
    ? options.features
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

  const features =
    featureTitles.length > 0
      ? featureTitles.slice(0, 6).map((title, index) => ({
          title,
          body: FEATURE_BANK[index % FEATURE_BANK.length].body,
        }))
      : FEATURE_BANK.slice(0, 6);

  const stats = [
    { value: `${40 + Math.floor(rng() * 50)}%`, label: "less manual work in the first month" },
    { value: `${2 + Math.floor(rng() * 8)}x`, label: "faster from question to answer" },
    { value: `${90 + Math.floor(rng() * 9)}.${Math.floor(rng() * 9)}%`, label: "uptime over the last twelve months" },
  ];

  return {
    name,
    tagline,
    lead: `${name} is built for ${audience}. Replace the spreadsheet-and-screenshot routine with one place that stays current, explains itself, and holds up when someone asks how the number was produced.`,
    eyebrow: "New",
    goal,
    audience,
    features,
    stats,
    quote: {
      text: `We replaced three internal tools and a standing meeting with ${name}. The part I did not expect was how quickly the rest of the team stopped asking me for numbers.`,
      author: "A. Okafor",
      role: `Operations lead, ${audience}`,
    },
    tiers: [
      {
        name: "Starter",
        price: "$0",
        cadence: "forever",
        blurb: "For one person proving it works.",
        items: ["1 workspace", "Up to 3 sources", "7-day history", "Community support"],
        featured: false,
      },
      {
        name: "Team",
        price: `$${20 + Math.floor(rng() * 40)}`,
        cadence: "per seat / month",
        blurb: `For ${audience} running this every week.`,
        items: ["Unlimited sources", "Roles and shared views", "12-month history", "API, webhooks, and CLI", "Email support"],
        featured: true,
      },
      {
        name: "Scale",
        price: "Custom",
        cadence: "annual",
        blurb: "For the version with an audit requirement.",
        items: ["SSO and SCIM", "Region selection", "Audit log export", "99.9% uptime SLA", "Shared Slack channel"],
        featured: false,
      },
    ],
    faqs: FAQ_BANK.slice(0, 5),
    ctaHeading: `Ready to ${goal.toLowerCase()}?`,
    ctaBody: `Start with the free tier, or talk to us about the version with the audit trail. Either way you will know within an afternoon whether ${name} fits.`,
    year: new Date().getFullYear(),
  };
}

/* ------------------------------------------------------------------ */
/* markdown copy overrides                                             */
/* ------------------------------------------------------------------ */

async function loadMarked() {
  try {
    return await import("marked");
  } catch {
    throw new Error("Missing dependency 'marked'. Run bun install in this skill directory.");
  }
}

interface ParsedCopy {
  heroTitle?: string;
  heroLead?: string;
  overrides: CopyOverride[];
}

async function parseCopyFile(path: string): Promise<ParsedCopy> {
  const { marked } = await loadMarked();
  const source = await readFile(path, "utf8");
  const tokens = marked.lexer(source);

  const overrides: CopyOverride[] = [];
  let heroTitle: string | undefined;
  const preamble: unknown[] = [];
  let current: { title: string; tokens: unknown[] } | null = null;

  const flush = () => {
    if (!current) return;
    const slug = slugify(current.title);
    const known = (KNOWN_SECTIONS as readonly string[]).includes(slug);
    overrides.push({
      slug,
      title: current.title,
      html: marked.parser(current.tokens as never).trim(),
      known,
    });
    current = null;
  };

  for (const token of tokens as Array<Record<string, unknown>>) {
    if (token.type === "heading" && token.depth === 1) {
      flush();
      heroTitle = String(token.text ?? "").trim();
      continue;
    }
    if (token.type === "heading" && token.depth === 2) {
      flush();
      current = { title: String(token.text ?? "").trim(), tokens: [] };
      continue;
    }
    if (current) current.tokens.push(token);
    else preamble.push(token);
  }
  flush();

  const heroLead =
    preamble.length > 0 ? marked.parser(preamble as never).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : undefined;

  return { heroTitle, heroLead: heroLead || undefined, overrides };
}

/* ------------------------------------------------------------------ */
/* stylesheet                                                          */
/* ------------------------------------------------------------------ */

function buildCss(tokens: Tokens): string {
  return `/* Generated by the one-page-website skill. Design tokens live in :root. */

:root {
  color-scheme: light dark;

  --font-display: ${tokens.fontDisplay};
  --font-sans: ${tokens.fontSans};
  --font-mono: ${tokens.fontMono};

  --heading-weight: ${tokens.headingWeight};
  --heading-tracking: ${tokens.headingTracking};
  --measure: ${tokens.measure};

  --radius: ${tokens.radius};
  --radius-lg: ${tokens.radiusLg};

  --accent: ${tokens.accent};
  --accent-contrast: ${tokens.accentContrast};
  --accent-soft: ${hslToHex(tokens.hue, 0.7, 0.94)};
  --accent-strong: ${hslToHex(tokens.hue, 0.72, 0.34)};

  --bg: #FFFFFF;
  --bg-alt: ${hslToHex(tokens.hue, 0.32, 0.975)};
  --surface: #FFFFFF;
  --border: ${hslToHex(tokens.hue, 0.18, 0.88)};
  --text: ${hslToHex(tokens.hue, 0.26, 0.12)};
  --muted: ${hslToHex(tokens.hue, 0.12, 0.42)};
  --shadow: 0 1px 2px rgba(15, 20, 30, 0.06), 0 12px 32px -18px rgba(15, 20, 30, 0.28);

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-24: 6rem;

  --container: 1140px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --accent: ${hslToHex(tokens.hue, 0.72, 0.62)};
    --accent-contrast: #0B0E14;
    --accent-soft: ${hslToHex(tokens.hue, 0.4, 0.2)};
    --accent-strong: ${hslToHex(tokens.hue, 0.7, 0.72)};

    --bg: ${hslToHex(tokens.hue, 0.16, 0.07)};
    --bg-alt: ${hslToHex(tokens.hue, 0.15, 0.1)};
    --surface: ${hslToHex(tokens.hue, 0.14, 0.12)};
    --border: ${hslToHex(tokens.hue, 0.12, 0.24)};
    --text: #EEF1F6;
    --muted: ${hslToHex(tokens.hue, 0.1, 0.68)};
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 18px 40px -24px rgba(0, 0, 0, 0.8);
  }
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: clamp(1rem, 0.96rem + 0.2vw, 1.0625rem);
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

img, svg { max-width: 100%; height: auto; }

h1, h2, h3 {
  font-family: var(--font-display);
  font-weight: var(--heading-weight);
  letter-spacing: var(--heading-tracking);
  line-height: 1.15;
  margin: 0 0 var(--space-4);
  text-wrap: balance;
}

h1 { font-size: clamp(2.25rem, 1.6rem + 3.1vw, 3.75rem); }
h2 { font-size: clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem); }
h3 { font-size: clamp(1.125rem, 1.05rem + 0.35vw, 1.3rem); }
p  { margin: 0 0 var(--space-4); }

a { color: var(--accent-strong); }
a:hover { color: var(--accent); }

:where(a, button, summary, input, [tabindex]):focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
  border-radius: var(--radius);
}

.skip-link {
  position: absolute;
  left: var(--space-4);
  top: -100%;
  z-index: 100;
  padding: var(--space-3) var(--space-4);
  background: var(--accent);
  color: var(--accent-contrast);
  border-radius: var(--radius);
  font-weight: 600;
  text-decoration: none;
}
.skip-link:focus { top: var(--space-4); }

.container {
  width: 100%;
  max-width: var(--container);
  margin-inline: auto;
  padding-inline: var(--space-6);
}

.section { padding-block: var(--space-16); }
.section--alt { background: var(--bg-alt); }
.section__head { max-width: var(--measure); margin-bottom: var(--space-12); }
.section__eyebrow {
  display: inline-block;
  margin-bottom: var(--space-3);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}
.lede { font-size: 1.125rem; color: var(--muted); max-width: var(--measure); }

/* ---- header ---- */

.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  border-bottom: 1px solid transparent;
  backdrop-filter: saturate(180%) blur(12px);
  transition: border-color 150ms ease;
}
.site-header[data-scrolled="true"] { border-bottom-color: var(--border); }

.site-header__inner {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-height: 4rem;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-weight: 700;
  font-family: var(--font-display);
  letter-spacing: var(--heading-tracking);
  color: var(--text);
  text-decoration: none;
  margin-right: auto;
}
.brand__mark {
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 0.9rem;
  font-weight: 800;
}

.nav-toggle {
  display: none;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}
.nav-toggle__bars { display: block; width: 1rem; height: 2px; background: currentColor; box-shadow: 0 5px currentColor, 0 -5px currentColor; }

.site-nav__list {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  margin: 0;
  padding: 0;
  list-style: none;
}
.site-nav__list a {
  color: var(--muted);
  text-decoration: none;
  font-size: 0.9375rem;
  font-weight: 500;
}
.site-nav__list a:hover { color: var(--text); }
.site-nav__list a[aria-current="true"] { color: var(--text); }

/* ---- buttons ---- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0.75rem 1.25rem;
  border-radius: var(--radius);
  border: 1px solid transparent;
  font: inherit;
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
}
.btn:active { transform: translateY(1px); }
.btn--primary { background: var(--accent); color: var(--accent-contrast); }
.btn--primary:hover { background: var(--accent-strong); color: var(--accent-contrast); }
.btn--ghost { background: transparent; color: var(--text); border-color: var(--border); }
.btn--ghost:hover { background: var(--bg-alt); color: var(--text); }
.btn--sm { padding: 0.5rem 0.875rem; font-size: 0.875rem; }

/* ---- hero ---- */

.hero { padding-block: var(--space-24) var(--space-16); }
.hero__grid { display: grid; gap: var(--space-12); align-items: center; }
.hero__badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 0.8125rem;
  font-weight: 600;
}
.hero__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-8); }
.hero__note { margin-top: var(--space-4); font-size: 0.875rem; color: var(--muted); }
.hero__panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow);
  padding: var(--space-6);
}
.hero__panel-bar { display: flex; gap: var(--space-2); margin-bottom: var(--space-6); }
.hero__panel-bar span { width: 0.625rem; height: 0.625rem; border-radius: 999px; background: var(--border); }
.hero__panel-row { display: flex; align-items: center; gap: var(--space-4); padding-block: var(--space-3); border-top: 1px solid var(--border); }
.hero__panel-row:first-of-type { border-top: 0; }
.hero__panel-key { font-family: var(--font-mono); font-size: 0.8125rem; color: var(--muted); }
.hero__panel-val { margin-left: auto; font-weight: 700; }

/* ---- features ---- */

.grid { display: grid; gap: var(--space-6); }
.grid--3 { grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); }

.card {
  padding: var(--space-6);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.card__icon {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  margin-bottom: var(--space-4);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.card p:last-child { margin-bottom: 0; }

/* ---- proof ---- */

.stats { display: grid; gap: var(--space-6); grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); margin-bottom: var(--space-12); }
.stat__value { font-family: var(--font-display); font-size: clamp(2rem, 1.5rem + 2vw, 3rem); font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); line-height: 1; }
.stat__label { margin-top: var(--space-2); color: var(--muted); font-size: 0.9375rem; }

.quote {
  margin: 0;
  padding: var(--space-8);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
  background: var(--surface);
}
.quote p { font-size: 1.125rem; max-width: var(--measure); }
.quote footer { color: var(--muted); font-size: 0.9375rem; }

/* ---- pricing ---- */

.tier { display: flex; flex-direction: column; }
.tier--featured { border-color: var(--accent); box-shadow: var(--shadow); }
.tier__badge { display: inline-block; margin-bottom: var(--space-3); padding: 0.15rem 0.6rem; border-radius: 999px; background: var(--accent); color: var(--accent-contrast); font-size: 0.75rem; font-weight: 700; }
.tier__price { display: flex; align-items: baseline; gap: var(--space-2); margin-block: var(--space-4); }
.tier__amount { font-family: var(--font-display); font-size: 2.25rem; font-weight: var(--heading-weight); letter-spacing: var(--heading-tracking); }
.tier__cadence { color: var(--muted); font-size: 0.875rem; }
.tier__list { list-style: none; margin: 0 0 var(--space-6); padding: 0; display: grid; gap: var(--space-2); }
.tier__list li { position: relative; padding-left: 1.5rem; font-size: 0.9375rem; }
.tier__list li::before { content: ""; position: absolute; left: 0; top: 0.55em; width: 0.5rem; height: 0.5rem; border-radius: 999px; background: var(--accent); }
.tier .btn { margin-top: auto; }

/* ---- faq ---- */

.faq { display: grid; gap: var(--space-3); max-width: 52rem; }
.faq__item { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
.faq__item summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.faq__item summary::-webkit-details-marker { display: none; }
.faq__item summary::after { content: "+"; font-family: var(--font-mono); font-size: 1.25rem; color: var(--muted); }
.faq__item[open] summary::after { content: "\\2212"; }
.faq__answer { padding: 0 var(--space-6) var(--space-6); color: var(--muted); max-width: var(--measure); }

/* ---- cta ---- */

.cta-band {
  padding: var(--space-16) var(--space-8);
  border-radius: var(--radius-lg);
  background: var(--accent);
  color: var(--accent-contrast);
  text-align: center;
}
.cta-band h2 { color: inherit; }
.cta-band p { color: inherit; opacity: 0.9; max-width: var(--measure); margin-inline: auto; }
.cta-band .btn--primary { background: var(--accent-contrast); color: var(--accent); }
.cta-band .btn--primary:hover { background: var(--accent-contrast); opacity: 0.9; color: var(--accent); }

/* ---- rich text (from --copy) ---- */

.rich-text { max-width: var(--measure); }
.rich-text > :last-child { margin-bottom: 0; }
.rich-text ul, .rich-text ol { padding-left: 1.25rem; margin: 0 0 var(--space-4); }
.rich-text li { margin-bottom: var(--space-2); }
.rich-text code { font-family: var(--font-mono); font-size: 0.9em; background: var(--bg-alt); padding: 0.1em 0.35em; border-radius: 4px; }
.rich-text pre { overflow-x: auto; padding: var(--space-4); background: var(--bg-alt); border-radius: var(--radius); }
.rich-text blockquote { margin: 0 0 var(--space-4); padding-left: var(--space-4); border-left: 3px solid var(--border); color: var(--muted); }
.rich-text table { width: 100%; border-collapse: collapse; }
.rich-text th, .rich-text td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); }

/* ---- footer ---- */

.site-footer { padding-block: var(--space-12); border-top: 1px solid var(--border); color: var(--muted); font-size: 0.9375rem; }
.site-footer__inner { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: center; justify-content: space-between; }
.site-footer ul { display: flex; flex-wrap: wrap; gap: var(--space-6); margin: 0; padding: 0; list-style: none; }
.site-footer a { color: var(--muted); text-decoration: none; }
.site-footer a:hover { color: var(--text); }

/* ---- responsive ---- */

@media (min-width: 60rem) {
  .hero__grid { grid-template-columns: 1.05fr 0.95fr; }
  .section { padding-block: var(--space-24); }
}

@media (max-width: 52rem) {
  .site-header__inner { flex-wrap: wrap; }
  .site-nav { flex-basis: 100%; }
  .site-nav__list { flex-direction: column; align-items: flex-start; gap: var(--space-2); padding-bottom: var(--space-4); }

  /* Without JavaScript the menu stays open; the toggle only exists for the JS path. */
  html.js .nav-toggle { display: inline-flex; }
  html.js .site-nav { display: none; }
  html.js .site-nav[data-open="true"] { display: block; }
}

@media print {
  .site-header, .nav-toggle, .skip-link { display: none; }
  .section { padding-block: var(--space-8); }
}
`;
}

/* ------------------------------------------------------------------ */
/* script                                                              */
/* ------------------------------------------------------------------ */

function buildJs(): string {
  return `/* Generated by the one-page-website skill.
   Progressive enhancement only: every behaviour below is an upgrade on markup
   that already works with JavaScript disabled. */
(function () {
  "use strict";

  var doc = document;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---- mobile navigation ---- */
  var toggle = doc.querySelector(".nav-toggle");
  var nav = doc.getElementById("site-nav");

  function closeNav() {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", "false");
    nav.setAttribute("data-open", "false");
  }

  if (toggle && nav) {
    toggle.hidden = false;
    closeNav();
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      nav.setAttribute("data-open", open ? "false" : "true");
    });
    doc.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeNav();
    });
  }

  /* ---- smooth scroll + focus management ---- */
  doc.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    var id = link.getAttribute("href").slice(1);
    if (!id) return;
    var target = doc.getElementById(id);
    if (!target) return;

    event.preventDefault();
    closeNav();
    target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });

    // Move focus so keyboard and screen reader users land where sighted users do.
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });

    if (history.replaceState) history.replaceState(null, "", "#" + id);
  });

  /* ---- FAQ accordion: keep one open at a time ---- */
  var faqItems = Array.prototype.slice.call(doc.querySelectorAll(".faq__item"));
  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });

  /* ---- header shadow on scroll ---- */
  var header = doc.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.setAttribute("data-scrolled", window.scrollY > 8 ? "true" : "false");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- scrollspy on the nav ---- */
  var navLinks = Array.prototype.slice.call(doc.querySelectorAll('#site-nav a[href^="#"]'));
  if (navLinks.length && "IntersectionObserver" in window) {
    var sections = navLinks
      .map(function (link) { return doc.getElementById(link.getAttribute("href").slice(1)); })
      .filter(Boolean);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) {
          var active = link.getAttribute("href") === "#" + entry.target.id;
          if (active) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });

    sections.forEach(function (section) { observer.observe(section); });
  }
})();
`;
}

/* ------------------------------------------------------------------ */
/* html                                                                */
/* ------------------------------------------------------------------ */

const ICONS = [
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="m9 12 2 2 4-4"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6H4v12h4M16 6h4v12h-4M10 16l4-8"/></svg>',
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5"/></svg>',
];

const SECTION_LABELS: Record<KnownSection, string> = {
  hero: "Overview",
  features: "Features",
  proof: "Proof",
  pricing: "Pricing",
  faq: "FAQ",
  cta: "Get started",
};

interface RenderContext {
  content: Content;
  overrides: Map<string, CopyOverride>;
  sections: string[];
}

function richOverride(ctx: RenderContext, slug: string): string | null {
  const override = ctx.overrides.get(slug);
  return override ? `      <div class="rich-text">\n${override.html
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n")}\n      </div>` : null;
}

function renderHero(ctx: RenderContext): string {
  const { content } = ctx;
  const custom = richOverride(ctx, "hero");
  const panelRows = content.stats
    .map(
      (stat) =>
        `          <div class="hero__panel-row"><span class="hero__panel-key">${escapeHtml(
          stat.label,
        )}</span><span class="hero__panel-val">${escapeHtml(stat.value)}</span></div>`,
    )
    .join("\n");

  return `    <section id="hero" class="section hero" aria-labelledby="hero-title">
      <div class="container hero__grid">
        <div>
          <p class="hero__badge">${escapeHtml(content.eyebrow)} &middot; ${escapeHtml(content.name)}</p>
          <h1 id="hero-title">${escapeHtml(content.tagline)}</h1>
          <p class="lede">${escapeHtml(content.lead)}</p>
${custom ? `${custom}\n` : ""}          <div class="hero__actions">
            <a class="btn btn--primary" href="#cta">${escapeHtml(content.goal)}</a>
            <a class="btn btn--ghost" href="#features">See how it works</a>
          </div>
          <p class="hero__note">No credit card required &middot; Built for ${escapeHtml(content.audience)}</p>
        </div>
        <div class="hero__panel" aria-hidden="true">
          <div class="hero__panel-bar"><span></span><span></span><span></span></div>
${panelRows}
        </div>
      </div>
    </section>`;
}

function renderFeatures(ctx: RenderContext): string {
  const custom = richOverride(ctx, "features");
  const cards = ctx.content.features
    .map(
      (feature, index) => `          <article class="card">
            <div class="card__icon">${ICONS[index % ICONS.length]}</div>
            <h3>${escapeHtml(feature.title)}</h3>
            <p>${escapeHtml(feature.body)}</p>
          </article>`,
    )
    .join("\n");

  return `    <section id="features" class="section section--alt" aria-labelledby="features-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">Features</span>
          <h2 id="features-title">What you actually get</h2>
          <p class="lede">Fewer moving parts than the stack it replaces, and every one of them is inspectable.</p>
        </div>
${custom ? `${custom}\n` : ""}        <div class="grid grid--3">
${cards}
        </div>
      </div>
    </section>`;
}

function renderProof(ctx: RenderContext): string {
  const { content } = ctx;
  const custom = richOverride(ctx, "proof");
  const stats = content.stats
    .map(
      (stat) => `          <div class="stat">
            <p class="stat__value">${escapeHtml(stat.value)}</p>
            <p class="stat__label">${escapeHtml(stat.label)}</p>
          </div>`,
    )
    .join("\n");

  return `    <section id="proof" class="section" aria-labelledby="proof-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">Proof</span>
          <h2 id="proof-title">Numbers first, story second</h2>
        </div>
        <div class="stats">
${stats}
        </div>
${custom ? `${custom}\n` : ""}        <figure class="quote">
          <blockquote><p>&ldquo;${escapeHtml(content.quote.text)}&rdquo;</p></blockquote>
          <footer>${escapeHtml(content.quote.author)} &middot; ${escapeHtml(content.quote.role)}</footer>
        </figure>
      </div>
    </section>`;
}

function renderPricing(ctx: RenderContext): string {
  const custom = richOverride(ctx, "pricing");
  const tiers = ctx.content.tiers
    .map(
      (tier) => `          <article class="card tier${tier.featured ? " tier--featured" : ""}">
            ${tier.featured ? '<span class="tier__badge">Most popular</span>' : ""}
            <h3>${escapeHtml(tier.name)}</h3>
            <p class="tier__price"><span class="tier__amount">${escapeHtml(tier.price)}</span><span class="tier__cadence">${escapeHtml(
              tier.cadence,
            )}</span></p>
            <p>${escapeHtml(tier.blurb)}</p>
            <ul class="tier__list">
${tier.items.map((item) => `              <li>${escapeHtml(item)}</li>`).join("\n")}
            </ul>
            <a class="btn ${tier.featured ? "btn--primary" : "btn--ghost"}" href="#cta">${escapeHtml(
              tier.featured ? ctx.content.goal : `Choose ${tier.name}`,
            )}</a>
          </article>`,
    )
    .join("\n");

  return `    <section id="pricing" class="section section--alt" aria-labelledby="pricing-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">Pricing</span>
          <h2 id="pricing-title">Priced so you can start today</h2>
          <p class="lede">Start free. Upgrade when the team does, not when a sales cycle says so.</p>
        </div>
${custom ? `${custom}\n` : ""}        <div class="grid grid--3">
${tiers}
        </div>
      </div>
    </section>`;
}

function renderFaq(ctx: RenderContext): string {
  const custom = richOverride(ctx, "faq");
  const items = ctx.content.faqs
    .map(
      (faq) => `          <details class="faq__item">
            <summary>${escapeHtml(faq.q)}</summary>
            <div class="faq__answer"><p>${escapeHtml(faq.a)}</p></div>
          </details>`,
    )
    .join("\n");

  return `    <section id="faq" class="section" aria-labelledby="faq-title">
      <div class="container">
        <div class="section__head">
          <span class="section__eyebrow">FAQ</span>
          <h2 id="faq-title">Questions people actually ask</h2>
        </div>
${custom ? `${custom}\n` : ""}        <div class="faq">
${items}
        </div>
      </div>
    </section>`;
}

function renderCta(ctx: RenderContext): string {
  const { content } = ctx;
  const custom = richOverride(ctx, "cta");
  return `    <section id="cta" class="section" aria-labelledby="cta-title">
      <div class="container">
        <div class="cta-band">
          <h2 id="cta-title">${escapeHtml(content.ctaHeading)}</h2>
          <p>${escapeHtml(content.ctaBody)}</p>
${custom ? `${custom}\n` : ""}          <p><a class="btn btn--primary" href="mailto:hello@example.com?subject=${encodeURIComponent(
            `${content.name} — ${content.goal}`,
          )}">${escapeHtml(content.goal)}</a></p>
        </div>
      </div>
    </section>`;
}

function renderCustomSection(override: CopyOverride): string {
  return `    <section id="${escapeHtml(override.slug)}" class="section" aria-labelledby="${escapeHtml(
    override.slug,
  )}-title">
      <div class="container">
        <div class="section__head">
          <h2 id="${escapeHtml(override.slug)}-title">${escapeHtml(override.title)}</h2>
        </div>
        <div class="rich-text">
${override.html
  .split("\n")
  .map((line) => `          ${line}`)
  .join("\n")}
        </div>
      </div>
    </section>`;
}

const RENDERERS: Record<KnownSection, (ctx: RenderContext) => string> = {
  hero: renderHero,
  features: renderFeatures,
  proof: renderProof,
  pricing: renderPricing,
  faq: renderFaq,
  cta: renderCta,
};

interface NavEntry {
  id: string;
  label: string;
}

function buildHtml(options: {
  content: Content;
  tokens: Tokens;
  css: string;
  sections: string[];
  overrides: Map<string, CopyOverride>;
  customSections: CopyOverride[];
  navEntries: NavEntry[];
}): string {
  const ctx: RenderContext = {
    content: options.content,
    overrides: options.overrides,
    sections: options.sections,
  };

  const rendered: string[] = [];
  for (const section of options.sections) {
    if (section === "cta" && options.customSections.length > 0) {
      for (const custom of options.customSections) rendered.push(renderCustomSection(custom));
    }
    rendered.push(RENDERERS[section as KnownSection](ctx));
  }
  if (!options.sections.includes("cta")) {
    for (const custom of options.customSections) rendered.push(renderCustomSection(custom));
  }

  const nav = options.navEntries
    .map((entry) => `            <li><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</a></li>`)
    .join("\n");

  const initials =
    options.content.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "A";

  return `<!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.content.name)} — ${escapeHtml(options.content.tagline)}</title>
  <meta name="description" content="${escapeHtml(options.content.lead.slice(0, 155))}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="${options.tokens.accent}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(options.content.name)}">
  <meta property="og:description" content="${escapeHtml(options.content.tagline)}">
  <link rel="canonical" href="/">
  <script>document.documentElement.className = document.documentElement.className.replace("no-js", "js");</script>
  <style>
${options.css
  .split("\n")
  .map((line) => (line ? `    ${line}` : line))
  .join("\n")}
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="site-header">
    <div class="container site-header__inner">
      <a class="brand" href="#hero">
        <span class="brand__mark" aria-hidden="true">${escapeHtml(initials)}</span>
        <span>${escapeHtml(options.content.name)}</span>
      </a>

      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" hidden>
        <span class="nav-toggle__bars" aria-hidden="true"></span>
        <span>Menu</span>
      </button>

      <nav class="site-nav" id="site-nav" aria-label="Primary">
        <ul class="site-nav__list">
${nav}
        </ul>
      </nav>

      <a class="btn btn--primary btn--sm" href="#cta">${escapeHtml(options.content.goal)}</a>
    </div>
  </header>

  <main id="main">
${rendered.join("\n\n")}
  </main>

  <footer class="site-footer">
    <div class="container site-footer__inner">
      <p>&copy; ${options.content.year} ${escapeHtml(options.content.name)}. All rights reserved.</p>
      <ul>
        <li><a href="#hero">Back to top</a></li>
        <li><a href="mailto:hello@example.com">Contact</a></li>
        <li><a href="/privacy">Privacy</a></li>
      </ul>
    </div>
  </footer>

  <script src="script.js" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* docs                                                                */
/* ------------------------------------------------------------------ */

function siteReadme(content: Content, tokens: Tokens, sections: string[]): string {
  return `# ${content.name} — one page site

Generated by the \`one-page-website\` skill. Everything in this folder is static:
no build step, no bundler, no external requests.

## Run it locally

\`\`\`bash
# any static server works
python3 -m http.server 8000
bunx serve .
npx http-server .
\`\`\`

Then open <http://localhost:8000>.

## Files

| File | Purpose |
|------|---------|
| \`index.html\` | The whole page. The stylesheet is inlined in \`<style>\` so the page renders with a single request. |
| \`styles.css\` | The identical stylesheet as a standalone file, if you would rather link it. See "Splitting the CSS" below. |
| \`script.js\` | Progressive enhancement: mobile nav, single-open FAQ, smooth scroll with focus management, scrollspy, header shadow. |

## Splitting the CSS

\`index.html\` inlines the stylesheet to keep the page to one request. If you
prefer a cached external stylesheet, delete the \`<style>\` block and add:

\`\`\`html
<link rel="stylesheet" href="styles.css">
\`\`\`

\`styles.css\` is byte-identical to the inlined block, so nothing else changes.

## Design tokens

All design decisions are CSS custom properties on \`:root\` in the stylesheet:

- \`--accent\` is \`${tokens.accent}\` (style preset: \`${tokens.preset}\`)
- \`--font-display\`, \`--font-sans\`, \`--font-mono\` — system stacks, no webfont requests
- \`--radius\`, \`--radius-lg\`, \`--measure\`, \`--container\`, \`--space-*\`

Dark mode is a \`@media (prefers-color-scheme: dark)\` block that overrides only
the color tokens. Change a token once and both themes follow.

## Accessibility notes

- Skip link to \`#main\`, landmark elements, one \`<h1>\`.
- The FAQ uses native \`<details>\`/\`<summary>\`, so it opens and closes with
  JavaScript disabled. The script only adds single-open behaviour.
- The mobile menu button is \`hidden\` in the markup and revealed by the script.
  Without JavaScript the nav list is always visible instead of being trapped
  behind a dead button.
- Anchor navigation moves focus to the target so keyboard and screen reader
  users land where sighted users do.
- \`prefers-reduced-motion\` disables smooth scrolling.

## Sections in this build

${sections.map((section) => `- \`#${section}\``).join("\n")}

## Replacing the copy

Edit \`index.html\` directly, or re-run the skill with \`--copy your-copy.md\` to
inject real markdown per section.
`;
}

function deployNotes(content: Content): string {
  return `# Deploy notes — ${content.name}

The \`site/\` folder is a complete static site. There is no build step and no
runtime dependency; anything that serves files will serve it.

## Checklist before you ship

- [ ] Replace the placeholder copy (search \`index.html\` for \`example.com\`).
- [ ] Point \`mailto:hello@example.com\` at a real inbox or swap it for your form URL.
- [ ] Add a real favicon and an \`og:image\` (1200x630) and reference them in \`<head>\`.
- [ ] Set \`<link rel="canonical">\` to the production URL.
- [ ] Add \`/privacy\` and \`/terms\` pages, or remove the footer links.
- [ ] Run Lighthouse. The page ships accessible, but your copy and images decide the final score.

## Static hosts

\`\`\`bash
# Netlify
netlify deploy --dir=site --prod

# Cloudflare Pages
wrangler pages deploy site

# GitHub Pages (from a docs/ folder or gh-pages branch)
cp -r site/* docs/ && git add docs && git commit -m "Publish site"

# S3 + CloudFront
aws s3 sync site/ s3://YOUR_BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths '/*'
\`\`\`

## Caching

\`index.html\` inlines its CSS, so a cold visit is one HTML request plus
\`script.js\`. Suggested headers:

\`\`\`
/index.html    Cache-Control: public, max-age=0, must-revalidate
/script.js     Cache-Control: public, max-age=31536000, immutable
/styles.css    Cache-Control: public, max-age=31536000, immutable
\`\`\`

Add a content hash to \`script.js\` if you adopt the immutable header.

## Security headers

\`\`\`
Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
\`\`\`

\`'unsafe-inline'\` is needed for the inlined \`<style>\` block and the two-line
no-js class swap in \`<head>\`. Move the CSS to \`styles.css\` and delete that
inline script if you want a stricter policy.
`;
}

function copyDoc(content: Content, sections: string[]): string {
  return `# Copy — ${content.name}

This is the copy that was written into \`site/index.html\`. Edit it, then re-run
the skill with \`--copy copy.md\` to feed it back in.

# ${content.tagline}

${content.lead}

${sections.includes("features") ? `## Features\n\n${content.features.map((f) => `### ${f.title}\n\n${f.body}`).join("\n\n")}\n` : ""}
${sections.includes("proof") ? `## Proof\n\n${content.stats.map((s) => `- **${s.value}** — ${s.label}`).join("\n")}\n\n> ${content.quote.text}\n>\n> — ${content.quote.author}, ${content.quote.role}\n` : ""}
${
  sections.includes("pricing")
    ? `## Pricing\n\n${content.tiers
        .map((t) => `### ${t.name} — ${t.price} ${t.cadence}\n\n${t.blurb}\n\n${t.items.map((i) => `- ${i}`).join("\n")}`)
        .join("\n\n")}\n`
    : ""
}
${sections.includes("faq") ? `## FAQ\n\n${content.faqs.map((f) => `**${f.q}**\n\n${f.a}`).join("\n\n")}\n` : ""}
${sections.includes("cta") ? `## CTA\n\n### ${content.ctaHeading}\n\n${content.ctaBody}\n` : ""}`;
}

/* ------------------------------------------------------------------ */
/* cli                                                                 */
/* ------------------------------------------------------------------ */

function printHelp(): void {
  console.log(`one-page-website v${VERSION}

Generate a deployable static one-page site. Semantic, responsive, accessible,
dark-mode aware, zero external requests, zero API keys, zero network access.

USAGE:
  one-page-website --name <text> [options]
  one-page-website "<name>" [options]

OPTIONS:
      --name <text>         Brand or product name (positional works)  [required]
      --tagline <text>      Hero headline                     [generated from name]
      --sections <list>     Comma list of: hero,features,proof,pricing,faq,cta
                                                              [all six]
      --style <text>        Style preset keyword or phrase    [clean]
      --copy <file>         Markdown file whose H2 sections override the copy
      --goal <text>         Primary CTA label                 [Book a demo]
      --audience <text>     Who the page is for               [software teams]
      --features <list>     Comma list of feature card titles [generated]
      --accent <hex>        Force the accent color (#RRGGBB)  [from style preset]
  -o, --output <dir>        Output directory                  [./one-page-website]
      --json                Print the run summary as JSON
      --help                Show this help message
      --version             Show the current version

STYLE PRESETS:
  clean (default) | editorial | bold | warm | technical

OUTPUTS:
  site/index.html           The page, with the stylesheet inlined
  site/styles.css           Same stylesheet as a standalone file
  site/script.js            Progressive enhancement: nav, FAQ, scroll, scrollspy
  site/README.md            How to run, split the CSS, and edit tokens
  section-map.json          Sections, ids, nav labels, copy overrides applied
  copy.md                   The generated copy, ready to edit and feed back in
  deploy-notes.md           Host commands, cache headers, CSP, pre-ship checklist
  manifest.json             Every file written, with byte sizes

EXAMPLES:
  one-page-website --name "MeterKit" --tagline "Usage billing that finance trusts"
  one-page-website "Relay" --sections hero,features,cta --style bold
  one-page-website --name "Ledgerly" --copy ./copy.md --accent "#0F7B7B" -o ./out
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sections: KNOWN_SECTIONS.join(","),
    style: "clean",
    goal: "Book a demo",
    audience: "software teams",
    output: "./one-page-website",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--name":
        options.name = argv[++i];
        break;
      case "--tagline":
        options.tagline = argv[++i];
        break;
      case "--sections":
        options.sections = argv[++i] ?? options.sections;
        break;
      case "--style":
        options.style = argv[++i] ?? options.style;
        break;
      case "--copy":
        options.copy = argv[++i];
        break;
      case "--goal":
        options.goal = argv[++i] ?? options.goal;
        break;
      case "--audience":
        options.audience = argv[++i] ?? options.audience;
        break;
      case "--features":
        options.features = argv[++i];
        break;
      case "--accent": {
        const value = normalizeHex(argv[++i] ?? "");
        if (!value) {
          throw new Error(`Invalid --accent value: ${argv[i]} (expected a hex color such as #0F7B7B)`);
        }
        options.accent = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.name) {
          options.name = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.name || options.name.trim() === "") {
    throw new Error("Missing required --name <text> argument (a positional name also works)");
  }

  return options;
}

interface WrittenFile {
  path: string;
  type: string;
  bytes: number;
}

async function writeOutput(
  outDir: string,
  relPath: string,
  contents: string,
  type: string,
  files: WrittenFile[],
): Promise<void> {
  const target = join(outDir, relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
  files.push({ path: relPath, type, bytes: Buffer.byteLength(contents, "utf8") });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outDir = resolve(options.output);

  const sections = options.sections
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const unknown = sections.filter((section) => !(KNOWN_SECTIONS as readonly string[]).includes(section));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown section(s): ${unknown.join(", ")}. Valid sections are: ${KNOWN_SECTIONS.join(", ")}`,
    );
  }
  if (sections.length === 0) {
    throw new Error("--sections resolved to an empty list");
  }
  if (!sections.includes("hero")) {
    sections.unshift("hero");
  }

  const seed = fnv1a(`${options.name}|${options.tagline ?? ""}|${options.audience}|${options.goal}`);
  const content = buildContent(options, seed);
  const preset = selectPreset(options.style);
  const tokens = buildTokens(preset, options.accent);

  const overrides = new Map<string, CopyOverride>();
  const customSections: CopyOverride[] = [];
  let copySource: string | null = null;

  if (options.copy) {
    copySource = resolve(options.copy);
    const parsed = await parseCopyFile(copySource);
    if (parsed.heroTitle) content.tagline = parsed.heroTitle;
    if (parsed.heroLead) content.lead = parsed.heroLead;
    for (const override of parsed.overrides) {
      if (override.known) overrides.set(override.slug, override);
      else customSections.push(override);
    }
  }

  const navEntries: NavEntry[] = sections
    .filter((section) => section !== "hero")
    .map((section) => ({ id: section, label: SECTION_LABELS[section as KnownSection] }));
  for (const custom of customSections) {
    navEntries.splice(Math.max(0, navEntries.length - 1), 0, { id: custom.slug, label: custom.title });
  }

  const css = buildCss(tokens);
  const js = buildJs();
  const html = buildHtml({ content, tokens, css, sections, overrides, customSections, navEntries });

  const files: WrittenFile[] = [];
  await writeOutput(outDir, "site/index.html", html, "text/html", files);
  await writeOutput(outDir, "site/styles.css", css, "text/css", files);
  await writeOutput(outDir, "site/script.js", js, "text/javascript", files);
  await writeOutput(outDir, "site/README.md", siteReadme(content, tokens, sections), "text/markdown", files);
  await writeOutput(outDir, "copy.md", copyDoc(content, sections), "text/markdown", files);
  await writeOutput(outDir, "deploy-notes.md", deployNotes(content), "text/markdown", files);

  const sectionMap = {
    name: content.name,
    tagline: content.tagline,
    goal: content.goal,
    audience: content.audience,
    style: { input: options.style, preset: preset.name, accent: tokens.accent },
    copySource,
    sections: sections.map((section) => ({
      id: section,
      label: SECTION_LABELS[section as KnownSection],
      anchor: `#${section}`,
      inNav: section !== "hero",
      copyOverride: overrides.has(section),
    })),
    customSections: customSections.map((custom) => ({
      id: custom.slug,
      label: custom.title,
      anchor: `#${custom.slug}`,
      inNav: true,
      copyOverride: true,
    })),
    nav: navEntries,
  };

  await writeOutput(outDir, "section-map.json", `${JSON.stringify(sectionMap, null, 2)}\n`, "application/json", files);

  const manifest = {
    skill: "one-page-website",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    input: {
      name: content.name,
      tagline: content.tagline,
      sections,
      style: options.style,
      stylePreset: preset.name,
      accent: tokens.accent,
      goal: content.goal,
      audience: content.audience,
      copy: copySource,
    },
    outputDir: outDir,
    files: files.slice().sort((a, b) => a.path.localeCompare(b.path)),
  };

  const manifestPath = join(outDir, "manifest.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...manifest, sectionMap }, null, 2)}\n`);
    return;
  }

  console.log(`one-page-website: wrote ${files.length + 1} files to ${outDir}`);
  console.log(`  name       ${content.name}`);
  console.log(`  style      ${options.style} -> preset "${preset.name}", accent ${tokens.accent}`);
  console.log(`  sections   ${sections.join(", ")}${customSections.length ? ` (+${customSections.map((c) => c.slug).join(", ")})` : ""}`);
  if (copySource) {
    console.log(`  copy       ${copySource} (${overrides.size} known + ${customSections.length} custom section(s))`);
  }
  console.log(`  serve      cd ${relative(process.cwd(), join(outDir, "site")) || join(outDir, "site")} && python3 -m http.server 8000`);
  console.log(`  manifest   ${relative(process.cwd(), manifestPath) || manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`one-page-website: ${message}\n`);
  process.exit(1);
});
