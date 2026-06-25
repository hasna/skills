/**
 * schedule — cron-based skill scheduling commands
 */

import chalk from "chalk";
import type { Command } from "commander";
import {
  addSchedule, listSchedules, removeSchedule, setScheduleEnabled,
  getDueSchedules, recordScheduleRun, validateCron, getNextRun,
} from "../../lib/scheduler.js";
import {
  DEFAULT_LIST_LIMIT,
  paginate,
  parsePageLimit,
  parsePageOffset,
  showingLabel,
  truncateText,
} from "../../lib/compact-output.js";

export function registerSchedule(parent: Command) {
  const scheduleCmd = parent
    .command("schedule")
    .description("Manage scheduled skill runs (cron-based)");

  scheduleCmd
    .command("add")
    .argument("<skill>", "Skill to schedule (bare name, e.g. image)")
    .argument("<cron>", "5-field cron expression")
    .option("--name <label>", "Human-readable label for this schedule")
    .option("--args <args>", "Space-separated args to pass to the skill")
    .option("--json", "Output as JSON", false)
    .description("Add a cron schedule for a skill")
    .action((skill: string, cron: string, options: { name?: string; args?: string; json: boolean }) => {
      const args = options.args ? options.args.split(" ").filter(Boolean) : undefined;
      const { schedule, error } = addSchedule(skill, cron, { name: options.name, args });
      if (options.json) { console.log(JSON.stringify(schedule ? { schedule } : { error })); return; }
      if (error || !schedule) { console.error(chalk.red(`✗ ${error || "Failed to add schedule"}`)); process.exitCode = 1; return; }
      console.log(chalk.green(`✓ Scheduled '${schedule.name}'`));
      console.log(chalk.dim(`  Cron: ${schedule.cron}`));
      if (schedule.nextRun) console.log(chalk.dim(`  Next run: ${new Date(schedule.nextRun).toLocaleString()}`));
      console.log(chalk.dim(`  ID: ${schedule.id}`));
    });

  scheduleCmd
    .command("list")
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Maximum rows to print for human output (default: 30, use 0 or all for every row)")
    .option("--cursor <n>", "Numeric offset for human-output pagination", "0")
    .description("List all scheduled skills")
    .action((options: { json: boolean; limit?: string; cursor?: string }) => {
      const schedules = listSchedules();
      if (options.json) { console.log(JSON.stringify(schedules)); return; }
      if (!schedules.length) { console.log(chalk.dim("No schedules. Run: skills schedule add <skill> <cron>")); return; }
      const page = paginate(schedules, {
        limit: parsePageLimit(options.limit, DEFAULT_LIST_LIMIT, { allowAll: true }),
        offset: parsePageOffset(options.cursor),
      });
      console.log(chalk.bold(`\nScheduled skills (${showingLabel(schedules.length, page.items.length, page.offset)}):\n`));
      for (const s of page.items) {
        console.log(`  ${chalk.cyan(s.name)} [${s.enabled ? chalk.green("enabled") : chalk.dim("disabled")}]`);
        const last = s.lastRun ? `last: ${new Date(s.lastRun).toLocaleString()} [${s.lastRunStatus ?? "?"}]` : "never run";
        const next = s.nextRun ? `next: ${new Date(s.nextRun).toLocaleString()}` : "";
        const args = s.args?.length ? `  args: ${truncateText(s.args.join(" "), 80)}` : "";
        console.log(chalk.dim(`    ${s.id}  skill: ${s.skill}  cron: ${s.cron}  ${last}  ${next}${args}`));
      }
      if (page.hasMore && page.nextOffset !== null) {
        console.log(chalk.dim(`\nNext: skills schedule list --cursor ${page.nextOffset} --limit ${page.limit}`));
      }
      console.log(chalk.dim("Details: use --json for complete schedule records."));
    });

  scheduleCmd
    .command("remove")
    .argument("<id-or-name>", "Schedule ID or name to remove")
    .option("--json", "Output as JSON", false)
    .description("Remove a schedule")
    .action((idOrName: string, options: { json: boolean }) => {
      const removed = removeSchedule(idOrName);
      if (options.json) { console.log(JSON.stringify({ removed, idOrName })); return; }
      console.log(removed ? chalk.green(`✓ Removed schedule '${idOrName}'`) : chalk.red(`Schedule '${idOrName}' not found`));
      if (!removed) process.exitCode = 1;
    });

  scheduleCmd
    .command("enable")
    .argument("<id-or-name>", "Schedule ID or name")
    .option("--json", "Output as JSON", false)
    .description("Enable a disabled schedule")
    .action((idOrName: string, options: { json: boolean }) => {
      const ok = setScheduleEnabled(idOrName, true);
      if (options.json) console.log(JSON.stringify({ idOrName, enabled: true, success: ok }));
      else console.log(ok ? chalk.green(`✓ Enabled '${idOrName}'`) : chalk.red(`Schedule '${idOrName}' not found`));
      if (!ok) process.exitCode = 1;
    });

  scheduleCmd
    .command("disable")
    .argument("<id-or-name>", "Schedule ID or name")
    .option("--json", "Output as JSON", false)
    .description("Disable a schedule without removing it")
    .action((idOrName: string, options: { json: boolean }) => {
      const ok = setScheduleEnabled(idOrName, false);
      if (options.json) console.log(JSON.stringify({ idOrName, enabled: false, success: ok }));
      else console.log(ok ? chalk.green(`✓ Disabled '${idOrName}'`) : chalk.red(`Schedule '${idOrName}' not found`));
      if (!ok) process.exitCode = 1;
    });

  scheduleCmd
    .command("run")
    .option("--dry-run", "Show which schedules are due without running them", false)
    .option("--allow-paid", "Allow due paid hosted schedules to spend account balance", false)
    .option("--max-paid-cents <cents>", "Maximum paid hosted spend approved for this run")
    .option("--json", "Output as JSON", false)
    .description("Execute all due schedules now")
    .action(async (options: { dryRun: boolean; allowPaid: boolean; maxPaidCents?: string; json: boolean }) => {
      const due = getDueSchedules();
      if (!due.length) { console.log(options.json ? JSON.stringify({ ran: 0, schedules: [] }) : chalk.dim("No schedules are due.")); return; }
      const dueDetails = await Promise.all(due.map((schedule) => describeDueSchedule(schedule)));
      const paidTotalCents = dueDetails.reduce((total, schedule) => total + (schedule.costCents ?? 0), 0);
      if (options.dryRun) {
        console.log(options.json ? JSON.stringify({ due: dueDetails, paidTotalCents, paidTotal: formatCost(paidTotalCents) }) : chalk.bold(`${due.length} schedule(s) due:\n`));
        if (!options.json) for (const s of dueDetails) console.log(`  ${chalk.cyan(s.name)} — ${s.skill} (${s.cron})${s.cost ? ` — ${s.cost}` : ""}`);
        return;
      }
      const approvedMaxCents = parseMaxPaidCents(options.maxPaidCents);
      if (paidTotalCents > 0 && (!options.allowPaid || approvedMaxCents === null || approvedMaxCents < paidTotalCents)) {
        const error = `Due paid hosted schedules cost ${formatCost(paidTotalCents)} total. Review with skills schedule run --dry-run, then rerun with --allow-paid --max-paid-cents ${paidTotalCents}.`;
        if (options.json) {
          console.log(JSON.stringify({
            ran: 0,
            approvalRequired: true,
            error,
            paidTotalCents,
            paidTotal: formatCost(paidTotalCents),
            schedules: dueDetails.filter((schedule) => schedule.paid),
          }));
        } else {
          console.error(chalk.red(`✗ ${error}`));
        }
        process.exitCode = 1;
        return;
      }
      const results = [];
      for (const s of due) {
        try {
          const execution = await executeScheduledSkill(s.skill, s.args ?? [], { allowPaid: options.allowPaid });
          recordScheduleRun(s.id, "success");
          results.push({ name: s.name, skill: s.skill, status: "success", ...execution });
        } catch (err) {
          recordScheduleRun(s.id, "error");
          results.push({ name: s.name, skill: s.skill, status: "error", error: (err as Error).message });
        }
      }
      if (options.json) console.log(JSON.stringify({ ran: results.length, results }));
      else {
        for (const r of results) {
          console.log(`${r.status === "success" ? chalk.green("✓") : chalk.red("✗")} ${r.name} (${r.skill})`);
          if (r.error) console.log(chalk.dim(`  ${r.error}`));
        }
      }
    });

  scheduleCmd
    .command("validate")
    .argument("<cron>", "Cron expression to validate")
    .option("--json", "Output as JSON", false)
    .description("Validate a cron expression and show the next 5 run times")
    .action((cron: string, options: { json: boolean }) => {
      const { valid, error } = validateCron(cron);
      if (!valid) {
        if (options.json) console.log(JSON.stringify({ cron, valid, error }));
        else console.error(chalk.red(`Invalid cron: ${error}`));
        process.exitCode = 1; return;
      }
      const nextRuns: string[] = [];
      let d = new Date();
      for (let i = 0; i < 5; i++) {
        const next = getNextRun(cron, d);
        if (!next) break;
        nextRuns.push(next.toISOString());
        d = next;
      }
      if (options.json) { console.log(JSON.stringify({ cron, valid, nextRuns }, null, 2)); return; }
      console.log(chalk.green(`✓ Valid cron: "${cron}"`));
      console.log(chalk.dim("\nNext 5 run times:"));
      for (const nextRun of nextRuns) console.log(`  ${new Date(nextRun).toLocaleString()}`);
    });
}

async function executeScheduledSkill(skillName: string, args: string[], options: { allowPaid: boolean }) {
  const { getSkill } = await import("../../lib/registry.js");
  const skill = getSkill(skillName);
  if (!skill) throw new Error(`Skill '${skillName}' not found`);

  const pricing = await import("../../lib/pricing.js");
  if (pricing.isPremiumSkill(skill.name)) {
    const publicPricing = pricing.getPublicSkillPricing(skill.name, {}, args);
    if (!options.allowPaid) {
      throw new Error(`${skill.name} is a paid hosted skill (${publicPricing.formattedCost}). Review with skills schedule run --dry-run, then rerun with --allow-paid --max-paid-cents ${publicPricing.costCents}.`);
    }

    const { getApiKey } = await import("../../lib/auth-store.js");
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error(`${skill.name} is a hosted skill. Run: skills setup --mode hosted && skills auth login`);
    }

    const { RemoteSkillsClient } = await import("../../lib/remote-client.js");
    const client = new RemoteSkillsClient(apiKey);
    const run = await client.submitRun(skill.name, {}, args);
    if (run.error) throw new Error(String(run.error));
    return { paid: true, costCents: publicPricing.costCents, cost: publicPricing.formattedCost };
  }

  const { runSkill } = await import("../../lib/skillinfo.js");
  const result = await runSkill(skill.name, args);
  if (result.exitCode !== 0) {
    throw new Error(result.error || result.stderr || `Skill '${skill.name}' exited with ${result.exitCode}`);
  }
  return { paid: false };
}

async function describeDueSchedule(schedule: { name: string; skill: string; cron: string; args?: string[] }) {
  const { getSkill } = await import("../../lib/registry.js");
  const pricing = await import("../../lib/pricing.js");
  const skill = getSkill(schedule.skill);
  const paid = Boolean(skill && pricing.isPremiumSkill(skill.name));
  const publicPricing = paid && skill ? pricing.getPublicSkillPricing(skill.name, {}, schedule.args ?? []) : null;
  return {
    name: schedule.name,
    skill: schedule.skill,
    cron: schedule.cron,
    paid,
    costCents: publicPricing?.costCents,
    cost: publicPricing?.formattedCost,
  };
}

function parseMaxPaidCents(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
