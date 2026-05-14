import { parseArgs } from "util";
import { DEFAULT_OUTPUT_DIR, HELP } from "./constants";
import type { DeckOptions } from "./types";
import { clamp, isAudience, isTone } from "./utils";

export function parseCliOptions(): DeckOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brief: { type: "string" },
      company: { type: "string", default: "Company" },
      audience: { type: "string", default: "investors" },
      slides: { type: "string", default: "10" },
      tone: { type: "string", default: "concise" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const brief = String(values.brief || positionals.join(" ")).trim();
  if (!brief) {
    console.error("Brief is required. Pass --brief <text> or positional text.");
    process.exit(1);
  }

  const audience = String(values.audience || "investors");
  if (!isAudience(audience)) {
    console.error("Invalid audience. Use investors, sales, or internal.");
    process.exit(1);
  }

  const tone = String(values.tone || "concise");
  if (!isTone(tone)) {
    console.error("Invalid tone. Use concise, bold, or technical.");
    process.exit(1);
  }

  return {
    brief,
    company: String(values.company || "Company").trim(),
    audience,
    slideCount: clamp(Number.parseInt(String(values.slides || "10"), 10) || 10, 5, 15),
    tone,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}
