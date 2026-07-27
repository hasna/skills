#!/usr/bin/env bun

import { mkdir, writeFile } from "fs/promises";
import { join, resolve, relative } from "path";

const VERSION = "0.1.0";

type Scene = "browser" | "device" | "dashboard";
type DeviceKind = "auto" | "phone" | "laptop";

interface CliOptions {
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

interface Tokens {
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

interface VariantPlan {
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

interface StylePreset {
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

function selectPreset(style: string): StylePreset {
  const lower = style.toLowerCase();
  for (const preset of STYLE_PRESETS) {
    if (preset.keywords.some((keyword) => lower.includes(keyword))) return preset;
  }
  return STYLE_PRESETS[STYLE_PRESETS.length - 1];
}

function buildTokens(preset: StylePreset, variantIndex: number, accentOverride?: string): Tokens {
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
const MONO_STACK = "'JetBrains Mono','SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  radius = 0,
  extra = "",
): string {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${round(
    radius,
  )}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
}

function text(
  x: number,
  y: number,
  content: string,
  fill: string,
  size: number,
  weight = 500,
  anchor: "start" | "middle" | "end" = "start",
  stack = FONT_STACK,
): string {
  return `<text x="${round(x)}" y="${round(y)}" font-family="${stack}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central">${xmlEscape(
    content,
  )}</text>`;
}

function placeholderLines(
  x: number,
  y: number,
  width: number,
  count: number,
  fill: string,
  rng: () => number,
  lineHeight = 14,
  gap = 10,
): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const w = width * (0.55 + rng() * 0.45);
    parts.push(rect(x, y + i * (lineHeight + gap), w, lineHeight, fill, lineHeight / 2, 'fill-opacity="0.55"'));
  }
  return parts.join("\n      ");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/* ------------------------------------------------------------------ */
/* scene renderers                                                     */
/* ------------------------------------------------------------------ */

interface SceneInput {
  title: string;
  product: string;
  url: string;
  tokens: Tokens;
  rng: () => number;
  index: number;
}

interface SceneOutput {
  width: number;
  height: number;
  body: string;
  layers: string[];
  notes: string;
}

function renderBrowser(input: SceneInput): SceneOutput {
  const { tokens, rng } = input;
  const width = 1280;
  const height = 800;
  const pad = 48;
  const winX = pad;
  const winY = pad;
  const winW = width - pad * 2;
  const winH = height - pad * 2;
  const chromeH = 88;
  const tabH = 38;
  const r = tokens.radius + 4;

  const tabs = ["Overview", truncate(input.product, 18), "Docs"];
  let tabX = winX + 76;
  const tabParts: string[] = [];
  tabs.forEach((label, i) => {
    const w = 34 + label.length * 8.2;
    const active = i === 1;
    tabParts.push(
      rect(tabX, winY + 10, w, tabH, active ? tokens.surface : tokens.surfaceAlt, 8),
      text(tabX + 16, winY + 10 + tabH / 2, label, active ? tokens.text : tokens.muted, 13, active ? 600 : 500),
    );
    tabX += w + 8;
  });

  const contentY = winY + chromeH;
  const contentH = winH - chromeH;
  const heroPad = 56;

  const body = `  <rect id="canvas" width="${width}" height="${height}" fill="${tokens.background}"/>
  <g id="window">
    ${rect(winX, winY, winW, winH, tokens.surface, r)}
    ${rect(winX, winY, winW, winH, "none", r, `stroke="${tokens.border}" stroke-width="1"`)}
  </g>
  <g id="chrome">
    ${rect(winX, winY, winW, chromeH, tokens.surfaceAlt, r)}
    ${rect(winX, winY + chromeH - r, winW, r, tokens.surfaceAlt, 0)}
    <line x1="${winX}" y1="${contentY}" x2="${winX + winW}" y2="${contentY}" stroke="${tokens.border}" stroke-width="1"/>
    <circle cx="${winX + 26}" cy="${winY + 28}" r="6" fill="#FF5F57"/>
    <circle cx="${winX + 46}" cy="${winY + 28}" r="6" fill="#FEBC2E"/>
    <circle cx="${winX + 66}" cy="${winY + 28}" r="6" fill="#28C840"/>
  </g>
  <g id="tab-bar">
    ${tabParts.join("\n    ")}
  </g>
  <g id="url-pill">
    ${rect(winX + 24, winY + 56, winW - 168, 24, tokens.dark ? tokens.background : "#FFFFFF", 12, `stroke="${tokens.border}" stroke-width="1"`)}
    <path d="M ${winX + 40} ${winY + 66} a 5 5 0 0 1 10 0 v 4 h -10 z" fill="none" stroke="${tokens.muted}" stroke-width="1.6"/>
    ${text(winX + 58, winY + 68, input.url, tokens.muted, 12, 500, "start", MONO_STACK)}
    ${rect(winX + winW - 128, winY + 58, 20, 20, tokens.border, 6)}
    ${rect(winX + winW - 100, winY + 58, 20, 20, tokens.border, 6)}
    <circle cx="${winX + winW - 46}" cy="${winY + 68}" r="11" fill="${tokens.accent}"/>
  </g>
  <g id="page-content">
    ${rect(winX + heroPad, contentY + 56, 120, 26, tokens.accentSoft, 13)}
    ${text(winX + heroPad + 60, contentY + 69, "NEW", tokens.accent, 12, 700, "middle")}
    ${text(winX + heroPad, contentY + 120, truncate(input.title, 42), tokens.text, 44, 700)}
    ${placeholderLines(winX + heroPad, contentY + 168, 520, 3, tokens.muted, rng)}
    ${rect(winX + heroPad, contentY + 258, 168, 48, tokens.accent, tokens.radius)}
    ${text(winX + heroPad + 84, contentY + 282, "Get started", tokens.dark ? "#0B0D12" : "#FFFFFF", 15, 600, "middle")}
    ${rect(winX + heroPad + 188, contentY + 258, 148, 48, "none", tokens.radius, `stroke="${tokens.border}" stroke-width="1.5"`)}
    ${text(winX + heroPad + 262, contentY + 282, "See a demo", tokens.text, 15, 600, "middle")}
    ${rect(winX + winW - heroPad - 460, contentY + 56, 460, contentH - 112, tokens.surfaceAlt, tokens.radius + 4, `stroke="${tokens.border}" stroke-width="1"`)}
    ${rect(winX + winW - heroPad - 424, contentY + 96, 388, 34, tokens.border, 8, 'fill-opacity="0.6"')}
    ${[0, 1, 2]
      .map((i) =>
        rect(
          winX + winW - heroPad - 424,
          contentY + 154 + i * 78,
          388,
          62,
          tokens.surface,
          tokens.radius,
          `stroke="${tokens.border}" stroke-width="1"`,
        ),
      )
      .join("\n    ")}
    ${[0, 1, 2]
      .map((i) => `<circle cx="${winX + winW - heroPad - 396}" cy="${contentY + 185 + i * 78}" r="14" fill="${tokens.accentSoft}"/>`)
      .join("\n    ")}
  </g>`;

  return {
    width,
    height,
    body,
    layers: ["canvas", "window", "chrome", "tab-bar", "url-pill", "page-content"],
    notes: "Desktop browser frame at 1280x800 with traffic lights, a three-tab bar, a URL pill, and a two-column marketing page body.",
  };
}

function renderPhone(input: SceneInput): SceneOutput {
  const { tokens, rng } = input;
  const width = 720;
  const height = 1000;
  const bodyW = 360;
  const bodyH = 740;
  const bodyX = (width - bodyW) / 2;
  const bodyY = (height - bodyH) / 2;
  const bezel = 12;
  const screenX = bodyX + bezel;
  const screenY = bodyY + bezel;
  const screenW = bodyW - bezel * 2;
  const screenH = bodyH - bezel * 2;

  const cards = [0, 1, 2].map((i) =>
    [
      rect(screenX + 20, screenY + 250 + i * 108, screenW - 40, 92, tokens.surfaceAlt, tokens.radius, `stroke="${tokens.border}" stroke-width="1"`),
      `<circle cx="${screenX + 52}" cy="${screenY + 296 + i * 108}" r="18" fill="${tokens.accentSoft}"/>`,
      rect(screenX + 84, screenY + 278 + i * 108, 140, 12, tokens.text, 6, 'fill-opacity="0.75"'),
      rect(screenX + 84, screenY + 300 + i * 108, 96, 10, tokens.muted, 5, 'fill-opacity="0.6"'),
    ].join("\n    "),
  );

  const body = `  <rect id="canvas" width="${width}" height="${height}" fill="${tokens.background}"/>
  <g id="device-body">
    ${rect(bodyX, bodyY, bodyW, bodyH, tokens.dark ? "#15171C" : "#1B1D22", 46)}
    ${rect(bodyX, bodyY, bodyW, bodyH, "none", 46, 'stroke="#000000" stroke-opacity="0.35" stroke-width="2"')}
    ${rect(bodyX + bodyW, bodyY + 190, 3, 74, "#2A2D34", 2)}
    ${rect(bodyX - 3, bodyY + 160, 3, 46, "#2A2D34", 2)}
  </g>
  <g id="screen">
    ${rect(screenX, screenY, screenW, screenH, tokens.surface, 36)}
  </g>
  <g id="status-bar">
    ${text(screenX + 26, screenY + 30, "9:41", tokens.text, 13, 700)}
    ${rect(screenX + screenW - 74, screenY + 24, 18, 11, tokens.text, 2, 'fill-opacity="0.8"')}
    ${rect(screenX + screenW - 50, screenY + 23, 26, 13, tokens.text, 4, 'fill-opacity="0.8"')}
    ${rect(screenX + screenW / 2 - 46, screenY + 6, 92, 26, "#0B0B0F", 13)}
  </g>
  <g id="app-content">
    ${text(screenX + 26, screenY + 92, truncate(input.title, 22), tokens.text, 26, 700)}
    ${placeholderLines(screenX + 26, screenY + 124, screenW - 80, 2, tokens.muted, rng, 11, 9)}
    ${rect(screenX + 26, screenY + 182, screenW - 52, 44, tokens.accent, tokens.radius)}
    ${text(screenX + screenW / 2, screenY + 204, "Continue", tokens.dark ? "#0B0D12" : "#FFFFFF", 15, 600, "middle")}
    ${cards.join("\n    ")}
  </g>
  <g id="tab-bar">
    ${rect(screenX, screenY + screenH - 76, screenW, 76, tokens.surfaceAlt, 0)}
    <line x1="${screenX}" y1="${screenY + screenH - 76}" x2="${screenX + screenW}" y2="${screenY + screenH - 76}" stroke="${tokens.border}" stroke-width="1"/>
    ${[0, 1, 2, 3]
      .map((i) => {
        const cx = screenX + screenW * (0.16 + i * 0.226);
        const active = i === 0;
        return `<circle cx="${round(cx)}" cy="${screenY + screenH - 46}" r="9" fill="${active ? tokens.accent : tokens.muted}" fill-opacity="${active ? 1 : 0.5}"/>`;
      })
      .join("\n    ")}
    ${rect(screenX + screenW / 2 - 62, screenY + screenH - 16, 124, 5, tokens.muted, 3)}
  </g>`;

  return {
    width,
    height,
    body,
    layers: ["canvas", "device-body", "screen", "status-bar", "app-content", "tab-bar"],
    notes: "Phone bezel at 720x1000 with a rounded body, side buttons, notch, status bar, app content stack, and a four-item tab bar.",
  };
}

function renderLaptop(input: SceneInput): SceneOutput {
  const { tokens, rng } = input;
  const width = 1280;
  const height = 840;
  const lidW = 960;
  const lidH = 600;
  const lidX = (width - lidW) / 2;
  const lidY = 60;
  const bezel = 18;
  const screenX = lidX + bezel;
  const screenY = lidY + bezel + 10;
  const screenW = lidW - bezel * 2;
  const screenH = lidH - bezel * 2 - 10;

  const body = `  <rect id="canvas" width="${width}" height="${height}" fill="${tokens.background}"/>
  <g id="lid">
    ${rect(lidX, lidY, lidW, lidH, tokens.dark ? "#15171C" : "#1B1D22", 18)}
    <circle cx="${width / 2}" cy="${lidY + 14}" r="3" fill="#3A3D44"/>
  </g>
  <g id="screen">
    ${rect(screenX, screenY, screenW, screenH, tokens.surface, 6)}
  </g>
  <g id="app-window">
    ${rect(screenX, screenY, screenW, 44, tokens.surfaceAlt, 6)}
    <line x1="${screenX}" y1="${screenY + 44}" x2="${screenX + screenW}" y2="${screenY + 44}" stroke="${tokens.border}" stroke-width="1"/>
    <circle cx="${screenX + 22}" cy="${screenY + 22}" r="5" fill="#FF5F57"/>
    <circle cx="${screenX + 40}" cy="${screenY + 22}" r="5" fill="#FEBC2E"/>
    <circle cx="${screenX + 58}" cy="${screenY + 22}" r="5" fill="#28C840"/>
    ${text(screenX + screenW / 2, screenY + 22, truncate(input.product, 46), tokens.muted, 13, 500, "middle")}
    ${text(screenX + 48, screenY + 116, truncate(input.title, 40), tokens.text, 34, 700)}
    ${placeholderLines(screenX + 48, screenY + 158, 420, 3, tokens.muted, rng)}
    ${rect(screenX + 48, screenY + 244, 152, 42, tokens.accent, tokens.radius)}
    ${text(screenX + 124, screenY + 265, "Start free", tokens.dark ? "#0B0D12" : "#FFFFFF", 14, 600, "middle")}
    ${rect(screenX + screenW - 400, screenY + 88, 348, screenH - 152, tokens.surfaceAlt, tokens.radius, `stroke="${tokens.border}" stroke-width="1"`)}
    ${[0, 1, 2, 3, 4, 5, 6]
      .map((i) => {
        const h = 30 + Math.floor(rng() * 130);
        const x = screenX + screenW - 368 + i * 44;
        const y = screenY + screenH - 120 - h;
        return rect(x, y, 26, h, i % 2 === 0 ? tokens.accent : tokens.accentSoft, 6);
      })
      .join("\n    ")}
  </g>
  <g id="base">
    <path d="M ${lidX - 90} ${lidY + lidH} L ${lidX + lidW + 90} ${lidY + lidH} L ${lidX + lidW + 150} ${lidY + lidH + 34} L ${lidX - 150} ${lidY + lidH + 34} Z" fill="${tokens.dark ? "#1D2026" : "#25282E"}"/>
    ${rect(width / 2 - 70, lidY + lidH + 4, 140, 6, "#33363D", 3)}
    <path d="M ${lidX - 150} ${lidY + lidH + 34} L ${lidX + lidW + 150} ${lidY + lidH + 34} L ${lidX + lidW + 150} ${lidY + lidH + 42} L ${lidX - 150} ${lidY + lidH + 42} Z" fill="${tokens.dark ? "#101216" : "#15171B"}"/>
  </g>`;

  return {
    width,
    height,
    body,
    layers: ["canvas", "lid", "screen", "app-window", "base"],
    notes: "Laptop mockup at 1280x840 with a bezelled lid, camera dot, in-screen app window, bar chart panel, and a tapered base.",
  };
}

function renderDashboard(input: SceneInput): SceneOutput {
  const { tokens, rng } = input;
  const width = 1440;
  const height = 900;
  const sidebarW = 240;
  const headerH = 72;
  const gutter = 28;
  const contentX = sidebarW + gutter;
  const contentW = width - sidebarW - gutter * 2;

  const navItems = ["Overview", "Usage", "Customers", "Billing", "Reports", "Settings"];
  const nav = navItems
    .map((label, i) => {
      const y = headerH + 34 + i * 46;
      const active = i === 0;
      return [
        active ? rect(14, y - 4, sidebarW - 28, 38, tokens.accentSoft, tokens.radius) : "",
        `<circle cx="38" cy="${y + 15}" r="7" fill="${active ? tokens.accent : tokens.muted}" fill-opacity="${active ? 1 : 0.55}"/>`,
        text(58, y + 15, label, active ? tokens.text : tokens.muted, 14, active ? 600 : 500),
      ]
        .filter(Boolean)
        .join("\n    ");
    })
    .join("\n    ");

  const kpiSpecs: Array<{ label: string; value: () => string }> = [
    { label: "MRR", value: () => `$${(Math.floor(rng() * 800) + 120).toLocaleString("en-US")}k` },
    { label: "Active seats", value: () => `${(Math.floor(rng() * 9000) + 400).toLocaleString("en-US")}` },
    { label: "Churn", value: () => `${(rng() * 3 + 0.4).toFixed(1)}%` },
    { label: "NRR", value: () => `${Math.floor(rng() * 40) + 100}%` },
  ];
  const kpiW = (contentW - gutter * 3) / 4;
  const kpis = kpiSpecs
    .map(({ label, value: makeValue }, i) => {
      const x = contentX + i * (kpiW + gutter);
      const y = headerH + gutter;
      const value = makeValue();
      const delta = `${rng() > 0.35 ? "+" : "-"}${(rng() * 12).toFixed(1)}%`;
      return [
        rect(x, y, kpiW, 118, tokens.surface, tokens.radius, `stroke="${tokens.border}" stroke-width="1"`),
        text(x + 20, y + 30, label, tokens.muted, 12, 600),
        text(x + 20, y + 66, value, tokens.text, 30, 700),
        rect(x + 20, y + 90, 64, 20, tokens.accentSoft, 10),
        text(x + 52, y + 100, delta, tokens.accent, 11, 600, "middle"),
      ].join("\n    ");
    })
    .join("\n    ");

  const chartY = headerH + gutter + 118 + gutter;
  const chartH = 300;
  const chartW = contentW * 0.62;
  const bars = Array.from({ length: 12 }, (_, i) => {
    const h = 40 + Math.floor(rng() * (chartH - 130));
    const barW = (chartW - 96) / 12 - 12;
    const x = contentX + 48 + i * ((chartW - 96) / 12);
    return rect(x, chartY + chartH - 48 - h, barW, h, i === 8 ? tokens.accent : tokens.accentSoft, 6);
  }).join("\n    ");

  const linePoints = Array.from({ length: 12 }, (_, i) => {
    const x = contentX + chartW + gutter + 40 + i * ((contentW - chartW - gutter - 80) / 11);
    const y = chartY + 90 + Math.floor(rng() * 140);
    return `${round(x)},${round(y)}`;
  }).join(" ");

  const tableY = chartY + chartH + gutter;
  const rows = Array.from({ length: 4 }, (_, i) => {
    const y = tableY + 66 + i * 44;
    return [
      `<circle cx="${contentX + 34}" cy="${y}" r="11" fill="${tokens.accentSoft}"/>`,
      rect(contentX + 56, y - 6, 150 + Math.floor(rng() * 80), 12, tokens.text, 6, 'fill-opacity="0.72"'),
      rect(contentX + contentW * 0.45, y - 6, 90, 12, tokens.muted, 6, 'fill-opacity="0.5"'),
      rect(contentX + contentW * 0.66, y - 6, 70, 12, tokens.muted, 6, 'fill-opacity="0.5"'),
      rect(contentX + contentW - 96, y - 12, 72, 24, tokens.accentSoft, 12),
    ].join("\n    ");
  }).join("\n    ");

  const body = `  <rect id="canvas" width="${width}" height="${height}" fill="${tokens.background}"/>
  <g id="sidebar">
    ${rect(0, 0, sidebarW, height, tokens.surface, 0)}
    <line x1="${sidebarW}" y1="0" x2="${sidebarW}" y2="${height}" stroke="${tokens.border}" stroke-width="1"/>
    ${rect(20, 24, 26, 26, tokens.accent, 8)}
    ${text(58, 37, truncate(input.product, 16), tokens.text, 15, 700)}
    ${nav}
  </g>
  <g id="header">
    ${rect(sidebarW, 0, width - sidebarW, headerH, tokens.surface, 0)}
    <line x1="${sidebarW}" y1="${headerH}" x2="${width}" y2="${headerH}" stroke="${tokens.border}" stroke-width="1"/>
    ${text(contentX, headerH / 2, truncate(input.title, 44), tokens.text, 20, 700)}
    ${rect(width - 300, 20, 180, 32, tokens.surfaceAlt, 16, `stroke="${tokens.border}" stroke-width="1"`)}
    ${text(width - 282, 36, "Search", tokens.muted, 12, 500)}
    ${rect(width - 104, 20, 32, 32, tokens.accentSoft, 16)}
    <circle cx="${width - 44}" cy="36" r="16" fill="${tokens.accent}"/>
  </g>
  <g id="kpi-row">
    ${kpis}
  </g>
  <g id="chart-bar">
    ${rect(contentX, chartY, chartW, chartH, tokens.surface, tokens.radius, `stroke="${tokens.border}" stroke-width="1"`)}
    ${text(contentX + 24, chartY + 32, "Revenue by month", tokens.text, 14, 600)}
    <line x1="${contentX + 32}" y1="${chartY + chartH - 48}" x2="${contentX + chartW - 32}" y2="${chartY + chartH - 48}" stroke="${tokens.border}" stroke-width="1"/>
    ${bars}
  </g>
  <g id="chart-line">
    ${rect(contentX + chartW + gutter, chartY, contentW - chartW - gutter, chartH, tokens.surface, tokens.radius, `stroke="${tokens.border}" stroke-width="1"`)}
    ${text(contentX + chartW + gutter + 24, chartY + 32, "Activation trend", tokens.text, 14, 600)}
    <polyline points="${linePoints}" fill="none" stroke="${tokens.accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g id="table">
    ${rect(contentX, tableY, contentW, height - tableY - gutter, tokens.surface, tokens.radius, `stroke="${tokens.border}" stroke-width="1"`)}
    ${text(contentX + 24, tableY + 30, "Recent accounts", tokens.text, 14, 600)}
    <line x1="${contentX}" y1="${tableY + 48}" x2="${contentX + contentW}" y2="${tableY + 48}" stroke="${tokens.border}" stroke-width="1"/>
    ${rows}
  </g>`;

  return {
    width,
    height,
    body,
    layers: ["canvas", "sidebar", "header", "kpi-row", "chart-bar", "chart-line", "table"],
    notes: "Analytics dashboard at 1440x900 with a six-item sidebar, header search, four KPI cards, a bar chart, a line chart, and a four-row table.",
  };
}

/* ------------------------------------------------------------------ */
/* cli                                                                 */
/* ------------------------------------------------------------------ */

function printHelp(): void {
  console.log(`product-mockup v${VERSION}

Emit parametric SVG product mockup frames. Everything is drawn locally as real
SVG geometry: no image model, no network access, no API keys. The package also
includes written image prompts you can hand to an image model yourself.

USAGE:
  product-mockup --product <text> [options]
  product-mockup "<product text>" [options]

OPTIONS:
  -p, --product <text>      Product, feature, or campaign (positional works)  [required]
      --title <text>        Headline rendered inside the frame     [product text]
  -s, --scene <name>        browser | device | dashboard           [browser]
      --device <kind>       auto | phone | laptop (scene=device)   [auto]
  -n, --variants <1-4>      Number of mockup variants              [3]
      --style <text>        Style direction keyword or phrase      [polished SaaS, crisp product UI]
      --audience <text>     Target audience, recorded in the brief [software buyers]
      --accent <hex>        Force the accent color (#RRGGBB)       [derived from style]
      --url <text>          URL shown in the browser address pill  [https://example.com]
  -o, --output <dir>        Output directory                       [./product-mockup]
      --json                Print the run summary as JSON
      --help                Show this help message
      --version             Show the current version

STYLE KEYWORDS:
  polished (default) | noir/dark | warm | editorial | technical | vivid

OUTPUTS:
  variants/variant-NN.svg   Real SVG frames, one per variant
  scene-plan.json           Scene, tokens, and seed for every variant
  asset-metadata.json       Dimensions, viewBox, and layer names per file
  image-prompts.md          Text prompts for your own image model
  mockup-brief.md           Brief, audience, and style interpretation
  usage-notes.md            How to edit, export, and place the frames
  manifest.json             Every file written, with byte sizes

EXAMPLES:
  product-mockup "Usage-based billing dashboard" --scene dashboard -n 3
  product-mockup --product "AI meeting assistant" --scene device --device phone
  product-mockup -p "MeterKit" --scene browser --style noir --url https://example.com
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    scene: "browser",
    device: "auto",
    variants: 3,
    style: "polished SaaS, crisp product UI",
    audience: "software buyers",
    url: "https://example.com",
    output: "./product-mockup",
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
      case "--product":
      case "-p":
        options.product = argv[++i];
        break;
      case "--title":
        options.title = argv[++i];
        break;
      case "--scene":
      case "-s": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "browser" && value !== "device" && value !== "dashboard") {
          throw new Error(`Invalid --scene value: ${value} (expected browser | device | dashboard)`);
        }
        options.scene = value;
        break;
      }
      case "--device": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "auto" && value !== "phone" && value !== "laptop") {
          throw new Error(`Invalid --device value: ${value} (expected auto | phone | laptop)`);
        }
        options.device = value;
        break;
      }
      case "--variants":
      case "-n": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 1 || value > 4) {
          throw new Error(`Invalid --variants value: ${argv[i]} (expected 1-4)`);
        }
        options.variants = value;
        break;
      }
      case "--style":
        options.style = argv[++i] ?? options.style;
        break;
      case "--audience":
        options.audience = argv[++i] ?? options.audience;
        break;
      case "--accent": {
        const value = normalizeHex(argv[++i] ?? "");
        if (!value) {
          throw new Error(`Invalid --accent value: ${argv[i]} (expected a hex color such as #2E86C1)`);
        }
        options.accent = value;
        break;
      }
      case "--url":
        options.url = argv[++i] ?? options.url;
        break;
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.product) {
          options.product = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.product || options.product.trim() === "") {
    throw new Error("Missing required --product <text> argument (a positional description also works)");
  }

  return options;
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

function imagePrompts(options: CliOptions, plans: VariantPlan[]): string {
  return `# Image prompts — ${options.product}

The SVG frames in \`variants/\` are drawn deterministically by this skill and are
ready to use as-is. This file is the *other* half: written prompts you can paste
into whichever image model you use. **This skill never calls an image model and
never needs a key** — copy a prompt out and run it wherever you like.

- Product: ${options.product}
- Audience: ${options.audience}
- Style direction: ${options.style}
- Scene family: ${options.scene}

## Prompt anatomy

\`\`\`
<subject and surface> , <composition> , <lighting> , <color> , <finish> , <negatives>
\`\`\`

Keep the subject concrete, name the camera position, and always add negatives —
image models over-decorate product shots by default.

${plans
  .map(
    (plan) => `## ${plan.id} — ${plan.scene}${plan.device ? ` (${plan.device})` : ""}

**Prompt**

> ${promptFor(options, plan)}

**Negative prompt**

> lorem ipsum text, garbled letterforms, watermark, stock-photo people, heavy drop shadows, lens flare, skeuomorphic gradients, cluttered UI, extra fingers, distorted geometry

**Settings to try**: ${plan.width}x${plan.height} (matches \`${plan.file}\`), guidance 5-7, 2 seeds per prompt.
`,
  )
  .join("\n")}
## Compositing recipe

1. Render the prompt above at the same aspect ratio as the matching SVG.
2. Open the SVG, delete the \`canvas\` layer, and export the frame with a transparent background.
3. Place the generated image behind the frame — the SVG layer names in
   \`asset-metadata.json\` tell you exactly what each group is.
4. Keep the real UI text in the SVG layer. Image models still cannot render legible product copy.
`;
}

function promptFor(options: CliOptions, plan: VariantPlan): string {
  const surface =
    plan.scene === "dashboard"
      ? "a wide analytics dashboard screen floating on a soft studio backdrop"
      : plan.device === "phone"
        ? "a modern smartphone held upright, screen facing the camera"
        : plan.device === "laptop"
          ? "an open thin-bezel laptop on a clean desk, screen facing the camera"
          : "a desktop browser window floating in a clean studio space";
  const tone = plan.tokens.dark ? "low-key lighting, deep charcoal background" : "bright even lighting, soft neutral background";
  return `Product marketing shot of ${surface} showing ${options.product} for ${options.audience}, ${options.style}, three-quarter camera at eye level with a slight perspective, ${tone}, accent color ${plan.tokens.accent}, crisp focus edge to edge, subtle contact shadow, high-detail render, no text artifacts`;
}

function mockupBrief(options: CliOptions, plans: VariantPlan[]): string {
  return `# Mockup brief — ${options.product}

| Field | Value |
|-------|-------|
| Product | ${options.product} |
| Headline in frame | ${options.title ?? options.product} |
| Audience | ${options.audience} |
| Scene | ${options.scene} |
| Style input | ${options.style} |
| Style preset matched | ${plans[0].tokens.name} |
| Variants | ${options.variants} |

## What was generated

${plans
  .map(
    (plan) =>
      `- **${plan.id}** — ${plan.notes} Accent \`${plan.tokens.accent}\`, surface \`${plan.tokens.surface}\`, seed \`${plan.seed}\`.`,
  )
  .join("\n")}

## Reproducibility

Variant geometry is seeded from the product text, scene, style, and variant
index. Re-running the same command reproduces the same SVGs exactly. Change
\`--style\` or \`--accent\` to move the palette without changing the layout.
`;
}

function usageNotes(options: CliOptions, plans: VariantPlan[]): string {
  return `# Usage notes

## Editing

Every frame is plain SVG with named groups. Open it in Figma (File > Import),
Illustrator, Inkscape, or a text editor. The group ids are listed per file in
\`asset-metadata.json\`; the common ones are:

- \`canvas\` — the full-bleed background rect. Delete it for a transparent export.
- \`chrome\` / \`device-body\` / \`lid\` — the frame hardware.
- \`page-content\` / \`app-content\` / \`app-window\` — the screen contents you will
  usually replace with a real screenshot.
- \`kpi-row\`, \`chart-bar\`, \`chart-line\`, \`table\` — dashboard modules.

## Dropping in a real screenshot

1. Delete the content group (\`page-content\`, \`app-content\`, or the dashboard modules).
2. Place your screenshot and clip it to the \`screen\` rect.
3. Keep the frame hardware on top so the bezel corners stay clean.

## Exporting

\`\`\`bash
# any SVG renderer works; here are two common ones
rsvg-convert -w 2560 variants/variant-01.svg -o variant-01@2x.png
inkscape variants/variant-01.svg --export-type=png --export-width=2560
\`\`\`

## Sizes in this package

${plans.map((plan) => `- \`${plan.file}\` — ${plan.width}x${plan.height}`).join("\n")}

## Color

The accent rotates per variant so a set reads as a family rather than a repeat.
Pass \`--accent "#RRGGBB"\` to lock every variant to your brand color.
`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const product = options.product!.trim();
  const title = (options.title ?? product).trim();
  const outDir = resolve(options.output);
  const preset = selectPreset(options.style);

  const files: WrittenFile[] = [];
  const plans: VariantPlan[] = [];

  for (let i = 0; i < options.variants; i += 1) {
    const index = i + 1;
    const id = `variant-${String(index).padStart(2, "0")}`;
    const seed = fnv1a(`${product}|${title}|${options.scene}|${options.style}|${index}`);
    const rng = mulberry32(seed);
    const tokens = buildTokens(preset, i, options.accent);

    let device: "phone" | "laptop" | undefined;
    if (options.scene === "device") {
      device = options.device === "auto" ? (i % 2 === 0 ? "phone" : "laptop") : options.device;
    }

    const sceneInput: SceneInput = { title, product, url: options.url, tokens, rng, index };
    const rendered =
      options.scene === "dashboard"
        ? renderDashboard(sceneInput)
        : options.scene === "device"
          ? device === "laptop"
            ? renderLaptop(sceneInput)
            : renderPhone(sceneInput)
          : renderBrowser(sceneInput);

    const file = `variants/${id}.svg`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rendered.width} ${rendered.height}" width="${rendered.width}" height="${rendered.height}" role="img" aria-labelledby="title-${index} desc-${index}">
  <title id="title-${index}">${xmlEscape(`${title} — ${options.scene} mockup ${index}`)}</title>
  <desc id="desc-${index}">${xmlEscape(rendered.notes)}</desc>
${rendered.body}
</svg>
`;

    await writeOutput(outDir, file, svg, "image/svg+xml", files);

    plans.push({
      id,
      index,
      seed,
      scene: options.scene,
      device,
      width: rendered.width,
      height: rendered.height,
      file,
      tokens,
      layers: rendered.layers,
      notes: rendered.notes,
    });
  }

  const scenePlan = {
    product,
    title,
    audience: options.audience,
    scene: options.scene,
    style: { input: options.style, preset: preset.name, dark: preset.dark },
    url: options.url,
    variants: plans.map((plan) => ({
      id: plan.id,
      seed: plan.seed,
      scene: plan.scene,
      device: plan.device ?? null,
      file: plan.file,
      tokens: plan.tokens,
      notes: plan.notes,
    })),
  };

  const assetMetadata = {
    generatedAt: new Date().toISOString(),
    assets: plans.map((plan) => ({
      file: plan.file,
      format: "svg",
      width: plan.width,
      height: plan.height,
      viewBox: `0 0 ${plan.width} ${plan.height}`,
      aspectRatio: round(plan.width / plan.height),
      layers: plan.layers,
      accent: plan.tokens.accent,
      background: plan.tokens.background,
      dark: plan.tokens.dark,
    })),
  };

  await writeOutput(outDir, "scene-plan.json", `${JSON.stringify(scenePlan, null, 2)}\n`, "application/json", files);
  await writeOutput(
    outDir,
    "asset-metadata.json",
    `${JSON.stringify(assetMetadata, null, 2)}\n`,
    "application/json",
    files,
  );
  await writeOutput(outDir, "image-prompts.md", imagePrompts(options, plans), "text/markdown", files);
  await writeOutput(outDir, "mockup-brief.md", mockupBrief(options, plans), "text/markdown", files);
  await writeOutput(outDir, "usage-notes.md", usageNotes(options, plans), "text/markdown", files);

  const manifest = {
    skill: "product-mockup",
    version: VERSION,
    generatedAt: new Date().toISOString(),
    deterministic: true,
    input: {
      product,
      title,
      scene: options.scene,
      device: options.device,
      variants: options.variants,
      style: options.style,
      stylePreset: preset.name,
      audience: options.audience,
      accent: options.accent ?? null,
      url: options.url,
    },
    outputDir: outDir,
    files: files.slice().sort((a, b) => a.path.localeCompare(b.path)),
  };

  const manifestPath = join(outDir, "manifest.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...manifest, scenePlan, assetMetadata }, null, 2)}\n`);
    return;
  }

  console.log(`product-mockup: wrote ${files.length + 1} files to ${outDir}`);
  console.log(`  product    ${product}`);
  console.log(`  scene      ${options.scene}${options.scene === "device" ? ` (${options.device})` : ""}`);
  console.log(`  style      ${options.style} -> preset "${preset.name}"${preset.dark ? " (dark)" : ""}`);
  for (const plan of plans) {
    console.log(`  ${plan.id}  ${plan.width}x${plan.height}  accent ${plan.tokens.accent}  layers: ${plan.layers.join(", ")}`);
  }
  console.log(`  manifest   ${relative(process.cwd(), manifestPath) || manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`product-mockup: ${message}\n`);
  process.exit(1);
});
