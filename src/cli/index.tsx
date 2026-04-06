#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import chalk from "chalk";
import pkg from "../../package.json" with { type: "json" };
import { App } from "./components/App.js";
import { SKILLS } from "../lib/registry.js";
import { normalizeSkillName } from "../lib/utils.js";

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
  .description("Install AI agent skills for your project")
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
      console.log(JSON.stringify(SKILLS.map(s => ({ name: s.name, category: s.category }))));
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

const { registerSchedule } = await import("./commands/schedule.js");
registerSchedule(program);

program.parse();
