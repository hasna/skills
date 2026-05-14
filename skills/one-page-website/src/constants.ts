import { join } from "path";

export const SKILL_NAME = "one-page-website";
export const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
export const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
export const DEFAULT_SECTIONS = ["hero", "features", "proof", "pricing", "faq", "cta"];

export const HELP = `One Page Website

Usage:
  skills run one-page-website "Usage-based billing for AI SaaS" --name "MeterKit" --audience "founders"
  skills run one-page-website --brief "Customer feedback analytics" --goal "join the waitlist"

Options:
  --brief <text>     Product, service, or website brief. Positional text also works.
  --name <text>      Brand or page name. Default: derived from brief
  --audience <text>  Target visitor. Default: software teams
  --goal <text>      Primary conversion goal. Default: book a demo
  --style <text>     Visual and voice direction. Default: polished SaaS, crisp UI, confident copy
  --proof <text>     Proof points or trust signals. Default: customer outcomes and workflow proof
  --sections <list>  Comma-separated sections. Default: hero,features,proof,pricing,faq,cta
  --output <dir>     Output directory. Default: current run export directory
  --help             Show help

Outputs:
  site/index.html, site/styles.css, site/script.js, site/README.md, copy.md, section-map.json, deploy-notes.md, and manifest.json
`;
