/**
 * Stray positionals on a verb that declares none are a phantom verb, not a
 * no-op. Commander's `allowExcessArguments` defaults to true (12.1.0,
 * `lib/command.js:28`), so `skills categories typo` exited 0 with the ordinary
 * output and `skills list typo` printed the whole catalogue: a caller reading
 * the exit code is told the word was understood (BUG e3997558).
 *
 * The default command refuses by hand so it can name the verbs that exist, and
 * `skills mcp` refuses by hand so it can name its three forms. Those two keep
 * their own, better sentences. Every other command that declares no argument of
 * its own is closed here in one pass, so the next command added gets the
 * refusal without its author having to remember the hole exists.
 */
import type { Command } from "commander";

const selfRefusing = new WeakSet<Command>();

/**
 * Opt a command out of the pass because it owns a more precise refusal than
 * commander's. Chainable, and it keeps `allowExcessArguments(true)` so the
 * command still receives the stray word it wants to report.
 */
export function permitStrayArguments(command: Command): Command {
  selfRefusing.add(command);
  return command.allowExcessArguments(true);
}

/**
 * Refuse positionals on every command that declares no argument of its own.
 *
 * A command that declares arguments keeps commander's own arity check, and a
 * command with subcommands never reaches the excess check for a word that names
 * a child (commander dispatches the subcommand first). Commands without an
 * action handler reach it only with zero operands, so the flag is inert there.
 */
export function rejectStrayArguments(command: Command): void {
  for (const child of command.commands) {
    if (child.registeredArguments.length === 0 && !selfRefusing.has(child)) {
      child.allowExcessArguments(false);
    }
    rejectStrayArguments(child);
  }
}
