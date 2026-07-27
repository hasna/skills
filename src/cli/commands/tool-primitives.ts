import chalk from "chalk";
import type { Command } from "commander";
import {
  getSkillToolDependencies,
  getToolPrimitive,
  listToolPrimitives,
  validateToolPrimitiveCoverage,
} from "../../lib/tool-primitives.js";

export function registerToolPrimitives(parent: Command) {
  const tools = parent
    .command("tools")
    .description("Inspect primitive tools used by skills, CLI, MCP, and hosted runtimes");

  tools
    .command("list")
    .option("--json", "Output as JSON", false)
    .option("--query <query>", "Filter by primitive name, family, runtime, or capability")
    .description("List primitive tools")
    .action((options: { json: boolean; query?: string }) => {
      const primitives = listToolPrimitives(options.query);
      if (options.json) {
        console.log(JSON.stringify({ schemaVersion: 1, primitives, total: primitives.length }, null, 2));
        return;
      }
      for (const primitive of primitives) {
        console.log(`${chalk.bold(primitive.name)} ${chalk.dim(`[${primitive.family}/${primitive.runtime}]`)}`);
        console.log(`  ${primitive.description}`);
      }
    });

  tools
    .command("info")
    .argument("<primitive>", "Primitive tool name")
    .option("--json", "Output as JSON", false)
    .description("Show primitive tool details")
    .action((name: string, options: { json: boolean }) => {
      const primitive = getToolPrimitive(name);
      if (!primitive) {
        if (options.json) console.log(JSON.stringify({ error: `Primitive '${name}' not found` }));
        else console.error(`Primitive '${name}' not found`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(primitive, null, 2));
        return;
      }
      console.log(`${chalk.bold(primitive.title)} ${chalk.dim(`[${primitive.name}]`)}`);
      console.log(primitive.description);
      console.log(`${chalk.dim("Family:")} ${primitive.family}`);
      console.log(`${chalk.dim("Runtime:")} ${primitive.runtime}`);
      if (primitive.capabilities.length) console.log(`${chalk.dim("Capabilities:")} ${primitive.capabilities.join(", ")}`);
      if (primitive.cliCommands.length) console.log(`${chalk.dim("CLI:")} ${primitive.cliCommands.join(", ")}`);
      if (primitive.mcpTools.length) console.log(`${chalk.dim("MCP:")} ${primitive.mcpTools.join(", ")}`);
    });

  tools
    .command("deps")
    .argument("<skill>", "Skill name")
    .option("--json", "Output as JSON", false)
    .description("Show primitive tool dependencies for a skill")
    .action((name: string, options: { json: boolean }) => {
      const deps = getSkillToolDependencies(name);
      if (!deps) {
        if (options.json) console.log(JSON.stringify({ error: `Skill '${name}' not found` }));
        else console.error(`Skill '${name}' not found`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(deps, null, 2));
        return;
      }
      console.log(`${chalk.bold(deps.skill)} ${chalk.dim(`[${deps.category}]`)}`);
      console.log(`${chalk.dim("Gateway backed:")} ${deps.gatewayBacked ? "yes" : "no"}`);
      console.log(`${chalk.dim("Hosted runtime:")} ${deps.hostedRuntime ? "yes" : "no"}`);
      for (const dependency of deps.dependencies) {
        console.log(`  ${chalk.bold(dependency.primitive)} ${chalk.dim(`[${dependency.family}]`)} - ${dependency.reason}`);
      }
    });

  tools
    .command("validate")
    .option("--json", "Output as JSON", false)
    .option("--profile <profile>", "Registry profile: basic or all", "all")
    .description("Validate primitive tool coverage for the bundled skill catalog")
    .action((options: { json: boolean; profile: "basic" | "all" }) => {
      const profile = options.profile === "basic" ? "basic" : "all";
      const result = validateToolPrimitiveCoverage(profile);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.valid) {
        console.log(chalk.green(`Primitive coverage ok: ${result.mappedSkillCount}/${result.skillCount} skills mapped to ${result.primitiveCount} primitives`));
        console.log(chalk.dim(`Gateway-backed: ${result.gatewayBackedSkillCount}; hosted runtime: ${result.hostedRuntimeSkillCount}`));
      } else {
        console.log(chalk.red(`Primitive coverage failed: ${result.issues.length} issue(s)`));
        for (const issue of result.issues) console.log(chalk.red(`  ${issue.skill}: ${issue.message}`));
      }
      if (!result.valid) process.exitCode = 1;
    });
}
