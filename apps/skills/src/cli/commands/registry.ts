import chalk from "chalk";
import type { Command } from "commander";
import {
  createRegistrySyncArtifact,
  writeRegistrySyncArtifact,
  type RegistrySyncOptions,
} from "../../lib/registry-sync.js";
import type { SkillRegistryProfile } from "../../lib/registry.js";
import { pullSkills, PullSkillError, type PulledSkillResult } from "../../lib/pull.js";
import { createRemoteSkillsClient } from "../../lib/remote-client.js";
import { requiresCliSkillLoading } from "../../lib/managed-policy.js";
import { loadSelectedSkill, syncSelectionProfile } from "../../lib/selection-resolver.js";
import { selectedProfileId } from "./context.js";
import { SkillSelectionError } from "../../lib/selection-cache.js";
import { exportSkillVersionForReview } from "../../lib/review-export.js";

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
    .argument("[names...]", "Skills to pull from the configured instance (name or name@version)")
    .option("--all", "Pull every skill the instance serves", false)
    .option("--for-machine", "Prepare this machine with the instance's full catalog (implies --all)", false)
    .option("--json", "Output results as JSON", false)
    .option("--selection-profile <id>", "Selection profile for stations using the Skills CLI cache")
    .description("Fetch skills from the configured Skills instance into this machine's corpus")
    .action(async (names: string[], options: { all: boolean; forMachine: boolean; json: boolean; selectionProfile?: string }) => {
      try {
        if (requiresCliSkillLoading()) {
          const profileId = selectedProfileId(options.selectionProfile);
          if (options.all || options.forMachine) {
            const result = await syncSelectionProfile(profileId);
            if (options.json) console.log(JSON.stringify(result));
            else console.log(`Pulled verified selection profile ${result.profile.profileId} at ${result.profile.profileRevision}.`);
          } else {
            if (!names.length) throw new SkillSelectionError("SKILL_SELECTION_REQUIRED", "Name a selected skill, or use --all to synchronize the selected profile.");
            const results = [];
            for (const spec of names) {
              const loaded = await loadSelectedSkill(spec, profileId, { projectDir: process.cwd() });
              results.push({ name: loaded.selection.slug, version: loaded.selection.version, success: true, selection: loaded.selection });
            }
            if (options.json) console.log(JSON.stringify({ results }));
            else for (const result of results) console.log(`Pulled ${result.name}@${result.version} into the verified Skills cache.`);
          }
          return;
        }
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

/**
 * `skills versions <name>` — every immutable published version of a skill on the configured
 * instance, newest first, with the one the instance currently serves marked (hasna/apps#1630).
 */
export function registerVersions(parent: Command) {
  parent
    .command("versions")
    .argument("<name>", "Skill name on the configured instance")
    .option("--json", "Output as JSON", false)
    .description("List the published versions of a skill on the configured instance")
    .action(async (name: string, options: { json: boolean }) => {
      const client = await createRemoteSkillsClient();
      if (!client) {
        const message = "No API key configured, so there is no instance to list versions from.";
        if (options.json) console.log(JSON.stringify({ error: message }, null, 2));
        else console.error(chalk.red(message));
        process.exitCode = 1;
        return;
      }
      try {
        const versions = await client.listSkillVersions(name.trim());
        if (options.json) {
          console.log(JSON.stringify({ slug: name.trim(), versions }, null, 2));
          return;
        }
        if (!versions.length) {
          console.log(chalk.dim(`No published versions of '${name}' on the configured instance.`));
          return;
        }
        console.log(chalk.bold(`\nVersions of ${name}\n`));
        for (const version of versions) {
          const marker = version.current ? chalk.green(" (current)") : "";
          console.log(`  ${chalk.cyan(version.version)}${marker}  ${chalk.dim(version.bundleSha256.slice(0, 12))}  ${chalk.dim(version.createdAt)}`);
        }
        console.log("");
      } catch (error) {
        if (options.json) console.log(JSON.stringify({ error: (error as Error).message }, null, 2));
        else console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}

/** Read one immutable bundle into a private review artifact without selecting or installing it. */
export function registerReviewExport(parent: Command) {
  parent
    .command("review-export")
    .argument("<slug@version>", "Exact published skill version to review")
    .requiredOption("--output <path>", "New .tar.gz path inside an existing owner-only directory outside Git and agent discovery")
    .option("--json", "Print a metadata-only receipt", false)
    .description("Export an exact hosted bundle for private review without changing skill selection")
    .action(async (spec: string, options: { output: string; json: boolean }) => {
      try {
        const client = await createRemoteSkillsClient();
        if (!client) throw new Error("No Skills instance credential is configured. Run skills login.");
        const receipt = await exportSkillVersionForReview(spec, options.output, client);
        if (options.json) console.log(JSON.stringify(receipt));
        else console.log(`Exported ${receipt.slug}@${receipt.version} to ${receipt.output} (${receipt.bundleSha256}).`);
      } catch (error) {
        if (options.json) console.log(JSON.stringify({ error: (error as Error).message }));
        else console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}

export function registerLifecycle(parent: Command) {
  parent.command("lifecycle")
    .argument("<name>", "Skill name on the configured instance")
    .requiredOption("--state <state>", "Lifecycle state: active or archived")
    .requiredOption("--revision <revision>", "Exact revision id from skills info/get")
    .option("--reason <reason>", "Bounded archive reason")
    .option("--replacement <slug>", "Optional successor slug")
    .option("--json", "Output as JSON", false)
    .description("Change a hosted skill's active/archive lifecycle with an exact revision guard")
    .action(async (name: string, options: { state: string; revision: string; reason?: string; replacement?: string; json: boolean }) => {
      if (options.state !== "active" && options.state !== "archived") throw new Error("--state must be active or archived");
      const client = await createRemoteSkillsClient();
      if (!client) throw new Error("No API key configured, so there is no instance to update.");
      try {
        const result = await client.setSkillLifecycle(name.trim(), options.state, { expectedRevisionId: options.revision, ...(options.reason ? { reason: options.reason } : {}), ...(options.replacement ? { replacementSlug: options.replacement } : {}) });
        console.log(options.json ? JSON.stringify(result, null, 2) : `Updated ${name} to ${options.state}.`);
      } catch (error) {
        if (options.json) console.log(JSON.stringify({ error: (error as Error).message }, null, 2)); else console.error(chalk.red((error as Error).message));
        process.exitCode = 1;
      }
    });
}
