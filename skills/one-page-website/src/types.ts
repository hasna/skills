export type SectionKind = "hero" | "features" | "proof" | "pricing" | "faq" | "cta" | "custom";

export interface WebsiteOptions {
  brief: string;
  name: string;
  audience: string;
  goal: string;
  style: string;
  proof: string;
  sections: string[];
  outputDir: string;
}

export interface WebsiteSection {
  id: string;
  kind: SectionKind;
  eyebrow: string;
  headline: string;
  body: string;
  bullets: string[];
  primaryCta: string;
}

export interface Palette {
  ink: string;
  paper: string;
  accent: string;
  support: string;
  line: string;
}

export interface WebsiteFiles {
  html: string;
  css: string;
  script: string;
  readme: string;
  copy: string;
  sectionMap: string;
  deployNotes: string;
  manifest: string;
}
