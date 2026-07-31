import chalk from "chalk";
import type { Command } from "commander";
import {
  createRegistrySyncArtifact,
  writeRegistrySyncArtifact,
  type RegistrySyncOptions,
} from "../../lib/registry-sync.js";
import type { SkillRegistryProfile } from "../../lib/registry.js";
import { pullSkills, PullSkillError, type PulledSkillResult } from "../../lib/pull.js";

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

async function writeJson(value: unknown, space?: number) {
  const text = `${JSON.stringify(value, null, space)}\n`;
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(text, (error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function handleRegistrySync(options: {
  profile: string;
  output?: string;
  docs: boolean;
  requirements: boolean;
  validation: boolean;
  json: boolean;
}) {
  if (options.profile !== "basic" && options.profile !== "all") {
    const error = `Unknown registry profile: ${options.profile}. Available: basic, all`;
    if (options.json) await writeJson({ error });
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
    await writeJson(artifact, 2);
    return;
  }

  const invalid = artifact.summary.invalidSkillCount ?? "not checked";
  console.log(chalk.green(`Registry sync artifact written to ${options.output}`));
  console.log(chalk.dim(`  Skills: ${artifact.summary.skillCount}`));
  console.log(chalk.dim(`  Invalid: ${invalid}`));
}

/**
 * `skills pull` — fetch skills from the configured instance into this machine's corpus
 * (~/.hasna/skills/installed/<name>/). Registered here beside `registry sync` because both
 * are the "instance <-> local registry" surface. Once a skill is in the corpus,
 * loadRegistry() shows it to `skills list --all` and the MCP `list_skills` with no further
 * step.
 */
export function registerPull(parent: Command) {
  parent
    .command("pull")
    .argument("[names...]", "Skills to pull from the configured instance")
    .option("--all", "Pull every skill the instance serves", false)
    .option("--for-machine", "Prepare this machine with the instance's full catalog (implies --all)", false)
    .option("--json", "Output results as JSON", false)
    .description("Fetch skills from the configured Skills instance into this machine's corpus")
    .action(async (names: string[], options: { all: boolean; forMachine: boolean; json: boolean }) => {
      try {
        const { results } = await pullSkills({ names, all: options.all || options.forMachine });
        if (options.json) {
          console.log(JSON.stringify({ results }, null, 2));
        } else {
          printPullHuman(results);
        }
        if (results.some((result) => !result.success)) process.exitCode = 1;
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({
            error: (error as Error).message,
            ...(error instanceof PullSkillError && error.detail ? { detail: error.detail } : {}),
          }, null, 2));
        } else {
          console.error(chalk.red((error as Error).message));
          if (error instanceof PullSkillError) for (const line of error.detail ?? []) console.error(chalk.dim(`  - ${line}`));
        }
        process.exitCode = 1;
      }
    });
}

function printPullHuman(results: PulledSkillResult[]): void {
  if (!results.length) {
    console.log(chalk.dim("No skills to pull."));
    return;
  }
  console.log(chalk.bold("\nPulling skills from the configured instance...\n"));
  for (const result of results) {
    if (result.success) {
      console.log(`${chalk.green(`✓ ${result.name}`)}${chalk.dim(`  ${result.created ? "added" : "updated"} → ${result.path}`)}`);
    } else {
      console.log(chalk.red(`✗ ${result.name}: ${result.error}`));
    }
  }
  const ok = results.filter((result) => result.success).length;
  console.log(chalk.dim(`\n${ok}/${results.length} pulled into ~/.hasna/skills/installed`));
}
