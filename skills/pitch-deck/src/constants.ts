import { join } from "path";

export const SKILL_NAME = "pitch-deck";
export const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
export const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

export const HELP = `Pitch Deck

Usage:
  skills run pitch-deck --brief "AI support desk for Shopify merchants" --company "Acme"
  skills run pitch-deck "Usage-based billing platform for AI SaaS" --slides 12 --tone bold

Options:
  --brief <text>      Company, product, offer, or campaign brief
  --company <name>    Company or product name. Default: Company
  --audience <type>   investors, sales, or internal. Default: investors
  --slides <number>   Number of slides, 5-15. Default: 10
  --tone <tone>       concise, bold, or technical. Default: concise
  --output <dir>      Output directory. Default: current run export directory
  --help              Show this help

Outputs:
  deck.md, deck.pdf, deck.pptx, slides.json, speaker-notes.md, design-direction.md, and manifest.json
`;
