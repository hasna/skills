/**
 * schedule — cron-based skill scheduling commands
 */

import chalk from "chalk";
import { Option, type Command } from "commander";
import { loadConfig } from "../../lib/config.js";
import { loadRemoteSkill } from "../../lib/remote-registry.js";
import { formatCredits, toCustomerCreditPayload, toPublicCreditQuote } from "../../lib/public-credits.js";
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
    .option("--allow-paid", "Allow due remote schedules to use account credits", false)
    .option("--max-credits <credits>", "Maximum credits approved for this run")
    .addOption(new Option("--max-paid-cents <credits>").hideHelp())
    .option("--json", "Output as JSON", false)
    .description("Execute all due schedules now")
    .action(async (options: { dryRun: boolean; allowPaid: boolean; maxCredits?: string; maxPaidCents?: string; json: boolean }) => {
      const due = getDueSchedules();
      if (!due.length) { console.log(options.json ? JSON.stringify({ ran: 0, schedules: [] }) : chalk.dim("No schedules are due.")); return; }
      const dueDetails = await Promise.all(due.map((schedule) => describeDueSchedule(schedule)));
      const unavailable = dueDetails.filter((schedule) => schedule.availability?.status === "unavailable");
      if (unavailable.length > 0 && !options.dryRun) {
        const code = unavailable[0]?.availability?.code ?? "HOSTED_PROVIDER_UNAVAILABLE";
        const error = `Remote execution is temporarily unavailable for ${unavailable.map((schedule) => schedule.skill).join(", ")}. No credits were charged.`;
        if (options.json) {
          console.log(JSON.stringify({ ran: 0, error, code, unavailable, schedules: dueDetails }));
        } else {
          console.error(chalk.red(`✗ ${error}`));
        }
        process.exitCode = 1;
        return;
      }
      const totalCredits = dueDetails.reduce((total, schedule) => total + (schedule.credits ?? 0), 0);
      if (options.dryRun) {
        console.log(options.json ? JSON.stringify({ due: dueDetails, totalCredits }) : chalk.bold(`${due.length} schedule(s) due:\n`));
        if (!options.json) for (const s of dueDetails) console.log(`  ${chalk.cyan(s.name)} — ${s.skill} (${s.cron})${s.creditQuote ? ` — ${s.creditQuote.formattedCredits}` : ""}`);
        return;
      }
      const approvedCredits = parseMaxCredits(options.maxCredits ?? options.maxPaidCents);
      if (totalCredits > 0 && (!options.allowPaid || approvedCredits === null)) {
        const error = `Due remote schedules require ${formatCredits(totalCredits)} total. Review with skills schedule run --dry-run, then rerun with --allow-paid --max-credits ${totalCredits}.`;
        if (options.json) {
          console.log(JSON.stringify({
            ran: 0,
            approvalRequired: true,
            error,
            totalCredits,
            schedules: dueDetails.filter((schedule) => schedule.paid),
          }));
        } else {
          console.error(chalk.red(`✗ ${error}`));
        }
        process.exitCode = 1;
        return;
      }
      const prepared = await Promise.all(due.map(async (schedule) => {
        try {
          return { schedule, execution: await prepareScheduledSkill(schedule.skill, schedule.args ?? []) };
        } catch (error) {
          return { schedule, error: (error as Error).message };
        }
      }));
      const authoritativeTotalCredits = prepared.reduce(
        (total, item) => total + (item.execution?.credits ?? 0),
        0,
      );
      if (authoritativeTotalCredits > 0 && (
        !options.allowPaid
        || approvedCredits === null
        || authoritativeTotalCredits > approvedCredits
      )) {
        const suggestedCredits = authoritativeTotalCredits;
        const error = `Authoritative live quotes require ${formatCredits(authoritativeTotalCredits)} total, above the approved maximum of ${approvedCredits ?? 0} credits. Review and rerun with --allow-paid --max-credits ${suggestedCredits}.`;
        if (options.json) {
          console.log(JSON.stringify({
            ran: 0,
            approvalRequired: true,
            error,
            totalCredits: authoritativeTotalCredits,
            maxCredits: approvedCredits,
            schedules: prepared.filter((item) => item.execution?.paid).map((item) => ({
              name: item.schedule.name,
              skill: item.schedule.skill,
              paid: true,
              credits: item.execution?.credits,
              creditQuote: item.execution?.creditQuote,
            })),
          }));
        } else {
          console.error(chalk.red(`✗ ${error}`));
        }
        process.exitCode = 1;
        return;
      }
      const results = [];
      for (const item of prepared) {
        const s = item.schedule;
        if (!item.execution) {
          recordScheduleRun(s.id, "error");
          results.push({ name: s.name, skill: s.skill, status: "error", error: item.error || "Unable to prepare scheduled skill" });
          continue;
        }
        try {
          const execution = await item.execution.execute();
          recordScheduleRun(s.id, "success");
          results.push({ name: s.name, skill: s.skill, status: "success", ...execution });
        } catch (err) {
          recordScheduleRun(s.id, "error");
          results.push({ name: s.name, skill: s.skill, status: "error", error: (err as Error).message });
        }
      }
      if (options.json) console.log(JSON.stringify(toCustomerCreditPayload({ ran: results.length, results })));
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

interface PreparedScheduledSkill {
  paid: boolean;
  credits: number;
  creditQuote?: ReturnType<typeof toPublicCreditQuote>;
  execute: () => Promise<{ paid: boolean; credits?: number; creditQuote?: ReturnType<typeof toPublicCreditQuote> }>;
}

async function prepareScheduledSkill(skillName: string, args: string[]): Promise<PreparedScheduledSkill> {
  const { getSkill } = await import("../../lib/registry.js");
  const skill = getSkill(skillName);
  if (!skill) throw new Error(`Skill '${skillName}' not found`);

  const pricing = await import("../../lib/pricing.js");
  if (pricing.isPremiumSkill(skill.name)) {
    const mode = resolveDeploymentMode();
    if (mode === "local") throw new Error(`${skill.name} requires cloud or self-hosted mode.`);
    let creditQuote = toPublicCreditQuote(pricing.getPublicSkillPricing(skill.name, {}, args));
    if (mode === "cloud") {
      const remoteSkill = await loadRemoteSkill(skill.name);
      if (remoteSkill.availability?.status !== "available") {
        throw new Error(`${remoteSkill.availability?.code || "REMOTE_UNAVAILABLE"}: ${remoteSkill.availability?.message || "remote execution is unavailable"}. No credits were charged.`);
      }
      if (remoteSkill.pricing) creditQuote = toPublicCreditQuote(remoteSkill.pricing);
    } else {
      const { getHostedRunAvailability } = await import("../../lib/hosted-availability.js");
      const hostedAvailability = getHostedRunAvailability(skill.name);
      if (!hostedAvailability.ok) throw new Error(`${hostedAvailability.code}: ${hostedAvailability.message}. ${hostedAvailability.details.join(" ")}`);
    }

    const { getApiKey } = await import("../../lib/auth-store.js");
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error(`${skill.name} is a remote skill. Run: skills setup --mode ${mode} && skills auth login`);
    }

    const { RemoteSkillsClient } = await import("../../lib/remote-client.js");
    const client = new RemoteSkillsClient(apiKey);
    let quoteToken: string | undefined;
    if (mode === "cloud") {
      const liveQuote = await client.quoteSkill(skill.name, {}, args);
      if (liveQuote?.error || liveQuote?.availability?.status === "unavailable") {
        throw new Error(`${liveQuote?.availability?.code || liveQuote?.code || "CLOUD_QUOTE_UNAVAILABLE"}: ${liveQuote?.availability?.message || liveQuote?.detail || liveQuote?.error || "remote execution is unavailable"}. No credits were charged.`);
      }
      if (liveQuote?.creditQuote || liveQuote?.pricing) creditQuote = toPublicCreditQuote(liveQuote.creditQuote ?? liveQuote.pricing);
      quoteToken = typeof liveQuote?.quoteToken === "string" ? liveQuote.quoteToken : undefined;
      if (creditQuote.credits > 0 && !quoteToken) {
        throw new Error("The cloud quote did not include the required quote token. No credits were charged.");
      }
    }
    return {
      paid: true,
      credits: creditQuote.credits,
      creditQuote,
      execute: async () => {
        const run = await client.submitRun(
          skill.name,
          {},
          args,
          mode === "cloud" ? { quoteToken, approved: true } : {},
        );
        if (run.error) throw new Error(String(run.error));
        return { paid: true, credits: creditQuote.credits, creditQuote };
      },
    };
  }

  return {
    paid: false,
    credits: 0,
    execute: async () => {
      const { runSkill } = await import("../../lib/skillinfo.js");
      const result = await runSkill(skill.name, args);
      if (result.exitCode !== 0) {
        throw new Error(result.error || result.stderr || `Skill '${skill.name}' exited with ${result.exitCode}`);
      }
      return { paid: false };
    },
  };
}

async function describeDueSchedule(schedule: { name: string; skill: string; cron: string; args?: string[] }) {
  const { getSkill } = await import("../../lib/registry.js");
  const pricing = await import("../../lib/pricing.js");
  const { getHostedRunAvailability } = await import("../../lib/hosted-availability.js");
  const skill = getSkill(schedule.skill);
  const paid = Boolean(skill && pricing.isPremiumSkill(skill.name));
  const publicPricing = paid && skill ? pricing.getPublicSkillPricing(skill.name, {}, schedule.args ?? []) : null;
  let creditQuote = publicPricing ? toPublicCreditQuote(publicPricing) : undefined;
  const mode = resolveDeploymentMode();
  let availability: { status: "available" | "unavailable"; code?: string; message?: string; details?: string[] } = { status: "available" };
  if (paid && skill && mode === "cloud") {
    try {
      const remoteSkill = await loadRemoteSkill(skill.name);
      if (remoteSkill.pricing) creditQuote = toPublicCreditQuote(remoteSkill.pricing);
      availability = remoteSkill.availability ?? { status: "unavailable", code: "REMOTE_AVAILABILITY_MISSING", message: "The cloud service did not publish run availability for this skill." };
    } catch (error) {
      availability = { status: "unavailable", code: "CLOUD_CAPABILITY_CHECK_FAILED", message: (error as Error).message };
    }
  } else if (paid && skill) {
    const hostedAvailability = getHostedRunAvailability(skill.name);
    if (!hostedAvailability.ok) availability = { status: "unavailable", code: hostedAvailability.code, message: hostedAvailability.message, details: hostedAvailability.details };
  }
  return {
    name: schedule.name,
    skill: schedule.skill,
    cron: schedule.cron,
    paid,
    credits: creditQuote?.credits,
    creditQuote,
    availability,
  };
}

function parseMaxCredits(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function resolveDeploymentMode(): "local" | "self-hosted" | "cloud" {
  const config = loadConfig();
  if (config.mode) return config.mode;
  const apiUrl = (process.env.SKILLS_API_URL || config.apiUrl || "").toLowerCase();
  if (apiUrl.includes("skills.md")) return "cloud";
  if (apiUrl || process.env.SKILLS_API_KEY || process.env.SKILL_API_KEY) return "self-hosted";
  return "self-hosted";
}
