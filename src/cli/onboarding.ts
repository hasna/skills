import type { Command } from "commander";
import { loadConfig, type SkillsConfig } from "../lib/config.js";

const SKIP_ONBOARDING_COMMANDS = new Set([
  "interactive",
  "setup",
  "config",
  "auth",
  "billing",
  "credits",
  "completion",
  "self-update",
]);

export interface FirstRunOnboardingInput {
  argv: string[];
  commandName?: string;
  config: SkillsConfig;
  isInteractive: boolean;
  testMode?: boolean;
}

export function getRootCommandName(actionCommand: Command): string {
  let current: Command = actionCommand;
  while (current.parent && current.parent.parent) current = current.parent;
  return current.name();
}

export function shouldShowFirstRunOnboarding(input: FirstRunOnboardingInput): boolean {
  if (!input.isInteractive || input.testMode) return false;
  if (input.config.mode) return false;
  if (input.argv.some((arg) => arg === "--json" || arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V")) {
    return false;
  }
  if (!input.commandName || SKIP_ONBOARDING_COMMANDS.has(input.commandName)) return false;
  return input.argv.length > 0;
}

export function getFirstRunOnboardingMessage(): string {
  return [
    "No Skills setup found.",
    "  Hosted: skills setup --mode hosted && skills auth login",
    "  Local:  skills setup --mode local",
  ].join("\n");
}

export function maybePrintFirstRunOnboarding(actionCommand: Command, argv: string[], isInteractive: boolean): void {
  if (
    shouldShowFirstRunOnboarding({
      argv,
      commandName: getRootCommandName(actionCommand),
      config: loadConfig(),
      isInteractive,
      testMode: process.env.SKILLS_TEST_MODE === "1",
    })
  ) {
    console.error(getFirstRunOnboardingMessage());
  }
}
