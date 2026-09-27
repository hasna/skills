import type { Command } from "commander";

/** Locate a real terminator without mistaking a required option value for it. */
export function optionPrefix(program: Command, args: string[]): { indices: number[]; separator: number } {
  const indices: number[] = [];
  let command = program, runArguments = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (value === "--") return { indices, separator: index };
    indices.push(index);
    // run uses passThroughOptions: after <skill>, its own control parser owns
    // the prefix, and a bare -- always ends it (even after a missing value).
    if (runArguments) continue;
    const options = [...command.options, ...program.options];
    const option = options.find(option => option.long === value || option.short === value);
    if (option?.required || (option?.optional && args[index + 1] !== undefined && !args[index + 1]!.startsWith("-"))) { index++; continue; }
    if (!value.startsWith("--") && value.startsWith("-") && value.length > 2) {
      // Commander expands -abc until a value-taking option. Its remainder is
      // that option's attached value, or the next token supplies the value.
      for (let offset = 1; offset < value.length; offset++) {
        const short = options.find(option => option.short === `-${value[offset]}`);
        if (!short) break;
        if (short.required || short.optional) {
          if (offset === value.length - 1 && (short.required || (args[index + 1] !== undefined && !args[index + 1]!.startsWith("-")))) index++;
          break;
        }
      }
    }
    // --flag=value already contains its value and consumes no following token.
    if (value.startsWith("-")) continue;
    const child = command.commands.find(child => child.name() === value || child.aliases().includes(value));
    if (child) command = child;
    else if (command.name() === "run" && command.parent === program) runArguments = true;
  }
  return { indices, separator: -1 };
}
