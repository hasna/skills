#!/usr/bin/env bun

const help = `Voiceover And Jingle Pack is a hosted premium skill.

Usage:
  skills run voiceover-jingle-pack "audio brief" --duration 30
  skills run voiceover-jingle-pack --script ./spot.txt --voices 4 --jingles 3

Run through the Skills CLI with SKILLS_API_KEY or skills auth login.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

console.error("voiceover-jingle-pack is hosted-only. Run: skills auth login && skills run voiceover-jingle-pack <brief>");
process.exit(1);
