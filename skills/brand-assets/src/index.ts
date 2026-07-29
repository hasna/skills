#!/usr/bin/env bun

import { mkdir, writeFile } from "fs/promises";
import { basename, extname, join, resolve, relative } from "path";

const VERSION = "0.1.0";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_STYLESHEETS = 6;
const MAX_STYLESHEET_BYTES = 2 * 1024 * 1024;
const MAX_PALETTE_ENTRIES = 48;

interface CliOptions {
  url?: string;
  output: string;
  timeout: number;
  maxAssets: number;
  download: boolean;
  json: boolean;
}

interface AssetCandidate {
  role: string;
  sourceUrl: string;
  attributes: Record<string, string>;
}

interface DownloadedAsset {
  role: string;
  file: string | null;
  sourceUrl: string;
  contentType: string | null;
  bytes: number | null;
  status: "downloaded" | "skipped" | "failed";
  note?: string;
  attributes: Record<string, string>;
}

type ColorKind = "meta" | "manifest" | "custom-property" | "declaration";

interface ColorHit {
  hex: string;
  raw: string;
  name: string;
  kind: ColorKind;
  foundIn: string;
}

interface FontHit {
  stack: string;
  families: string[];
  property: string;
  foundIn: string;
}

/* ------------------------------------------------------------------ */
/* deps                                                                */
/* ------------------------------------------------------------------ */

type HtmlNode = {
  getAttribute(name: string): string | undefined;
  removeAttribute?(name: string): void;
  text: string;
  rawText: string;
  toString(): string;
  querySelectorAll(selector: string): HtmlNode[];
  querySelector(selector: string): HtmlNode | null;
  tagName?: string;
  attributes: Record<string, string>;
};

async function loadHtmlParser(): Promise<(html: string) => HtmlNode> {
  try {
    const mod = await import("node-html-parser");
    return mod.parse as unknown as (html: string) => HtmlNode;
  } catch {
    throw new Error("Missing dependency 'node-html-parser'. Run bun install in this skill directory.");
  }
}

/* ------------------------------------------------------------------ */
/* cli                                                                 */
/* ------------------------------------------------------------------ */

function printHelp(): void {
  console.log(`brand-assets v${VERSION}

Extract brand assets from a website you name. Fetches the page over plain HTTP,
parses it for icons, social preview images, theme colors, CSS color custom
properties, and font stacks, then downloads what it finds.

No API keys and no third-party services: the only host contacted is the one in
the URL you pass (plus whatever that page links its own assets from).

USAGE:
  brand-assets --url <url> [options]
  brand-assets <url> [options]

OPTIONS:
  -u, --url <url>           Website to inspect. Required.
  -o, --output <dir>        Output directory                     [./brand-assets]
  -t, --timeout <ms>        Per-request timeout in milliseconds  [15000]
      --max-assets <n>      Maximum assets to download           [20]
      --no-download         Discover and report only, fetch no binaries
      --json                Print the brand profile as JSON on stdout
      --help                Show this help message
      --version             Show the current version

WHAT IS DISCOVERED:
  <link rel="icon" | "shortcut icon" | "apple-touch-icon" | "mask-icon">
  <link rel="manifest">      (parsed for name, theme_color, background_color, icons)
  <meta property="og:image">, <meta name="twitter:image">
  <meta name="theme-color">  (including per-color-scheme media variants)
  <img> and inline <svg> whose src, alt, class, or id looks like a logo
  CSS custom properties whose name contains color / brand / accent / bg / fg
  font-family declarations, in inline <style> and in linked stylesheets

OUTPUTS:
  assets/                   Downloaded icons, logos, and social images
  brand-profile.json        Everything discovered, machine readable
  brand-profile.md          The same profile as a readable summary
  palette.json              Every color with its hex and where it was found
  typography.md             Font stacks with their source
  sources.json              asset file -> source URL map
  manifest.json             Every file written, with byte sizes

EXIT CODES:
  0  page fetched and parsed
  1  missing --url, network failure, non-200 response, or non-HTML content type

EXAMPLES:
  brand-assets --url https://example.com
  brand-assets https://example.com --output ./out/example --timeout 30000
  brand-assets --url https://example.com --no-download --json
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: "./brand-assets",
    timeout: 15000,
    maxAssets: 20,
    download: true,
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
      case "--url":
      case "-u":
        options.url = argv[++i];
        break;
      case "--output":
      case "-o":
        options.output = argv[++i] ?? options.output;
        break;
      case "--timeout":
      case "-t": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 500 || value > 300000) {
          throw new Error(`Invalid --timeout value: ${argv[i]} (expected 500-300000 ms)`);
        }
        options.timeout = value;
        break;
      }
      case "--max-assets": {
        const value = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(value) || value < 0 || value > 200) {
          throw new Error(`Invalid --max-assets value: ${argv[i]} (expected 0-200)`);
        }
        options.maxAssets = value;
        break;
      }
      case "--no-download":
        options.download = false;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!options.url) {
          options.url = arg;
          break;
        }
        throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!options.url || options.url.trim() === "") {
    throw new Error(
      "Missing required --url <url> argument. This skill inspects a specific website; " +
        "there is no brand-name search fallback. Example: brand-assets --url https://example.com",
    );
  }

  return options;
}

function normalizeUrl(input: string): URL {
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    throw new Error(`Invalid --url value: ${input} (expected an http(s) URL such as https://example.com)`);
  }
}

/* ------------------------------------------------------------------ */
/* fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(url: string, timeout: number, accept: string): Promise<Response> {
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

async function fetchPage(url: string, timeout: number): Promise<{ html: string; finalUrl: string; contentType: string }> {
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

function toHex(value: string): string | null {
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

function extractColorsFromCss(css: string, foundIn: string): ColorHit[] {
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

function extractFontsFromCss(css: string, foundIn: string): FontHit[] {
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

function safeResolve(href: string | undefined, base: string): string | null {
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

function looksLikeLogo(node: HtmlNode): boolean {
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

function sanitizeFilename(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[?#].*$/, "")
    .split("/")
    .pop()!
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function extensionFor(contentType: string | null, url: string): string {
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

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

interface WrittenFile {
  path: string;
  type: string;
  bytes: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const target = normalizeUrl(options.url!);
  const outDir = resolve(options.output);
  const parse = await loadHtmlParser();

  const { html, finalUrl, contentType } = await fetchPage(target.toString(), options.timeout);
  const root = parse(html);
  const base = safeResolve(root.querySelector("base")?.getAttribute("href"), finalUrl) ?? finalUrl;

  /* ---- metadata ---- */

  const metaOf = (selector: string): string | undefined =>
    root.querySelector(selector)?.getAttribute("content")?.trim();

  const pageTitle = root.querySelector("title")?.text?.trim();
  const siteName = metaOf('meta[property="og:site_name"]');
  const ogTitle = metaOf('meta[property="og:title"]');
  const description = metaOf('meta[name="description"]') ?? metaOf('meta[property="og:description"]');

  const brandName =
    siteName ??
    (ogTitle ? ogTitle.split(/[|–—-]/)[0].trim() : undefined) ??
    (pageTitle ? pageTitle.split(/[|–—-]/)[0].trim() : undefined) ??
    new URL(finalUrl).hostname.replace(/^www\./, "");

  /* ---- colors ---- */

  const colors: ColorHit[] = [];
  for (const node of root.querySelectorAll('meta[name="theme-color"]')) {
    const value = node.getAttribute("content")?.trim();
    const hex = value ? toHex(value) : null;
    if (hex) {
      const media = node.getAttribute("media");
      colors.push({
        hex,
        raw: value!,
        name: "theme-color",
        kind: "meta",
        foundIn: media ? `<meta name="theme-color" media="${media}">` : '<meta name="theme-color">',
      });
    }
  }
  for (const node of root.querySelectorAll('meta[name="msapplication-TileColor"]')) {
    const value = node.getAttribute("content")?.trim();
    const hex = value ? toHex(value) : null;
    if (hex) colors.push({ hex, raw: value!, name: "msapplication-TileColor", kind: "meta", foundIn: "<meta>" });
  }

  const fonts: FontHit[] = [];

  const inlineStyles = root.querySelectorAll("style");
  inlineStyles.forEach((node, index) => {
    const css = node.rawText ?? node.text ?? "";
    colors.push(...extractColorsFromCss(css, `inline <style> #${index + 1}`));
    fonts.push(...extractFontsFromCss(css, `inline <style> #${index + 1}`));
  });

  for (const node of root.querySelectorAll("[style]")) {
    const css = node.getAttribute("style");
    if (!css) continue;
    const where = `inline style attribute on <${node.tagName?.toLowerCase() ?? "element"}>`;
    fonts.push(...extractFontsFromCss(css, where));
    colors.push(...extractColorsFromCss(css, where));
  }

  /* ---- linked stylesheets ---- */

  const stylesheetUrls: string[] = [];
  for (const node of root.querySelectorAll('link[rel~="stylesheet"], link[rel="preload"][as="style"]')) {
    const href = safeResolve(node.getAttribute("href"), base);
    if (href && !stylesheetUrls.includes(href)) stylesheetUrls.push(href);
  }

  const stylesheetResults: Array<{ url: string; status: string; bytes?: number }> = [];
  for (const url of stylesheetUrls.slice(0, MAX_STYLESHEETS)) {
    try {
      const response = await fetchWithTimeout(url, options.timeout, "text/css,*/*;q=0.1");
      if (!response.ok) {
        stylesheetResults.push({ url, status: `HTTP ${response.status}` });
        continue;
      }
      const css = (await response.text()).slice(0, MAX_STYLESHEET_BYTES);
      colors.push(...extractColorsFromCss(css, url));
      fonts.push(...extractFontsFromCss(css, url));
      stylesheetResults.push({ url, status: "ok", bytes: Buffer.byteLength(css, "utf8") });
    } catch (error) {
      stylesheetResults.push({ url, status: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const url of stylesheetUrls.slice(MAX_STYLESHEETS)) {
    stylesheetResults.push({ url, status: `skipped (limit ${MAX_STYLESHEETS})` });
  }

  /* ---- asset candidates ---- */

  const candidates: AssetCandidate[] = [];
  const seenUrls = new Set<string>();

  const addCandidate = (role: string, href: string | undefined, attributes: Record<string, string> = {}) => {
    const url = safeResolve(href, base);
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    candidates.push({ role, sourceUrl: url, attributes });
  };

  for (const node of root.querySelectorAll("link[rel]")) {
    const rel = (node.getAttribute("rel") ?? "").toLowerCase();
    const href = node.getAttribute("href");
    const attributes: Record<string, string> = {};
    for (const key of ["sizes", "type", "color", "media"]) {
      const value = node.getAttribute(key);
      if (value) attributes[key] = value;
    }
    if (/\bapple-touch-icon\b/.test(rel)) addCandidate("apple-touch-icon", href, attributes);
    else if (/\bmask-icon\b/.test(rel)) addCandidate("mask-icon", href, attributes);
    else if (/\bicon\b/.test(rel)) addCandidate("icon", href, attributes);
    else if (/\bmanifest\b/.test(rel)) addCandidate("manifest", href, attributes);
  }

  // Root favicon fallback when the page declares none.
  if (!candidates.some((candidate) => candidate.role === "icon" || candidate.role === "apple-touch-icon")) {
    addCandidate("icon", new URL("/favicon.ico", base).toString(), { note: "conventional fallback" });
  }

  for (const [selector, role] of [
    ['meta[property="og:image"]', "og:image"],
    ['meta[property="og:image:secure_url"]', "og:image"],
    ['meta[name="twitter:image"]', "twitter:image"],
    ['meta[name="twitter:image:src"]', "twitter:image"],
  ] as const) {
    for (const node of root.querySelectorAll(selector)) {
      addCandidate(role, node.getAttribute("content"), {});
    }
  }

  for (const node of root.querySelectorAll("img")) {
    if (!looksLikeLogo(node)) continue;
    const src = node.getAttribute("src") ?? node.getAttribute("data-src");
    addCandidate("logo-img", src, {
      alt: node.getAttribute("alt") ?? "",
      class: node.getAttribute("class") ?? "",
    });
  }

  /* ---- web app manifest ---- */

  let webManifest: Record<string, unknown> | null = null;
  const manifestCandidate = candidates.find((candidate) => candidate.role === "manifest");
  if (manifestCandidate) {
    try {
      const response = await fetchWithTimeout(manifestCandidate.sourceUrl, options.timeout, "application/manifest+json,application/json");
      if (response.ok) {
        webManifest = (await response.json()) as Record<string, unknown>;
        for (const key of ["theme_color", "background_color"]) {
          const value = webManifest[key];
          const hex = typeof value === "string" ? toHex(value) : null;
          if (hex) {
            colors.push({ hex, raw: String(value), name: key, kind: "manifest", foundIn: manifestCandidate.sourceUrl });
          }
        }
        const icons = webManifest.icons;
        if (Array.isArray(icons)) {
          for (const icon of icons as Array<Record<string, unknown>>) {
            if (typeof icon.src === "string") {
              addCandidate("manifest-icon", new URL(icon.src, manifestCandidate.sourceUrl).toString(), {
                sizes: typeof icon.sizes === "string" ? icon.sizes : "",
                type: typeof icon.type === "string" ? icon.type : "",
              });
            }
          }
        }
      }
    } catch {
      // A missing or malformed manifest is not fatal; it is reported in sources.json.
    }
  }

  /* ---- inline svg logos ---- */

  const inlineSvgs: Array<{ file: string; markup: string; foundIn: string }> = [];
  const svgNodes = root.querySelectorAll("header svg, nav svg, a svg, [class*=logo] svg, svg[class*=logo]");
  let svgIndex = 0;
  for (const node of svgNodes) {
    const markup = node.toString();
    if (markup.length > 200000) continue;
    if (inlineSvgs.some((entry) => entry.markup === markup)) continue;
    svgIndex += 1;
    if (svgIndex > 3) break;
    inlineSvgs.push({
      file: `assets/inline-logo-${String(svgIndex).padStart(2, "0")}.svg`,
      markup: markup.startsWith("<?xml") ? markup : `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`,
      foundIn: finalUrl,
    });
  }

  /* ---- download ---- */

  const files: WrittenFile[] = [];
  const downloaded: DownloadedAsset[] = [];
  const usedNames = new Set<string>();

  const downloadable = candidates.filter((candidate) => candidate.role !== "manifest");
  const limit = options.download ? Math.min(options.maxAssets, downloadable.length) : 0;

  for (let i = 0; i < downloadable.length; i += 1) {
    const candidate = downloadable[i];
    if (i >= limit) {
      downloaded.push({
        role: candidate.role,
        file: null,
        sourceUrl: candidate.sourceUrl,
        contentType: null,
        bytes: null,
        status: "skipped",
        note: options.download ? `beyond --max-assets ${options.maxAssets}` : "--no-download",
        attributes: candidate.attributes,
      });
      continue;
    }

    try {
      const response = await fetchWithTimeout(candidate.sourceUrl, options.timeout, "image/*,*/*;q=0.5");
      if (!response.ok) {
        downloaded.push({
          role: candidate.role,
          file: null,
          sourceUrl: candidate.sourceUrl,
          contentType: response.headers.get("content-type"),
          bytes: null,
          status: "failed",
          note: `HTTP ${response.status}`,
          attributes: candidate.attributes,
        });
        continue;
      }

      const type = response.headers.get("content-type");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_ASSET_BYTES) {
        downloaded.push({
          role: candidate.role,
          file: null,
          sourceUrl: candidate.sourceUrl,
          contentType: type,
          bytes: buffer.byteLength,
          status: "skipped",
          note: `larger than ${MAX_ASSET_BYTES} bytes`,
          attributes: candidate.attributes,
        });
        continue;
      }

      const ext = extensionFor(type, candidate.sourceUrl);
      const stem = sanitizeFilename(basename(new URL(candidate.sourceUrl).pathname, ext) || candidate.role, candidate.role);
      let name = `${candidate.role}-${stem}${ext}`.replace(/-+/g, "-");
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${candidate.role}-${stem}-${suffix}${ext}`.replace(/-+/g, "-");
        suffix += 1;
      }
      usedNames.add(name);

      const relPath = `assets/${name}`;
      await mkdir(join(outDir, "assets"), { recursive: true });
      await writeFile(join(outDir, relPath), buffer);
      files.push({ path: relPath, type: type ?? "application/octet-stream", bytes: buffer.byteLength });
      downloaded.push({
        role: candidate.role,
        file: relPath,
        sourceUrl: candidate.sourceUrl,
        contentType: type,
        bytes: buffer.byteLength,
        status: "downloaded",
        attributes: candidate.attributes,
      });
    } catch (error) {
      downloaded.push({
        role: candidate.role,
        file: null,
        sourceUrl: candidate.sourceUrl,
        contentType: null,
        bytes: null,
        status: "failed",
        note: error instanceof Error ? error.message : String(error),
        attributes: candidate.attributes,
      });
    }
  }

  for (const svg of inlineSvgs) {
    if (!options.download) {
      downloaded.push({
        role: "inline-svg-logo",
        file: null,
        sourceUrl: svg.foundIn,
        contentType: "image/svg+xml",
        bytes: null,
        status: "skipped",
        note: "--no-download",
        attributes: {},
      });
      continue;
    }
    await mkdir(join(outDir, "assets"), { recursive: true });
    await writeFile(join(outDir, svg.file), svg.markup, "utf8");
    const bytes = Buffer.byteLength(svg.markup, "utf8");
    files.push({ path: svg.file, type: "image/svg+xml", bytes });
    downloaded.push({
      role: "inline-svg-logo",
      file: svg.file,
      sourceUrl: svg.foundIn,
      contentType: "image/svg+xml",
      bytes,
      status: "downloaded",
      attributes: { note: "extracted from the page markup, not a separate request" },
    });
  }

  /* ---- dedupe colors and fonts ---- */

  const KIND_RANK: Record<ColorKind, number> = {
    meta: 0,
    manifest: 1,
    "custom-property": 2,
    declaration: 3,
  };

  // Utility-framework internals (Tailwind's --tw-*, for example) are real colors
  // but they are plumbing, not brand tokens, so they rank below hand-authored ones.
  const rankOf = (hit: { kind: ColorKind; name: string }): number =>
    KIND_RANK[hit.kind] + (/^--(tw|bs-internal|un)-/.test(hit.name) ? 1.5 : 0);

  const paletteMap = new Map<
    string,
    ColorHit & { occurrences: number; sources: string[]; properties: string[]; kinds: ColorKind[] }
  >();
  for (const hit of colors) {
    const existing = paletteMap.get(hit.hex);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.sources.includes(hit.foundIn)) existing.sources.push(hit.foundIn);
      if (!existing.properties.includes(hit.name)) existing.properties.push(hit.name);
      if (!existing.kinds.includes(hit.kind)) existing.kinds.push(hit.kind);
      if (rankOf(hit) < rankOf(existing)) {
        existing.kind = hit.kind;
        existing.name = hit.name;
        existing.raw = hit.raw;
      }
      continue;
    }
    paletteMap.set(hit.hex, {
      ...hit,
      occurrences: 1,
      sources: [hit.foundIn],
      properties: [hit.name],
      kinds: [hit.kind],
    });
  }
  const palette = [...paletteMap.values()]
    .sort((a, b) => rankOf(a) - rankOf(b) || b.occurrences - a.occurrences || a.hex.localeCompare(b.hex))
    .slice(0, MAX_PALETTE_ENTRIES);

  const fontMap = new Map<string, FontHit & { occurrences: number; sources: string[] }>();
  for (const hit of fonts) {
    const key = hit.families.join("|").toLowerCase();
    const existing = fontMap.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.sources.includes(hit.foundIn)) existing.sources.push(hit.foundIn);
      continue;
    }
    fontMap.set(key, { ...hit, occurrences: 1, sources: [hit.foundIn] });
  }
  const typography = [...fontMap.values()].sort((a, b) => b.occurrences - a.occurrences);

  /* ---- write outputs ---- */

  const writeText = async (relPath: string, contents: string, type: string) => {
    const targetPath = join(outDir, relPath);
    await mkdir(join(targetPath, ".."), { recursive: true });
    await writeFile(targetPath, contents, "utf8");
    files.push({ path: relPath, type, bytes: Buffer.byteLength(contents, "utf8") });
  };

  const brandProfile = {
    requestedUrl: target.toString(),
    finalUrl,
    fetchedAt: new Date().toISOString(),
    contentType,
    brandName,
    pageTitle: pageTitle ?? null,
    siteName: siteName ?? null,
    description: description ?? null,
    webManifest: webManifest
      ? {
          name: webManifest.name ?? null,
          shortName: webManifest.short_name ?? null,
          themeColor: webManifest.theme_color ?? null,
          backgroundColor: webManifest.background_color ?? null,
          iconCount: Array.isArray(webManifest.icons) ? webManifest.icons.length : 0,
        }
      : null,
    assets: downloaded,
    palette,
    typography,
    stylesheets: stylesheetResults,
    counts: {
      assetsDiscovered: candidates.length + inlineSvgs.length,
      assetsDownloaded: downloaded.filter((asset) => asset.status === "downloaded").length,
      colors: palette.length,
      fontStacks: typography.length,
      stylesheetsInspected: stylesheetResults.filter((entry) => entry.status === "ok").length,
    },
  };

  await writeText("brand-profile.json", `${JSON.stringify(brandProfile, null, 2)}\n`, "application/json");

  await writeText(
    "palette.json",
    `${JSON.stringify(
      {
        source: finalUrl,
        colors: palette.map((entry) => ({
          hex: entry.hex,
          declaredAs: entry.raw,
          property: entry.name,
          properties: entry.properties,
          kind: entry.kind,
          kinds: entry.kinds,
          occurrences: entry.occurrences,
          foundIn: entry.sources,
        })),
      },
      null,
      2,
    )}\n`,
    "application/json",
  );

  await writeText(
    "sources.json",
    `${JSON.stringify(
      {
        page: finalUrl,
        fetchedAt: brandProfile.fetchedAt,
        userAgent: USER_AGENT,
        assets: downloaded.map((asset) => ({
          file: asset.file,
          role: asset.role,
          sourceUrl: asset.sourceUrl,
          status: asset.status,
          note: asset.note ?? null,
          contentType: asset.contentType,
          bytes: asset.bytes,
        })),
        stylesheets: stylesheetResults,
      },
      null,
      2,
    )}\n`,
    "application/json",
  );

  const profileMd = `# Brand profile — ${brandName}

| Field | Value |
|-------|-------|
| Requested URL | ${target.toString()} |
| Final URL | ${finalUrl} |
| Fetched at | ${brandProfile.fetchedAt} |
| Page title | ${pageTitle ?? "_not found_"} |
| og:site_name | ${siteName ?? "_not found_"} |
| Description | ${description ?? "_not found_"} |
| Assets discovered | ${brandProfile.counts.assetsDiscovered} |
| Assets downloaded | ${brandProfile.counts.assetsDownloaded} |
| Colors found | ${palette.length} |
| Font stacks found | ${typography.length} |
| Stylesheets inspected | ${brandProfile.counts.stylesheetsInspected} of ${stylesheetUrls.length} linked |

## Assets

${
  downloaded.length === 0
    ? "_No asset candidates were found on this page._"
    : `| Role | File | Status | Source |
|------|------|--------|--------|
${downloaded
  .map(
    (asset) =>
      `| ${asset.role} | ${asset.file ? `\`${asset.file}\`` : "—"} | ${asset.status}${
        asset.note ? ` (${asset.note})` : ""
      } | ${asset.sourceUrl} |`,
  )
  .join("\n")}`
}

## Palette

${
  palette.length === 0
    ? "_No colors were declared in a way this skill could read. The site may set colors from a JS bundle or from a stylesheet beyond the fetch limit._"
    : `Colors are ranked by how authoritative the source is: \`<meta>\` and web app
manifest first, then CSS custom properties, then ordinary declarations.

| Hex | Declared as | Property | Kind | Seen | First source |
|-----|-------------|----------|------|------|--------------|
${palette
  .map(
    (entry) =>
      `| \`${entry.hex}\` | \`${entry.raw}\` | \`${entry.name}\` | ${entry.kind} | ${entry.occurrences}x | ${entry.sources[0]} |`,
  )
  .join("\n")}`
}

## Typography

${
  typography.length === 0
    ? "_No font-family declarations were found in the HTML or the stylesheets that were fetched._"
    : typography
        .slice(0, 12)
        .map((entry) => `- **${entry.families[0]}** — \`${entry.stack}\` (${entry.property}, ${entry.occurrences}x)`)
        .join("\n")
}

${webManifest ? `## Web app manifest\n\n- Name: ${String(webManifest.name ?? "—")}\n- Short name: ${String(webManifest.short_name ?? "—")}\n- Theme color: ${String(webManifest.theme_color ?? "—")}\n- Background color: ${String(webManifest.background_color ?? "—")}\n- Icons declared: ${Array.isArray(webManifest.icons) ? webManifest.icons.length : 0}\n` : ""}
## Provenance and reuse

Every file in \`assets/\` was downloaded from the URL recorded against it in
\`sources.json\`. These are someone else's trademarks. Confirm you have the right
to use them before you ship anything, and check the site's brand or press page
for official guidelines and higher-resolution originals.
`;

  await writeText("brand-profile.md", profileMd, "text/markdown");

  const typographyMd = `# Typography — ${brandName}

Source: ${finalUrl}

${
  typography.length === 0
    ? `No \`font-family\` declarations were readable.

This usually means one of:

- fonts are set inside a JavaScript bundle rather than CSS,
- the stylesheet that declares them is beyond the ${MAX_STYLESHEETS}-stylesheet fetch limit,
- or the page uses only system font keywords that this skill filters out.

Open the site's devtools > Computed > font-family on a heading and a paragraph to confirm by hand.`
    : typography
        .map(
          (entry, index) => `## ${index + 1}. ${entry.families[0]}

\`\`\`css
${entry.property}: ${entry.stack};
\`\`\`

- Fallback chain: ${entry.families.join(" → ")}
- Declared ${entry.occurrences} time(s)
- Found in: ${entry.sources.slice(0, 4).join(", ")}${entry.sources.length > 4 ? `, +${entry.sources.length - 4} more` : ""}
`,
        )
        .join("\n")
}

## Matching the type without the font files

This skill does not download webfont binaries — licensing almost never permits
redistributing them. To reproduce the look:

1. Take the first family in each stack above and look it up on the foundry's or
   Google Fonts' site to confirm the license.
2. Keep the whole fallback chain, not just the first name; that is what the site
   actually renders on machines missing the webfont.
3. Match weights and optical sizes from the site's own CSS before matching the
   family — weight mismatch reads as "wrong" faster than family mismatch.
`;

  await writeText("typography.md", typographyMd, "text/markdown");

  const manifest = {
    skill: "brand-assets",
    version: VERSION,
    generatedAt: brandProfile.fetchedAt,
    input: {
      url: target.toString(),
      finalUrl,
      timeout: options.timeout,
      maxAssets: options.maxAssets,
      download: options.download,
    },
    brandName,
    counts: brandProfile.counts,
    outputDir: outDir,
    files: files.slice().sort((a, b) => a.path.localeCompare(b.path)),
  };

  const manifestPath = join(outDir, "manifest.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ...manifest, brandProfile }, null, 2)}\n`);
    return;
  }

  console.log(`brand-assets: wrote ${files.length + 1} files to ${outDir}`);
  console.log(`  brand      ${brandName}`);
  console.log(`  page       ${finalUrl}`);
  console.log(
    `  assets     ${brandProfile.counts.assetsDownloaded} downloaded / ${brandProfile.counts.assetsDiscovered} discovered`,
  );
  console.log(`  palette    ${palette.length} color(s)${palette.length ? `: ${palette.slice(0, 6).map((c) => c.hex).join(", ")}` : ""}`);
  console.log(`  typography ${typography.length} font stack(s)${typography.length ? `: ${typography.slice(0, 3).map((f) => f.families[0]).join(", ")}` : ""}`);
  console.log(`  css        ${brandProfile.counts.stylesheetsInspected} of ${stylesheetUrls.length} linked stylesheet(s) inspected`);
  for (const asset of downloaded.filter((entry) => entry.status === "failed")) {
    console.log(`  ! failed   ${asset.role} ${asset.sourceUrl} (${asset.note})`);
  }
  console.log(`  manifest   ${relative(process.cwd(), manifestPath) || manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`brand-assets: ${message}\n`);
  process.exit(1);
});
