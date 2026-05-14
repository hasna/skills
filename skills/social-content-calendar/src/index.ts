#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type Tone = "direct" | "premium" | "friendly" | "technical";

interface CalendarOptions {
  campaign: string;
  audience: string;
  goal: string;
  days: number;
  channels: string[];
  tone: Tone;
  outputDir: string;
}

interface PostPlan {
  day: number;
  dateLabel: string;
  channel: string;
  theme: string;
  format: string;
  hook: string;
  body: string;
  cta: string;
  asset: string;
}

interface ChannelPlan {
  channel: string;
  role: string;
  cadence: string;
  bestUse: string;
}

const SKILL_NAME = "social-content-calendar";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const DEFAULT_CHANNELS = ["LinkedIn", "X", "Newsletter"];
const THEMES = [
  "problem awareness",
  "buyer education",
  "proof and credibility",
  "workflow comparison",
  "objection handling",
  "customer outcome",
  "launch reminder",
];

const HELP = `Social Content Calendar

Usage:
  skills run social-content-calendar "Usage-based billing for AI SaaS" --audience "founders" --days 30
  skills run social-content-calendar --campaign "API monitoring launch" --channels "LinkedIn,X,Newsletter"

Options:
  --campaign <text>   Campaign, product, or content brief. Positional text also works.
  --audience <text>   Target buyer or segment. Default: software teams
  --goal <text>       Campaign goal. Default: build qualified demand
  --days <n>          Calendar length, 14-45 days. Default: 30
  --channels <list>   Comma-separated channels. Default: LinkedIn, X, Newsletter
  --tone <tone>       direct, premium, friendly, or technical. Default: direct
  --output <dir>      Output directory. Default: current run export directory
  --help              Show help

Outputs:
  calendar.md, posts.csv, channel-plan.json, asset-briefs.md, hooks.md, publishing-schedule.csv, repurposing-map.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const channelPlan = buildChannelPlan(options);
  const posts = buildPosts(options);
  const files = writeArtifacts(options, channelPlan, posts);

  console.log(`Generated social content calendar for ${options.campaign}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const file of Object.values(files)) {
    console.log(`- ${file}`);
  }
}

function parseCliOptions(): CalendarOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      campaign: { type: "string" },
      audience: { type: "string", default: "software teams" },
      goal: { type: "string", default: "build qualified demand" },
      days: { type: "string", default: "30" },
      channels: { type: "string" },
      tone: { type: "string", default: "direct" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const campaign = String(values.campaign || positionals.join(" ")).trim();
  if (!campaign) {
    console.error("Campaign is required. Pass --campaign <text> or positional text.");
    process.exit(1);
  }

  const tone = String(values.tone || "direct");
  if (!isTone(tone)) {
    console.error("Invalid tone. Use direct, premium, friendly, or technical.");
    process.exit(1);
  }

  return {
    campaign,
    audience: String(values.audience || "software teams").trim(),
    goal: String(values.goal || "build qualified demand").trim(),
    days: clampNumber(Number(values.days || 30), 14, 45),
    channels: splitList(values.channels, DEFAULT_CHANNELS),
    tone,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildChannelPlan(options: CalendarOptions): ChannelPlan[] {
  return options.channels.map((channel, index) => ({
    channel,
    role: channelRole(channel, options.goal),
    cadence: cadenceFor(index, options.days),
    bestUse: bestUseFor(channel, options.audience),
  }));
}

function buildPosts(options: CalendarOptions): PostPlan[] {
  const posts: PostPlan[] = [];
  for (let day = 1; day <= options.days; day += 1) {
    const channel = options.channels[(day - 1) % options.channels.length] || "LinkedIn";
    const theme = THEMES[(day - 1) % THEMES.length] || "buyer education";
    const format = formatFor(day, channel);
    posts.push({
      day,
      dateLabel: `Day ${pad(day)}`,
      channel,
      theme,
      format,
      hook: hookFor(theme, options),
      body: bodyFor(theme, channel, options),
      cta: ctaForGoal(options.goal),
      asset: assetFor(format, theme, options),
    });
  }
  return posts;
}

function writeArtifacts(options: CalendarOptions, channelPlan: ChannelPlan[], posts: PostPlan[]) {
  const files = {
    calendar: "calendar.md",
    posts: "posts.csv",
    channelPlan: "channel-plan.json",
    assetBriefs: "asset-briefs.md",
    hooks: "hooks.md",
    publishingSchedule: "publishing-schedule.csv",
    repurposingMap: "repurposing-map.md",
    manifest: "manifest.json",
  };

  writeFile(join(options.outputDir, files.calendar), renderCalendar(options, posts));
  writeFile(join(options.outputDir, files.posts), renderPostsCsv(posts));
  writeFile(join(options.outputDir, files.channelPlan), JSON.stringify({ channels: channelPlan }, null, 2));
  writeFile(join(options.outputDir, files.assetBriefs), renderAssetBriefs(options, posts));
  writeFile(join(options.outputDir, files.hooks), renderHooks(options, posts));
  writeFile(join(options.outputDir, files.publishingSchedule), renderScheduleCsv(posts));
  writeFile(join(options.outputDir, files.repurposingMap), renderRepurposingMap(options));
  writeFile(
    join(options.outputDir, files.manifest),
    JSON.stringify(
      {
        skill: SKILL_NAME,
        runId: RUN_ID,
        generatedAt: new Date().toISOString(),
        input: {
          campaign: options.campaign,
          audience: options.audience,
          goal: options.goal,
          days: options.days,
          channels: options.channels,
          tone: options.tone,
        },
        postCount: posts.length,
        channelCount: options.channels.length,
        files,
      },
      null,
      2,
    ),
  );

  return files;
}

function renderCalendar(options: CalendarOptions, posts: PostPlan[]) {
  const weeks = chunk(posts, 7);
  const sections = weeks
    .map((week, index) => {
      const lines = week.map((post) => (
        `| ${post.dateLabel} | ${post.channel} | ${post.theme} | ${post.format} | ${post.hook} | ${post.cta} |`
      ));
      return [
        `## Week ${index + 1}`,
        "",
        "| Day | Channel | Theme | Format | Hook | CTA |",
        "| --- | --- | --- | --- | --- | --- |",
        ...lines,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `# Social Content Calendar: ${titleCase(options.campaign)}`,
    "",
    `Audience: ${options.audience}`,
    `Goal: ${options.goal}`,
    `Tone: ${options.tone}`,
    `Length: ${options.days} days`,
    `Channels: ${options.channels.join(", ")}`,
    "",
    sections,
  ].join("\n");
}

function renderPostsCsv(posts: PostPlan[]) {
  const rows = posts.map((post) => [
    post.day,
    post.channel,
    post.theme,
    post.format,
    post.hook,
    post.body,
    post.cta,
    post.asset,
  ]);
  return csv([
    ["day", "channel", "theme", "format", "hook", "body", "cta", "asset"],
    ...rows,
  ]);
}

function renderAssetBriefs(options: CalendarOptions, posts: PostPlan[]) {
  const representative = posts.filter((_, index) => index % Math.max(1, Math.floor(posts.length / 8)) === 0).slice(0, 8);
  return [
    `# Asset Briefs: ${titleCase(options.campaign)}`,
    "",
    ...representative.map((post, index) => [
      `## Asset ${index + 1}: ${titleCase(post.theme)}`,
      "",
      `Channel: ${post.channel}`,
      `Format: ${post.format}`,
      `Brief: ${post.asset}`,
      `Design note: keep the visual clean, specific to ${options.audience}, and free of tiny unreadable text.`,
    ].join("\n")),
  ].join("\n\n");
}

function renderHooks(options: CalendarOptions, posts: PostPlan[]) {
  const hooks = Array.from(new Set(posts.map((post) => post.hook))).slice(0, 18);
  return [
    `# Hook Bank: ${titleCase(options.campaign)}`,
    "",
    ...hooks.map((hook, index) => `${index + 1}. ${hook}`),
    "",
    "## CTA Variants",
    "",
    `- ${ctaForGoal(options.goal)}`,
    "- Read the full workflow",
    "- Compare your current process",
    "- Save this checklist",
    "- Share with the team",
  ].join("\n");
}

function renderScheduleCsv(posts: PostPlan[]) {
  const rows = posts.map((post) => [
    `day-${pad(post.day)}`,
    post.channel,
    post.day % 5 === 0 ? "09:30" : post.day % 2 === 0 ? "13:00" : "10:00",
    ownerFor(post.channel),
    post.theme,
    post.asset,
  ]);
  return csv([
    ["publish_slot", "channel", "local_time", "owner", "theme", "asset_brief"],
    ...rows,
  ]);
}

function renderRepurposingMap(options: CalendarOptions) {
  return [
    `# Repurposing Map: ${titleCase(options.campaign)}`,
    "",
    "| Source | Reuse as | Notes |",
    "| --- | --- | --- |",
    `| Strong LinkedIn post | Newsletter intro | Keep the first paragraph and expand with one example for ${options.audience}. |`,
    "| Short post | Thread | Split the claim, evidence, and CTA into separate beats. |",
    "| Customer outcome post | Sales follow-up | Convert the result into a short proof point. |",
    "| Objection post | FAQ entry | Preserve the answer and add a link to the relevant resource. |",
    "| Launch reminder | Retargeting copy | Use the same promise with a more direct CTA. |",
    "",
    "## Review Cadence",
    "",
    "- Review weekly winners by saves, replies, qualified clicks, and direct requests.",
    "- Convert the top two posts into longer assets before drafting net-new content.",
    "- Keep one content slot per week open for timely customer questions.",
  ].join("\n");
}

function hookFor(theme: string, options: CalendarOptions) {
  const subject = shortCampaign(options.campaign);
  const voice = tonePhrase(options.tone);
  switch (theme) {
    case "problem awareness":
      return `${subject} breaks when the manual workaround becomes the system. ${voice}`;
    case "buyer education":
      return `Most ${options.audience} do not need more content. They need a clearer operating rhythm.`;
    case "proof and credibility":
      return `A useful proof point is specific enough for a buyer to repeat it internally.`;
    case "workflow comparison":
      return `Compare the workflow people tolerate with the workflow they would choose today.`;
    case "objection handling":
      return `The real objection is usually risk, not interest. Address it directly.`;
    case "customer outcome":
      return `Show the before state, the decision moment, and the measurable next step.`;
    default:
      return `A launch works better when every post has one job and one next step.`;
  }
}

function bodyFor(theme: string, channel: string, options: CalendarOptions) {
  const channelHint = channel.toLowerCase().includes("newsletter")
    ? "Open with a practical note and close with one resource."
    : channel.toLowerCase() === "x"
      ? "Keep it tight, specific, and easy to repost."
      : "Use one concrete example and one business outcome.";
  return `${titleCase(theme)} for ${options.audience}: connect ${shortCampaign(options.campaign)} to ${options.goal}. ${channelHint}`;
}

function assetFor(format: string, theme: string, options: CalendarOptions) {
  if (format.includes("carousel")) {
    return `Five-slide carousel: problem, hidden cost, better workflow, proof point, next step for ${options.audience}.`;
  }
  if (format.includes("checklist")) {
    return `Compact checklist graphic for ${theme}, with three checks and one bottom CTA.`;
  }
  if (format.includes("thread")) {
    return `Text-first thread with claim, context, example, and action.`;
  }
  return `Single clean visual showing ${shortCampaign(options.campaign)} tied to ${theme}.`;
}

function formatFor(day: number, channel: string) {
  if (channel.toLowerCase() === "x") return day % 3 === 0 ? "thread" : "short post";
  if (channel.toLowerCase().includes("newsletter")) return "newsletter section";
  if (day % 4 === 0) return "checklist";
  if (day % 3 === 0) return "carousel";
  return "feed post";
}

function channelRole(channel: string, goal: string) {
  const normalized = channel.toLowerCase();
  if (normalized.includes("newsletter")) return `Own the deeper education path toward ${goal}.`;
  if (normalized === "x" || normalized.includes("twitter")) return "Test concise hooks and repeatable points of view.";
  if (normalized.includes("linkedin")) return "Build trust with operators, founders, and decision makers.";
  if (normalized.includes("youtube")) return "Turn high-performing themes into longer explainers.";
  if (normalized.includes("tiktok")) return "Package one idea into fast visual proof.";
  return `Create repeated touchpoints that move buyers toward ${goal}.`;
}

function bestUseFor(channel: string, audience: string) {
  const normalized = channel.toLowerCase();
  if (normalized.includes("newsletter")) return `Education and owned follow-up for ${audience}.`;
  if (normalized === "x" || normalized.includes("twitter")) return "Hooks, fast feedback, and community conversation.";
  if (normalized.includes("linkedin")) return `Credible professional posts for ${audience}.`;
  return "Awareness, reminders, and lightweight social proof.";
}

function cadenceFor(index: number, days: number) {
  const weekly = Math.max(2, Math.round((days / 7) * (index === 0 ? 3 : 2)));
  return `${weekly} planned posts across the calendar`;
}

function ctaForGoal(goal: string) {
  const normalized = goal.toLowerCase();
  if (normalized.includes("demo")) return "Book a demo";
  if (normalized.includes("signup") || normalized.includes("sign up")) return "Start free";
  if (normalized.includes("download")) return "Download the guide";
  if (normalized.includes("waitlist")) return "Join the waitlist";
  if (normalized.includes("subscribe")) return "Subscribe";
  return "Learn more";
}

function ownerFor(channel: string) {
  const normalized = channel.toLowerCase();
  if (normalized.includes("newsletter")) return "content";
  if (normalized.includes("linkedin")) return "founder";
  if (normalized === "x" || normalized.includes("twitter")) return "community";
  return "marketing";
}

function tonePhrase(tone: Tone) {
  switch (tone) {
    case "premium":
      return "Keep the language restrained, confident, and outcome-led.";
    case "friendly":
      return "Make the point conversational and practical.";
    case "technical":
      return "Anchor the claim in workflow detail and implementation reality.";
    default:
      return "Say it plainly and avoid filler.";
  }
}

function splitList(value: unknown, fallback: string[]) {
  const raw = typeof value === "string" ? value : "";
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function isTone(value: string): value is Tone {
  return ["direct", "premium", "friendly", "technical"].includes(value);
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function csv(rows: Array<Array<string | number>>) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string | number) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function shortCampaign(value: string) {
  return value.split(/[,.]/)[0]?.trim() || value;
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeFile(path: string, content: string) {
  ensureDir(dirname(path));
  writeFileSync(path, content);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
