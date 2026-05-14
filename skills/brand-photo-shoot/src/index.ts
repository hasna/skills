#!/usr/bin/env bun

const help = `Brand Photo Shoot is a hosted premium skill.

Usage:
  skills run brand-photo-shoot "brand or product brief" --scenes 8
  skills run brand-photo-shoot --brief ./brand.md --aspect-ratios "1:1,4:5"

Run through the Skills CLI with SKILLS_API_KEY or skills auth login.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

console.error("brand-photo-shoot is hosted-only. Run: skills auth login && skills run brand-photo-shoot <brief>");
process.exit(1);
