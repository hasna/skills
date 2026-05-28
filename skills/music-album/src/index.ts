#!/usr/bin/env bun

const help = `Music Album is a hosted premium skill.

Usage:
  skills run music-album "album concept" --songs 7
  skills run music-album "album concept" --songs 14 --genre "electro pop"
  skills run music-album "album concept" --songs 21 --lyrics-mode instrumental

Run through the Skills CLI with SKILLS_API_KEY or skills auth login.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

console.error("music-album is hosted-only. Run: skills auth login && skills run music-album <concept>");
process.exit(1);
