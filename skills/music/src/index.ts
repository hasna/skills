#!/usr/bin/env bun

import { executeAndSave, executeSkill, handleInstallCommand } from "../../_common";

const SKILL = "music";

const SKILL_META = {
  name: "music",
  description: "Generate music using provider-cost AI backends",
  version: "1.0.0",
  commands: "music generate --provider <provider> --prompt <prompt> --output <file>",
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
  console.log(`Skill Music CLI

USAGE:
  music generate --provider <provider> --prompt <prompt> [options]

PROVIDERS:
  minimax   Music-2.6, Music-2.0
  gemini    lyria-3-clip-preview, lyria-3-pro-preview

OPTIONS:
  --model <model>     Provider model override
  --prompt <prompt>   Musical direction
  --lyrics <value>    Lyrics text or file path
  --duration <secs>   Requested duration
  --output <path>     Save generated music

EXAMPLES:
  music generate --provider minimax --prompt "upbeat synth pop intro" --output ./song.mp3
  music generate --provider gemini --model lyria-3-clip-preview --prompt "ambient ident" --output ./clip.wav`);
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
    console.error("Unexpected binary response. Pass --output to save music output.");
    process.exit(1);
  }
  if (result.success && result.output) {
    console.log(result.output);
    return;
  }
  console.error(`Error: ${result.error || "Music generation failed"}`);
  if (result.details) console.error(result.details);
  process.exit(1);
}

main().catch((error) => {
  console.error(`Fatal error: ${(error as Error).message}`);
  process.exit(1);
});
