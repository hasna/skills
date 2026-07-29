import type { Palette } from "./types.js";

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

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

export function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ------------------------------------------------------------------ */
/* color                                                               */
/* ------------------------------------------------------------------ */

const NAMED_COLORS: Record<string, string> = {
  amber: "#D98324",
  black: "#0B0B0F",
  bone: "#F3EFE7",
  charcoal: "#22262B",
  coral: "#E4644B",
  cream: "#FBF7EF",
  crimson: "#B3243C",
  emerald: "#1F8A5B",
  forest: "#1E4634",
  gold: "#C9A227",
  graphite: "#3A3F44",
  indigo: "#3A3D98",
  ink: "#101418",
  ivory: "#FDFCF7",
  lavender: "#8E86C9",
  lime: "#7FB800",
  magenta: "#B5177E",
  mint: "#4FBF9F",
  navy: "#1B2A4A",
  ocean: "#12566B",
  olive: "#6B7233",
  orange: "#E2761B",
  plum: "#63305C",
  purple: "#5B2A86",
  red: "#C0392B",
  rose: "#D96A8A",
  rust: "#9C4221",
  sand: "#DDCBA4",
  sky: "#2E86C1",
  slate: "#4A5568",
  steel: "#5B6C7F",
  teal: "#0F7B7B",
  violet: "#6C4AB6",
  white: "#FFFFFF",
};

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

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function hueOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
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

function resolveColorToken(token: string, seed: number, index: number): Palette["resolved"][number] {
  const trimmed = token.trim();
  const asHex = normalizeHex(trimmed);
  if (asHex) return { token: trimmed, hex: asHex, origin: "hex" };
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named) return { token: trimmed, hex: named, origin: "named" };
  const localSeed = fnv1a(`${seed}:${trimmed.toLowerCase()}:${index}`);
  const hue = localSeed % 360;
  const sat = 0.52 + ((localSeed >>> 9) % 26) / 100;
  const light = 0.38 + ((localSeed >>> 17) % 22) / 100;
  return { token: trimmed, hex: hslToHex(hue, sat, light), origin: "derived" };
}

export function buildPalette(tokens: string[], seed: number): Palette {
  const resolved = tokens.map((token, index) => resolveColorToken(token, seed, index));
  const byLuminance = [...resolved].sort((a, b) => relativeLuminance(a.hex) - relativeLuminance(b.hex));
  const darkest = byLuminance[0].hex;
  const lightest = byLuminance[byLuminance.length - 1].hex;

  const background = relativeLuminance(lightest) > 0.7 ? lightest : "#FFFFFF";
  const primary = darkest;

  const accentCandidates = resolved
    .filter((entry) => entry.hex !== primary && entry.hex !== background)
    .sort((a, b) => chroma(b.hex) - chroma(a.hex));
  const accent =
    accentCandidates.length > 0 && chroma(accentCandidates[0].hex) > 0.12
      ? accentCandidates[0].hex
      : hslToHex(hueOf(primary) + 152, 0.62, 0.54);

  const secondaryCandidates = resolved
    .map((entry) => entry.hex)
    .filter((hex) => hex !== primary && hex !== background && hex !== accent);
  const secondary = secondaryCandidates[0] ?? hslToHex(hueOf(primary), 0.24, 0.42);

  return {
    primary,
    secondary,
    accent,
    background,
    requested: tokens,
    resolved,
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

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function polygonPoints(cx: number, cy: number, radius: number, sides: number, rotation: number): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    points.push(`${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`);
  }
  return points.join(" ");
}

export function initialsOf(brand: string): string {
  const words = brand
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return "A";
  if (words.length === 1) {
    const word = words[0];
    return (word.length > 1 ? word.slice(0, 2) : word).toUpperCase();
  }
  return words.map((word) => word[0]).join("").toUpperCase();
}

/* ------------------------------------------------------------------ */
/* geometry generators                                                 */
/* ------------------------------------------------------------------ */


