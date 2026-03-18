#!/usr/bin/env bun
/**
 * skill-colorextract — Extract color palettes from screenshots via AI Vision
 * Supports multiple providers: anthropic, openai, xai, gemini
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { extname } from "path";
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

export interface ExtractedColor {
  hex: string;
  name: string;           // human name like "slate blue" or "warm white"
  usage: string;          // "background", "primary text", "accent", "border", "button fill", etc.
  frequency: "dominant" | "accent" | "minor";
}

export interface ColorPalette {
  primary: string | null;
  secondary: string | null;
  accent: string | null;
  background: string | null;
  text: string | null;
  neutral: string[];
  all: ExtractedColor[];
}

export interface ColorExtractResult {
  source: string;
  colors: ExtractedColor[];
  palette: ColorPalette;
  provider: VisionProvider;
  model: string;
  openStylesProfile: {
    name: string;
    displayName: string;
    category: string;
    description: string;
    colors: Record<string, string>;
    principles: string[];
    tags: string[];
  };
  rawAnalysis: string;
}

// ============================================================================
// Media type detection
// ============================================================================

function getMediaType(imagePath: string): "image/png" | "image/jpeg" | "image/webp" | "image/gif" {
  const ext = extname(imagePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".png":
    default:
      return "image/png";
  }
}

// ============================================================================
// Core extraction function
// ============================================================================

export async function extractColors(
  imagePath: string,
  options?: { provider?: VisionProvider; model?: string }
): Promise<ColorExtractResult> {
  const provider = options?.provider ?? detectProvider();
  if (!provider) {
    throw new Error(
      "No AI provider API key found. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY"
    );
  }

  const isUrl = imagePath.startsWith("http://") || imagePath.startsWith("https://");

  let imageBase64: string;
  let mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";

  if (isUrl) {
    // Fetch the image from the URL
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    imageBase64 = Buffer.from(buffer).toString("base64");

    // Try to detect media type from URL extension, fall back to content-type header
    const urlMediaType = getMediaType(imagePath);
    const contentType = response.headers.get("content-type");
    if (urlMediaType === "image/png" && contentType && contentType.startsWith("image/")) {
      mediaType = contentType.split(";")[0].trim() as typeof mediaType;
    } else {
      mediaType = urlMediaType;
    }
  } else {
    // Read local file
    if (!existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }
    const fileBuffer = readFileSync(imagePath);
    imageBase64 = fileBuffer.toString("base64");
    mediaType = getMediaType(imagePath);
  }

  const prompt = `Analyze this screenshot/image and extract ALL colors used. For each color provide:
1. Exact hex value (#RRGGBB)
2. Human-readable name
3. Usage context (what is it used for in the UI)
4. Frequency (dominant/accent/minor)

Then categorize into a design palette:
- primary: the main brand/action color
- secondary: supporting color
- accent: highlight/CTA color
- background: main background
- text: primary text color
- neutral: array of neutral/gray tones (can be empty array)

Finally, suggest what design style this resembles (minimalist/brutalist/corporate/startup/glassmorphism/editorial/retro/material/neubrutalism/neumorphic).

Respond ONLY with valid JSON matching this schema:
{
  "colors": [{ "hex": "#...", "name": "...", "usage": "...", "frequency": "dominant|accent|minor" }],
  "palette": { "primary": "#...", "secondary": "#...", "accent": "#...", "background": "#...", "text": "#...", "neutral": ["#..."] },
  "styleCategory": "minimalist",
  "styleReasoning": "..."
}`;

  const result = await analyzeImage(imageBase64, mediaType, prompt, {
    provider,
    model: options?.model,
    systemPrompt: "You are a design systems expert and color analyst. Extract colors precisely.",
    jsonMode: true,
    maxTokens: 2048,
  });

  const rawAnalysis = result.text;

  const parsed = parseJsonResponse(rawAnalysis) as {
    colors: ExtractedColor[];
    palette: {
      primary: string | null;
      secondary: string | null;
      accent: string | null;
      background: string | null;
      text: string | null;
      neutral: string[];
    };
    styleCategory: string;
    styleReasoning: string;
  };

  const { colors, palette, styleCategory, styleReasoning } = parsed;

  // Build full palette with all colors attached
  const fullPalette: ColorPalette = {
    primary: palette.primary ?? null,
    secondary: palette.secondary ?? null,
    accent: palette.accent ?? null,
    background: palette.background ?? null,
    text: palette.text ?? null,
    neutral: Array.isArray(palette.neutral) ? palette.neutral : [],
    all: colors,
  };

  // Capitalize style category
  const capitalizedCategory =
    styleCategory.charAt(0).toUpperCase() + styleCategory.slice(1);

  // Build open-styles compatible profile
  const openStylesProfile = {
    name: `extracted-${Date.now()}`,
    displayName: "Extracted Style",
    category: capitalizedCategory,
    description: styleReasoning,
    colors: {
      ...(palette.primary ? { primary: palette.primary } : {}),
      ...(palette.secondary ? { secondary: palette.secondary } : {}),
      ...(palette.accent ? { accent: palette.accent } : {}),
      ...(palette.background ? { background: palette.background } : {}),
      ...(palette.text ? { text: palette.text } : {}),
    } as Record<string, string>,
    principles: ["Derived from visual analysis"],
    tags: ["extracted", "auto-generated"],
  };

  return {
    source: imagePath,
    colors,
    palette: fullPalette,
    provider: result.provider,
    model: result.model,
    openStylesProfile,
    rawAnalysis,
  };
}

// ============================================================================
// CLI
// ============================================================================

type OutputFormat = "colors" | "profile" | "full";

interface CliOptions {
  image: string | null;
  format: OutputFormat;
  output: string | null;
  provider: VisionProvider | null;
  model: string | null;
}

function parseArgs(argv: string[]): { command: string; options: CliOptions } {
  const args = argv.slice(2); // strip node/bun + script path

  let command = "help";
  const options: CliOptions = {
    image: null,
    format: "full",
    output: null,
    provider: null,
    model: null,
  };

  if (args.length === 0) {
    return { command: "help", options };
  }

  // First positional arg is the command
  const firstArg = args[0];
  if (firstArg === "extract") {
    command = "extract";
  } else if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
    command = "help";
  } else {
    command = "help";
  }

  // Parse flags
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--image" || arg === "-i") && args[i + 1]) {
      options.image = args[++i];
    } else if ((arg === "--format" || arg === "-f") && args[i + 1]) {
      const fmt = args[++i];
      if (fmt === "colors" || fmt === "profile" || fmt === "full") {
        options.format = fmt;
      } else {
        console.error(`Invalid format: ${fmt}. Use: colors, profile, full`);
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
    }
  }

  return { command, options };
}

function printHelp(): void {
  const available = listAvailableProviders();
  console.log(`
skill-colorextract — Extract color palettes from screenshots and images via AI Vision

USAGE
  skill-colorextract extract --image <path-or-url> [options]
  skill-colorextract help

COMMANDS
  extract   Analyze an image and extract its color palette
  help      Show this help message

OPTIONS
  --image, -i <path|url>   Path to local image or HTTP/HTTPS URL (required)
  --format, -f <format>    Output format: colors | profile | full (default: full)
  --output, -o <file>      Write JSON result to file instead of stdout
  --provider <name>        AI provider: anthropic | openai | xai | gemini (auto-detected)
  --model <name>           Model override (uses provider default if not set)

FORMATS
  colors    Print only the extracted colors array
  profile   Print only the open-styles compatible profile object
  full      Print the complete extraction result (default)

EXAMPLES
  skill-colorextract extract --image ./screenshot.png
  skill-colorextract extract --image https://example.com/screenshot.png
  skill-colorextract extract --image ./screenshot.png --format profile
  skill-colorextract extract --image ./screenshot.png --output ./colors.json
  skill-colorextract extract --image ./screenshot.png --provider openai
  skill-colorextract extract --image ./screenshot.png --provider gemini --model gemini-2.0-flash

ENVIRONMENT
  ANTHROPIC_API_KEY   Claude API key (anthropic provider)
  OPENAI_API_KEY      OpenAI API key (openai provider)
  XAI_API_KEY         xAI API key (xai provider)
  GEMINI_API_KEY      Google Gemini API key (gemini provider)

AVAILABLE PROVIDERS
  ${available.length > 0 ? available.join(", ") : "(none — set an API key)"}
`);
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv);

  if (command === "help") {
    printHelp();
    process.exit(0);
  }

  if (command === "extract") {
    // Check for a provider (auto-detect or explicit)
    const provider = options.provider ?? detectProvider();
    if (!provider) {
      console.error("Error: No AI provider API key found.");
      console.error("Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY");
      process.exit(1);
    }

    // Validate image argument
    if (!options.image) {
      console.error("Error: --image <path-or-url> is required.");
      console.error("Run `skill-colorextract help` for usage.");
      process.exit(1);
    }

    // Validate local file exists (URLs are validated during fetch)
    const isUrl =
      options.image.startsWith("http://") ||
      options.image.startsWith("https://");
    if (!isUrl && !existsSync(options.image)) {
      console.error(`Error: Image file not found: ${options.image}`);
      process.exit(1);
    }

    try {
      const result = await extractColors(options.image, {
        provider: options.provider ?? undefined,
        model: options.model ?? undefined,
      });

      // Determine output value based on format
      let output: unknown;
      if (options.format === "colors") {
        output = result.colors;
      } else if (options.format === "profile") {
        output = result.openStylesProfile;
      } else {
        // full — omit rawAnalysis for cleaner output
        output = {
          source: result.source,
          provider: result.provider,
          model: result.model,
          colors: result.colors,
          palette: result.palette,
          openStylesProfile: result.openStylesProfile,
        };
      }

      const json = JSON.stringify(output, null, 2);

      if (options.output) {
        writeFileSync(options.output, json, "utf-8");
        console.log(`Result written to: ${options.output}`);
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
