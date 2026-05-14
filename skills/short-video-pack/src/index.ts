#!/usr/bin/env bun

const help = `Short Video Pack is a hosted premium skill.

Usage:
  skills run short-video-pack "campaign brief" --count 3 --aspect-ratio 9:16
  skills run short-video-pack --brief ./campaign.md --platforms "tiktok,linkedin"

Run through the Skills CLI with SKILLS_API_KEY or skills auth login.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

console.error("short-video-pack is hosted-only. Run: skills auth login && skills run short-video-pack <brief>");
process.exit(1);
