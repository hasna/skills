import { parseArgs } from "util";
import { log } from "./runtime";
import { detectSourceType } from "./source";
import type { GenerateOptions, OutputFormat, Platform, Tone } from "./types";

export function parseGenerateOptions(): GenerateOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string" },
      platforms: { type: "string", default: "all" },
      count: { type: "string", default: "3" },
      tone: { type: "string", default: "professional" },
      "include-hashtags": { type: "boolean", default: true },
      threads: { type: "boolean", default: false },
      "max-length": { type: "string", default: "10000" },
      output: { type: "string", short: "o" },
      format: { type: "string", default: "json" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Generate Social Posts - Transform content into platform-optimized social media posts

Usage:
  bun run src/index.ts <url|file> [options]
  bun run src/index.ts --input "text" [options]

Options:
  --input <text>          Direct text input (alternative to URL/file)
  --platforms <list>      Comma-separated platforms (twitter,linkedin,facebook,instagram,threads,all) [default: all]
  --count <number>        Number of post variants per platform [default: 3]
  --tone <tone>           Writing tone (professional,casual,witty,inspiring,educational) [default: professional]
  --include-hashtags      Include hashtag suggestions [default: true]
  --threads               Generate thread/carousel versions [default: false]
  --max-length <chars>    Maximum content length to process [default: 10000]
  --output, -o <path>     Custom output path
  --format <format>       Output format (json,markdown,text) [default: json]
  --help, -h              Show this help
`);
    process.exit(0);
  }

  const { source, sourceType } = resolveSource(values.input as string | undefined, positionals);
  const platforms = parsePlatforms(values.platforms as string);
  const count = parseInt(values.count as string);
  const maxLength = parseInt(values["max-length"] as string);
  const tone = values.tone as Tone;
  const format = values.format as OutputFormat;

  const validTones: Tone[] = ["professional", "casual", "witty", "inspiring", "educational"];
  const validFormats: OutputFormat[] = ["json", "markdown", "text"];

  if (!validTones.includes(tone)) {
    log(`Invalid tone: ${tone}. Must be one of: ${validTones.join(", ")}`, "error");
    process.exit(1);
  }

  if (!validFormats.includes(format)) {
    log(`Invalid format: ${format}. Must be one of: ${validFormats.join(", ")}`, "error");
    process.exit(1);
  }

  if (count < 1 || count > 20) {
    log("Count must be between 1 and 20", "error");
    process.exit(1);
  }

  return {
    source,
    sourceType,
    platforms,
    count,
    tone,
    includeHashtags: values["include-hashtags"] as boolean,
    threads: values.threads as boolean,
    maxLength,
    output: values.output as string | undefined,
    format,
  };
}

function resolveSource(input: string | undefined, positionals: string[]) {
  if (input) {
    return { source: input, sourceType: "text" as const };
  }

  if (positionals.length > 0) {
    const source = positionals.join(" ");
    return { source, sourceType: detectSourceType(source) };
  }

  log("Please provide a URL, file path, or use --input for direct text", "error");
  process.exit(1);
}

function parsePlatforms(value: string): Platform[] {
  const platformsInput = value.toLowerCase();
  if (platformsInput === "all") {
    return ["twitter", "linkedin", "facebook", "instagram", "threads"];
  }

  const validPlatforms: Platform[] = ["twitter", "linkedin", "facebook", "instagram", "threads"];
  const platforms = platformsInput
    .split(",")
    .map((platform) => platform.trim())
    .filter((platform) => validPlatforms.includes(platform as Platform)) as Platform[];

  if (platforms.length === 0) {
    log("No valid platforms specified. Use: twitter, linkedin, facebook, instagram, threads, or all", "error");
    process.exit(1);
  }

  return platforms;
}
