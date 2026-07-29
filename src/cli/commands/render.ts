import chalk from "chalk";
import type { Command } from "commander";

import { resolveAgents, type AgentScope } from "../../lib/installer.js";
import {
  checkRenderedSkillHomes,
  renderSkillHomes,
  type SkillRenderHomeCheck,
} from "../../lib/skill-render.js";

interface RenderCommandOptions {
  check: boolean;
  archiveStrays: boolean;
  to: string;
  scope: string;
  json: boolean;
}

export function registerRender(parent: Command): void {
  parent
    .command("render")
    .description("Render instruction skills into agent-native skill homes")
    .option("--check", "Report missing, drifted, stray, and stale renders without writing", false)
    .option("--archive-strays", "Move unmanaged entries to the recoverable skills archive", false)
    .option("--to <agent>", "Agent home to render (default: all)", "all")
    .option("--scope <scope>", "Agent home scope: global or project", "global")
    .option("--json", "Output as JSON", false)
    .action((options: RenderCommandOptions) => handleRender(options));
}

function handleRender(options: RenderCommandOptions): void {
  try {
    if (options.check && options.archiveStrays) {
      throw new Error("--archive-strays cannot be used with read-only --check");
    }
    if (options.scope !== "global" && options.scope !== "project") {
      throw new Error("Unknown scope. Available: global, project");
    }
    const agents = resolveAgents(options.to);
    const renderOptions = { agents, scope: options.scope as AgentScope };
    const result = options.check
      ? checkRenderedSkillHomes(renderOptions)
      : renderSkillHomes({ ...renderOptions, archiveStrays: options.archiveStrays });

    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printHomes(result.homes, options.check);
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    const error = (err as Error).message;
    if (options.json) console.log(JSON.stringify({ ok: false, error }, null, 2));
    else console.error(chalk.red(error));
    process.exitCode = 1;
  }
}

function printHomes(homes: SkillRenderHomeCheck[], check: boolean): void {
  for (const home of homes) {
    const issueCount = home.missing.length
      + home.drifted.length
      + home.stray.length
      + home.stale.length
      + home.errors.length;
    console.log(issueCount === 0
      ? chalk.green(`✓ ${home.home}: ${check ? "render is current" : "rendered"} (${home.path})`)
      : chalk.yellow(`! ${home.home}: ${issueCount} render issue${issueCount === 1 ? "" : "s"} (${home.path})`));
    printIssueList("missing", home.missing);
    printIssueList("drifted", home.drifted);
    printIssueList("stray", home.stray);
    printIssueList("stale", home.stale);
    printIssueList("error", home.errors);
  }
}

function printIssueList(label: string, entries: string[]): void {
  for (const entry of entries) console.log(`  ${label}: ${entry}`);
}
