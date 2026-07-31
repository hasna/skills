import type { CliOptions, Layout, Slide } from "./types.js";
import { chunk, headlineFrom, shorten, splitSentences, stripInlineMarkdown, titleCase } from "./utils.js";

async function loadMarked() {
  try {
    return (await import("marked")).marked;
  } catch {
    throw new Error("Missing dependency 'marked'. Run bun install in this skill directory.");
  }
}


export interface DraftSlide {
  layout: Layout;
  title: string;
  subtitle?: string;
  bullets: string[];
  notes: string[];
}

export async function parseMarkdown(source: string): Promise<{ deckTitle?: string; drafts: DraftSlide[] }> {
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

export function draftsFromBrief(brief: string): DraftSlide[] {
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

export function buildSlides(
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


