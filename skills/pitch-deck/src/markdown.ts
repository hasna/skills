import type { DeckOptions, Slide } from "./types";
import { tonePhrase } from "./utils";

export function buildDeckMarkdown(options: DeckOptions, slides: Slide[]): string {
  return `# ${options.company} Pitch Deck

Audience: ${options.audience}

Brief: ${options.brief}

${slides.map((slide) => `## ${slide.number}. ${slide.title}

${slide.subtitle}

${slide.bullets.map((bullet) => `- ${bullet}`).join("\n")}

Visual direction: ${slide.visualDirection}
`).join("\n")}
`;
}

export function buildSpeakerNotes(options: DeckOptions, slides: Slide[]): string {
  return `# Speaker Notes

Company: ${options.company}

${slides.map((slide) => `## Slide ${slide.number}: ${slide.title}

${slide.speakerNotes}
`).join("\n")}
`;
}

export function buildDesignDirection(options: DeckOptions, slides: Slide[]): string {
  return `# Design Direction

## Deck Style

- Tone: ${tonePhrase(options.tone)}
- Audience: ${options.audience}
- Layout: sharp title slides, dense but readable body slides, visual proof where available
- Color: high-contrast neutral base with one confident accent color
- Typography: large slide titles, compact bullets, clear speaker-note separation

## Slide Visuals

${slides.map((slide) => `- Slide ${slide.number}, ${slide.title}: ${slide.visualDirection}`).join("\n")}
`;
}
