#!/usr/bin/env bun

import { mkdir, writeFile, stat } from "fs/promises";
import { join, resolve, relative } from "path";

const VERSION = "0.1.0";
const CANVAS = 256;
const MARGIN = 32;
const SAFE = CANVAS - MARGIN * 2;

interface CliOptions {
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

interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  requested: string[];
  resolved: Array<{ token: string; hex: string; origin: "named" | "hex" | "derived" }>;
}

interface Concept {
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

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
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

function normalizeHex(token: string): string | null {
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

function buildPalette(tokens: string[], seed: number): Palette {
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

function xmlEscape(value: string): string {
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

const FONT_STACK =
  "'Inter','Helvetica Neue',Helvetica,'Segoe UI',Arial,'DejaVu Sans',sans-serif";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function polygonPoints(cx: number, cy: number, radius: number, sides: number, rotation: number): string {
  const points: string[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    points.push(`${round(cx + radius * Math.cos(angle))},${round(cy + radius * Math.sin(angle))}`);
  }
  return points.join(" ");
}

function initialsOf(brand: string): string {
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

interface GeometryContext {
  rng: () => number;
  palette: Palette;
  brand: string;
}

interface Geometry {
  name: string;
  build: (ctx: GeometryContext) => { body: string; description: string };
}

const CONTAINERS = ["circle", "squircle", "hexagon", "shield"] as const;

function containerShape(kind: (typeof CONTAINERS)[number], fill: string): string {
  const cx = CANVAS / 2;
  switch (kind) {
    case "circle":
      return `  <circle id="container" cx="${cx}" cy="${cx}" r="${SAFE / 2}" fill="${fill}"/>`;
    case "squircle":
      return `  <rect id="container" x="${MARGIN}" y="${MARGIN}" width="${SAFE}" height="${SAFE}" rx="${round(
        SAFE * 0.26,
      )}" fill="${fill}"/>`;
    case "hexagon":
      return `  <polygon id="container" points="${polygonPoints(cx, cx, SAFE / 2, 6, -Math.PI / 2)}" fill="${fill}"/>`;
    default:
      return `  <path id="container" d="M ${cx} ${MARGIN} L ${CANVAS - MARGIN} ${MARGIN + 26} L ${
        CANVAS - MARGIN
      } ${cx + 18} Q ${CANVAS - MARGIN} ${CANVAS - MARGIN} ${cx} ${CANVAS - MARGIN} Q ${MARGIN} ${
        CANVAS - MARGIN
      } ${MARGIN} ${cx + 18} L ${MARGIN} ${MARGIN + 26} Z" fill="${fill}"/>`;
  }
}

const GEOMETRIES: Geometry[] = [
  {
    name: "monogram",
    build: ({ rng, palette, brand }) => {
      const container = pick(rng, CONTAINERS);
      const initials = initialsOf(brand);
      const fontSize = initials.length > 1 ? 92 : 118;
      const barY = CANVAS - MARGIN - 14;
      return {
        description: `Brand initials "${initials}" knocked out of a solid ${container} container with an accent underline.`,
        body: [
          containerShape(container, palette.primary),
          `  <text id="monogram" x="${CANVAS / 2}" y="${CANVAS / 2 + 2}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700" letter-spacing="-2" fill="${palette.background}">${xmlEscape(
            initials,
          )}</text>`,
          `  <rect id="accent-bar" x="${CANVAS / 2 - 26}" y="${barY}" width="52" height="8" rx="4" fill="${palette.accent}"/>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "glyph-grid",
    build: ({ rng, palette }) => {
      const cells = rng() > 0.5 ? 4 : 3;
      const gap = 10;
      const size = (SAFE - gap * (cells - 1)) / cells;
      const parts: string[] = [];
      const half = Math.ceil(cells / 2);
      const plan: string[][] = [];
      for (let row = 0; row < cells; row += 1) {
        const rowPlan: string[] = [];
        for (let col = 0; col < half; col += 1) {
          const roll = rng();
          rowPlan.push(roll < 0.22 ? "none" : roll < 0.52 ? "square" : roll < 0.8 ? "circle" : "triangle");
        }
        for (let col = 0; col < cells; col += 1) {
          rowPlan[col] = rowPlan[col] ?? rowPlan[cells - 1 - col];
        }
        plan.push(rowPlan);
      }
      let filled = 0;
      for (let row = 0; row < cells; row += 1) {
        for (let col = 0; col < cells; col += 1) {
          const shape = plan[row][col];
          if (shape === "none") continue;
          filled += 1;
          const x = MARGIN + col * (size + gap);
          const y = MARGIN + row * (size + gap);
          const fill = (row + col) % 2 === 0 ? palette.primary : palette.accent;
          if (shape === "square") {
            parts.push(
              `  <rect x="${round(x)}" y="${round(y)}" width="${round(size)}" height="${round(size)}" rx="${round(
                size * 0.22,
              )}" fill="${fill}"/>`,
            );
          } else if (shape === "circle") {
            parts.push(
              `  <circle cx="${round(x + size / 2)}" cy="${round(y + size / 2)}" r="${round(size / 2)}" fill="${fill}"/>`,
            );
          } else {
            parts.push(
              `  <polygon points="${round(x + size / 2)},${round(y)} ${round(x + size)},${round(
                y + size,
              )} ${round(x)},${round(y + size)}" fill="${fill}"/>`,
            );
          }
        }
      }
      return {
        description: `${cells}x${cells} modular glyph grid, mirrored across the vertical axis, ${filled} active cells alternating primary and accent.`,
        body: `  <g id="glyph-grid">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
  {
    name: "orbit",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const ringWidth = 14 + Math.floor(rng() * 8);
      const outer = SAFE / 2 - ringWidth / 2;
      const gapDegrees = 40 + Math.floor(rng() * 50);
      const circumference = 2 * Math.PI * outer;
      const dash = circumference * (1 - gapDegrees / 360);
      const rotation = Math.floor(rng() * 360);
      const dotAngle = ((rotation - 90 + gapDegrees / 2) * Math.PI) / 180;
      return {
        description: `Open orbital ring with a ${gapDegrees} degree aperture, a solid accent core, and a satellite dot on the ring path.`,
        body: [
          `  <g id="orbit" transform="rotate(${rotation} ${cx} ${cx})">`,
          `    <circle cx="${cx}" cy="${cx}" r="${round(outer)}" fill="none" stroke="${palette.primary}" stroke-width="${ringWidth}" stroke-linecap="round" stroke-dasharray="${round(
            dash,
          )} ${round(circumference - dash)}"/>`,
          `  </g>`,
          `  <circle id="core" cx="${cx}" cy="${cx}" r="${round(outer * 0.42)}" fill="${palette.accent}"/>`,
          `  <circle id="satellite" cx="${round(cx + outer * Math.cos(dotAngle))}" cy="${round(
            cx + outer * Math.sin(dotAngle),
          )}" r="${round(ringWidth * 0.62)}" fill="${palette.secondary}"/>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "chevron-stack",
    build: ({ rng, palette }) => {
      const layers = 3 + Math.floor(rng() * 2);
      const thickness = 16 + Math.floor(rng() * 6);
      const spacing = SAFE / (layers + 1);
      const parts: string[] = [];
      for (let i = 0; i < layers; i += 1) {
        const y = MARGIN + spacing * (i + 0.5);
        const inset = i * 10;
        const fill = i % 2 === 0 ? palette.primary : palette.accent;
        parts.push(
          `    <polyline points="${round(MARGIN + inset)},${round(y)} ${CANVAS / 2},${round(
            y + spacing * 0.58,
          )} ${round(CANVAS - MARGIN - inset)},${round(y)}" fill="none" stroke="${fill}" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
      }
      return {
        description: `${layers} nested chevrons with ${thickness}px strokes reading as forward motion or an upward stack.`,
        body: `  <g id="chevron-stack">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
  {
    name: "prism",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const radius = SAFE / 2;
      const rotationA = Math.floor(rng() * 60);
      const rotationB = rotationA + 120 + Math.floor(rng() * 60);
      return {
        description: `Two overlapping equilateral triangles rotated ${rotationA} and ${rotationB} degrees, forming a translucent prism intersection.`,
        body: [
          `  <g id="prism">`,
          `    <polygon points="${polygonPoints(cx, cx, radius, 3, -Math.PI / 2)}" fill="${palette.primary}" transform="rotate(${rotationA} ${cx} ${cx})"/>`,
          `    <polygon points="${polygonPoints(cx, cx, radius, 3, -Math.PI / 2)}" fill="${palette.accent}" fill-opacity="0.78" transform="rotate(${rotationB} ${cx} ${cx})"/>`,
          `  </g>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "aperture",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const blades = 5 + Math.floor(rng() * 3);
      const inner = SAFE * 0.16;
      const outer = SAFE / 2;
      const parts: string[] = [];
      for (let i = 0; i < blades; i += 1) {
        const angle = (360 / blades) * i;
        const fill = i % 2 === 0 ? palette.primary : palette.accent;
        parts.push(
          `    <path d="M ${round(cx)} ${round(cx - inner)} L ${round(cx + outer * 0.62)} ${round(
            cx - outer * 0.78,
          )} A ${round(outer)} ${round(outer)} 0 0 1 ${round(cx + outer * 0.95)} ${round(cx - outer * 0.2)} Z" fill="${fill}" transform="rotate(${round(
            angle,
          )} ${cx} ${cx})"/>`,
        );
      }
      return {
        description: `${blades}-blade aperture rotating around a hollow center, alternating primary and accent fills.`,
        body: [
          `  <g id="aperture">`,
          ...parts,
          `    <circle cx="${cx}" cy="${cx}" r="${round(inner * 0.9)}" fill="${palette.secondary}"/>`,
          `  </g>`,
        ].join("\n"),
      };
    },
  },
  {
    name: "layer-stack",
    build: ({ rng, palette }) => {
      const layers = 3;
      const height = 34 + Math.floor(rng() * 10);
      const skew = 18 + Math.floor(rng() * 14);
      const parts: string[] = [];
      for (let i = 0; i < layers; i += 1) {
        const y = MARGIN + 18 + i * (height + 12);
        const fill = i === 1 ? palette.accent : palette.primary;
        const opacity = i === 2 ? "0.72" : "1";
        parts.push(
          `    <polygon points="${round(MARGIN + skew)},${round(y)} ${round(CANVAS - MARGIN)},${round(
            y,
          )} ${round(CANVAS - MARGIN - skew)},${round(y + height)} ${MARGIN},${round(y + height)}" fill="${fill}" fill-opacity="${opacity}"/>`,
        );
      }
      return {
        description: `Three offset parallelogram layers with a ${skew}px shear, reading as stacked planes or data layers.`,
        body: `  <g id="layer-stack">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
  {
    name: "arc-mark",
    build: ({ rng, palette }) => {
      const cx = CANVAS / 2;
      const strokes = 2 + Math.floor(rng() * 2);
      const width = 18 + Math.floor(rng() * 8);
      const parts: string[] = [];
      for (let i = 0; i < strokes; i += 1) {
        const radius = SAFE / 2 - i * (width + 10);
        if (radius < width) break;
        const sweep = i % 2 === 0 ? 1 : 0;
        const fill = i % 2 === 0 ? palette.primary : palette.accent;
        parts.push(
          `    <path d="M ${round(cx - radius)} ${cx} A ${round(radius)} ${round(radius)} 0 0 ${sweep} ${round(
            cx + radius,
          )} ${cx}" fill="none" stroke="${fill}" stroke-width="${width}" stroke-linecap="round"/>`,
        );
      }
      return {
        description: `${parts.length} alternating half-arcs of ${width}px weight forming a rising, balanced mark.`,
        body: `  <g id="arc-mark">\n${parts.join("\n")}\n  </g>`,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* document assembly                                                   */
/* ------------------------------------------------------------------ */

function svgDocument(options: {
  width: number;
  height: number;
  title: string;
  description: string;
  background?: string;
  body: string;
}): string {
  const backdrop = options.background
    ? `  <rect id="backdrop" width="${options.width}" height="${options.height}" fill="${options.background}"/>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.width} ${options.height}" width="${options.width}" height="${options.height}" role="img" aria-labelledby="title desc">
  <title id="title">${xmlEscape(options.title)}</title>
  <desc id="desc">${xmlEscape(options.description)}</desc>
${backdrop}${options.body}
</svg>
`;
}

function buildLockup(options: {
  brand: string;
  tagline: string;
  markBody: string;
  palette: Palette;
  background: boolean;
}): string {
  const width = 720;
  const height = 200;
  const scale = 0.55;
  const markSize = CANVAS * scale;
  const markX = 40;
  const markY = (height - markSize) / 2;
  const textX = markX + markSize + 36;
  const brandSize = 60;
  const hasTagline = options.tagline.trim().length > 0;
  const brandY = hasTagline ? height / 2 - 10 : height / 2;

  const body = [
    `  <g id="mark" transform="translate(${markX} ${round(markY)}) scale(${scale})">`,
    options.markBody
      .split("\n")
      .map((line) => (line ? `  ${line}` : line))
      .join("\n"),
    `  </g>`,
    `  <text id="wordmark" x="${textX}" y="${round(brandY)}" dominant-baseline="central" font-family="${FONT_STACK}" font-size="${brandSize}" font-weight="700" letter-spacing="-1.5" fill="${options.palette.primary}">${xmlEscape(
      options.brand,
    )}</text>`,
  ];

  if (hasTagline) {
    body.push(
      `  <text id="tagline" x="${textX}" y="${round(height / 2 + 40)}" dominant-baseline="central" font-family="${FONT_STACK}" font-size="22" font-weight="500" letter-spacing="0.5" fill="${options.palette.secondary}">${xmlEscape(
        options.tagline,
      )}</text>`,
    );
  }

  return svgDocument({
    width,
    height,
    title: `${options.brand} horizontal lockup`,
    description: `Horizontal lockup pairing the ${options.brand} mark with the wordmark.`,
    background: options.background ? options.palette.background : undefined,
    body: body.join("\n"),
  });
}

/* ------------------------------------------------------------------ */
/* cli                                                                 */
/* ------------------------------------------------------------------ */

function printHelp(): void {
  console.log(`logo-design v${VERSION}

Generate deterministic geometric logo marks as SVG. No network access and no
API keys: every mark is composed locally from a hash of your brief, so the same
inputs always produce the same output.

USAGE:
  logo-design --brief <text> [options]
  logo-design "<brief text>" [options]

OPTIONS:
  -b, --brief <text>        Logo brief (positional text also works)   [required]
      --brand <name>        Brand or product name                     [Brand]
      --style <text>        Style direction, recorded in the brief    [clean geometric mark]
      --palette <list>      Comma-separated colors: names or hex      [navy,white,accent]
  -n, --variations <1-6>    Number of concepts to generate            [3]
  -o, --output <dir>        Output directory                          [./logo-design]
      --background          Draw a solid backdrop rect in each SVG    [off, transparent]
      --png                 Also rasterize PNGs (requires sharp)      [off]
      --png-size <px>       PNG width/height when --png is used       [512]
      --json                Print the run summary as JSON
      --help                Show this help message
      --version             Show the current version

OUTPUTS:
  vector/logo-NN.svg        Standalone mark, 256x256 viewBox
  vector/logo-NN-lockup.svg Horizontal mark + wordmark lockup
  png/logo-NN.png           Optional raster export (--png)
  concepts.json             Per-variant seed, geometry, palette, rationale
  logo-brief.md             The brief as interpreted by this run
  usage-notes.md            Clear space, minimum sizes, do / don't
  manifest.json             Every file written, with byte sizes

EXAMPLES:
  logo-design --brief "minimal geometric owl mark for a developer tool" --brand Acme
  logo-design "vintage badge for a coffee roaster" --palette "#2B1B12,cream,rust" -n 4
  logo-design --brief "ledger app" --brand Ledgerly --png --png-size 1024
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    brand: "Brand",
    style: "clean geometric mark",
    palette: "navy,white,accent",
    variations: 3,
    output: "./logo-design",
    png: false,
    pngSize: 512,
    background: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--version":
      case "-v":
        console.log(VERSION);
        process.exit(0);
      case "--brief":
      case "-b":
        options.brief = argv[++i];
        break;
      case "--brand":
        options.brand = argv[++i] ?? options.brand;
        break;
      case "--style":
        options.style = argv[++i] ?? options.style;
        break;
      case "--palette":
        options.palette = argv[++i] ?? options.palette;
        break;
      case "--variations":
      case "-n": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1 || value > 6) {
          throw new Error(`Invalid --variations value: ${argv[i]} (expected 1-6)`);
        }
        options.variations = value;
        break;
      }
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--background":
        options.background = true;
        break;
      case "--png":
        options.png = true;
        break;
      case "--png-size": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 16 || value > 4096) {
          throw new Error(`Invalid --png-size value: ${argv[i]} (expected 16-4096)`);
        }
        options.pngSize = value;
        break;
      }
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.brief) {
          options.brief = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.brief || options.brief.trim() === "") {
    throw new Error("Missing required --brief <text> argument (a positional brief also works)");
  }

  return options;
}

async function loadSharp(): Promise<unknown | null> {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

interface WrittenFile {
  path: string;
  type: string;
  bytes: number;
}

async function writeOutput(
  outDir: string,
  relPath: string,
  contents: string,
  type: string,
  files: WrittenFile[],
): Promise<void> {
  const target = join(outDir, relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
  files.push({ path: relPath, type, bytes: Buffer.byteLength(contents, "utf8") });
}

function usageNotes(brand: string, palette: Palette, concepts: Concept[]): string {
  return `# ${brand} logo usage notes

Generated by the \`logo-design\` skill. Every mark in this package is a plain SVG
you can open in Figma, Illustrator, Inkscape, or any browser.

## Clear space

Reserve clear space equal to **25% of the mark height** (64 units on the 256 unit
artboard) on all four sides. Nothing — type, rules, photography, other logos —
enters that zone.

## Minimum sizes

| Context | Minimum width | Which file |
|---------|---------------|------------|
| Favicon / app icon | 16 px | \`vector/logo-01.svg\` (mark only) |
| UI chrome, avatars | 24 px | mark only |
| Print, business card | 12 mm | mark only |
| Horizontal lockup | 120 px | \`vector/logo-01-lockup.svg\` |

Below 120 px the wordmark in the lockup stops being legible. Drop to the mark.

## Color

| Role | Hex |
|------|-----|
| Primary | \`${palette.primary}\` |
| Secondary | \`${palette.secondary}\` |
| Accent | \`${palette.accent}\` |
| Background | \`${palette.background}\` |

The SVGs ship with a transparent background by default. Re-run with
\`--background\` if you need a baked-in backdrop rect.

## Do

- Use the supplied SVG. It scales losslessly and stays crisp on any display.
- Keep the mark on backgrounds that hold a contrast ratio of at least 3:1
  against \`${palette.primary}\`.
- Scale the whole group proportionally.

## Don't

- Don't recolor individual shapes ad hoc — swap the palette and regenerate.
- Don't rotate, skew, or add drop shadows, bevels, or outlines.
- Don't reflow the lockup: the mark stays left of the wordmark at the supplied
  spacing.
- Don't place the mark over busy photography without a solid or scrimmed plate.

## Concepts in this package

${concepts
  .map((concept) => `- **${concept.id}** (\`${concept.geometry}\`, seed \`${concept.seed}\`) — ${concept.description}`)
  .join("\n")}
`;
}

function briefDoc(options: CliOptions, palette: Palette, seed: number, concepts: Concept[]): string {
  return `# Logo brief — ${options.brand}

- **Brief**: ${options.brief}
- **Brand**: ${options.brand}
- **Style direction**: ${options.style}
- **Palette request**: ${palette.requested.join(", ")}
- **Master seed**: \`${seed}\` (derived from brief + brand + style + palette)
- **Variations**: ${options.variations}

## Resolved palette

| Token | Hex | Origin |
|-------|-----|--------|
${palette.resolved.map((entry) => `| ${entry.token} | \`${entry.hex}\` | ${entry.origin} |`).join("\n")}

Roles: primary \`${palette.primary}\`, secondary \`${palette.secondary}\`, accent \`${palette.accent}\`, background \`${palette.background}\`.

## Concepts

${concepts
  .map(
    (concept) => `### ${concept.id} — ${concept.geometry}

${concept.description}

- Seed: \`${concept.seed}\`
- Mark: \`${concept.markFile}\`
- Lockup: \`${concept.lockupFile}\`
- Rationale: ${concept.rationale}`,
  )
  .join("\n\n")}

## Reproducibility

This package is deterministic. Running the same command with the same
\`--brief\`, \`--brand\`, \`--style\`, and \`--palette\` regenerates byte-identical
SVGs. Change any one of them to explore a different direction.
`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const brief = options.brief!.trim();
  const outDir = resolve(options.output);

  const seedInput = `${brief}|${options.brand}|${options.style}|${options.palette}`;
  const masterSeed = fnv1a(seedInput);
  const palette = buildPalette(
    options.palette
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean),
    masterSeed,
  );

  const selectorRng = mulberry32(masterSeed);
  const order = shuffle(selectorRng, GEOMETRIES);

  const files: WrittenFile[] = [];
  const concepts: Concept[] = [];
  const markBodies: string[] = [];

  for (let i = 0; i < options.variations; i += 1) {
    const index = i + 1;
    const id = `logo-${String(index).padStart(2, "0")}`;
    const geometry = order[i % order.length];
    const seed = fnv1a(`${seedInput}|${index}|${geometry.name}`);
    const rng = mulberry32(seed);
    const { body, description } = geometry.build({ rng, palette, brand: options.brand });
    markBodies.push(body);

    const markFile = `vector/${id}.svg`;
    const lockupFile = `vector/${id}-lockup.svg`;

    const markSvg = svgDocument({
      width: CANVAS,
      height: CANVAS,
      title: `${options.brand} logo mark ${index}`,
      description,
      background: options.background ? palette.background : undefined,
      body,
    });

    const lockupSvg = buildLockup({
      brand: options.brand,
      tagline: options.style,
      markBody: body,
      palette,
      background: options.background,
    });

    await writeOutput(outDir, markFile, markSvg, "image/svg+xml", files);
    await writeOutput(outDir, lockupFile, lockupSvg, "image/svg+xml", files);

    concepts.push({
      id,
      index,
      seed,
      geometry: geometry.name,
      description,
      markFile,
      lockupFile,
      palette: {
        primary: palette.primary,
        secondary: palette.secondary,
        accent: palette.accent,
        background: palette.background,
      },
      rationale: `Seeded from "${brief}" with the ${geometry.name} construction; reproducible from seed ${seed}.`,
    });
  }

  let pngNote = "PNG export skipped (--png not set).";
  if (options.png) {
    const sharp = (await loadSharp()) as
      | ((input: Buffer) => { png(): { toFile(path: string): Promise<unknown> }; resize(w: number, h: number): unknown })
      | null;
    if (!sharp) {
      pngNote =
        "PNG export skipped: optional dependency 'sharp' is not installed. Run `bun add sharp` in this skill directory to enable --png. All SVG outputs were written normally.";
      console.error(`logo-design: ${pngNote}`);
    } else {
      await mkdir(join(outDir, "png"), { recursive: true });
      for (const concept of concepts) {
        const svg = svgDocument({
          width: CANVAS,
          height: CANVAS,
          title: `${options.brand} logo mark ${concept.index}`,
          description: concept.description,
          background: options.background ? palette.background : undefined,
          body: markBodies[concept.index - 1],
        });
        const pngPath = `png/${concept.id}.png`;
        const target = join(outDir, pngPath);
        const pipeline = sharp(Buffer.from(svg)) as unknown as {
          resize(width: number, height: number): { png(): { toFile(path: string): Promise<unknown> } };
        };
        await pipeline.resize(options.pngSize, options.pngSize).png().toFile(target);
        const info = await stat(target);
        files.push({ path: pngPath, type: "image/png", bytes: info.size });
        concept.pngFile = pngPath;
      }
      pngNote = `Rasterized ${concepts.length} PNG(s) at ${options.pngSize}x${options.pngSize} via sharp.`;
    }
  }

  await writeOutput(
    outDir,
    "concepts.json",
    `${JSON.stringify(
      {
        brief,
        brand: options.brand,
        style: options.style,
        masterSeed,
        palette,
        concepts,
      },
      null,
      2,
    )}\n`,
    "application/json",
    files,
  );

  await writeOutput(outDir, "logo-brief.md", briefDoc(options, palette, masterSeed, concepts), "text/markdown", files);
  await writeOutput(outDir, "usage-notes.md", usageNotes(options.brand, palette, concepts), "text/markdown", files);

  const manifest = {
    skill: "logo-design",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    deterministic: true,
    masterSeed,
    input: {
      brief,
      brand: options.brand,
      style: options.style,
      palette: palette.requested,
      variations: options.variations,
      background: options.background,
      png: options.png,
    },
    outputDir: outDir,
    files: files.slice().sort((a, b) => a.path.localeCompare(b.path)),
  };

  const manifestPath = join(outDir, "manifest.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...manifest, pngNote, concepts }, null, 2)}\n`);
    return;
  }

  console.log(`logo-design: wrote ${files.length + 1} files to ${outDir}`);
  console.log(`  brand      ${options.brand}`);
  console.log(`  seed       ${masterSeed} (deterministic)`);
  console.log(`  palette    ${palette.primary} / ${palette.secondary} / ${palette.accent} on ${palette.background}`);
  console.log(`  concepts   ${concepts.map((c) => `${c.id}:${c.geometry}`).join(", ")}`);
  if (options.png) console.log(`  png        ${pngNote}`);
  console.log(`  manifest   ${relative(process.cwd(), manifestPath) || manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`logo-design: ${message}\n`);
  process.exit(1);
});
