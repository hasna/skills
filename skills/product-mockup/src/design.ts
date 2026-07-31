import type { Tokens } from "./types.js";

export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
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
/* color + style tokens                                                */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hslToHex(h: number, s: number, l: number): string {
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

export interface StylePreset {
  name: string;
  dark: boolean;
  hue: number;
  radius: number;
  keywords: string[];
}

const STYLE_PRESETS: StylePreset[] = [
  { name: "noir", dark: true, hue: 258, radius: 14, keywords: ["dark", "noir", "midnight", "night", "black"] },
  { name: "warm", dark: false, hue: 24, radius: 18, keywords: ["warm", "sunset", "amber", "friendly", "human"] },
  { name: "editorial", dark: false, hue: 8, radius: 4, keywords: ["editorial", "sharp", "print", "serif", "magazine"] },
  { name: "technical", dark: true, hue: 168, radius: 6, keywords: ["technical", "terminal", "developer", "mono", "engineering"] },
  { name: "vivid", dark: false, hue: 292, radius: 22, keywords: ["vivid", "bold", "playful", "loud", "energetic"] },
  { name: "polished", dark: false, hue: 222, radius: 12, keywords: ["polished", "quiet", "refined", "saas", "crisp", "restrained", "clean"] },
];

export function selectPreset(style: string): StylePreset {
  const lower = style.toLowerCase();
  for (const preset of STYLE_PRESETS) {
    if (preset.keywords.some((keyword) => lower.includes(keyword))) return preset;
  }
  return STYLE_PRESETS[STYLE_PRESETS.length - 1];
}

export function buildTokens(preset: StylePreset, variantIndex: number, accentOverride?: string): Tokens {
  const hue = (preset.hue + variantIndex * 26) % 360;
  const accent = accentOverride ?? hslToHex(hue, preset.dark ? 0.66 : 0.62, preset.dark ? 0.6 : 0.48);
  const accentSoft = hslToHex(hue, preset.dark ? 0.4 : 0.62, preset.dark ? 0.24 : 0.92);

  if (preset.dark) {
    return {
      name: preset.name,
      background: hslToHex(hue, 0.14, 0.09),
      surface: hslToHex(hue, 0.12, 0.14),
      surfaceAlt: hslToHex(hue, 0.11, 0.19),
      border: hslToHex(hue, 0.1, 0.27),
      text: "#F2F4F8",
      muted: hslToHex(hue, 0.08, 0.62),
      accent,
      accentSoft,
      radius: preset.radius,
      dark: true,
    };
  }

  return {
    name: preset.name,
    background: hslToHex(hue, 0.28, 0.965),
    surface: "#FFFFFF",
    surfaceAlt: hslToHex(hue, 0.3, 0.975),
    border: hslToHex(hue, 0.18, 0.87),
    text: hslToHex(hue, 0.24, 0.14),
    muted: hslToHex(hue, 0.1, 0.46),
    accent,
    accentSoft,
    radius: preset.radius,
    dark: false,
  };
}

/* ------------------------------------------------------------------ */
/* svg helpers                                                         */
/* ------------------------------------------------------------------ */

export function xmlEscape(value: string): string {
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
        return "&apos;";
    }
  });
}

export const FONT_STACK =
  "'Inter','Helvetica Neue',Helvetica,'Segoe UI',Arial,'DejaVu Sans',sans-serif";
export const MONO_STACK = "'JetBrains Mono','SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace";
