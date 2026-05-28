#!/usr/bin/env bun

import { executeAndSave, executeSkill, handleInstallCommand } from "../../_common";

const SKILL = "video";

const SKILL_META = {
  name: "video",
  description: "Generate videos using provider-cost AI backends",
  version: "1.0.0",
  commands: "video generate --provider <provider> --prompt <prompt> --output <file>",
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
  console.log(`Skill Video CLI

USAGE:
  video generate --provider <provider> --prompt <prompt> [options]

PROVIDERS:
  openai     sora-2, sora-2-pro
  minimax    MiniMax-Hailuo-2.3-Fast, MiniMax-Hailuo-2.3
  gemini     veo-3.1-fast-generate-preview, veo-3.1-generate-preview
  seedance   dreamina-seedance-2.0, dreamina-seedance-2.0-fast

OPTIONS:
  --model <model>        Provider model override
  --duration <seconds>   Requested duration
  --image <path-or-url>  Optional reference image
  --size <value>         Provider-specific size/aspect ratio
  --output <path>        Save generated video

EXAMPLES:
  video generate --provider seedance --prompt "cinematic product reveal" --duration 6 --output ./video.mp4
  video generate --provider openai --model sora-2 --prompt "aerial city sunrise" --output ./video.mp4`);
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
    console.error("Unexpected binary response. Pass --output to save video output.");
    process.exit(1);
  }
  if (result.success && result.output) {
    console.log(result.output);
    return;
  }
  console.error(`Error: ${result.error || "Video generation failed"}`);
  if (result.details) console.error(result.details);
  process.exit(1);
}

main().catch((error) => {
  console.error(`Fatal error: ${(error as Error).message}`);
  process.exit(1);
});
