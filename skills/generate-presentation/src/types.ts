export interface SkillOptions {
  input: string;
  isFile: boolean;
  slides: number;
  style: "business" | "educational" | "pitch-deck" | "technical" | "minimal";
  format: "markdown" | "html" | "pdf";
  includeNotes: boolean;
  template: "default" | "modern" | "dark" | "minimal" | "corporate";
  aiProvider: "openai" | "anthropic";
  output: string;
  language: string;
}

export interface SlideContent {
  number: number;
  title: string;
  content: string[];
  notes?: string;
  type: "title" | "agenda" | "content" | "summary" | "qa";
}

export interface PresentationStructure {
  title: string;
  subtitle?: string;
  author: string;
  date: string;
  slides: SlideContent[];
}
