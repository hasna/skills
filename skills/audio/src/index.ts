#!/usr/bin/env bun

import { executeAndSave, executeSkill, handleInstallCommand } from "../../_common";

const SKILL = "audio";

const SKILL_META = {
  name: "audio",
  description: "Generate speech and audio using provider-cost AI backends",
  version: "1.0.0",
  commands: "audio generate --provider <provider> --text <text> --output <file>",
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
  console.log(`Skill Audio CLI

USAGE:
  audio generate --provider <provider> --text <text> [options]

PROVIDERS:
  openai    tts-1, tts-1-hd
  minimax   speech-2.8-turbo, speech-2.8-hd
  gemini    gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts

OPTIONS:
  --model <model>    Provider model override
  --text <text>      Text to synthesize
  --voice <voice>    Provider-specific voice
  --format <format>  mp3, wav, or opus
  --output <path>    Save generated audio

EXAMPLES:
  audio generate --provider openai --text "Welcome to Skills.md" --voice alloy --output ./voice.mp3
  audio generate --provider minimax --text "Fast narration" --output ./voice.mp3`);
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
    console.error("Unexpected binary response. Pass --output to save audio output.");
    process.exit(1);
  }
  if (result.success && result.output) {
    console.log(result.output);
    return;
  }
  console.error(`Error: ${result.error || "Audio generation failed"}`);
  if (result.details) console.error(result.details);
  process.exit(1);
}

main().catch((error) => {
  console.error(`Fatal error: ${(error as Error).message}`);
  process.exit(1);
});
