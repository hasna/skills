#!/usr/bin/env bun

import { mkdir, writeFile } from "fs/promises";
import { join, resolve, relative } from "path";

import { parseArgs } from "./cli.js";
import { buildTokens, fnv1a, mulberry32, selectPreset, xmlEscape } from "./design.js";
import { imagePrompts, mockupBrief, usageNotes } from "./docs.js";
import { renderBrowser, renderDashboard, renderLaptop, renderPhone, round } from "./render.js";
import type { SceneInput, VariantPlan } from "./types.js";

const VERSION = "0.1.0";

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
