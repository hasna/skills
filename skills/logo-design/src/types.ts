export interface CliOptions {
  brief?: string;
  brand: string;
  style: string;
  palette: string;
  variations: number;
  output: string;
  png: boolean;
  pngSize: number;
  background: boolean;
  json: boolean;
}

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  requested: string[];
  resolved: Array<{ token: string; hex: string; origin: "named" | "hex" | "derived" }>;
}

export interface Concept {
  id: string;
  index: number;
  seed: number;
  geometry: string;
  description: string;
  markFile: string;
  lockupFile: string;
  pngFile?: string;
  palette: { primary: string; secondary: string; accent: string; background: string };
  rationale: string;
}

/* ------------------------------------------------------------------ */
/* deterministic randomness                                            */
/* ------------------------------------------------------------------ */

export interface GeometryContext {
  rng: () => number;
  palette: Palette;
  brand: string;
}

export interface Geometry {
  name: string;
  build: (ctx: GeometryContext) => { body: string; description: string };
}

