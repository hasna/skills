import chalk from "chalk";
import type { Command } from "commander";
import {
  createRegistrySyncArtifact,
  writeRegistrySyncArtifact,
  type RegistrySyncOptions,
} from "../../lib/registry-sync.js";
import type { SkillRegistryProfile } from "../../lib/registry.js";

export function registerRegistry(parent: Command) {
  const registry = parent
    .command("registry")
    .description("Generate registry artifacts for hosted skills services");

  registry
    .command("sync")
    .description("Generate a deterministic registry sync artifact")
    .option("--profile <profile>", "Registry profile: basic or all", "all")
    .option("--output <path>", "Write artifact to a JSON file")
    .option("--no-docs", "Exclude skill documentation content")
    .option("--no-requirements", "Exclude extracted skill requirements")
    .option("--no-validation", "Exclude validation results")
    .option("--json", "Print artifact JSON to stdout", false)
    .action((options) => handleRegistrySync(options));
}

function handleRegistrySync(options: {
  profile: string;
  output?: string;
  docs: boolean;
  requirements: boolean;
  validation: boolean;
  json: boolean;
}) {
  if (options.profile !== "basic" && options.profile !== "all") {
    const error = `Unknown registry profile: ${options.profile}. Available: basic, all`;
    if (options.json) console.log(JSON.stringify({ error }));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  const artifactOptions: RegistrySyncOptions = {
    profile: options.profile as SkillRegistryProfile,
    includeDocs: options.docs,
    includeRequirements: options.requirements,
    includeValidation: options.validation,
  };
  const artifact = createRegistrySyncArtifact(artifactOptions);

  if (options.output) {
    writeRegistrySyncArtifact(options.output, artifact);
  }

  if (options.json || !options.output) {
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  const invalid = artifact.summary.invalidSkillCount ?? "not checked";
  console.log(chalk.green(`Registry sync artifact written to ${options.output}`));
  console.log(chalk.dim(`  Skills: ${artifact.summary.skillCount}`));
  console.log(chalk.dim(`  Invalid: ${invalid}`));
}
