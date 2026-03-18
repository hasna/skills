#!/usr/bin/env bun
/**
 * skill-siteanalyze — Analyze any website's design system via Playwright + AI Vision
 * Supports multiple providers: anthropic, openai, xai, gemini
 */
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  analyzeImage,
  detectProvider,
  listAvailableProviders,
  parseJsonResponse,
  type VisionProvider,
} from "../../_common/vision.js";

// ============================================================================
// Types
// ============================================================================

export interface DesignColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
  border?: string;
  muted?: string;
  [key: string]: string | undefined;
}

export interface TypographyScale {
  fontFamilies: string[];
  sizes: string[];
  weights: string[];
  lineHeights?: string[];
}

export interface ComponentPattern {
  name: string;
  description: string;
}

export interface SiteAnalyzeResult {
  url: string;
  framework: string | null;
  hasShadcn: boolean;
  hasTailwind: boolean;
  colors: DesignColors;
  typography: TypographyScale;
  components: ComponentPattern[];
  provider: VisionProvider | null;
  model: string | null;
  openStylesProfile: {
    name: string;
    displayName: string;
    category: string;
    description: string;
    colors: Record<string, string>;
    typography: TypographyScale;
    framework: string | null;
    tags: string[];
  };
  screenshotPath?: string;
  rawAnalysis?: string;
}

// ============================================================================
// HTML/CSS analysis (quick mode — no browser needed)
// ============================================================================

async function fetchPageSource(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; skill-siteanalyze/1.0; +https://github.com/hasna/skills)",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function detectFrameworkFromHtml(html: string): {
  hasShadcn: boolean;
  hasTailwind: boolean;
  framework: string | null;
} {
  const lower = html.toLowerCase();
  const hasShadcn =
    lower.includes("shadcn") ||
    lower.includes("@radix-ui") ||
    lower.includes("radix-ui") ||
    lower.includes("cmdk") ||
    lower.includes("data-radix");
  const hasTailwind =
    lower.includes("tailwind") ||
    lower.includes("tw-") ||
    /class="[^"]*\b(flex|grid|p-\d|m-\d|text-\w+|bg-\w+|border-\w+)\b/.test(html);

  let framework: string | null = null;
  if (hasShadcn) {
    framework = "shadcn/ui";
  } else if (lower.includes("mui") || lower.includes("material-ui")) {
    framework = "Material UI";
  } else if (lower.includes("chakra")) {
    framework = "Chakra UI";
  } else if (lower.includes("mantine")) {
    framework = "Mantine";
  } else if (lower.includes("antd") || lower.includes("ant-design")) {
    framework = "Ant Design";
  } else if (lower.includes("bootstrap")) {
    framework = "Bootstrap";
  } else if (hasTailwind) {
    framework = "Tailwind CSS";
  }

  return { hasShadcn, hasTailwind, framework };
}

function extractColorsFromCss(html: string): DesignColors {
  const colors: DesignColors = {};
  const hexPattern = /#([0-9A-Fa-f]{3,8})\b/g;
  const cssVarPattern = /--[\w-]+:\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/g;

  // Try to extract CSS custom properties (most reliable)
  const varMatches = [...html.matchAll(cssVarPattern)].slice(0, 20);
  if (varMatches.length > 0) {
    for (const match of varMatches) {
      const varName = match[0].split(":")[0].trim();
      const value = match[1].trim();
      if (varName.includes("primary")) colors.primary = value;
      else if (varName.includes("secondary")) colors.secondary = value;
      else if (varName.includes("accent")) colors.accent = value;
      else if (varName.includes("background") || varName.includes("bg")) colors.background = value;
      else if (varName.includes("foreground") || varName.includes("text")) colors.text = value;
      else if (varName.includes("border")) colors.border = value;
      else if (varName.includes("muted")) colors.muted = value;
    }
  }

  // Fall back to raw hex extraction from inline styles
  if (Object.keys(colors).length === 0) {
    const hexMatches = [...html.matchAll(hexPattern)].map((m) => m[0]);
    const unique = [...new Set(hexMatches)].slice(0, 5);
    if (unique[0]) colors.primary = unique[0];
    if (unique[1]) colors.secondary = unique[1];
    if (unique[2]) colors.accent = unique[2];
  }

  return colors;
}

// ============================================================================
// Vision-based analysis
// ============================================================================

async function captureScreenshot(url: string): Promise<string | null> {
  // Try to use playwright if available
  try {
    // Dynamic import so the skill works without playwright installed
    const { chromium } = await import("playwright" as never) as {
      chromium: {
        launch: (opts?: Record<string, unknown>) => Promise<{
          newPage: () => Promise<{
            goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
            screenshot: (opts?: Record<string, unknown>) => Promise<Buffer>;
            close: () => Promise<void>;
          }>;
          close: () => Promise<void>;
        }>;
      };
    };

    const tmpDir = join(tmpdir(), "skill-siteanalyze");
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }
    const screenshotPath = join(tmpDir, `screenshot-${Date.now()}.png`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const buffer = await page.screenshot({ path: screenshotPath, fullPage: false });
    await page.close();
    await browser.close();

    return screenshotPath;
  } catch {
    return null;
  }
}

async function analyzeScreenshot(
  screenshotPath: string,
  url: string,
  options: { provider?: VisionProvider; model?: string }
): Promise<{
  colors: DesignColors;
  typography: TypographyScale;
  components: ComponentPattern[];
  styleCategory: string;
  description: string;
  rawAnalysis: string;
  provider: VisionProvider;
  model: string;
}> {
  const { readFileSync } = await import("fs");
  const imageBase64 = readFileSync(screenshotPath).toString("base64");

  const prompt = `Analyze this website screenshot from ${url}.

Extract:
1. Color palette — primary, secondary, accent, background, text, border, muted colors (hex values)
2. Typography — font families used, size scale, font weights
3. UI components — list the main component patterns you see (buttons, cards, nav, etc.)
4. Design style category (minimalist/corporate/startup/editorial/material/glassmorphism/brutalist/neubrutalism)
5. Brief description of the overall design system

Respond ONLY with valid JSON:
{
  "colors": {
    "primary": "#...",
    "secondary": "#...",
    "accent": "#...",
    "background": "#...",
    "text": "#...",
    "border": "#...",
    "muted": "#..."
  },
  "typography": {
    "fontFamilies": ["..."],
    "sizes": ["xs", "sm", "base", "lg", "xl", "2xl"],
    "weights": ["400", "500", "600", "700"]
  },
  "components": [
    { "name": "Button", "description": "Rounded pill buttons with primary color fill" }
  ],
  "styleCategory": "minimalist",
  "description": "..."
}`;

  const result = await analyzeImage(imageBase64, "image/png", prompt, {
    provider: options.provider,
    model: options.model,
    jsonMode: true,
    maxTokens: 2048,
  });

  const parsed = parseJsonResponse(result.text) as {
    colors: DesignColors;
    typography: TypographyScale;
    components: ComponentPattern[];
    styleCategory: string;
    description: string;
  };

  return {
    colors: parsed.colors ?? {},
    typography: parsed.typography ?? { fontFamilies: [], sizes: [], weights: [] },
    components: parsed.components ?? [],
    styleCategory: parsed.styleCategory ?? "unknown",
    description: parsed.description ?? "",
    rawAnalysis: result.text,
    provider: result.provider,
    model: result.model,
  };
}

// ============================================================================
// Core analysis function
// ============================================================================

export async function analyzeSite(
  url: string,
  options?: {
    provider?: VisionProvider;
    model?: string;
    quickMode?: boolean; // skip screenshot/vision — HTML analysis only
  }
): Promise<SiteAnalyzeResult> {
  // Fetch HTML for framework/color detection
  const html = await fetchPageSource(url);
  const { hasShadcn, hasTailwind, framework } = detectFrameworkFromHtml(html);
  const quickColors = extractColorsFromCss(html);

  const availableProviders = listAvailableProviders();
  const useVision = !options?.quickMode && availableProviders.length > 0;

  if (!useVision) {
    // Quick mode or no provider available — return HTML analysis only
    return {
      url,
      framework,
      hasShadcn,
      hasTailwind,
      colors: quickColors,
      typography: { fontFamilies: [], sizes: [], weights: [] },
      components: [],
      provider: null,
      model: null,
      openStylesProfile: {
        name: `site-${Date.now()}`,
        displayName: url,
        category: framework ?? "Unknown",
        description: `Design system extracted from ${url} (HTML analysis only)`,
        colors: quickColors as Record<string, string>,
        typography: { fontFamilies: [], sizes: [], weights: [] },
        framework,
        tags: [
          "extracted",
          "auto-generated",
          ...(hasShadcn ? ["shadcn"] : []),
          ...(hasTailwind ? ["tailwind"] : []),
        ],
      },
    };
  }

  // Vision-based analysis
  const screenshotPath = await captureScreenshot(url);
  let visionResult: Awaited<ReturnType<typeof analyzeScreenshot>> | null = null;

  if (screenshotPath) {
    visionResult = await analyzeScreenshot(screenshotPath, url, {
      provider: options?.provider,
      model: options?.model,
    });
  }

  const colors = visionResult?.colors ?? quickColors;
  const typography = visionResult?.typography ?? { fontFamilies: [], sizes: [], weights: [] };
  const components = visionResult?.components ?? [];
  const styleCategory = visionResult?.styleCategory ?? framework ?? "Unknown";
  const description =
    visionResult?.description ??
    `Design system extracted from ${url}`;

  return {
    url,
    framework,
    hasShadcn,
    hasTailwind,
    colors,
    typography,
    components,
    provider: visionResult?.provider ?? null,
    model: visionResult?.model ?? null,
    screenshotPath: screenshotPath ?? undefined,
    rawAnalysis: visionResult?.rawAnalysis,
    openStylesProfile: {
      name: `site-${Date.now()}`,
      displayName: url,
      category: styleCategory,
      description,
      colors: colors as Record<string, string>,
      typography,
      framework,
      tags: [
        "extracted",
        "auto-generated",
        ...(hasShadcn ? ["shadcn"] : []),
        ...(hasTailwind ? ["tailwind"] : []),
      ],
    },
  };
}

// ============================================================================
// CLI
// ============================================================================

type OutputFormat = "profile" | "colors" | "full";

interface CliOptions {
  url: string | null;
  format: OutputFormat;
  output: string | null;
  provider: VisionProvider | null;
  model: string | null;
  quickMode: boolean;
}

function parseArgs(argv: string[]): { command: string; options: CliOptions } {
  const args = argv.slice(2);

  let command = "help";
  const options: CliOptions = {
    url: null,
    format: "full",
    output: null,
    provider: null,
    model: null,
    quickMode: false,
  };

  if (args.length === 0) {
    return { command: "help", options };
  }

  const firstArg = args[0];
  if (firstArg === "analyze") {
    command = "analyze";
  } else if (
    firstArg === "help" ||
    firstArg === "--help" ||
    firstArg === "-h"
  ) {
    command = "help";
  } else if (firstArg.startsWith("http://") || firstArg.startsWith("https://")) {
    // Allow `skill-siteanalyze <url>` shorthand
    command = "analyze";
    options.url = firstArg;
    args.splice(0, 1);
    // Re-parse remaining flags below (shift args[0] already used)
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if ((arg === "--format" || arg === "-f") && args[i + 1]) {
        const fmt = args[++i];
        if (fmt === "profile" || fmt === "colors" || fmt === "full") {
          options.format = fmt;
        }
      } else if ((arg === "--output" || arg === "-o") && args[i + 1]) {
        options.output = args[++i];
      } else if (arg === "--provider" && args[i + 1]) {
        const p = args[++i] as VisionProvider;
        if (["anthropic", "openai", "xai", "gemini"].includes(p)) options.provider = p;
      } else if (arg === "--model" && args[i + 1]) {
        options.model = args[++i];
      } else if (arg === "--quick") {
        options.quickMode = true;
      }
    }
    return { command, options };
  } else {
    command = "help";
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--url" || arg === "-u") && args[i + 1]) {
      options.url = args[++i];
    } else if ((arg === "--format" || arg === "-f") && args[i + 1]) {
      const fmt = args[++i];
      if (fmt === "profile" || fmt === "colors" || fmt === "full") {
        options.format = fmt;
      } else {
        console.error(`Invalid format: ${fmt}. Use: profile, colors, full`);
        process.exit(1);
      }
    } else if ((arg === "--output" || arg === "-o") && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === "--provider" && args[i + 1]) {
      const p = args[++i] as VisionProvider;
      if (["anthropic", "openai", "xai", "gemini"].includes(p)) {
        options.provider = p;
      } else {
        console.error(`Invalid provider: ${p}. Use: anthropic, openai, xai, gemini`);
        process.exit(1);
      }
    } else if (arg === "--model" && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === "--quick") {
      options.quickMode = true;
    }
  }

  return { command, options };
}

function printHelp(): void {
  const available = listAvailableProviders();
  console.log(`
skill-siteanalyze — Analyze any website's design system via Playwright + AI Vision

USAGE
  skill-siteanalyze <url> [options]
  skill-siteanalyze analyze --url <url> [options]
  skill-siteanalyze help

COMMANDS
  analyze   Analyze a website's design system (default when URL is given)
  help      Show this help message

OPTIONS
  --url, -u <url>          Website URL to analyze (required)
  --format, -f <format>    Output format: profile | colors | full (default: full)
  --output, -o <file>      Write JSON result to file instead of stdout
  --provider <name>        AI provider: anthropic | openai | xai | gemini (auto-detected)
  --model <name>           Model override (uses provider default if not set)
  --quick                  Skip AI vision analysis — HTML/CSS analysis only

FORMATS
  profile   Print only the open-styles compatible profile object
  colors    Print only the extracted colors
  full      Print the complete analysis result (default)

EXAMPLES
  skill-siteanalyze https://vercel.com
  skill-siteanalyze https://stripe.com --format profile
  skill-siteanalyze https://tailwindcss.com --provider openai
  skill-siteanalyze https://shadcn.com --quick
  skill-siteanalyze analyze --url https://example.com --output ./profile.json

ENVIRONMENT
  ANTHROPIC_API_KEY   Claude API key (anthropic provider)
  OPENAI_API_KEY      OpenAI API key (openai provider)
  XAI_API_KEY         xAI API key (xai provider)
  GEMINI_API_KEY      Google Gemini API key (gemini provider)

AVAILABLE PROVIDERS
  ${available.length > 0 ? available.join(", ") : "(none — set an API key for vision analysis, or use --quick)"}
`);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv);

  if (command === "help") {
    printHelp();
    process.exit(0);
  }

  if (command === "analyze") {
    if (!options.url) {
      console.error("Error: URL is required.");
      console.error(
        "Run `skill-siteanalyze help` for usage."
      );
      process.exit(1);
    }

    const available = listAvailableProviders();
    if (!options.quickMode && available.length === 0) {
      console.warn(
        "Warning: No AI provider API key found — running in quick mode (HTML analysis only)."
      );
      console.warn(
        "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, or GEMINI_API_KEY for visual analysis."
      );
      options.quickMode = true;
    }

    try {
      console.error(`Analyzing ${options.url}...`);

      const result = await analyzeSite(options.url, {
        provider: options.provider ?? undefined,
        model: options.model ?? undefined,
        quickMode: options.quickMode,
      });

      let output: unknown;
      if (options.format === "colors") {
        output = result.colors;
      } else if (options.format === "profile") {
        output = result.openStylesProfile;
      } else {
        output = {
          url: result.url,
          framework: result.framework,
          hasShadcn: result.hasShadcn,
          hasTailwind: result.hasTailwind,
          colors: result.colors,
          typography: result.typography,
          components: result.components,
          provider: result.provider,
          model: result.model,
          openStylesProfile: result.openStylesProfile,
        };
      }

      const json = JSON.stringify(output, null, 2);

      if (options.output) {
        writeFileSync(options.output, json, "utf-8");
        console.error(`Result written to: ${options.output}`);
      } else {
        console.log(json);
      }
    } catch (error) {
      console.error(
        "Error:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  }
}

main();
