#!/usr/bin/env bun
import { writeCliOutput } from "./output.js";
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import chalk from "chalk";
import pkg from "../../package.json" with { type: "json" };
import { App, type TuiAccess } from "./components/App.js";
import { loadBasicRegistry } from "../lib/registry.js";
import { getCompactSkillDiscovery } from "../lib/discovery.js";
import { isSkillsFleetCredentialError } from "../lib/fleet-credentials.js";
import { requireSkillsReadAccess } from "../lib/read-access.js";
import { optionPrefix } from "./option-boundary.js";
import { recordEnvironmentProfile } from "./profile-selection.js";
import { selectCliSkillsCredentialProfile } from "../lib/cli-credential-profile.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

const program = new Command();

program
  .name("skills")
  .description("Discover and run AI agent skills through the Skills CLI/MCP")
  .version(pkg.version)
  .option("--verbose", "Enable verbose logging", false)
  .option("--profile <name>", "Use an isolated Skills instance credential profile")
  .option("--no-color", "Disable colored output (also respects NO_COLOR env var)")
  .enablePositionalOptions();
program.hook("preAction", () => {
  const profile = program.opts<{ profile?: string }>().profile;
  recordEnvironmentProfile(process.env.HASNA_PROFILE);
  selectCliSkillsCredentialProfile(profile);
});

// ── Interactive TUI (default) ──
program
  .command("interactive", { isDefault: true })
  .alias("i")
  // A stray first argument means a verb that does not exist: commander
  // dispatches an unknown top-level word to the default command, and letting
  // it fall through to the TUI (or its non-TTY discovery render) is a silent
  // rc=0 for a phantom verb (BUG e3997558). Reject it loudly, naming the
  // verbs that DO exist, derived from the program rather than hardcoded so
  // the message cannot rot.
  .allowExcessArguments(true)
  .description("Interactive skill browser (TUI)")
  .action(async (_options: unknown, command: Command) => {
    const stray = command.args[0];
    if (stray !== undefined) {
      const verbs = program.commands
        .map((c) => c.name())
        .filter((n) => n !== "interactive")
        .sort();
      console.error(chalk.red(`error: unknown command '${stray}'. Valid commands: ${verbs.join(", ")}`));
      process.exit(1);
    }
    // Piped, the bare verb is a data surface like `skills list`: it fails
    // closed through the same ladder before the registry is read — one line
    // on stderr, exit 1, nothing on stdout — instead of printing the bundled
    // catalog for an install that was never told to serve it (#1720 validation).
    //
    // On a terminal the TUI opens either way: signed out, it is where `/login`
    // lives, and it offers no catalog until the same gate lets it through.
    let access: TuiAccess;
    try {
      const read = await requireSkillsReadAccess();
      access = read.mode === "hosted" ? { state: "hosted", origin: read.apiOrigin } : { state: "local" };
    } catch (error) {
      if (!isSkillsFleetCredentialError(error)) throw error;
      if (!isTTY) {
        console.error(chalk.red(error.message));
        process.exit(1);
      }
      access = { state: "signed-out", reason: error.message, code: error.code };
    }
    if (!isTTY) {
      await writeCliOutput(JSON.stringify(loadBasicRegistry().map(getCompactSkillDiscovery)));
      return;
    }
    render(<App initialAccess={access} />);
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

const { registerRemoteAccount } = await import("./commands/remote-account.js");
registerRemoteAccount(program);
const { registerRecurringCommands } = await import("./commands/recurring.js");
registerRecurringCommands(program);

const { registerCompletion } = await import("./commands/completion.js");
registerCompletion(program);

const { registerCreateSync } = await import("./commands/create-sync-config.js");
registerCreateSync(program);

const { registerContextCommands } = await import("./commands/context.js");
registerContextCommands(program);
const { registerAgentIntegration } = await import("./commands/agent-integration.js");
registerAgentIntegration(program);
const { registerPluginAdmission } = await import("./commands/plugin-admission.js");
registerPluginAdmission(program);
const { registerProfiles } = await import("./commands/profiles.js");
registerProfiles(program);
const { registerGrants } = await import("./commands/grants.js");
registerGrants(program);

const { registerHydrate } = await import("./commands/hydrate.js");
registerHydrate(program);

const { registerPortableSkillCommands } = await import("./commands/portable-skills.js");
registerPortableSkillCommands(program);

const { registerSchedule } = await import("./commands/schedule.js");
registerSchedule(program);

const { registerRegistry, registerPull, registerVersions, registerLifecycle, registerReviewExport } = await import("./commands/registry.js");
registerRegistry(program);
registerPull(program);
registerVersions(program);
registerLifecycle(program);
registerReviewExport(program);

const { registerPublish } = await import("./commands/publish.js");
registerPublish(program);
const { registerPrivatePublications } = await import("./commands/private-publications.js");
registerPrivatePublications(program);

const { registerAuth } = await import("./commands/auth.js");
registerAuth(program);
const { registerCustomerProfileCommands } = await import("./commands/customer-profile.js");
registerCustomerProfileCommands(program);

const { registerFeedback } = await import("./commands/feedback.js");
registerFeedback(program);

const { registerStorage } = await import("./commands/storage.js");
registerStorage(program);

const { registerRegistryReconcile } = await import("./commands/registry-reconcile.js");
registerRegistryReconcile(program);

registerEventsCommands(program as any, { source: "skills" });

// Registration supplies option arity: a required value may itself be -- or
// --no-color. Preserve those values and all executable arguments after --.
const cliArgs = process.argv.slice(2);
const colorFlag = optionPrefix(program, cliArgs).indices.find(index => cliArgs[index] === "--no-color");
if (colorFlag !== undefined) {
  chalk.level = 0;
  process.argv.splice(colorFlag + 2, 1);
}

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
