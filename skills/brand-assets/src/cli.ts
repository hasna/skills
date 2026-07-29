import { VERSION } from "./constants.js";
import type { CliOptions, HtmlNode } from "./types.js";

export async function loadHtmlParser(): Promise<(html: string) => HtmlNode> {
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

export function parseArgs(argv: string[]): CliOptions {
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

export function normalizeUrl(input: string): URL {
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

