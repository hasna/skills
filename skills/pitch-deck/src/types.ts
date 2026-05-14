export type Audience = "investors" | "sales" | "internal";
export type Tone = "concise" | "bold" | "technical";

export interface DeckOptions {
  brief: string;
  company: string;
  audience: Audience;
  slideCount: number;
  tone: Tone;
  outputDir: string;
}

export interface Slide {
  number: number;
  title: string;
  subtitle: string;
  bullets: string[];
  speakerNotes: string;
  visualDirection: string;
}

export interface ZipEntry {
  path: string;
  data: Buffer;
}
