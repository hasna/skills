#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";

const VERSION = "0.1.0";

type Layout = "title" | "agenda" | "bullets" | "section" | "quote" | "closing";

interface Slide {
  index: number;
  layout: Layout;
  title: string;
  subtitle?: string;
  bullets: string[];
  notes: string;
}

interface Theme {
  name: string;
  label: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  headingFont: string;
  bodyFont: string;
  mood: string;
}

interface CliOptions {
  brief?: string;
  source?: string;
  title?: string;
  audience: string;
  format: string;
  slides: number;
  theme: string;
  output: string;
  json: boolean;
  noPptx: boolean;
}

/* -------------------------------------------------------------------------- */
/* Themes                                                                      */
/* -------------------------------------------------------------------------- */

const THEMES: Record<string, Theme> = {
  midnight: {
    name: "midnight",
    label: "Midnight",
    background: "0B1020",
    surface: "151B33",
    text: "F5F7FF",
    muted: "9AA6C8",
    accent: "6E8BFF",
    accentText: "0B1020",
    headingFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    mood: "High-contrast dark deck for keynotes and product launches.",
  },
  aurora: {
    name: "aurora",
    label: "Aurora",
    background: "0E1F1C",
    surface: "13302A",
    text: "EAFFF7",
    muted: "8FC4B2",
    accent: "35D6A4",
    accentText: "07120F",
    headingFont: "'Trebuchet MS', 'Segoe UI', sans-serif",
    bodyFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    mood: "Fresh dark-green deck for growth, sustainability, and roadmap reviews.",
  },
  sandstone: {
    name: "sandstone",
    label: "Sandstone",
    background: "FBF7F0",
    surface: "F2EAD9",
    text: "2A2318",
    muted: "7A6A52",
    accent: "C1682C",
    accentText: "FFF8EF",
    headingFont: "Georgia, 'Times New Roman', serif",
    bodyFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    mood: "Warm light deck for workshops, training, and long-form reports.",
  },
  ocean: {
    name: "ocean",
    label: "Ocean",
    background: "F4F9FC",
    surface: "E3EFF7",
    text: "0C2233",
    muted: "5A778C",
    accent: "0F6FA8",
    accentText: "FFFFFF",
    headingFont: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    bodyFont: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    mood: "Calm light-blue deck for status updates and customer-facing reviews.",
  },
  mono: {
    name: "mono",
    label: "Mono",
    background: "FFFFFF",
    surface: "F1F1F1",
    text: "111111",
    muted: "666666",
    accent: "111111",
    accentText: "FFFFFF",
    headingFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    bodyFont: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    mood: "Neutral black-and-white deck that prints and photocopies cleanly.",
  },
};

const AUDIENCES = ["team", "customers", "executives", "students"];
const FORMATS = ["general", "training", "sales", "report", "proposal"];

/* -------------------------------------------------------------------------- */
/* Lazy optional dependencies                                                  */
/* -------------------------------------------------------------------------- */

async function loadMarked() {
  try {
    return (await import("marked")).marked;
  } catch {
    throw new Error("Missing dependency 'marked'. Run bun install in this skill directory.");
  }
}

async function loadPptxGenJs() {
  try {
    const mod = await import("pptxgenjs");
    return (mod.default ?? mod) as any;
  } catch {
    throw new Error("Missing dependency 'pptxgenjs'. Run bun install in this skill directory.");
  }
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

function printHelp(): void {
  console.log(`slide-deck-generator v${VERSION}

USAGE:
  slide-deck-generator --brief "<text>" [options]
  slide-deck-generator --source <outline.md> [options]

OPTIONS:
  -b, --brief <text>      Brief, outline, or narrative text. A bare positional also works.
  -s, --source <path>     Read the brief/outline from a Markdown or text file.
  -t, --title <text>      Deck title (default: first heading, or first line of the brief)
  -n, --slides <n>        Target slide count (default: 8)
      --theme <name>      ${Object.keys(THEMES).join(" | ")} (default: midnight)
      --audience <type>   ${AUDIENCES.join(" | ")} (default: team)
      --format <type>     ${FORMATS.join(" | ")} (default: general)
  -o, --output <dir>      Output directory (default: ./slide-deck)
      --no-pptx           Skip deck.pptx rendering (all other files still emitted)
      --json              Print the manifest as JSON instead of a text summary
  -h, --help              Show this help message
  -v, --version           Show the current version

EXAMPLES:
  slide-deck-generator --brief "Q2 launch review for AI billing" --slides 10 --theme aurora
  slide-deck-generator --source ./outline.md --audience executives --output ./out
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    audience: "team",
    format: "general",
    slides: 8,
    theme: "midnight",
    output: "./slide-deck",
    json: false,
    noPptx: false,
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
      case "--brief":
      case "-b":
        options.brief = argv[++i];
        break;
      case "--source":
      case "-s":
        options.source = argv[++i];
        break;
      case "--title":
      case "-t":
        options.title = argv[++i];
        break;
      case "--slides":
      case "-n": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1 || value > 60) {
          throw new Error(`Invalid --slides value: ${argv[i]}. Use 1-60.`);
        }
        options.slides = value;
        break;
      }
      case "--theme": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (!THEMES[value]) {
          throw new Error(`Unknown --theme: ${value}. Available: ${Object.keys(THEMES).join(", ")}`);
        }
        options.theme = value;
        break;
      }
      case "--audience": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (!AUDIENCES.includes(value)) {
          throw new Error(`Unknown --audience: ${value}. Available: ${AUDIENCES.join(", ")}`);
        }
        options.audience = value;
        break;
      }
      case "--format": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (!FORMATS.includes(value)) {
          throw new Error(`Unknown --format: ${value}. Available: ${FORMATS.join(", ")}`);
        }
        options.format = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? "./slide-deck";
        break;
      case "--no-pptx":
        options.noPptx = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.brief && !options.source) {
          options.brief = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.brief && !options.source) {
    throw new Error("Provide --brief <text> or --source <file>. See --help.");
  }

  return options;
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                                */
/* -------------------------------------------------------------------------- */

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
    .replace(/(^|\s)_([^_]+)_/g, "$1$2")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  const cleaned = value.trim().replace(/[.:;,]+$/, "");
  if (!cleaned) return "Untitled";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function shorten(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\-\s]+$/, "")}…`;
}

function headlineFrom(sentence: string): string {
  const stripped = stripInlineMarkdown(sentence).replace(/^(the|a|an)\s+/i, "");
  const words = stripped.split(" ").slice(0, 8).join(" ");
  return titleCase(shorten(words, 60));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Slide model construction                                                    */
/* -------------------------------------------------------------------------- */

interface DraftSlide {
  layout: Layout;
  title: string;
  subtitle?: string;
  bullets: string[];
  notes: string[];
}

async function parseMarkdown(source: string): Promise<{ deckTitle?: string; drafts: DraftSlide[] }> {
  const marked = await loadMarked();
  const tokens = marked.lexer(source);

  const drafts: DraftSlide[] = [];
  let deckTitle: string | undefined;
  let current: DraftSlide | undefined;
  let sectionTitle: string | undefined;

  const push = (draft: DraftSlide) => {
    drafts.push(draft);
    current = draft;
  };

  /** Title used when content appears without a heading of its own. */
  const implicitTitle = (fallback: string): string => {
    if (!sectionTitle) return fallback;
    const used = drafts.filter(
      (draft) =>
        draft.title.startsWith(sectionTitle!) && (draft.bullets.length > 0 || draft.notes.length > 0),
    ).length;
    return used === 0 ? sectionTitle : `${sectionTitle} (cont.)`;
  };

  const ensureCurrent = (fallback: string) => {
    if (!current) push({ layout: "bullets", title: implicitTitle(fallback), bullets: [], notes: [] });
  };

  for (const token of tokens as any[]) {
    switch (token.type) {
      case "heading": {
        const text = stripInlineMarkdown(token.text ?? "");
        if (!text) break;
        if (token.depth === 1 && !deckTitle) {
          deckTitle = text;
          break;
        }
        if (token.depth <= 2) {
          sectionTitle = titleCase(text);
          push({ layout: "bullets", title: sectionTitle, bullets: [], notes: [] });
        } else if (current) {
          current.bullets.push(text);
        } else {
          sectionTitle = titleCase(text);
          push({ layout: "bullets", title: sectionTitle, bullets: [], notes: [] });
        }
        break;
      }
      case "list": {
        const items = (token.items ?? []) as any[];
        ensureCurrent("Overview");
        for (const item of items) {
          const text = stripInlineMarkdown(item.text ?? "");
          if (text) current!.bullets.push(shorten(text, 160));
        }
        break;
      }
      case "paragraph": {
        const text = stripInlineMarkdown(token.text ?? "");
        if (!text) break;
        ensureCurrent("Overview");
        current!.notes.push(text);
        break;
      }
      case "blockquote": {
        const text = stripInlineMarkdown(token.text ?? "");
        if (!text) break;
        push({ layout: "quote", title: shorten(text, 220), bullets: [], notes: [] });
        current = undefined;
        break;
      }
      case "code": {
        ensureCurrent("Example");
        const firstLines = String(token.text ?? "")
          .split("\n")
          .filter(Boolean)
          .slice(0, 4);
        for (const line of firstLines) current!.bullets.push(shorten(line.trim(), 120));
        break;
      }
      default:
        break;
    }
  }

  // Any slide with prose but no bullets gets bullets derived from its prose.
  for (const draft of drafts) {
    if (draft.bullets.length === 0 && draft.notes.length > 0 && draft.layout === "bullets") {
      const sentences = splitSentences(draft.notes.join(" ")).slice(0, 5);
      draft.bullets = sentences.map((sentence) => shorten(sentence, 160));
    }
  }

  return { deckTitle, drafts: drafts.filter((draft) => draft.bullets.length > 0 || draft.layout === "quote") };
}

function draftsFromBrief(brief: string): DraftSlide[] {
  const sentences = splitSentences(stripInlineMarkdown(brief));
  if (sentences.length === 0) return [];

  const groups = chunk(sentences, Math.max(2, Math.ceil(sentences.length / 5)));
  return groups.map((group) => ({
    layout: "bullets" as Layout,
    title: headlineFrom(group[0]),
    bullets: group.map((sentence) => shorten(sentence, 160)),
    notes: [group.join(" ")],
  }));
}

const FORMAT_CLOSERS: Record<string, Array<{ title: string; bullets: string[] }>> = {
  general: [
    { title: "Key takeaways", bullets: ["What changed", "Why it matters", "What we do next"] },
    { title: "Next steps", bullets: ["Owner and date per action", "Open decisions", "How we measure success"] },
  ],
  training: [
    { title: "Practice", bullets: ["Hands-on exercise", "Common mistakes", "Check for understanding"] },
    { title: "Resources", bullets: ["Reference docs", "Where to ask questions", "Follow-up session"] },
  ],
  sales: [
    { title: "Why now", bullets: ["Cost of waiting", "Time to value", "Proof from similar teams"] },
    { title: "Proposed next step", bullets: ["Pilot scope", "Success criteria", "Commercial terms"] },
  ],
  report: [
    { title: "Findings", bullets: ["What the data shows", "What surprised us", "Confidence and caveats"] },
    { title: "Recommendations", bullets: ["Priority actions", "Owners", "Review cadence"] },
  ],
  proposal: [
    { title: "Scope and plan", bullets: ["Phases and milestones", "Team and roles", "Assumptions"] },
    { title: "Investment and outcomes", bullets: ["Cost breakdown", "Expected outcomes", "Decision date"] },
  ],
};

const AUDIENCE_NOTE: Record<string, string> = {
  team: "Internal audience: keep the detail, name owners, and be explicit about trade-offs.",
  customers: "External audience: lead with outcomes, avoid internal jargon, and end on a clear ask.",
  executives: "Executive audience: state the decision up front, then the evidence, then the ask.",
  students: "Learning audience: define terms, pause for questions, and reinforce with an example.",
}
;

function agendaSlide(drafts: DraftSlide[]): DraftSlide {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const draft of drafts) {
    if (draft.layout === "quote") continue;
    const title = draft.title.replace(/\s*\(cont\.\)$/, "");
    if (seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
    if (titles.length >= 6) break;
  }
  return {
    layout: "agenda",
    title: "Agenda",
    bullets: titles.length > 0 ? titles : ["Context", "Findings", "Next steps"],
    notes: ["Walk the agenda in under 30 seconds, then move on."],
  };
}

function fitSlideCount(drafts: DraftSlide[], target: number, format: string): DraftSlide[] {
  const working = drafts.map((draft) => ({ ...draft, bullets: [...draft.bullets], notes: [...draft.notes] }));

  // Split dense slides while we still need more.
  let guard = 0;
  while (working.length < target && guard < 200) {
    guard += 1;
    let bestIndex = -1;
    let bestCount = 4;
    for (let i = 0; i < working.length; i += 1) {
      if (working[i].layout === "quote") continue;
      if (working[i].bullets.length > bestCount) {
        bestCount = working[i].bullets.length;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) break;
    const slide = working[bestIndex];
    const half = Math.ceil(slide.bullets.length / 2);
    const continuation: DraftSlide = {
      layout: slide.layout,
      title: `${slide.title} (cont.)`,
      bullets: slide.bullets.slice(half),
      notes: slide.notes.slice(),
    };
    slide.bullets = slide.bullets.slice(0, half);
    working.splice(bestIndex + 1, 0, continuation);
  }

  // Pad with format-aware closing sections.
  const closers = FORMAT_CLOSERS[format] ?? FORMAT_CLOSERS.general;
  let closerIndex = 0;
  while (working.length < target) {
    const closer = closers[closerIndex % closers.length];
    const suffix = closerIndex >= closers.length ? ` ${Math.floor(closerIndex / closers.length) + 1}` : "";
    working.push({
      layout: "bullets",
      title: `${closer.title}${suffix}`,
      bullets: [...closer.bullets],
      notes: ["Scaffold slide — replace with specifics before presenting."],
    });
    closerIndex += 1;
  }

  // Merge the lightest adjacent pair until we hit the target.
  guard = 0;
  while (working.length > target && working.length > 1 && guard < 500) {
    guard += 1;
    let bestIndex = 0;
    let bestWeight = Number.POSITIVE_INFINITY;
    for (let i = 0; i < working.length - 1; i += 1) {
      const weight = working[i].bullets.length + working[i + 1].bullets.length;
      if (weight < bestWeight) {
        bestWeight = weight;
        bestIndex = i;
      }
    }
    const first = working[bestIndex];
    const second = working[bestIndex + 1];
    first.bullets = [...first.bullets, ...second.bullets].slice(0, 8);
    first.notes = [...first.notes, ...second.notes];
    if (first.layout === "quote") first.layout = "bullets";
    working.splice(bestIndex + 1, 1);
  }

  return working;
}

function buildNotes(draft: DraftSlide, options: CliOptions, position: number, total: number): string {
  const parts: string[] = [];
  if (draft.notes.length > 0) {
    parts.push(shorten(draft.notes.join(" "), 600));
  } else if (draft.bullets.length > 0) {
    parts.push(`Walk through: ${draft.bullets.slice(0, 3).join("; ")}.`);
  }
  parts.push(AUDIENCE_NOTE[options.audience] ?? AUDIENCE_NOTE.team);
  parts.push(`Slide ${position} of ${total}. Target pace: about ${position === 1 ? 30 : 60} seconds.`);
  return parts.join(" ");
}

function buildSlides(
  deckTitle: string,
  drafts: DraftSlide[],
  options: CliOptions,
): Slide[] {
  const bodyTarget = Math.max(1, options.slides - (options.slides >= 3 ? 2 : 1));
  const fitted = fitSlideCount(drafts, Math.max(1, bodyTarget - (options.slides >= 4 ? 1 : 0)), options.format);

  const assembled: DraftSlide[] = [
    {
      layout: "title",
      title: deckTitle,
      subtitle: `${titleCase(options.format)} deck for ${options.audience}`,
      bullets: [],
      notes: [`Open with why this matters to ${options.audience}.`],
    },
  ];

  if (options.slides >= 4) assembled.push(agendaSlide(fitted));
  assembled.push(...fitted);

  if (options.slides >= 3) {
    assembled.push({
      layout: "closing",
      title: "Thank you",
      subtitle: "Questions and next steps",
      bullets: ["Recap the ask", "Confirm owners and dates", "Share this deck and the source material"],
      notes: ["Leave time for questions. Restate the single decision you need."],
    });
  }

  const trimmed = assembled.slice(0, options.slides);

  return trimmed.map((draft, index) => ({
    index: index + 1,
    layout: draft.layout,
    title: draft.title,
    subtitle: draft.subtitle,
    bullets: draft.bullets,
    notes: buildNotes(draft, options, index + 1, trimmed.length),
  }));
}

/* -------------------------------------------------------------------------- */
/* Renderers                                                                   */
/* -------------------------------------------------------------------------- */

function renderDeckMarkdown(deckTitle: string, slides: Slide[], theme: Theme, options: CliOptions): string {
  const lines: string[] = [
    `# ${deckTitle}`,
    "",
    `_${titleCase(options.format)} deck · audience: ${options.audience} · theme: ${theme.label} · ${slides.length} slides_`,
    "",
  ];

  for (const slide of slides) {
    lines.push("---", "", `## ${slide.index}. ${slide.title}`, "");
    if (slide.subtitle) lines.push(`**${slide.subtitle}**`, "");
    for (const bullet of slide.bullets) lines.push(`- ${bullet}`);
    if (slide.bullets.length > 0) lines.push("");
    lines.push(`> Notes: ${slide.notes}`, "");
  }

  return lines.join("\n");
}

function renderSpeakerNotes(deckTitle: string, slides: Slide[], options: CliOptions): string {
  const lines: string[] = [
    `# Speaker notes — ${deckTitle}`,
    "",
    `Audience: **${options.audience}** · Format: **${options.format}** · Slides: **${slides.length}**`,
    "",
    `Estimated runtime: **${Math.max(1, Math.round(slides.length * 0.9))}–${Math.max(2, slides.length * 2)} minutes** at 1–2 minutes per slide.`,
    "",
  ];

  for (const slide of slides) {
    lines.push(`## Slide ${slide.index} — ${slide.title}`, "");
    if (slide.bullets.length > 0) {
      lines.push("On screen:", "");
      for (const bullet of slide.bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
    lines.push("Say:", "", slide.notes, "");
  }

  lines.push(
    "## Delivery checklist",
    "",
    "- [ ] Open with the decision or outcome, not the agenda",
    "- [ ] Replace every scaffold bullet with a specific, verifiable claim",
    "- [ ] Name an owner and a date for each next step",
    "- [ ] Rehearse the first and last 30 seconds verbatim",
    "",
  );

  return lines.join("\n");
}

function renderThemeGuide(theme: Theme, slides: Slide[]): string {
  return [
    `# Theme guide — ${theme.label}`,
    "",
    theme.mood,
    "",
    "## Palette",
    "",
    "| Token | Hex | Use |",
    "|-------|-----|-----|",
    `| Background | \`#${theme.background}\` | Slide canvas |`,
    `| Surface | \`#${theme.surface}\` | Cards, agenda blocks, quote panels |`,
    `| Text | \`#${theme.text}\` | Headings and body copy |`,
    `| Muted | \`#${theme.muted}\` | Subtitles, slide numbers, captions |`,
    `| Accent | \`#${theme.accent}\` | Rules, bullet markers, section fills |`,
    `| Accent text | \`#${theme.accentText}\` | Text placed on the accent fill |`,
    "",
    "## Typography",
    "",
    `- Headings: \`${theme.headingFont}\``,
    `- Body: \`${theme.bodyFont}\``,
    "- Slide title: 40–44pt · Bullets: 18–20pt · Captions: 12pt",
    "",
    "## Layout rules",
    "",
    "- 16:9 canvas (10in × 5.625in in PPTX, 1280×720 in HTML).",
    "- Keep a 0.6in outer margin; never let text touch the edge.",
    "- Maximum 6 bullets per slide and roughly 12 words per bullet.",
    "- One idea per slide; if a slide needs a second idea, split it.",
    "",
    "## Applied in this deck",
    "",
    `- ${slides.length} slides`,
    `- Layouts used: ${Array.from(new Set(slides.map((slide) => slide.layout))).join(", ")}`,
    "",
    "## Swapping themes",
    "",
    "Re-run with `--theme <name>`. Available: " + Object.keys(THEMES).join(", ") + ".",
    "",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(deckTitle: string, slides: Slide[], theme: Theme, options: CliOptions): string {
  const slideMarkup = slides
    .map((slide) => {
      const parts: string[] = [];
      parts.push(`<section class="slide layout-${slide.layout}" data-index="${slide.index}" aria-label="Slide ${slide.index}">`);
      parts.push('  <div class="slide-inner">');
      if (slide.layout === "quote") {
        parts.push(`    <blockquote class="quote">${escapeHtml(slide.title)}</blockquote>`);
      } else {
        parts.push(`    <h2 class="slide-title">${escapeHtml(slide.title)}</h2>`);
      }
      if (slide.subtitle) parts.push(`    <p class="slide-subtitle">${escapeHtml(slide.subtitle)}</p>`);
      if (slide.bullets.length > 0) {
        parts.push('    <ul class="bullets">');
        for (const bullet of slide.bullets) parts.push(`      <li>${escapeHtml(bullet)}</li>`);
        parts.push("    </ul>");
      }
      parts.push(`    <p class="slide-number">${slide.index} / ${slides.length}</p>`);
      parts.push("  </div>");
      parts.push(`  <aside class="notes" hidden>${escapeHtml(slide.notes)}</aside>`);
      parts.push("</section>");
      return parts.join("\n");
    })
    .join("\n");

  const css = `
:root {
  --bg: #${theme.background};
  --surface: #${theme.surface};
  --text: #${theme.text};
  --muted: #${theme.muted};
  --accent: #${theme.accent};
  --accent-text: #${theme.accentText};
  --heading-font: ${theme.headingFont};
  --body-font: ${theme.bodyFont};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--body-font); }
#deck { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
.slide { position: absolute; inset: 0; display: none; padding: 5vh 7vw; }
.slide.active { display: flex; }
.slide-inner { margin: auto; width: 100%; max-width: 1100px; }
.slide-title { font-family: var(--heading-font); font-size: clamp(28px, 4.6vw, 56px); line-height: 1.1; margin: 0 0 0.4em; }
.slide-title::after { content: ""; display: block; width: 84px; height: 5px; margin-top: 0.35em; background: var(--accent); border-radius: 3px; }
.slide-subtitle { color: var(--muted); font-size: clamp(15px, 1.8vw, 22px); margin: 0 0 1em; }
.bullets { margin: 0; padding: 0; list-style: none; }
.bullets li { position: relative; padding-left: 1.5em; margin: 0 0 0.7em; font-size: clamp(15px, 2vw, 24px); line-height: 1.45; }
.bullets li::before { content: ""; position: absolute; left: 0; top: 0.55em; width: 0.6em; height: 0.6em; background: var(--accent); border-radius: 50%; }
.slide-number { position: absolute; right: 7vw; bottom: 4vh; color: var(--muted); font-size: 13px; letter-spacing: 0.08em; margin: 0; }
.layout-title .slide-inner, .layout-closing .slide-inner { text-align: center; }
.layout-title .slide-title::after, .layout-closing .slide-title::after { margin-left: auto; margin-right: auto; }
.layout-title .slide-title { font-size: clamp(34px, 6vw, 72px); }
.layout-title .bullets, .layout-closing .bullets { display: inline-block; text-align: left; }
.layout-section { background: var(--accent); color: var(--accent-text); }
.layout-section .slide-title::after { background: var(--accent-text); }
.layout-agenda .slide-inner { background: var(--surface); border-radius: 18px; padding: 4vh 4vw; }
.quote { font-family: var(--heading-font); font-size: clamp(22px, 3.4vw, 40px); line-height: 1.35; margin: 0; padding-left: 0.7em; border-left: 6px solid var(--accent); font-style: italic; }
#progress { position: fixed; left: 0; bottom: 0; height: 4px; background: var(--accent); width: 0; transition: width 160ms ease; z-index: 5; }
#help { position: fixed; left: 7vw; bottom: 4vh; color: var(--muted); font-size: 12px; letter-spacing: 0.06em; }
@media print {
  @page { size: 1280px 720px; margin: 0; }
  html, body, #deck { height: auto; width: auto; overflow: visible; }
  #progress, #help { display: none !important; }
  .slide { position: relative; display: flex !important; inset: auto; width: 1280px; height: 720px; page-break-after: always; break-after: page; background: var(--bg); }
  .slide.layout-section { background: var(--accent); }
}
`.trim();

  const js = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var progress = document.getElementById("progress");
  var current = 0;

  function show(next) {
    current = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach(function (slide, index) {
      slide.classList.toggle("active", index === current);
    });
    if (progress) progress.style.width = ((current + 1) / slides.length * 100) + "%";
    if (location.hash !== "#" + (current + 1)) history.replaceState(null, "", "#" + (current + 1));
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " " || event.key === "Enter") {
      show(current + 1);
      event.preventDefault();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp" || event.key === "Backspace") {
      show(current - 1);
      event.preventDefault();
    } else if (event.key === "Home") {
      show(0);
      event.preventDefault();
    } else if (event.key === "End") {
      show(slides.length - 1);
      event.preventDefault();
    } else if (event.key === "n" || event.key === "N") {
      document.body.classList.toggle("show-notes");
      slides.forEach(function (slide) {
        var notes = slide.querySelector(".notes");
        if (notes) notes.hidden = !document.body.classList.contains("show-notes");
      });
    }
  });

  document.addEventListener("click", function (event) {
    if (event.target && event.target.closest && event.target.closest("a")) return;
    show(current + 1);
  });

  var start = parseInt((location.hash || "#1").slice(1), 10);
  show(isNaN(start) ? 0 : start - 1);
})();
`.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deckTitle)}</title>
<meta name="generator" content="slide-deck-generator v${VERSION}">
<meta name="description" content="${escapeHtml(`${titleCase(options.format)} deck for ${options.audience}`)}">
<style>
${css}
</style>
</head>
<body>
<div id="deck">
${slideMarkup}
</div>
<div id="progress"></div>
<p id="help">← → navigate · N notes · Ctrl/Cmd-P print</p>
<script>
${js}
</script>
</body>
</html>
`;
}

async function renderPptx(
  path: string,
  deckTitle: string,
  slides: Slide[],
  theme: Theme,
  options: CliOptions,
): Promise<void> {
  const PptxGenJS = await loadPptxGenJs();
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "slide-deck-generator";
  pptx.company = "";
  pptx.title = deckTitle;
  pptx.subject = `${options.format} deck for ${options.audience}`;

  for (const slide of slides) {
    const pptSlide = pptx.addSlide();
    const isSection = slide.layout === "section";
    pptSlide.background = { color: isSection ? theme.accent : theme.background };
    const bodyColor = isSection ? theme.accentText : theme.text;
    const mutedColor = isSection ? theme.accentText : theme.muted;

    if (slide.layout === "title" || slide.layout === "closing") {
      pptSlide.addText(slide.title, {
        x: 0.6,
        y: 1.5,
        w: 8.8,
        h: 1.4,
        align: "center",
        fontSize: 40,
        bold: true,
        color: bodyColor,
      });
      if (slide.subtitle) {
        pptSlide.addText(slide.subtitle, {
          x: 0.6,
          y: 2.9,
          w: 8.8,
          h: 0.6,
          align: "center",
          fontSize: 18,
          color: mutedColor,
        });
      }
      pptSlide.addShape("rect", { x: 4.4, y: 3.6, w: 1.2, h: 0.06, fill: { color: theme.accent } });
      if (slide.bullets.length > 0) {
        pptSlide.addText(
          slide.bullets.map((bullet) => ({ text: bullet, options: { bullet: true } })),
          { x: 1.6, y: 3.9, w: 6.8, h: 1.3, fontSize: 14, color: mutedColor, align: "center" },
        );
      }
    } else if (slide.layout === "quote") {
      pptSlide.addShape("rect", { x: 0.6, y: 1.4, w: 0.08, h: 2.6, fill: { color: theme.accent } });
      pptSlide.addText(slide.title, {
        x: 1.0,
        y: 1.4,
        w: 8.2,
        h: 2.6,
        fontSize: 26,
        italic: true,
        color: bodyColor,
        valign: "middle",
      });
    } else {
      pptSlide.addText(slide.title, {
        x: 0.6,
        y: 0.5,
        w: 8.8,
        h: 0.9,
        fontSize: 30,
        bold: true,
        color: bodyColor,
      });
      pptSlide.addShape("rect", { x: 0.6, y: 1.42, w: 1.1, h: 0.06, fill: { color: theme.accent } });
      if (slide.subtitle) {
        pptSlide.addText(slide.subtitle, {
          x: 0.6,
          y: 1.55,
          w: 8.8,
          h: 0.4,
          fontSize: 14,
          color: mutedColor,
        });
      }
      if (slide.bullets.length > 0) {
        pptSlide.addText(
          slide.bullets.map((bullet) => ({
            text: bullet,
            options: { bullet: { code: "2022" }, breakLine: true },
          })),
          {
            x: 0.7,
            y: slide.subtitle ? 2.05 : 1.75,
            w: 8.6,
            h: 3.2,
            fontSize: 16,
            color: bodyColor,
            lineSpacingMultiple: 1.3,
            valign: "top",
          },
        );
      }
    }

    pptSlide.addText(`${slide.index} / ${slides.length}`, {
      x: 8.3,
      y: 5.05,
      w: 1.1,
      h: 0.3,
      fontSize: 10,
      color: mutedColor,
      align: "right",
    });

    pptSlide.addNotes(slide.notes);
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  await writeFile(path, buffer);
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function writeOut(root: string, relativePath: string, contents: string): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  return relativePath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const theme = THEMES[options.theme];

  let sourceText = options.brief ?? "";
  let sourceLabel = "brief";
  if (options.source) {
    const sourcePath = resolve(options.source);
    try {
      sourceText = await readFile(sourcePath, "utf8");
    } catch {
      throw new Error(`Unable to read source file: ${sourcePath}`);
    }
    sourceLabel = sourcePath;
  }

  if (!sourceText.trim()) {
    throw new Error("Source text is empty. Nothing to build a deck from.");
  }

  const looksLikeMarkdown = /^\s*#|^\s*[-*+]\s+|^\s*\d+\.\s+/m.test(sourceText);
  let deckTitle = options.title;
  let drafts: DraftSlide[];

  if (looksLikeMarkdown) {
    const parsed = await parseMarkdown(sourceText);
    deckTitle = deckTitle ?? parsed.deckTitle;
    drafts = parsed.drafts;
    if (drafts.length === 0) drafts = draftsFromBrief(sourceText);
  } else {
    drafts = draftsFromBrief(sourceText);
  }

  if (!deckTitle) {
    const firstLine = sourceText.split("\n").map((line) => stripInlineMarkdown(line)).find(Boolean) ?? "Slide Deck";
    deckTitle = titleCase(shorten(firstLine, 70));
  }

  if (drafts.length === 0) {
    throw new Error("Could not derive any slides from the source text.");
  }

  const slides = buildSlides(deckTitle, drafts, options);
  const outputRoot = resolve(options.output);
  const written: string[] = [];

  const slidesJson = {
    title: deckTitle,
    theme: theme.name,
    audience: options.audience,
    format: options.format,
    slideCount: slides.length,
    slides,
  };

  written.push(await writeOut(outputRoot, "slides.json", `${JSON.stringify(slidesJson, null, 2)}\n`));
  written.push(await writeOut(outputRoot, "deck.md", renderDeckMarkdown(deckTitle, slides, theme, options)));
  written.push(await writeOut(outputRoot, "speaker-notes.md", renderSpeakerNotes(deckTitle, slides, options)));
  written.push(await writeOut(outputRoot, "theme-guide.md", renderThemeGuide(theme, slides)));
  written.push(await writeOut(outputRoot, "deck.html", renderHtml(deckTitle, slides, theme, options)));

  let pptxError: string | undefined;
  if (!options.noPptx) {
    await mkdir(outputRoot, { recursive: true });
    try {
      await renderPptx(join(outputRoot, "deck.pptx"), deckTitle, slides, theme, options);
      written.push("deck.pptx");
    } catch (error) {
      pptxError = error instanceof Error ? error.message : String(error);
    }
  }

  const manifest = {
    skill: "slide-deck-generator",
    skillVersion: VERSION,
    generatedAt: new Date().toISOString(),
    title: deckTitle,
    source: options.source ? { type: "file", path: sourceLabel } : { type: "brief", chars: sourceText.length },
    theme: theme.name,
    audience: options.audience,
    format: options.format,
    slideCount: slides.length,
    layouts: slides.map((slide) => slide.layout),
    outputDir: outputRoot,
    files: [...written, "manifest.json"].sort(),
    pptx: options.noPptx ? "skipped" : pptxError ? `failed: ${pptxError}` : "ok",
  };

  written.push(await writeOut(outputRoot, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`));

  if (pptxError) {
    process.stderr.write(`slide-deck-generator: warning: deck.pptx was not written (${pptxError})\n`);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  console.log(
    [
      `slide-deck-generator v${VERSION}`,
      `  title      ${deckTitle}`,
      `  source     ${options.source ? basename(sourceLabel) : `brief (${sourceText.length} chars)`}`,
      `  theme      ${theme.label} (${theme.name})`,
      `  audience   ${options.audience} · format ${options.format}`,
      `  slides     ${slides.length}`,
      `  output     ${outputRoot}`,
      "",
      "Files:",
      ...manifest.files.map((file) => `  ${file}`),
      "",
      `Open the deck: ${join(outputRoot, "deck.html")} (← → to navigate, N for notes, Ctrl/Cmd-P to print)`,
    ].join("\n"),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`slide-deck-generator: ${message}\n`);
  process.exit(1);
});
