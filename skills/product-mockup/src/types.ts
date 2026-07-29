export type Scene = "browser" | "device" | "dashboard";
export type DeviceKind = "auto" | "phone" | "laptop";

export interface CliOptions {
  product?: string;
  title?: string;
  scene: Scene;
  device: DeviceKind;
  variants: number;
  style: string;
  audience: string;
  accent?: string;
  url: string;
  output: string;
  json: boolean;
}

export interface Tokens {
  name: string;
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  radius: number;
  dark: boolean;
}

export interface VariantPlan {
  id: string;
  index: number;
  seed: number;
  scene: Scene;
  device?: "phone" | "laptop";
  width: number;
  height: number;
  file: string;
  tokens: Tokens;
  layers: string[];
  notes: string;
}

/* ------------------------------------------------------------------ */
/* deterministic randomness                                            */
/* ------------------------------------------------------------------ */

export interface SceneInput {
  title: string;
  product: string;
  url: string;
  tokens: Tokens;
  rng: () => number;
  index: number;
}

export interface SceneOutput {
  width: number;
  height: number;
  body: string;
  layers: string[];
  notes: string;
}

