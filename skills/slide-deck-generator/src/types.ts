export type Layout = "title" | "agenda" | "bullets" | "section" | "quote" | "closing";

export interface Slide {
  index: number;
  layout: Layout;
  title: string;
  subtitle?: string;
  bullets: string[];
  notes: string;
}

export interface Theme {
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

export interface CliOptions {
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

export const THEMES: Record<string, Theme> = {
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

export const AUDIENCES = ["team", "customers", "executives", "students"];
export const FORMATS = ["general", "training", "sales", "report", "proposal"];


