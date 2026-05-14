#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parseArgs } from "util";

type Tone = "direct" | "premium" | "friendly" | "technical";

interface EmailOptions {
  campaign: string;
  audience: string;
  goal: string;
  count: number;
  tone: Tone;
  outputDir: string;
}

interface EmailDraft {
  index: number;
  purpose: string;
  subject: string;
  preview: string;
  body: string;
  cta: string;
  segmentNote: string;
}

const SKILL_NAME = "email-sequence";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `Email Sequence

Usage:
  skills run email-sequence "Usage-based billing for AI SaaS" --audience "founders"
  skills run email-sequence --campaign "API monitoring launch" --emails 7 --tone technical

Options:
  --campaign <text>  Campaign, product, or offer brief. Positional text also works.
  --audience <text>  Target segment. Default: software teams
  --goal <text>      Conversion goal. Default: book demos
  --emails <n>       Number of emails, 5-10. Default: 5
  --count <n>        Alias for --emails
  --tone <tone>      direct, premium, friendly, or technical. Default: direct
  --output <dir>     Output directory. Default: current run export directory
  --help             Show help

Outputs:
  sequence.md, emails/email-XX.md, emails/email-XX.html, subject-lines.csv, segmentation-notes.md, cta-variants.csv, send-plan.csv, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);
  ensureDir(join(options.outputDir, "emails"));

  const emails = buildEmails(options);
  const files = writeArtifacts(options, emails);

  console.log(`Generated ${emails.length} email sequence for ${options.campaign}.`);
  console.log(`Output: ${options.outputDir}`);
  for (const file of Object.values(files).flat()) {
    console.log(`- ${file}`);
  }
}

function parseCliOptions(): EmailOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      campaign: { type: "string" },
      audience: { type: "string", default: "software teams" },
      goal: { type: "string", default: "book demos" },
      emails: { type: "string" },
      count: { type: "string" },
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
    goal: String(values.goal || "book demos").trim(),
    count: clamp(parsePositiveInt(values.emails || values.count || "5"), 5, 10),
    tone,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildEmails(options: EmailOptions): EmailDraft[] {
  return Array.from({ length: options.count }, (_, index) => {
    const step = index + 1;
    const purpose = purposeFor(step, options.count);
    return {
      index: step,
      purpose,
      subject: subjectFor(options, step, purpose),
      preview: previewFor(options, purpose),
      body: bodyFor(options, step, purpose),
      cta: ctaForGoal(options.goal),
      segmentNote: segmentNoteFor(options, step),
    };
  });
}

function writeArtifacts(options: EmailOptions, emails: EmailDraft[]) {
  const emailMarkdown = emails.map((email) => `emails/email-${pad(email.index)}.md`);
  const emailHtml = emails.map((email) => `emails/email-${pad(email.index)}.html`);
  const files = {
    sequence: "sequence.md",
    subjectLines: "subject-lines.csv",
    segmentationNotes: "segmentation-notes.md",
    ctaVariants: "cta-variants.csv",
    sendPlan: "send-plan.csv",
    emailMarkdown,
    emailHtml,
    manifest: "manifest.json",
  };

  writeFile(join(options.outputDir, files.sequence), renderSequence(options, emails));
  emails.forEach((email, index) => {
    writeFile(join(options.outputDir, emailMarkdown[index]), renderEmailMarkdown(options, email));
    writeFile(join(options.outputDir, emailHtml[index]), renderEmailHtml(options, email));
  });
  writeFile(join(options.outputDir, files.subjectLines), renderSubjectLines(emails));
  writeFile(join(options.outputDir, files.segmentationNotes), renderSegmentationNotes(options, emails));
  writeFile(join(options.outputDir, files.ctaVariants), renderCtaVariants(options));
  writeFile(join(options.outputDir, files.sendPlan), renderSendPlan(emails));
  writeJson(join(options.outputDir, files.manifest), {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      campaign: options.campaign,
      audience: options.audience,
      goal: options.goal,
      emails: options.count,
      tone: options.tone,
    },
    emailCount: emails.length,
    files,
  });

  return files;
}

function renderSequence(options: EmailOptions, emails: EmailDraft[]): string {
  return `# Email Sequence: ${titleCase(options.campaign)}

## Campaign Brief

- Campaign: ${options.campaign}
- Audience: ${options.audience}
- Goal: ${options.goal}
- Tone: ${options.tone}
- Email count: ${emails.length}

## Sequence

${emails.map((email) => `### Email ${email.index}: ${email.purpose}

- Subject: ${email.subject}
- Preview: ${email.preview}
- CTA: ${email.cta}
- Segment note: ${email.segmentNote}
`).join("\n")}

## Notes

- Keep each email focused on one idea and one action.
- Use segmentation notes to personalize examples without changing the core offer.
- Suppress recipients after conversion or direct reply.
`;
}

function renderEmailMarkdown(options: EmailOptions, email: EmailDraft): string {
  return `---
subject: ${yamlScalar(email.subject)}
preview: ${yamlScalar(email.preview)}
cta: ${yamlScalar(email.cta)}
campaign: ${yamlScalar(options.campaign)}
---

# ${email.subject}

${email.preview}

${email.body}

[${email.cta}](https://example.com)
`;
}

function renderEmailHtml(options: EmailOptions, email: EmailDraft): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(email.preview)}">
  <title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;background:#f5f7fb;color:#172033;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #d7dde8;border-radius:8px;">
          <tr><td style="padding:28px 28px 8px;color:#0f766e;font-size:12px;font-weight:700;text-transform:uppercase;">${escapeHtml(options.audience)}</td></tr>
          <tr><td style="padding:0 28px 12px;"><h1 style="font-size:28px;line-height:1.15;margin:0;">${escapeHtml(email.subject)}</h1></td></tr>
          <tr><td style="padding:0 28px 18px;color:#506079;font-size:16px;">${paragraphs(email.body)}</td></tr>
          <tr><td style="padding:0 28px 30px;"><a href="https://example.com" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700;">${escapeHtml(email.cta)}</a></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function renderSubjectLines(emails: EmailDraft[]): string {
  return renderCsv([
    ["email", "purpose", "subject", "preview"],
    ...emails.map((email) => [String(email.index), email.purpose, email.subject, email.preview]),
  ]);
}

function renderSegmentationNotes(options: EmailOptions, emails: EmailDraft[]): string {
  return `# Segmentation Notes

## Audience

Primary segment: ${options.audience}

## Personalization

${emails.map((email) => `- Email ${email.index}: ${email.segmentNote}`).join("\n")}

## Suppression Rules

- Stop the sequence after ${options.goal}.
- Move direct replies to a human follow-up queue.
- Remove customers from acquisition sends unless the campaign is explicitly for expansion.
`;
}

function renderCtaVariants(options: EmailOptions): string {
  const primary = ctaForGoal(options.goal);
  return renderCsv([
    ["variant", "cta", "best_for"],
    ["primary", primary, "highest-intent readers"],
    ["soft", softerCta(options.goal), "early-stage readers"],
    ["proof", "See the workflow", "readers who need context"],
    ["reply", "Reply with your current workflow", "high-touch sales follow-up"],
  ]);
}

function renderSendPlan(emails: EmailDraft[]): string {
  return renderCsv([
    ["email", "day", "purpose", "send_window"],
    ...emails.map((email) => [String(email.index), String(sendDay(email.index)), email.purpose, email.index === 1 ? "morning" : "recipient local business hours"]),
  ]);
}

function purposeFor(index: number, count: number): string {
  const purposes = [
    "Introduce the outcome",
    "Name the pain",
    "Show the workflow",
    "Handle the main objection",
    "Share proof",
    "Compare alternatives",
    "Offer a checklist",
    "Restate the value",
    "Create urgency",
    "Final follow-up",
  ];
  if (index === count) return "Final follow-up";
  return purposes[index - 1] || `Email ${index}`;
}

function subjectFor(options: EmailOptions, index: number, purpose: string): string {
  const campaign = titleCase(options.campaign);
  if (index === 1) return `${campaign}: a cleaner path for ${options.audience}`;
  if (purpose.includes("pain")) return `Where ${options.audience} lose momentum`;
  if (purpose.includes("proof")) return `Proof that ${options.goal} can be simpler`;
  if (purpose.includes("Final")) return `Should I close the loop?`;
  return `${purpose}: ${campaign}`;
}

function previewFor(options: EmailOptions, purpose: string): string {
  return `${purpose} for ${options.audience}, with one clear path to ${options.goal}.`;
}

function bodyFor(options: EmailOptions, index: number, purpose: string): string {
  const opener = index === 1
    ? `${titleCase(options.campaign)} should make the next step easier for ${options.audience}.`
    : `${purpose} is the focus of this note.`;
  const voice = toneLine(options.tone);
  return `${opener}

${voice} The message should connect the current friction to a specific business or workflow outcome, then make the next action easy.

Use a concrete example from the buyer's daily work. Keep the email short enough to scan, but specific enough that the reader can see why the campaign matters now.`;
}

function segmentNoteFor(options: EmailOptions, index: number): string {
  if (index === 1) return `Use industry or role language familiar to ${options.audience}.`;
  if (index % 3 === 0) return "Swap in a proof point that matches company size or use case.";
  if (index % 2 === 0) return "Use a pain point from the recipient's likely workflow.";
  return `Tie the CTA back to ${options.goal}.`;
}

function ctaForGoal(goal: string): string {
  const normalized = goal.toLowerCase();
  if (normalized.includes("demo")) return "Book a demo";
  if (normalized.includes("trial")) return "Start a trial";
  if (normalized.includes("signup") || normalized.includes("sign up")) return "Start signup";
  if (normalized.includes("download")) return "Download the guide";
  return `Start ${goal}`;
}

function softerCta(goal: string): string {
  if (goal.toLowerCase().includes("demo")) return "See if this is relevant";
  return `Learn about ${goal}`;
}

function toneLine(tone: Tone): string {
  if (tone === "premium") return "Use confident, restrained language.";
  if (tone === "friendly") return "Use warm, plain language without sounding casual about the problem.";
  if (tone === "technical") return "Use exact workflow language and measurable details.";
  return "Use direct language and avoid long setup.";
}

function sendDay(index: number): number {
  return [1, 3, 6, 10, 14, 18, 24, 31, 38, 45][index - 1] || index * 4;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 14px;">${escapeHtml(part.trim())}</p>`)
    .join("\n");
}

function renderCsv(rows: string[][]): string {
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  return [
    header.join(","),
    ...body.map((row) => row.map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function parsePositiveInt(value: unknown): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTone(value: string): value is Tone {
  return ["direct", "premium", "friendly", "technical"].includes(value);
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function writeJson(path: string, value: unknown) {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path: string, value: string) {
  ensureDir(dirname(path));
  writeFileSync(path, value);
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
