#!/usr/bin/env bun

import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve, extname } from "path";

// ── Connectors REST API client (inline, no SDK dependency) ───────────

const DEFAULT_SERVER = "http://localhost:19426";

interface RunOperationResponse {
  connector: string;
  displayName: string;
  success: boolean;
  output: string;
}

interface ConnectorInfo {
  name: string;
  displayName: string;
  description: string;
  category: string;
  auth: { type: string; connected: boolean } | null;
}

async function connectorGet(server: string, name: string): Promise<ConnectorInfo> {
  const res = await fetch(`${server}/api/connectors/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Connector "${name}" not available (${res.status})`);
  return res.json() as Promise<ConnectorInfo>;
}

async function connectorRun(
  server: string,
  name: string,
  args: string[],
  timeout = 120_000
): Promise<RunOperationResponse> {
  const res = await fetch(`${server}/api/connectors/${encodeURIComponent(name)}/operations/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args, format: "json", timeout }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error: string }).error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<RunOperationResponse>;
}

// ── Logo prompt engineering ──────────────────────────────────────────

type Provider = "openai" | "gemini";

const LOGO_SYSTEM_PROMPT =
  "You are a world-class logo designer. Create a professional, clean, scalable logo. " +
  "Use flat vector style with solid colors. White or transparent background. " +
  "No photorealistic textures, no gradients unless specified. " +
  "The design must be recognizable at small sizes (16x16 favicon).";

function buildLogoPrompt(userPrompt: string): string {
  return `${LOGO_SYSTEM_PROMPT}\n\nLogo brief: ${userPrompt}\n\nStyle: flat vector logo, clean lines, professional, white background, high resolution, suitable for branding`;
}

function getOutputPath(output: string | undefined, index: number, total: number): string {
  if (output) {
    if (total === 1) return resolve(output);
    const ext = extname(output) || ".png";
    const base = output.replace(ext, "");
    return resolve(`${base}_${index + 1}${ext}`);
  }
  const ts = Date.now();
  return resolve(`./logo_${ts}_${index + 1}.png`);
}

// ── Generators ───────────────────────────────────────────────────────

async function generateOpenAI(
  server: string,
  prompt: string,
  opts: { size: string; quality: string; variations: number; output?: string; model?: string }
): Promise<string[]> {
  const savedPaths: string[] = [];

  for (let i = 0; i < opts.variations; i++) {
    const label = opts.variations > 1 ? ` (variation ${i + 1}/${opts.variations})` : "";
    console.log(chalk.cyan(`  Generating with OpenAI gpt-image-1${label}...`));

    const args = [
      "images", "generate", buildLogoPrompt(prompt),
      "--model", opts.model || "dall-e-3",
      "--size", opts.size,
      "--quality", opts.quality,
    ];

    const result = await connectorRun(server, "openai", args);

    if (!result.success) {
      console.error(chalk.red(`  Failed: ${result.output}`));
      continue;
    }

    let imageUrl: string | undefined;
    try {
      const parsed = JSON.parse(result.output);
      imageUrl = parsed.url || parsed.data?.[0]?.url;
    } catch {
      const urlMatch = result.output.match(/https?:\/\/[^\s"]+/);
      imageUrl = urlMatch?.[0];
    }

    if (imageUrl) {
      const outputPath = getOutputPath(opts.output, i, opts.variations);
      const dir = dirname(outputPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      console.log(chalk.gray(`  Downloading...`));
      const response = await fetch(imageUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(outputPath, buffer);
      savedPaths.push(outputPath);
      console.log(chalk.green(`  Saved: ${outputPath}`));
    } else {
      console.error(chalk.yellow(`  No image URL in response.`));
      console.log(chalk.gray(result.output.slice(0, 300)));
    }
  }

  return savedPaths;
}

async function generateGemini(
  server: string,
  prompt: string,
  opts: { aspectRatio: string; size: string; variations: number; output?: string; model?: string }
): Promise<string[]> {
  const savedPaths: string[] = [];

  for (let i = 0; i < opts.variations; i++) {
    const label = opts.variations > 1 ? ` (variation ${i + 1}/${opts.variations})` : "";
    console.log(chalk.cyan(`  Generating with Gemini Nano Banana${label}...`));

    const outputPath = getOutputPath(opts.output, i, opts.variations);
    const dir = dirname(outputPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const args = [
      "image", "generate", buildLogoPrompt(prompt),
      "--model", opts.model || "gemini-2.5-flash-preview-image-generation",
      "--aspect-ratio", opts.aspectRatio,
      "--size", opts.size,
      "--output", outputPath,
    ];

    const result = await connectorRun(server, "googlegemini", args);

    if (!result.success) {
      console.error(chalk.red(`  Failed: ${result.output}`));
      continue;
    }

    // Gemini connector saves with timestamp suffix — detect actual file
    if (existsSync(outputPath)) {
      savedPaths.push(outputPath);
      console.log(chalk.green(`  Saved: ${outputPath}`));
    } else {
      // Check if connector saved with its own naming (prefix_timestamp_index.ext)
      const dir = dirname(outputPath);
      const base = outputPath.replace(extname(outputPath), "").split("/").pop() || "generated";
      try {
        const { readdirSync } = await import("fs");
        const files = readdirSync(dir).filter((f) => f.startsWith(base));
        if (files.length > 0) {
          const saved = resolve(dir, files[files.length - 1]);
          savedPaths.push(saved);
          console.log(chalk.green(`  Saved: ${saved}`));
        } else {
          // Try to extract base64 from response
          const parsed = JSON.parse(result.output);
          const data = parsed.data || parsed.images?.[0]?.data;
          if (data) {
            writeFileSync(outputPath, Buffer.from(data, "base64"));
            savedPaths.push(outputPath);
            console.log(chalk.green(`  Saved: ${outputPath}`));
          } else {
            console.log(chalk.yellow(`  Generated but could not save locally.`));
          }
        }
      } catch {
        console.log(chalk.yellow(`  Generated. Output:`));
        console.log(chalk.gray(result.output.slice(0, 300)));
      }
    }
  }

  return savedPaths;
}

// ── CLI ──────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("logo-design")
  .description("Generate professional logos using AI (OpenAI GPT Image, Google Gemini)")
  .version("1.0.0");

program
  .command("generate")
  .alias("gen")
  .argument("<prompt>", "Logo description / design brief")
  .description("Generate a logo from a text prompt")
  .option("-p, --provider <provider>", "AI provider: openai or gemini", "openai")
  .option("-o, --output <path>", "Output file path")
  .option("-n, --variations <count>", "Number of variations to generate", "1")
  .option("-s, --size <size>", "Image size (openai: 1024x1024, gemini: 2K)", "1024x1024")
  .option("-a, --aspect-ratio <ratio>", "Aspect ratio for Gemini (1:1, 16:9, 9:16)", "1:1")
  .option("-q, --quality <quality>", "Quality: standard or hd (OpenAI only)", "hd")
  .option("-m, --model <model>", "Model override (openai: dall-e-3/gpt-image-1, gemini: gemini-2.5-flash-preview-image-generation)")
  .option("--server <url>", "Connectors server URL", DEFAULT_SERVER)
  .action(async (prompt: string, opts) => {
    const provider = opts.provider as Provider;
    const variations = parseInt(opts.variations);

    console.log(chalk.bold("\n  Logo Design Generator\n"));
    console.log(chalk.gray(`  Provider:   ${provider === "openai" ? "OpenAI GPT Image" : "Google Gemini (Nano Banana)"}`));
    console.log(chalk.gray(`  Prompt:     "${prompt}"`));
    console.log(chalk.gray(`  Variations: ${variations}\n`));

    let paths: string[];
    try {
      if (provider === "gemini") {
        paths = await generateGemini(opts.server, prompt, {
          aspectRatio: opts.aspectRatio,
          size: opts.size === "1024x1024" ? "2K" : opts.size,
          variations,
          output: opts.output,
          model: opts.model,
        });
      } else {
        paths = await generateOpenAI(opts.server, prompt, {
          size: opts.size,
          quality: opts.quality,
          variations,
          output: opts.output,
          model: opts.model,
        });
      }
    } catch (err) {
      console.error(chalk.red(`\n  Error: ${(err as Error).message}`));
      console.error(chalk.gray("  Make sure the connectors server is running: connectors serve\n"));
      process.exit(1);
    }

    console.log();
    if (paths.length > 0) {
      console.log(chalk.bold.green(`  Generated ${paths.length} logo(s):`));
      paths.forEach((p) => console.log(chalk.white(`    ${p}`)));
    } else {
      console.log(chalk.red("  No logos were generated. Check connector status:"));
      console.log(chalk.gray("    logo-design providers"));
    }
    console.log();
  });

program
  .command("providers")
  .description("Check available providers and their connection status")
  .option("--server <url>", "Connectors server URL", DEFAULT_SERVER)
  .action(async (opts) => {
    console.log(chalk.bold("\n  Logo Design Providers\n"));

    const providers = [
      { name: "openai", display: "OpenAI GPT Image", model: "gpt-image-1" },
      { name: "googlegemini", display: "Google Gemini (Nano Banana)", model: "gemini-2.5-flash-preview-image-generation" },
    ];

    for (const p of providers) {
      try {
        const connector = await connectorGet(opts.server, p.name);
        const status = connector.auth?.connected
          ? chalk.green("connected")
          : chalk.red("not connected");
        console.log(`  ${chalk.cyan(p.display)}`);
        console.log(`    Connector: ${p.name} (${status})`);
        console.log(`    Model:     ${p.model}`);
        console.log();
      } catch {
        console.log(`  ${chalk.cyan(p.display)}`);
        console.log(`    ${chalk.red("unavailable")} - connectors server not running?`);
        console.log(`    Start with: ${chalk.gray("connectors serve")}`);
        console.log();
      }
    }
  });

program
  .command("tips")
  .description("Show logo design tips for better AI-generated logos")
  .action(() => {
    console.log(chalk.bold("\n  Logo Design Tips\n"));
    const tips = [
      ["Be specific", '"minimalist geometric owl, flat vector, navy and gold, white bg" not "owl logo"'],
      ["Specify style", "flat vector, 3D, vintage, modern, hand-drawn, geometric, abstract, lettermark"],
      ["White background", "Always request white or solid background to keep the mark clean"],
      ["Keep it simple", "Logos must work at favicon size (16x16). Minimalism wins."],
      ["Skip text", "AI struggles with typography. Generate the icon, add text in Figma/Illustrator"],
      ["Many variations", "Generate 4-10 variations with slight prompt tweaks, pick the best 2-3"],
      ["Negative guidance", '"no photorealistic textures, no shadows, no gradients" for cleaner output'],
      ["Color constraints", 'Specify max 2-3 colors: "navy blue and gold only"'],
      ["Industry context", '"tech startup logo", "organic food brand", "luxury fashion"'],
      ["Vector conversion", "All AI logos are raster. Trace to SVG with Vectorizer.ai or Illustrator"],
    ];

    tips.forEach(([title, desc], i) => {
      console.log(chalk.cyan(`  ${i + 1}. ${title}`));
      console.log(chalk.gray(`     ${desc}`));
    });
    console.log();
  });

program.parse();
