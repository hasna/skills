#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { basename, join, relative } from "path";
import { parseArgs } from "util";

type Tone = "executive" | "friendly" | "technical";

interface ProposalOptions {
  project: string;
  client: string;
  budget: string;
  timeline: string;
  services: string[];
  tone: Tone;
  outputDir: string;
}

interface PricingRow {
  item: string;
  description: string;
  price: string;
}

interface TimelineRow {
  phase: string;
  duration: string;
  deliverable: string;
}

const SKILL_NAME = "proposal-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);

const HELP = `Proposal Pack

Usage:
  skills run proposal-pack --client "Acme" --project "AI onboarding workflow"
  skills run proposal-pack "Revamp customer onboarding" --services "Discovery,Design,Build"

Options:
  --project <text>    Project scope or proposal brief
  --client <name>     Client or account name. Default: Client
  --budget <text>     Budget range or fixed price. Default: To be confirmed
  --timeline <text>   Delivery timeline. Default: 4-6 weeks
  --services <list>   Comma-separated services or workstreams
  --tone <tone>       executive, friendly, or technical. Default: executive
  --output <dir>      Output directory. Default: current run export directory
  --help              Show this help

Outputs:
  proposal.md, proposal.pdf, statement-of-work.md, pricing.csv, timeline.csv, assumptions.md, cover-email.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const pricing = buildPricingRows(options);
  const timeline = buildTimelineRows(options);
  const proposal = buildProposal(options, pricing, timeline);
  const statementOfWork = buildStatementOfWork(options, timeline);
  const assumptions = buildAssumptions(options);
  const coverEmail = buildCoverEmail(options);
  const pdf = buildPdf(proposal);
  const files = writeArtifacts(options, pricing, timeline, proposal, statementOfWork, assumptions, coverEmail, pdf);

  console.log(`Generated proposal pack for ${options.client}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.proposal}`);
  console.log(`- ${files.pdf}`);
  console.log(`- ${files.statementOfWork}`);
  console.log(`- ${files.pricingCsv}`);
  console.log(`- ${files.timelineCsv}`);
  console.log(`- ${files.assumptions}`);
  console.log(`- ${files.coverEmail}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): ProposalOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      project: { type: "string" },
      client: { type: "string", default: "Client" },
      budget: { type: "string", default: "To be confirmed" },
      timeline: { type: "string", default: "4-6 weeks" },
      services: { type: "string" },
      tone: { type: "string", default: "executive" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const project = String(values.project || positionals.join(" ")).trim();
  if (!project) {
    console.error("Project is required. Pass --project <text> or positional text.");
    process.exit(1);
  }

  const tone = String(values.tone || "executive");
  if (!isTone(tone)) {
    console.error("Invalid tone. Use executive, friendly, or technical.");
    process.exit(1);
  }

  return {
    project,
    client: String(values.client || "Client").trim(),
    budget: String(values.budget || "To be confirmed").trim(),
    timeline: String(values.timeline || "4-6 weeks").trim(),
    services: splitServices(values.services),
    tone,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildPricingRows(options: ProposalOptions): PricingRow[] {
  const services = options.services.length > 0
    ? options.services
    : ["Discovery and solution design", "Implementation", "Enablement and handoff"];
  return services.map((service, index) => ({
    item: service,
    description: pricingDescription(service, index),
    price: index === services.length - 1 ? "Included in delivery package" : options.budget,
  }));
}

function buildTimelineRows(options: ProposalOptions): TimelineRow[] {
  const services = options.services.length > 0
    ? options.services
    : ["Discovery", "Delivery", "Enablement"];
  return services.map((service, index) => ({
    phase: `Phase ${index + 1}: ${service}`,
    duration: index === 0 ? "Week 1" : index === services.length - 1 ? "Final week" : options.timeline,
    deliverable: timelineDeliverable(service, index),
  }));
}

function buildProposal(options: ProposalOptions, pricing: PricingRow[], timeline: TimelineRow[]): string {
  const voice = toneSentence(options.tone);
  return `# Proposal for ${options.client}

## Project

${options.project}

## Executive Summary

${voice} This proposal defines a practical delivery plan for ${options.client}. The work focuses on a clear business outcome, visible milestones, and artifacts the client can review throughout delivery.

## Objectives

- Align on the desired operational or product outcome.
- Deliver the agreed scope within ${options.timeline}.
- Make assumptions, responsibilities, pricing, and acceptance criteria explicit.
- Leave the client with reusable documentation and a clean handoff.

## Scope

${options.services.length > 0 ? options.services.map((service) => `- ${service}`).join("\n") : "- Discovery and solution design\n- Implementation\n- Enablement and handoff"}

## Pricing

| Item | Description | Price |
| --- | --- | --- |
${pricing.map((row) => `| ${cell(row.item)} | ${cell(row.description)} | ${cell(row.price)} |`).join("\n")}

## Timeline

| Phase | Duration | Deliverable |
| --- | --- | --- |
${timeline.map((row) => `| ${cell(row.phase)} | ${cell(row.duration)} | ${cell(row.deliverable)} |`).join("\n")}

## Acceptance Criteria

- Scope artifacts are reviewed and accepted by the client.
- Final deliverables match the agreed workstreams.
- Implementation notes and handoff materials are delivered in writing.
- Any scope changes are handled through a written change request.

## Next Steps

1. Confirm scope, timeline, and commercial terms.
2. Approve the statement of work.
3. Schedule kickoff and assign client stakeholders.
4. Start delivery with weekly progress updates.
`;
}

function buildStatementOfWork(options: ProposalOptions, timeline: TimelineRow[]): string {
  return `# Statement of Work: ${options.client}

## Scope

${options.project}

## Deliverables

${timeline.map((row) => `- ${row.phase}: ${row.deliverable}`).join("\n")}

## Client Responsibilities

- Provide timely access to required systems, documents, and stakeholders.
- Review deliverables within two business days unless another review window is agreed.
- Assign one accountable owner for decisions and acceptance.

## Change Control

Work outside the agreed scope, timeline, or assumptions requires written approval before delivery starts.

## Commercial Terms

- Budget: ${options.budget}
- Timeline: ${options.timeline}
- Expiration: proposal terms are valid for 14 days unless extended in writing.
`;
}

function buildAssumptions(options: ProposalOptions): string {
  return `# Assumptions

- ${options.client} will provide access to required materials before kickoff.
- The project can be delivered within ${options.timeline} if reviews happen on schedule.
- Budget is ${options.budget}; taxes, pass-through services, and third-party software are excluded unless explicitly included.
- One round of revisions is included for major written deliverables.
- Final acceptance is based on the scope and criteria in the statement of work.
`;
}

function buildCoverEmail(options: ProposalOptions): string {
  return `Subject: Proposal for ${options.project}

Hi ${options.client},

Attached is the proposal package for ${options.project}. It includes the recommended scope, statement of work, pricing table, timeline, assumptions, and next steps.

The fastest path forward is to confirm the scope and timeline, then schedule kickoff with the owners who will approve the work.

Best,
`;
}

function writeArtifacts(
  options: ProposalOptions,
  pricing: PricingRow[],
  timeline: TimelineRow[],
  proposal: string,
  statementOfWork: string,
  assumptions: string,
  coverEmail: string,
  pdf: string,
) {
  const proposalPath = join(options.outputDir, "proposal.md");
  const pdfPath = join(options.outputDir, "proposal.pdf");
  const sowPath = join(options.outputDir, "statement-of-work.md");
  const pricingPath = join(options.outputDir, "pricing.csv");
  const timelinePath = join(options.outputDir, "timeline.csv");
  const assumptionsPath = join(options.outputDir, "assumptions.md");
  const coverEmailPath = join(options.outputDir, "cover-email.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(proposalPath, proposal);
  writeFileSync(pdfPath, pdf);
  writeFileSync(sowPath, statementOfWork);
  writeFileSync(pricingPath, toCsv(["item", "description", "price"], pricing));
  writeFileSync(timelinePath, toCsv(["phase", "duration", "deliverable"], timeline));
  writeFileSync(assumptionsPath, assumptions);
  writeFileSync(coverEmailPath, coverEmail);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      project: options.project,
      client: options.client,
      budget: options.budget,
      timeline: options.timeline,
      services: options.services,
      tone: options.tone,
    },
    files: {
      proposal: toManifestPath(options.outputDir, proposalPath),
      pdf: toManifestPath(options.outputDir, pdfPath),
      statementOfWork: toManifestPath(options.outputDir, sowPath),
      pricingCsv: toManifestPath(options.outputDir, pricingPath),
      timelineCsv: toManifestPath(options.outputDir, timelinePath),
      assumptions: toManifestPath(options.outputDir, assumptionsPath),
      coverEmail: toManifestPath(options.outputDir, coverEmailPath),
    },
  });

  return {
    proposal: proposalPath,
    pdf: pdfPath,
    statementOfWork: sowPath,
    pricingCsv: pricingPath,
    timelineCsv: timelinePath,
    assumptions: assumptionsPath,
    coverEmail: coverEmailPath,
    manifest: manifestPath,
  };
}

function buildPdf(markdown: string): string {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 45);
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    ...text.map((line, index) => `${index === 0 ? "" : "0 -14 Td"} (${escapePdf(line.slice(0, 95))}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
  ];
  return `%PDF-1.4\n${objects.join("\n")}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
}

function splitServices(value: unknown): string[] {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function pricingDescription(service: string, index: number): string {
  if (/discover|strategy|audit/i.test(service)) return "Requirements, success criteria, risks, and delivery plan.";
  if (/design|prototype|ux/i.test(service)) return "Screens, flows, content, and review-ready design artifacts.";
  if (/build|implement|develop/i.test(service)) return "Production implementation, integration, and delivery support.";
  if (/train|enable|handoff/i.test(service)) return "Training, documentation, and adoption support.";
  return index === 0 ? "Initial planning and delivery foundation." : "Defined workstream with review-ready deliverables.";
}

function timelineDeliverable(service: string, index: number): string {
  if (/discover|strategy|audit/i.test(service)) return "Discovery brief and delivery plan";
  if (/design|prototype|ux/i.test(service)) return "Approved design direction";
  if (/build|implement|develop/i.test(service)) return "Working implementation";
  if (/train|enable|handoff/i.test(service)) return "Handoff docs and enablement session";
  return index === 0 ? "Kickoff plan" : "Accepted workstream deliverable";
}

function toneSentence(tone: Tone): string {
  if (tone === "friendly") return "The tone is direct, collaborative, and easy to approve.";
  if (tone === "technical") return "The tone is precise, implementation-oriented, and grounded in delivery details.";
  return "The tone is concise, commercial, and executive-ready.";
}

function toCsv<T extends Record<string, string>>(headers: Array<keyof T & string>, rows: T[]): string {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n") + "\n";
}

function isTone(value: string): value is Tone {
  return value === "executive" || value === "friendly" || value === "technical";
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(join(path, ".."));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
