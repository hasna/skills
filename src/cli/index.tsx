#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import chalk from "chalk";
import pkg from "../../package.json" with { type: "json" };
import { App } from "./components/App.js";
import { loadBasicRegistry } from "../lib/registry.js";
import { getCompactSkillDiscovery } from "../lib/discovery.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

// Respect --no-color flag
if (process.argv.includes("--no-color")) {
  chalk.level = 0;
  const idx = process.argv.indexOf("--no-color");
  process.argv.splice(idx, 1);
}

const program = new Command();

program
  .name("skills")
  .description("Discover and run AI agent skills through the Skills CLI/MCP")
  .version(pkg.version)
  .option("--verbose", "Enable verbose logging", false)
  .option("--no-color", "Disable colored output (also respects NO_COLOR env var)")
  .enablePositionalOptions();

// ── Interactive TUI (default) ──
program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Interactive skill browser (TUI)")
  .action(() => {
    if (!isTTY) {
      console.log(JSON.stringify(loadBasicRegistry().map(getCompactSkillDiscovery)));
      process.exit(0);
    }
    render(<App />);
  });

// ── Command groups ──
const { registerInstall } = await import("./commands/install.js");
registerInstall(program);

const { registerBrowse } = await import("./commands/list.js");
registerBrowse(program);

const { registerIntrospect } = await import("./commands/introspect.js");
registerIntrospect(program);

const { registerToolPrimitives } = await import("./commands/tool-primitives.js");
registerToolPrimitives(program);

const { registerSetup } = await import("./commands/init.js");
registerSetup(program);

const { registerDiagnostic } = await import("./commands/diagnostic.js");
registerDiagnostic(program);

const { registerRuntime } = await import("./commands/runtime.js");
registerRuntime(program);

const { registerCompletion } = await import("./commands/completion.js");
registerCompletion(program);

const { registerCreateSync } = await import("./commands/create-sync-config.js");
registerCreateSync(program);

const { registerPortableSkillCommands } = await import("./commands/portable-skills.js");
registerPortableSkillCommands(program);

const { registerSchedule } = await import("./commands/schedule.js");
registerSchedule(program);

const { registerRegistry } = await import("./commands/registry.js");
registerRegistry(program);

const { registerPublish } = await import("./commands/publish.js");
registerPublish(program);

const { registerAuth } = await import("./commands/auth.js");
registerAuth(program);

const { registerFeedback } = await import("./commands/feedback.js");
registerFeedback(program);

const { registerStorage } = await import("./commands/storage.js");
registerStorage(program);

registerEventsCommands(program as any, { source: "skills" });

// A retired deployment-mode setting is an operator error with a one-line fix, and
// the fix is in the message. Printed bare rather than thrown, because a stack trace
// with bundler frames buries the sentence that says what to do, and every command
// that reads configuration can raise this - wrapping each one instead would leave
// whichever one was added next uncovered.
try {
  await program.parseAsync();
} catch (err) {
  if ((err as { code?: string } | undefined)?.code === "RETIRED_SETTING") {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  throw err;
}
