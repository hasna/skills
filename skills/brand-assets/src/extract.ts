import { extname } from "path";
import { USER_AGENT } from "./constants.js";
import type { ColorHit, FontHit, HtmlNode } from "./types.js";

export async function fetchWithTimeout(url: string, timeout: number, accept: string): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
      headers: {
        "user-agent": USER_AGENT,
        accept,
        "accept-language": "en-US,en;q=0.9",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|abort/i.test(message)) {
      throw new Error(`Request to ${url} timed out after ${timeout}ms. Raise it with --timeout <ms>.`);
    }
    throw new Error(`Network request to ${url} failed: ${message}`);
  }
}

export async function fetchPage(url: string, timeout: number): Promise<{ html: string; finalUrl: string; contentType: string }> {
  const response = await fetchWithTimeout(url, timeout, "text/html,application/xhtml+xml");

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status} ${response.statusText || ""}`.trim());
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(
      `${response.url} returned content-type "${contentType || "unknown"}", which is not HTML. ` +
        "Point --url at an HTML page rather than a file or API endpoint.",
    );
  }

  return { html: await response.text(), finalUrl: response.url || url, contentType };
}

/* ------------------------------------------------------------------ */
/* color + font extraction                                             */
/* ------------------------------------------------------------------ */

const CSS_NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  navy: "#000080",
  teal: "#008080",
  orange: "#FFA500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  gold: "#FFD700",
  crimson: "#DC143C",
  indigo: "#4B0082",
};

export function toHex(value: string): string | null {
  const raw = value.trim().toLowerCase();

  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(raw);
  if (hexMatch) {
    const body = hexMatch[1];
    if (body.length === 3 || body.length === 4) {
      const rgb = body
        .slice(0, 3)
        .split("")
        .map((c) => c + c)
        .join("");
      return `#${rgb.toUpperCase()}`;
    }
    if (body.length === 6 || body.length === 8) {
      return `#${body.slice(0, 6).toUpperCase()}`;
    }
    return null;
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(raw);
  if (rgbMatch) {
    const channels = rgbMatch.slice(1, 4).map((n) => Math.round(Math.min(255, Math.max(0, Number(n)))));
    if (channels.some((n) => Number.isNaN(n))) return null;
    return `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  const hslMatch = /^hsla?\(\s*([0-9.]+)(?:deg)?[\s,]+([0-9.]+)%[\s,]+([0-9.]+)%/.exec(raw);
  if (hslMatch) {
    const h = Number(hslMatch[1]);
    const s = Number(hslMatch[2]) / 100;
    const l = Number(hslMatch[3]) / 100;
    if ([h, s, l].some((n) => Number.isNaN(n))) return null;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb: [number, number, number];
    const hue = ((h % 360) + 360) % 360;
    if (hue < 60) rgb = [c, x, 0];
    else if (hue < 120) rgb = [x, c, 0];
    else if (hue < 180) rgb = [0, c, x];
    else if (hue < 240) rgb = [0, x, c];
    else if (hue < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return `#${rgb
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()}`;
  }

  return CSS_NAMED_COLORS[raw] ?? null;
}

const COLOR_PROP_PATTERN =
  /(--[a-z0-9-]*(?:color|colour|brand|accent|primary|secondary|bg|background|fg|foreground|surface|theme|ink|text)[a-z0-9-]*)\s*:\s*([^;{}]+)/gi;
const COLOR_DECL_PATTERN =
  /(?:^|[;{}\s])(color|background-color|background|border-color|border-top-color|outline-color|accent-color|caret-color|fill|stroke)\s*:\s*([^;{}]+)/gi;
const FONT_PATTERN = /(font-family|--[a-z0-9-]*font[a-z0-9-]*)\s*:\s*([^;{}]+)/gi;

const COLOR_TOKEN_PATTERN =
  /(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:black|white|red|green|blue|navy|teal|orange|purple|gray|grey|silver|gold|crimson|indigo)\b)/i;

function firstColorIn(value: string): { hex: string; raw: string } | null {
  const match = COLOR_TOKEN_PATTERN.exec(value);
  if (!match) return null;
  const hex = toHex(match[1]);
  return hex ? { hex, raw: match[1] } : null;
}

export function extractColorsFromCss(css: string, foundIn: string): ColorHit[] {
  const hits: ColorHit[] = [];

  COLOR_PROP_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COLOR_PROP_PATTERN.exec(css)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim();
    const color = firstColorIn(value);
    if (color) hits.push({ hex: color.hex, raw: color.raw, name, kind: "custom-property", foundIn });
  }

  COLOR_DECL_PATTERN.lastIndex = 0;
  while ((match = COLOR_DECL_PATTERN.exec(css)) !== null) {
    const name = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (value.startsWith("var(")) continue;
    const color = firstColorIn(value);
    if (color) hits.push({ hex: color.hex, raw: color.raw, name, kind: "declaration", foundIn });
  }

  return hits;
}

export function extractFontsFromCss(css: string, foundIn: string): FontHit[] {
  const hits: FontHit[] = [];
  FONT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FONT_PATTERN.exec(css)) !== null) {
    const property = match[1].trim();
    const stack = match[2].trim().replace(/\s+/g, " ");
    if (!stack || stack.startsWith("var(") || stack.length > 300) continue;
    const families = stack
      .split(",")
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    if (families.length === 0) continue;
    // CSS-wide keywords carry no typographic information.
    if (/^(inherit|initial|unset|revert|revert-layer|none|auto)$/i.test(families[0])) continue;
    hits.push({ stack, families, property, foundIn });
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* html parsing                                                        */
/* ------------------------------------------------------------------ */

export function safeResolve(href: string | undefined, base: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:")) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function looksLikeLogo(node: HtmlNode): boolean {
  const haystack = [
    node.getAttribute("class"),
    node.getAttribute("id"),
    node.getAttribute("alt"),
    node.getAttribute("src"),
    node.getAttribute("aria-label"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /logo|wordmark|brandmark|\bbrand\b/.test(haystack);
}

export function sanitizeFilename(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[?#].*$/, "")
    .split("/")
    .pop()!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export function extensionFor(contentType: string | null, url: string): string {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if (fromUrl && fromUrl.length <= 6) return fromUrl;
  if (!contentType) return ".bin";
  if (/svg/.test(contentType)) return ".svg";
  if (/png/.test(contentType)) return ".png";
  if (/jpe?g/.test(contentType)) return ".jpg";
  if (/webp/.test(contentType)) return ".webp";
  if (/gif/.test(contentType)) return ".gif";
  if (/x-icon|vnd\.microsoft\.icon/.test(contentType)) return ".ico";
  if (/avif/.test(contentType)) return ".avif";
  return ".bin";
}
