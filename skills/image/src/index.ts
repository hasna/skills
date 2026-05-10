#!/usr/bin/env bun

import { executeAndSave, executeSkill, handleInstallCommand } from "../../_common";

const SKILL = "image";

const SKILL_META = {
  name: "image",
  description: "Generate images using provider-cost AI backends",
  version: "1.0.0",
  commands: "image generate --provider <provider> --prompt <prompt> --output <file>",
  requiredEnvVars: ["SKILL_API_KEY"],
};

if (await handleInstallCommand(SKILL_META, process.argv.slice(2))) {
  process.exit(0);
}

function parseArgs(): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    } else if (!parsed.command) {
      parsed.command = arg;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Skill Image CLI

USAGE:
  image generate --provider <provider> --prompt <prompt> [options]

PROVIDERS:
  openai    gpt-image-1.5, dall-e-3
  minimax   image-01
  gemini    imagen-4.0-generate-001, imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001, gemini-2.5-flash-image

OPTIONS:
  --model <model>    Provider model override
  --prompt <prompt>  Text prompt
  --size <size>      Provider-specific size or aspect ratio
  --count <count>    Number of images
  --output <path>    Save generated image

EXAMPLES:
  image generate --provider openai --prompt "a cat" --output ./output.png
  image generate --provider minimax --prompt "a dog" --output ./output.png
  image generate --provider gemini --model imagen-4.0-fast-generate-001 --prompt "a bird" --output ./output.png`);
}

async function main() {
  const args = parseArgs();
  const command = (args.command as string) || "help";

  if (command === "help" || args.help) {
    printHelp();
    return;
  }

  const { command: _command, ...params } = args;
  if (params.output) {
    const success = await executeAndSave({ skill: SKILL, command, ...params });
    process.exit(success ? 0 : 1);
  }

  const result = await executeSkill({ skill: SKILL, command, ...params });
  if (result instanceof Blob) {
    console.error("Unexpected binary response. Pass --output to save image output.");
    process.exit(1);
  }
  if (result.success && result.output) {
    console.log(result.output);
    return;
  }
  console.error(`Error: ${result.error || "Image generation failed"}`);
  if (result.details) console.error(result.details);
  process.exit(1);
}

main().catch((error) => {
  console.error(`Fatal error: ${(error as Error).message}`);
  process.exit(1);
});
