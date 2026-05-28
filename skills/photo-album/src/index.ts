#!/usr/bin/env bun

import { Command } from "commander";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const NUM_IMAGES = 5;

interface AlbumImage {
  index: number;
  prompt: string;
  path: string;
}

interface Album {
  theme: string;
  images: AlbumImage[];
  createdAt: string;
}

function buildPrompts(theme: string): string[] {
  const angles = [
    `wide establishing shot of ${theme}, cinematic photography, golden hour lighting`,
    `close-up detail shot capturing the essence of ${theme}, shallow depth of field`,
    `candid moment within ${theme}, natural and authentic, documentary style`,
    `dramatic perspective of ${theme}, bold composition, vivid colors`,
    `quiet intimate scene of ${theme}, soft natural light, contemplative mood`,
  ];
  return angles;
}

async function generateImage(prompt: string, outputPath: string): Promise<boolean> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required for GPT Image 2");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
    }),
  });

  if (!res.ok) {
    console.error(`Image generation failed: ${res.status}`);
    return false;
  }

  const data = (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> };
  const img = data.data[0];

  if (img.b64_json) {
    writeFileSync(outputPath, Buffer.from(img.b64_json, "base64"));
    return true;
  }
  if (img.url) {
    const imgRes = await fetch(img.url);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    writeFileSync(outputPath, buffer);
    return true;
  }
  return false;
}

async function createAlbum(theme: string, outputDir: string): Promise<Album> {
  const albumDir = resolve(outputDir, "album");
  mkdirSync(albumDir, { recursive: true });

  const prompts = buildPrompts(theme);
  const album: Album = { theme, images: [], createdAt: new Date().toISOString() };

  for (let i = 0; i < prompts.length; i++) {
    const path = resolve(albumDir, `${String(i + 1).padStart(2, "0")}.png`);
    console.log(`Generating image ${i + 1}/${prompts.length}...`);
    const ok = await generateImage(prompts[i], path);
    if (ok) {
      album.images.push({ index: i + 1, prompt: prompts[i], path });
    }
  }

  const metaPath = resolve(outputDir, "album.json");
  writeFileSync(metaPath, JSON.stringify(album, null, 2));
  console.log(`Album saved to ${albumDir} (${album.images.length} images)`);

  return album;
}

const program = new Command()
  .name("photo-album")
  .description("Generate a themed photo album with cohesive AI images")
  .argument("<theme>", "Album theme or concept")
  .option("-o, --output <dir>", "Output directory", "./photo-album-output")
  .option("-n, --count <num>", "Number of images", String(NUM_IMAGES))
  .action(async (theme: string, options: { output: string; count: string }) => {
    const album = await createAlbum(theme, options.output);
    console.log(`\n${album.images.length} images generated for "${theme}"`);
  });

program.parse();
