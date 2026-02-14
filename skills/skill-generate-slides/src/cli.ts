/**
 * CLI argument parsing and help text
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { SlideOptions } from "./parse.js";

export function parseArguments(): SlideOptions {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      // Input
      text: { type: "string" },
      topic: { type: "string" },
      outline: { type: "boolean", default: false },

      // AI Generation
      "ai-generate": { type: "boolean", default: false },
      "slide-count": { type: "string", default: "8" },
      audience: { type: "string", default: "general" },
      style: { type: "string", default: "professional" },
      language: { type: "string", default: "en" },
      "include-images": { type: "boolean", default: false },

      // Output
      format: { type: "string", default: "pptx" },
      output: { type: "string" },
      dir: { type: "string", default: "" },

      // Theme
      theme: { type: "string", default: "minimal" },

      // Content
      title: { type: "string" },
      author: { type: "string" },
      date: { type: "string", default: new Date().toISOString().split("T")[0] },
      notes: { type: "boolean", default: true },
      footer: { type: "string" },
      "slide-numbers": { type: "boolean", default: true },

      // Layout
      "aspect-ratio": { type: "string", default: "16:9" },

      // Branding
      logo: { type: "string" },
      "logo-position": { type: "string", default: "bottom-right" },
      "primary-color": { type: "string" },
      "secondary-color": { type: "string" },
      font: { type: "string" },

      // Animation
      transition: { type: "string", default: "fade" },
      "transition-speed": { type: "string", default: "default" },

      // Code
      "code-theme": { type: "string", default: "github" },
      "line-numbers": { type: "boolean", default: false },

      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const outputDir =
    values.dir ||
    (process.env.SKILLS_OUTPUT_DIR
      ? join(process.env.SKILLS_OUTPUT_DIR, "exports", "generate-slides")
      : join(process.cwd(), ".skills", "exports", "generate-slides"));

  return {
    inputFile: positionals[0],
    text: values.text as string | undefined,
    topic: values.topic as string | undefined,
    outline: values.outline as boolean,
    aiGenerate: values["ai-generate"] as boolean,
    slideCount: parseInt(values["slide-count"] as string) || 8,
    audience: values.audience as string,
    style: values.style as string,
    language: values.language as string,
    includeImages: values["include-images"] as boolean,
    format: values.format as any,
    output: values.output as string | undefined,
    dir: outputDir,
    theme: values.theme as any,
    title: values.title as string | undefined,
    author: values.author as string | undefined,
    date: values.date as string,
    notes: values.notes as boolean,
    footer: values.footer as string | undefined,
    slideNumbers: values["slide-numbers"] as boolean,
    aspectRatio: values["aspect-ratio"] as any,
    logo: values.logo as string | undefined,
    logoPosition: values["logo-position"] as any,
    primaryColor: values["primary-color"] as string | undefined,
    secondaryColor: values["secondary-color"] as string | undefined,
    font: values.font as string | undefined,
    transition: values.transition as any,
    transitionSpeed: values["transition-speed"] as any,
    codeTheme: values["code-theme"] as string,
    lineNumbers: values["line-numbers"] as boolean,
  };
}

export function printHelp(): void {
  console.log(`
Generate Slides - Create presentations from markdown or AI

Usage:
  skills run generate-slides -- [input.md] [options]
  skills run generate-slides -- --topic "Your Topic" --ai-generate [options]

AI Generation:
  --topic <text>          Topic for AI to generate slides about
  --ai-generate           Enable AI slide generation
  --slide-count <n>       Number of slides to generate (default: 8)
  --audience <type>       Target audience: general, technical, executive, students
  --style <type>          Presentation style: professional, casual, academic, sales
  --language <code>       Language code: en, es, fr, de, etc.
  --include-images        Generate image suggestions for each slide

Input:
  [file]                  Markdown file with slide content
  --text <markdown>       Direct markdown text input

Output:
  --format <type>         Output format: pptx, pdf, html, revealjs (default: pptx)
  -o, --output <path>     Output file path
  --dir <path>            Output directory

Theme & Branding:
  --theme <name>          Theme: corporate, creative, minimal, dark, light, tech
  --primary-color <hex>   Primary color (without #)
  --secondary-color <hex> Secondary color
  --font <name>           Font family
  --logo <path>           Logo image file
  --logo-position <pos>   Logo position: top-left, top-right, bottom-left, bottom-right

Content:
  --title <text>          Presentation title
  --author <text>         Author name
  --notes                 Include speaker notes (default: true)
  --slide-numbers         Show slide numbers (default: true)
  --footer <text>         Footer text

Examples:
  # AI-generated presentation
  skills run generate-slides -- --topic "Introduction to Machine Learning" --ai-generate --format pptx

  # From markdown file
  skills run generate-slides -- presentation.md --format pptx --theme corporate

  # Quick HTML presentation
  skills run generate-slides -- --topic "Q4 Results" --ai-generate --format html --theme dark
`);
}
