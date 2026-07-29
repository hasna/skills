import type { CliOptions, Content, Tokens } from "./types.js";

export function fnv1a(input: string): number {
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

export function escapeHtml(value: string): string {
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

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

export function titleCase(value: string): string {
  return value
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hslToHex(h: number, s: number, l: number): string {
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

export function normalizeHex(token: string): string | null {
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

export function selectPreset(style: string): StylePreset {
  const lower = style.toLowerCase();
  for (const preset of STYLE_PRESETS) {
    if (preset.keywords.some((keyword) => lower.includes(keyword))) return preset;
  }
  return STYLE_PRESETS[STYLE_PRESETS.length - 1];
}

export function buildTokens(preset: StylePreset, accentOverride?: string): Tokens {
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

/* ------------------------------------------------------------------ */
/* copy generation                                                     */
/* ------------------------------------------------------------------ */


export function buildContent(options: CliOptions, seed: number): Content {
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

