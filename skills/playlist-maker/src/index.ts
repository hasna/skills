#!/usr/bin/env bun

import { Command } from "commander";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const EXA_API_KEY = process.env.EXA_API_KEY || "";
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";

interface Track {
  title: string;
  artist: string;
  reason: string;
}

interface Playlist {
  theme: string;
  tracks: Track[];
  coverImagePath?: string;
  createdAt: string;
}

async function searchTracks(theme: string): Promise<string[]> {
  if (!EXA_API_KEY) throw new Error("EXA_API_KEY required");

  const queries = [
    `best songs for "${theme}" playlist`,
    `music recommendations "${theme}" tracks artists`,
    `"${theme}" song list curated`,
  ];

  const results: string[] = [];
  for (const query of queries) {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": EXA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        numResults: 5,
        useAutoprompt: true,
        type: "auto",
        contents: { text: { maxCharacters: 1000 } },
      }),
    });
    if (!res.ok) continue;
    const data = (await res.json()) as { results: Array<{ text?: string }> };
    for (const r of data.results) {
      if (r.text) results.push(r.text);
    }
  }
  return results;
}

async function generateCoverArt(theme: string, outputPath: string): Promise<void> {
  if (!GEMINI_API_KEY) return;

  const prompt = `Create album cover art for a playlist called "${theme}". Abstract, artistic, moody. No text or words in the image. Square format, high quality.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    },
  );

  if (!res.ok) return;
  const data = (await res.json()) as {
    candidates?: Array<{ content: { parts: Array<{ inlineData?: { data: string; mimeType: string } }> } }>;
  };

  const imagePart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (imagePart?.inlineData) {
    const buffer = Buffer.from(imagePart.inlineData.data, "base64");
    writeFileSync(outputPath, buffer);
  }
}

async function createPlaylist(theme: string, outputDir: string): Promise<Playlist> {
  console.log(`Researching: "${theme}"...`);
  const searchResults = await searchTracks(theme);

  console.log(`Found ${searchResults.length} sources. Selecting tracks...`);

  const playlist: Playlist = {
    theme,
    tracks: [],
    createdAt: new Date().toISOString(),
  };

  const trackSet = new Set<string>();
  const trackRegex = /[""]([^""]+)[""].*?(?:by|[-–—])\s*([A-Z][a-zA-Z\s&.']+)/g;
  for (const text of searchResults) {
    for (const match of text.matchAll(trackRegex)) {
      const title = match[1].trim();
      const artist = match[2].trim();
      const key = `${title.toLowerCase()}|${artist.toLowerCase()}`;
      if (!trackSet.has(key) && playlist.tracks.length < 7) {
        trackSet.add(key);
        playlist.tracks.push({ title, artist, reason: `Found in research for "${theme}"` });
      }
    }
  }

  if (playlist.tracks.length < 7) {
    console.log(`Found ${playlist.tracks.length} tracks from research, filling to 7...`);
  }

  mkdirSync(outputDir, { recursive: true });

  const coverPath = resolve(outputDir, "cover.png");
  console.log("Generating album art...");
  await generateCoverArt(theme, coverPath);
  playlist.coverImagePath = coverPath;

  const playlistPath = resolve(outputDir, "playlist.json");
  writeFileSync(playlistPath, JSON.stringify(playlist, null, 2));
  console.log(`Playlist saved to ${playlistPath}`);

  return playlist;
}

const program = new Command()
  .name("playlist-maker")
  .description("Create a curated playlist with research and AI-generated album art")
  .argument("<theme>", "Playlist theme, mood, or artist reference")
  .option("-o, --output <dir>", "Output directory", "./playlist-output")
  .action(async (theme: string, options: { output: string }) => {
    const playlist = await createPlaylist(theme, options.output);
    console.log(`\n${playlist.tracks.length} tracks selected for "${theme}"`);
    for (const t of playlist.tracks) {
      console.log(`  ${t.title} — ${t.artist}`);
    }
  });

program.parse();
