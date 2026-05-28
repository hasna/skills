import { parseArgs } from "util";
import { DEFAULT_OUTPUT_DIR, DEFAULT_SECTIONS, HELP } from "./constants";
import type { WebsiteOptions } from "./types";
import { deriveName, splitList } from "./utils";

export function parseCliOptions(): WebsiteOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      brief: { type: "string" },
      name: { type: "string" },
      audience: { type: "string", default: "software teams" },
      goal: { type: "string", default: "book a demo" },
      style: { type: "string", default: "polished SaaS, crisp UI, confident copy" },
      proof: { type: "string", default: "customer outcomes and workflow proof" },
      sections: { type: "string" },
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

  return {
    brief,
    name: String(values.name || deriveName(brief)).trim(),
    audience: String(values.audience || "software teams").trim(),
    goal: String(values.goal || "book a demo").trim(),
    style: String(values.style || "polished SaaS, crisp UI, confident copy").trim(),
    proof: String(values.proof || "customer outcomes and workflow proof").trim(),
    sections: splitList(values.sections, DEFAULT_SECTIONS),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}
