#!/usr/bin/env bun
// Restore the caller's directory before any other module evaluates (pinned launchers start in the runtime root).
import "../lib/launch-cwd-apply.js";
import { Command } from "commander";
import { registerMaintenance } from "./maintenance-entry.js";

const program = new Command();
program.name("skills-maintenance");
registerMaintenance(program);
await program.parseAsync(process.argv);
