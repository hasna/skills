/**
 * run / mcp / serve / self-update — runtime commands
 */

import chalk from "chalk";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createInterface } from "readline";
import type { Command } from "commander";
import { getSkill, findSimilarSkills } from "../../lib/registry.js";
import { runSkill } from "../../lib/skillinfo.js";
import {
  ARTICLE_GENERATION_SLUG,
  getPublicSkillPricing,
  validateBlogArticleRunOptions,
} from "../../lib/pricing.js";
import { loadConfig, saveConfig, type ConfigScope } from "../../lib/config.js";
import { REMOTE_SKILL_RUN_CONTRACT_VERSION } from "../../lib/remote-run-contract.js";
import {
  completeSkillRun,
  createSkillRun,
  findSkillRun,
  getRunExportDir,
  listSkillRuns,
  updateSkillRun,
  writeRunLogs,
} from "../../lib/run-state.js";
import { handleMcp } from "./runtime-mcp.js";

export function registerRuntime(parent: Command) {
  parent
    .command("quote")
    .argument("<skill>", "Skill name")
    .argument("[args...]", "Arguments that affect pricing, such as --count 8")
    .allowUnknownOption(true)
    .passThroughOptions(true)
    .option("--json", "Output quote as JSON", false)
    .description("Quote a skill run before spending account balance")
    .action((name: string, args: string[], options: { json: boolean }) => handleQuote(name, args, options));

  // Run
  parent
    .command("run")
    .argument("<skill>", "Skill name")
    .argument("[args...]", "Arguments to pass to the skill")
    .allowUnknownOption(true)
    .passThroughOptions(true)
    .option("--json", "Output result as JSON", false)
    .option("--wait", "Poll remote runs until a terminal status", false)
    .option("--poll-interval-ms <ms>", "Remote polling interval in milliseconds", "1000")
    .option("--poll-timeout-ms <ms>", "Maximum time to wait for a remote run", "300000")
    .description("Run a skill directly")
    .action(async (name: string, args: string[], options: RunCommandOptions) => handleRun(name, args, options));

  const runs = parent
    .command("runs")
    .description("Inspect local skill run records");

  runs
    .command("list")
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Maximum number of runs", "20")
    .description("List recent skill runs")
    .action((options: { json: boolean; limit: string }) => handleRunsList(options));

  runs
    .command("show")
    .argument("<run-id>", "Run id")
    .option("--json", "Output as JSON", false)
    .description("Show a skill run record")
    .action((runId: string, options: { json: boolean }) => handleRunsShow(runId, options));

  runs
    .command("status")
    .argument("<run-id>", "Remote run id, or local run id linked to a remote run")
    .option("--json", "Output as JSON", false)
    .description("Fetch remote run status")
    .action((runId: string, options: { json: boolean }) => handleRunsStatus(runId, options));

  const exportsCommand = parent
    .command("exports")
    .description("Inspect or open skill run exports");

  exportsCommand
    .command("open")
    .argument("<run-id>", "Run id")
    .option("--json", "Output as JSON", false)
    .description("Open the export directory for a run")
    .action((runId: string, options: { json: boolean }) => handleExportsOpen(runId, options));

  exportsCommand
    .command("download")
    .argument("<run-id>", "Remote run id")
    .option("--json", "Output as JSON", false)
    .description("Download remote run artifacts into .skills/exports")
    .action((runId: string, options: { json: boolean }) => handleExportsDownload(runId, options));

  // MCP
  parent
    .command("mcp")
    .option("--register <agent>", "Register MCP server with agent")
    .option("--json", "Output registration result as JSON", false)
    .description("Start MCP server (stdio) or register with an agent")
    .action(async (options: { register?: string; json: boolean }) => handleMcp(options));

  const setup = parent
    .command("setup")
    .description("Choose hosted mode, local-only mode, or agent integrations")
    .option("--mode <mode>", "Runtime mode: hosted or local")
    .option("--api-url <url>", "Hosted API origin")
    .option("--global", "Save setup choice globally", false)
    .option("--json", "Output setup result as JSON", false)
    .action(async (options: SetupCommandOptions) => handleSetup(options));

  setup
    .command("agents")
    .option("--json", "Output registration result as JSON", false)
    .description("Register the Skills MCP server with all supported agents")
    .action(async (options: { json: boolean }) => handleMcp({ register: "all", json: options.json }));

  // Self-update
  parent
    .command("self-update")
    .description("Update @hasna/skills to the latest version")
    .option("--json", "Output result as JSON", false)
    .action(async (options: { json: boolean }) => {
      if (process.env.SKILLS_TEST_MODE === "1") {
        if (options.json) console.log(JSON.stringify({ updated: false, error: "Self-update disabled in test mode" }));
        else console.error(chalk.yellow("Self-update disabled in test mode"));
        process.exitCode = 1;
        return;
      }
      const name = "@hasna/skills";
      if (!options.json) console.log(chalk.bold(`\nUpdating ${name}...\n`));
      const proc = Bun.spawn(["bun", "add", "-g", `${name}@latest`], {
        stdout: options.json ? "pipe" : "inherit",
        stderr: options.json ? "pipe" : "inherit",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        options.json ? new Response(proc.stdout).text() : Promise.resolve(""),
        options.json ? new Response(proc.stderr).text() : Promise.resolve(""),
        proc.exited,
      ]);
      if (exitCode === 0) {
        const vProc = Bun.spawn(["skills", "--version"], { stdout: "pipe" });
        const version = (await new Response(vProc.stdout).text()).trim();
        if (options.json) console.log(JSON.stringify({ updated: true, version, stdout, stderr }));
        else {
          console.log(chalk.green("\n\u2713 Updated to latest version"));
          console.log(chalk.dim(`  Version: ${version}`));
        }
      } else {
        if (options.json) console.log(JSON.stringify({ updated: false, exitCode, stdout, stderr }));
        else console.error(chalk.red("\n\u2717 Update failed"));
        process.exitCode = 1;
      }
    });
}

interface SetupCommandOptions {
  mode?: string;
  apiUrl?: string;
  global: boolean;
  json: boolean;
}

async function handleSetup(options: SetupCommandOptions) {
  const scope: ConfigScope = options.global ? "global" : "project";
  let mode = normalizeSetupMode(options.mode);

  if (!mode && process.stdin.isTTY && process.stdout.isTTY) {
    mode = normalizeSetupMode(await promptLine("Use hosted Skills or local-only mode? [hosted/local] ")) ?? "hosted";
  }
  mode = mode ?? "local";

  saveConfig("mode", mode, scope);
  if (mode === "hosted") {
    saveConfig("apiUrl", options.apiUrl || "https://skills.md", scope);
  }

  const config = loadConfig();
  const next = mode === "hosted"
    ? ["skills auth login", "skills list --remote"]
    : ["skills list", "skills run <skill>"];
  const payload = {
    mode,
    scope,
    config,
    next,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(chalk.green(`Set Skills mode to ${mode}`));
  console.log(chalk.dim(`  Scope: ${scope}`));
  if (mode === "hosted") {
    console.log(chalk.dim(`  API: ${config.apiUrl || "https://skills.md"}`));
    console.log(chalk.dim("  Next: skills auth login"));
  } else {
    console.log(chalk.dim("  Skills will run locally unless a command explicitly uses remote registry access."));
    console.log(chalk.dim("  Next: skills list"));
  }
}

function normalizeSetupMode(value: string | undefined): "local" | "hosted" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "offline") return "local";
  if (normalized === "skills.md" || normalized === "skillsmd" || normalized === "remote" || normalized === "hosted") return "hosted";
  throw new Error("Invalid setup mode. Use hosted or local.");
}

function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.bold(question), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function handleQuote(name: string, args: string[], options: { json: boolean }) {
  const json = options.json || args.includes("--json");
  const quoteArgs = args.filter((arg) => arg !== "--json");
  const skill = getSkill(name);
  if (!skill) {
    const error = `Skill '${name}' not found`;
    if (json) console.log(JSON.stringify({ error, similar: findSimilarSkills(name) }));
    else {
      console.error(chalk.red(error));
      const similar = findSimilarSkills(name);
      if (similar.length > 0) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
    }
    process.exitCode = 1;
    return;
  }

  if (skill.name === ARTICLE_GENERATION_SLUG) {
    const validation = validateBlogArticleRunOptions({}, quoteArgs);
    if (!validation.ok) {
      writeBlogArticleValidationError(validation.errors, json);
      return;
    }
  }

  const pricing = getPublicSkillPricing(skill.name, {}, quoteArgs);
  const payload = { skill: skill.name, pricing };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(chalk.bold(`\nQuote for ${skill.name}\n`));
  console.log(`${chalk.dim("Price:")} ${pricing.formattedCost}`);
  if (pricing.formattedUnitCost && pricing.unitCount) {
    console.log(`${chalk.dim("Unit:")} ${pricing.formattedUnitCost} x ${pricing.unitCount}`);
  }
  console.log(`${chalk.dim("Type:")} ${pricing.tier}`);
  if (pricing.quoteDependsOnInput) console.log(chalk.dim("Final price depends on run options."));
}

interface RunCommandOptions {
  json: boolean;
  wait?: boolean;
  pollIntervalMs?: string;
  pollTimeoutMs?: string;
}

async function handleRun(name: string, args: string[], options: RunCommandOptions) {
  const skill = getSkill(name);
  if (!skill) {
    const similar = findSimilarSkills(name);
    if (options.json) {
      console.log(JSON.stringify({ skill: name, args, exitCode: 1, error: `Skill '${name}' not found`, similar }));
    } else {
      console.error(`Skill '${name}' not found`);
      if (similar.length) console.error(chalk.dim(`Did you mean: ${similar.join(", ")}?`));
    }
    process.exitCode = 1; return;
  }

  const prompt = extractPrompt(args);
  const pricing = await import("../../lib/pricing.js");
  if (skill.name === ARTICLE_GENERATION_SLUG) {
    const validation = pricing.validateBlogArticleRunOptions({}, args, { requireTopic: true });
    if (!validation.ok) {
      writeBlogArticleValidationError(validation.errors, options.json);
      return;
    }
  }
  const isPremium = pricing.isPremiumSkill(skill.name);
  const costCents = isPremium ? pricing.getSkillRunCostCents(skill.name, {}, args) : undefined;
  const publicPricing = pricing.getPublicSkillPricing(skill.name, {}, args);
  const runContext = createSkillRun({
    skill: skill.name,
    args,
    prompt,
    remote: isPremium,
    costCents,
  });

  if (isPremium) {
      const { getApiKey } = await import("../../lib/auth-store.js");
      const apiKey = getApiKey();
      if (!apiKey) {
        const error = `${skill.name} is a hosted skill (${pricing.formatCost(costCents ?? 0)}). Run: skills setup --mode hosted && skills auth login`;
        writeRunLogs(runContext, "", error + "\n");
        const run = completeSkillRun(runContext, { status: "failed", error, costCents });
        if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, skill: skill.name, args, exitCode: 1, remote: true, error, pricing: publicPricing, run }, null, 2));
        else console.error(chalk.red(error));
        process.exitCode = 1;
        return;
      }

      try {
        const { RemoteSkillsClient } = await import("../../lib/remote-client.js");
        const client = new RemoteSkillsClient(apiKey);
        if (!options.json) console.log(`${chalk.dim("Price:")} ${publicPricing.formattedCost}`);
        const run = await client.submitRun(skill.name, {}, args);
        if (run.error) {
          writeRunLogs(runContext, "", String(run.error) + "\n");
          const localRun = completeSkillRun(runContext, { status: "failed", error: String(run.error), costCents });
          if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, skill: skill.name, args, exitCode: 1, remote: true, error: run.error, pricing: publicPricing, remoteRun: run, run: localRun }, null, 2));
          else console.error(chalk.red(run.error));
          process.exitCode = 1;
          return;
        }
        const remoteRunId = typeof run.id === "string" ? run.id : undefined;
        const nextActions = remoteRunNextActions(remoteRunId);
        const polling = parsePollingOptions(options);
        const polled: PollRemoteRunResult = options.wait && remoteRunId && !isTerminalRemoteStatus(run.status)
          ? await pollRemoteRun(client, remoteRunId, polling)
          : { run, attempts: 0, waited: false };
        const remoteRun = polled.run ?? run;
        const status = normalizeRemoteStatus(remoteRun.status);
        const timedOutError = polled.timedOut && remoteRunId
          ? `Remote run '${remoteRunId}' did not reach a terminal status within ${polling.timeoutMs}ms`
          : undefined;
        const exitCode = timedOutError ? 124 : remoteExitCode(remoteRun, status);
        const error = timedOutError ?? remoteRunError(remoteRun);
        const localRun = await persistRemoteRun({
          client,
          context: runContext,
          remoteRun,
          remoteRunId,
          costCents,
          fallbackError: error,
        });
        if (options.json) {
          console.log(JSON.stringify({
            contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
            skill: skill.name,
            args,
            exitCode,
            remote: true,
            pricing: publicPricing,
            remoteRun,
            run: localRun,
            nextActions,
            ...(options.wait ? { polling: { waited: polled.waited, attempts: polled.attempts, timeoutMs: polling.timeoutMs, timedOut: Boolean(polled.timedOut) } } : {}),
            ...(error ? { error } : {}),
          }, null, 2));
        }
        else {
          if (status === "failed") console.log(chalk.red(`Remote run failed for ${skill.name}`));
          else if (status === "completed") console.log(chalk.green(`Completed remote run for ${skill.name}`));
          else console.log(chalk.green(`Submitted remote run for ${skill.name}`));
          console.log(chalk.dim(`  Local run: ${localRun.id}`));
          console.log(chalk.dim(`  Run: ${remoteRun.id ?? "unknown"}`));
          console.log(chalk.dim(`  Status: ${remoteRun.status ?? "queued"}`));
          console.log(chalk.dim(`  Metadata: ${localRun.paths.runDir}/run.json`));
          if (options.wait) console.log(chalk.dim(`  Poll attempts: ${polled.attempts}`));
          if (error) console.log(chalk.red(`  Error: ${error}`));
          if (nextActions) {
            console.log(chalk.dim(`  Next: ${nextActions.poll}`));
            console.log(chalk.dim(`  When complete: ${nextActions.download}`));
          }
        }
        process.exitCode = exitCode;
        return;
      } catch (err) {
        const error = `Hosted skill ${skill.name} requires hosted access: ${(err as Error).message}`;
        writeRunLogs(runContext, "", error + "\n");
        const run = completeSkillRun(runContext, { status: "failed", error, costCents });
        if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, skill: skill.name, args, exitCode: 1, remote: true, error, pricing: publicPricing, run }, null, 2));
        else console.error(chalk.red(error));
        process.exitCode = 1;
        return;
      }
  }

  const result = await runSkill(name, args, {
    stdio: "pipe",
    env: {
      SKILLS_RUN_ID: runContext.record.id,
      SKILLS_RUN_DIR: runContext.runDir,
      SKILLS_EXPORT_DIR: runContext.exportDir,
    },
  });
  writeRunLogs(runContext, result.stdout ?? "", result.stderr ?? result.error ?? "");
  const completed = completeSkillRun(runContext, {
    status: result.exitCode === 0 ? "completed" : "failed",
    error: result.error,
  });
  if (options.json) console.log(JSON.stringify({ skill: skill.name, args, ...result, run: completed }, null, 2));
  else {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error);
    console.log(chalk.dim(`Run metadata: ${completed.paths.runDir}/run.json`));
    console.log(chalk.dim(`Exports: ${completed.paths.exportDir}`));
  }
  process.exitCode = result.exitCode;
}

function writeBlogArticleValidationError(errors: string[], json: boolean) {
  const payload = {
    error: "invalid blog article options",
    code: "INVALID_BLOG_ARTICLE_OPTIONS",
    details: errors,
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.error(chalk.red(payload.error));
    for (const error of errors) console.error(chalk.dim(`  ${error}`));
  }
  process.exitCode = 1;
}

function handleRunsList(options: { json: boolean; limit: string }) {
  const limit = Number.parseInt(options.limit, 10);
  const runs = listSkillRuns(process.cwd(), Number.isFinite(limit) ? limit : 20);
  if (options.json) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }
  if (!runs.length) {
    console.log(chalk.dim("No skill runs found"));
    return;
  }
  console.log(chalk.bold(`\nRecent skill runs (${runs.length}):\n`));
  for (const run of runs) {
    console.log(`  ${chalk.cyan(run.id)}  ${run.skill}  ${statusColor(run.status)}  ${chalk.dim(run.startedAt)}`);
  }
}

function handleRunsShow(runId: string, options: { json: boolean }) {
  const run = findSkillRun(runId);
  if (!run) {
    const error = `Run '${runId}' not found`;
    if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }
  if (options.json) console.log(JSON.stringify(run, null, 2));
  else {
    console.log(chalk.bold(`\n${run.id}\n`));
    console.log(`${chalk.dim("Skill:")} ${run.skill}`);
    console.log(`${chalk.dim("Status:")} ${statusColor(run.status)}`);
    console.log(`${chalk.dim("Started:")} ${run.startedAt}`);
    if (run.completedAt) console.log(`${chalk.dim("Completed:")} ${run.completedAt}`);
    if (run.remoteRunId) console.log(`${chalk.dim("Remote run:")} ${run.remoteRunId}`);
    if (run.error) console.log(`${chalk.dim("Error:")} ${chalk.red(run.error)}`);
    console.log(`${chalk.dim("Run dir:")} ${run.paths.runDir}`);
    console.log(`${chalk.dim("Exports:")} ${run.paths.exportDir}`);
  }
}

async function handleRunsStatus(runId: string, options: { json: boolean }) {
  const { getApiKey } = await import("../../lib/auth-store.js");
  const apiKey = getApiKey();
  if (!apiKey) {
    const error = "Remote run status requires hosted access. Run: skills auth login";
    if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  const localRun = findSkillRun(runId);
  const remoteRunId = localRun?.remoteRunId || runId;
  if (localRun && !localRun.remoteRunId) {
    const error = `Run '${runId}' is local and has no remote run id`;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  try {
    const { RemoteSkillsClient } = await import("../../lib/remote-client.js");
    const client = new RemoteSkillsClient(apiKey);
    const run = await client.getRun(remoteRunId);
    if (!run) {
      const error = `Remote run '${remoteRunId}' not found`;
      if (options.json) console.log(JSON.stringify({ contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION, error }, null, 2));
      else console.error(chalk.red(error));
      process.exitCode = 1;
      return;
    }

    const nextActions = remoteRunNextActions(remoteRunId);
    const payload = {
      contractVersion: REMOTE_SKILL_RUN_CONTRACT_VERSION,
      runId: remoteRunId,
      ...(localRun ? { localRunId: localRun.id } : {}),
      run,
      nextActions,
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(chalk.bold(`\n${remoteRunId}\n`));
    if (localRun) console.log(`${chalk.dim("Local run:")} ${localRun.id}`);
    if (typeof run.skill === "string") console.log(`${chalk.dim("Skill:")} ${run.skill}`);
    console.log(`${chalk.dim("Status:")} ${statusColor(String(run.status || "queued"))}`);
    if (run.createdAt) console.log(`${chalk.dim("Created:")} ${run.createdAt}`);
    if (run.startedAt) console.log(`${chalk.dim("Started:")} ${run.startedAt}`);
    if (run.completedAt) console.log(`${chalk.dim("Completed:")} ${run.completedAt}`);
    if (run.errorMessage) console.log(`${chalk.dim("Error:")} ${chalk.red(run.errorMessage)}`);
    if (nextActions) {
      console.log(`${chalk.dim("Next:")} ${nextActions.poll}`);
      const label = run.status === "completed" ? "Download" : "When complete";
      console.log(`${chalk.dim(`${label}:`)} ${nextActions.download}`);
    }
  } catch (err) {
    const error = (err as Error).message;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
  }
}

async function handleExportsOpen(runId: string, options: { json: boolean }) {
  const run = findSkillRun(runId);
  if (!run) {
    const error = `Run '${runId}' not found`;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }
  const exportDir = run.paths.exportDir;
  if (options.json) {
    console.log(JSON.stringify({ runId, exportDir }, null, 2));
    return;
  }
  console.log(exportDir);
  try {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", exportDir] : [exportDir];
    Bun.spawn([opener, ...args], { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

async function handleExportsDownload(runId: string, options: { json: boolean }) {
  const { getApiKey } = await import("../../lib/auth-store.js");
  const apiKey = getApiKey();
  if (!apiKey) {
    const error = "Remote artifact downloads require hosted access. Run: skills auth login";
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
    return;
  }

  try {
    const { RemoteSkillsClient } = await import("../../lib/remote-client.js");
    const client = new RemoteSkillsClient(apiKey);
    const remoteRun = await client.getRun(runId);
    if (!remoteRun) {
      const error = `Remote run '${runId}' not found`;
      if (options.json) console.log(JSON.stringify({ error }, null, 2));
      else console.error(chalk.red(error));
      process.exitCode = 1;
      return;
    }

    const artifacts = await client.getRunArtifacts(runId);
    const canonicalSkill = typeof remoteRun.skill === "string" ? remoteRun.skill : "remote";
    const requestedSkill = typeof remoteRun.requestedSlug === "string" && remoteRun.requestedSlug.trim()
      ? remoteRun.requestedSlug
      : canonicalSkill;
    const exportDir = getRunExportDir(runId, requestedSkill);
    mkdirSync(exportDir, { recursive: true });
    const downloaded: Array<{ id: string; path: string; byteSize: number }> = [];

    for (const artifact of artifacts) {
      const artifactId = String(artifact.id || "");
      if (!artifactId) continue;
      const response = await client.downloadRunArtifact(runId, artifactId);
      if (!response.ok) throw new Error(`download failed for artifact ${artifactId}: ${response.status}`);
      const relativePath = safeArtifactRelativePath(
        typeof artifact.relativePath === "string" ? artifact.relativePath : artifact.fileName,
        String(artifact.fileName || artifactId),
      );
      const outputPath = join(exportDir, relativePath);
      mkdirSync(dirname(outputPath), { recursive: true });
      const bytes = new Uint8Array(await response.arrayBuffer());
      writeFileSync(outputPath, bytes);
      downloaded.push({ id: artifactId, path: outputPath, byteSize: bytes.byteLength });
    }

    const payload = {
      runId,
      skill: requestedSkill,
      ...(requestedSkill !== canonicalSkill ? { canonicalSkill } : {}),
      exportDir,
      downloaded,
    };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(chalk.green(`Downloaded ${downloaded.length} artifact${downloaded.length === 1 ? "" : "s"}`));
      console.log(chalk.dim(`  Exports: ${exportDir}`));
    }
  } catch (err) {
    const error = (err as Error).message;
    if (options.json) console.log(JSON.stringify({ error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
  }
}

function safeArtifactRelativePath(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  const parts = raw.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    return fallback.replace(/[\\/\r\n"]/g, "_");
  }
  return parts.join("/");
}

interface RemoteRunApiClient {
  getRun(runId: string): Promise<any | null>;
  getRunLogs(runId: string): Promise<any[]>;
}

interface PollingOptions {
  intervalMs: number;
  timeoutMs: number;
}

interface PollRemoteRunResult {
  run: any;
  attempts: number;
  waited: boolean;
  timedOut?: boolean;
}

function parsePollingOptions(options: RunCommandOptions): PollingOptions {
  return {
    intervalMs: parsePositiveInt(options.pollIntervalMs, 1000),
    timeoutMs: parsePositiveInt(options.pollTimeoutMs, 300_000),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function pollRemoteRun(
  client: RemoteRunApiClient,
  runId: string,
  options: PollingOptions,
): Promise<PollRemoteRunResult> {
  const deadline = Date.now() + options.timeoutMs;
  let attempts = 0;
  let current: any = null;

  while (Date.now() <= deadline) {
    attempts += 1;
    current = await client.getRun(runId);
    if (!current) throw new Error(`Remote run '${runId}' not found`);
    if (isTerminalRemoteStatus(current.status)) return { run: current, attempts, waited: true };
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.intervalMs, remaining)));
  }

  return {
    run: current ?? { id: runId, status: "queued" },
    attempts,
    waited: true,
    timedOut: true,
  };
}

async function persistRemoteRun(params: {
  client: RemoteRunApiClient;
  context: ReturnType<typeof createSkillRun>;
  remoteRun: any;
  remoteRunId?: string;
  costCents?: number;
  fallbackError?: string;
}) {
  const status = normalizeRemoteStatus(params.remoteRun.status);
  await writeRemoteRunLogs(params.client, params.context, params.remoteRun, params.remoteRunId, params.fallbackError);
  if (isTerminalNormalizedStatus(status)) {
    return completeSkillRun(params.context, {
      status,
      remoteRunId: params.remoteRunId,
      costCents: params.costCents,
      ...(status === "failed" ? { error: params.fallbackError ?? "Remote run failed" } : {}),
    });
  }

  return updateSkillRun(params.context, {
    status,
    remoteRunId: params.remoteRunId,
    costCents: params.costCents,
  });
}

async function writeRemoteRunLogs(
  client: RemoteRunApiClient,
  context: ReturnType<typeof createSkillRun>,
  remoteRun: any,
  remoteRunId?: string,
  fallbackError?: string,
): Promise<void> {
  const logs = remoteRunId ? await fetchRemoteRunLogs(client, remoteRunId) : [];
  const { stdout, stderr } = splitRemoteLogs(remoteRun, logs, fallbackError);
  writeRunLogs(context, stdout, stderr);
}

async function fetchRemoteRunLogs(client: RemoteRunApiClient, runId: string): Promise<any[]> {
  try {
    return await client.getRunLogs(runId);
  } catch {
    return [];
  }
}

function splitRemoteLogs(remoteRun: any, logs: any[], fallbackError?: string): { stdout: string; stderr: string } {
  let stdout = typeof remoteRun.stdout === "string" ? remoteRun.stdout : "";
  let stderr = typeof remoteRun.stderr === "string" ? remoteRun.stderr : "";

  if (logs.length > 0) {
    const out: string[] = [];
    const err: string[] = [];
    for (const entry of logs) {
      const line = formatRemoteLogLine(entry);
      const level = typeof entry?.level === "string" ? entry.level.toLowerCase() : "info";
      if (level === "error" || level === "warn") err.push(line);
      else out.push(line);
    }
    stdout = appendLines(stdout, out);
    stderr = appendLines(stderr, err);
  }

  if (!stdout && typeof remoteRun.outputPreview === "string" && normalizeRemoteStatus(remoteRun.status) === "completed") {
    stdout = `${remoteRun.outputPreview}\n`;
  }
  if (!stderr && fallbackError) stderr = `${fallbackError}\n`;

  return { stdout, stderr };
}

function formatRemoteLogLine(entry: any): string {
  const message = typeof entry?.message === "string" ? entry.message : JSON.stringify(entry);
  const level = typeof entry?.level === "string" ? entry.level : "info";
  const sequence = Number.isFinite(Number(entry?.sequence)) ? `${entry.sequence} ` : "";
  return `[${level}] ${sequence}${message}`;
}

function appendLines(existing: string, lines: string[]): string {
  const rendered = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  return existing ? `${existing}${existing.endsWith("\n") || !rendered ? "" : "\n"}${rendered}` : rendered;
}

function remoteRunNextActions(runId: string | undefined): { poll: string; download: string } | undefined {
  if (!runId) return undefined;
  return {
    poll: `skills runs status ${runId}`,
    download: `skills exports download ${runId}`,
  };
}

function extractPrompt(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--prompt" || arg === "-p") && args[i + 1]) return args[i + 1];
    if (arg.startsWith("--prompt=")) return arg.slice("--prompt=".length);
  }
  return undefined;
}

function normalizeRemoteStatus(status: unknown): "queued" | "running" | "completed" | "failed" {
  switch (String(status ?? "queued").toLowerCase()) {
    case "running":
    case "processing":
    case "in_progress":
      return "running";
    case "completed":
    case "complete":
    case "succeeded":
    case "success":
      return "completed";
    case "failed":
    case "failure":
    case "error":
    case "errored":
    case "cancelled":
    case "canceled":
    case "timed_out":
    case "timeout":
      return "failed";
    default:
      return "queued";
  }
}

function isTerminalRemoteStatus(status: unknown): boolean {
  return isTerminalNormalizedStatus(normalizeRemoteStatus(status));
}

function isTerminalNormalizedStatus(status: "queued" | "running" | "completed" | "failed"): boolean {
  return status === "completed" || status === "failed";
}

function remoteRunError(run: any): string | undefined {
  for (const key of ["error", "errorMessage", "message"]) {
    if (typeof run?.[key] === "string" && run[key].trim()) return run[key];
  }
  return normalizeRemoteStatus(run?.status) === "failed" ? "Remote run failed" : undefined;
}

function remoteExitCode(run: any, status: "queued" | "running" | "completed" | "failed"): number {
  const rawExitCode = Number(run?.exitCode);
  const hasExitCode = Number.isInteger(rawExitCode) && rawExitCode >= 0 && rawExitCode <= 255;
  if (hasExitCode) return rawExitCode;
  return status === "failed" ? 1 : 0;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return chalk.green(status);
    case "failed": return chalk.red(status);
    case "running": return chalk.yellow(status);
    default: return chalk.dim(status);
  }
}
