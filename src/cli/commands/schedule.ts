/**
 * schedule — cron-based skill scheduling commands
 */

import chalk from "chalk";
import type { Command } from "commander";
import {
  addSchedule, listSchedules, removeSchedule, setScheduleEnabled,
  getDueSchedules, recordScheduleRun, validateCron, getNextRun,
} from "../../lib/scheduler.js";

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
    .description("List all scheduled skills")
    .action((options: { json: boolean }) => {
      const schedules = listSchedules();
      if (options.json) { console.log(JSON.stringify(schedules)); return; }
      if (!schedules.length) { console.log(chalk.dim("No schedules. Run: skills schedule add <skill> <cron>")); return; }
      console.log(chalk.bold(`\nScheduled skills (${schedules.length}):\n`));
      for (const s of schedules) {
        console.log(`  ${chalk.cyan(s.name)} [${s.enabled ? chalk.green("enabled") : chalk.dim("disabled")}]`);
        const last = s.lastRun ? `last: ${new Date(s.lastRun).toLocaleString()} [${s.lastRunStatus ?? "?"}]` : "never run";
        const next = s.nextRun ? `next: ${new Date(s.nextRun).toLocaleString()}` : "";
        console.log(chalk.dim(`    skill: ${s.skill}  cron: ${s.cron}  ${last}  ${next}`));
      }
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
    .description("Enable a disabled schedule")
    .action((idOrName: string) => {
      const ok = setScheduleEnabled(idOrName, true);
      console.log(ok ? chalk.green(`✓ Enabled '${idOrName}'`) : chalk.red(`Schedule '${idOrName}' not found`));
      if (!ok) process.exitCode = 1;
    });

  scheduleCmd
    .command("disable")
    .argument("<id-or-name>", "Schedule ID or name")
    .description("Disable a schedule without removing it")
    .action((idOrName: string) => {
      const ok = setScheduleEnabled(idOrName, false);
      console.log(ok ? chalk.green(`✓ Disabled '${idOrName}'`) : chalk.red(`Schedule '${idOrName}' not found`));
      if (!ok) process.exitCode = 1;
    });

  scheduleCmd
    .command("run")
    .option("--dry-run", "Show which schedules are due without running them", false)
    .option("--json", "Output as JSON", false)
    .description("Execute all due schedules now")
    .action(async (options: { dryRun: boolean; json: boolean }) => {
      const due = getDueSchedules();
      if (!due.length) { console.log(options.json ? JSON.stringify({ ran: 0, schedules: [] }) : chalk.dim("No schedules are due.")); return; }
      if (options.dryRun) {
        console.log(options.json ? JSON.stringify({ due: due.map((s) => s.name) }) : chalk.bold(`${due.length} schedule(s) due:\n`));
        if (!options.json) for (const s of due) console.log(`  ${chalk.cyan(s.name)} — ${s.skill} (${s.cron})`);
        return;
      }
      const results = [];
      for (const s of due) {
        try {
          const { runSkill } = await import("../../lib/skillinfo.js");
          await runSkill(s.skill, s.args ?? []);
          recordScheduleRun(s.id, "success");
          results.push({ name: s.name, skill: s.skill, status: "success" });
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
    .description("Validate a cron expression and show the next 5 run times")
    .action((cron: string) => {
      const { valid, error } = validateCron(cron);
      if (!valid) { console.error(chalk.red(`Invalid cron: ${error}`)); process.exitCode = 1; return; }
      console.log(chalk.green(`✓ Valid cron: "${cron}"`));
      console.log(chalk.dim("\nNext 5 run times:"));
      let d = new Date();
      for (let i = 0; i < 5; i++) { const next = getNextRun(cron, d); if (!next) break; console.log(`  ${next.toLocaleString()}`); d = next; }
    });
}
