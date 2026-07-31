#!/usr/bin/env bun

import { mkdir, writeFile, stat } from "fs/promises";
import { join, resolve, relative } from "path";

import { parseArgs } from "./cli.js";
import { CANVAS, VERSION } from "./constants.js";
import { briefDoc, usageNotes } from "./docs.js";
import { buildLockup, GEOMETRIES, svgDocument } from "./geometry.js";
import { buildPalette, fnv1a, mulberry32, shuffle } from "./palette.js";
import type { Concept } from "./types.js";

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
