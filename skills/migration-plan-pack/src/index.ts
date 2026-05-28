#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "fs";
import { basename, dirname, join, relative } from "path";
import { parseArgs } from "util";

type Strategy = "phased" | "big-bang" | "parallel-run";
type Severity = "high" | "medium" | "low";

interface MigrationOptions {
  system: string;
  from: string;
  to: string;
  scope: string[];
  constraints: string;
  deadline: string;
  strategy: Strategy;
  outputDir: string;
}

interface DependencyItem {
  id: string;
  name: string;
  category: string;
  current: string;
  target: string;
  action: string;
  blockers: string[];
}

interface RiskItem {
  id: string;
  severity: Severity;
  area: string;
  risk: string;
  mitigation: string;
  owner: string;
}

interface PlanPhase {
  id: string;
  title: string;
  goal: string;
  owner: string;
  tasks: string[];
  exitCriteria: string[];
}

const SKILL_NAME = "migration-plan-pack";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const STRATEGIES: Strategy[] = ["phased", "big-bang", "parallel-run"];
const DEFAULT_SCOPE = ["app", "data", "deploy", "tests"];

const HELP = `Migration Plan Pack

Usage:
  skills run migration-plan-pack --system "Acme SaaS" --from "Next.js 14" --to "Next.js 16"
  skills run migration-plan-pack --from "single-region worker" --to "multi-region worker" --constraints "no downtime"

Options:
  --system <text>       Product, repo, app, or service being migrated
  --from <text>         Current framework, library, database, infrastructure, or architecture state
  --to <text>           Desired target state
  --scope <list>        Comma-separated systems or workstreams in scope
  --constraints <text>  Downtime, compliance, billing, data, or operational constraints
  --deadline <text>     Date, release train, or migration window
  --strategy <type>     phased, big-bang, or parallel-run. Default: phased
  --output <dir>        Output directory. Default: current run export directory
  --help                Show this help

Outputs:
  migration-plan.md, risk-matrix.csv, ordered-checklist.md, test-strategy.md,
  dependency-map.json, rollout-plan.md, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const dependencies = buildDependencyMap(options);
  const risks = buildRisks(options, dependencies);
  const phases = buildPhases(options, dependencies, risks);
  const plan = buildPlan(options, dependencies, risks, phases);
  const checklist = buildChecklist(options, phases);
  const testStrategy = buildTestStrategy(options, dependencies, risks);
  const rolloutPlan = buildRolloutPlan(options, phases, risks);
  const files = writeArtifacts(options, dependencies, risks, phases, {
    plan,
    checklist,
    testStrategy,
    rolloutPlan,
  });

  console.log(`Generated migration plan pack for ${options.system}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.plan}`);
  console.log(`- ${files.riskMatrix}`);
  console.log(`- ${files.checklist}`);
  console.log(`- ${files.testStrategy}`);
  console.log(`- ${files.dependencyMap}`);
  console.log(`- ${files.rolloutPlan}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): MigrationOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      system: { type: "string", default: "Migration Target" },
      from: { type: "string" },
      to: { type: "string" },
      scope: { type: "string" },
      constraints: { type: "string", default: "" },
      deadline: { type: "string", default: "" },
      strategy: { type: "string", default: "phased" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const strategy = String(values.strategy || "phased");
  if (!STRATEGIES.includes(strategy as Strategy)) {
    console.error("Invalid strategy. Use phased, big-bang, or parallel-run.");
    process.exit(1);
  }

  const positionalText = positionals.join(" ").trim();

  return {
    system: String(values.system || "Migration Target").trim(),
    from: String(values.from || positionalText || "current state").trim(),
    to: String(values.to || "target state").trim(),
    scope: parseList(values.scope, DEFAULT_SCOPE),
    constraints: String(values.constraints || "").trim(),
    deadline: String(values.deadline || "").trim(),
    strategy: strategy as Strategy,
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function buildDependencyMap(options: MigrationOptions): DependencyItem[] {
  const currentItems = splitItems(options.from);
  const targetItems = splitItems(options.to);
  const longest = Math.max(currentItems.length, targetItems.length, options.scope.length);
  const items: DependencyItem[] = [];

  for (let index = 0; index < longest; index += 1) {
    const current = currentItems[index] || currentItems[currentItems.length - 1] || "current state";
    const target = targetItems[index] || targetItems[targetItems.length - 1] || "target state";
    const scope = options.scope[index] || options.scope[index % options.scope.length] || "app";
    const name = nameFor(current, target, scope);
    items.push({
      id: `dep-${String(index + 1).padStart(2, "0")}`,
      name,
      category: classifyDependency(`${current} ${target} ${scope}`),
      current,
      target,
      action: actionFor(current, target),
      blockers: blockersFor(options, current, target),
    });
  }

  return items;
}

function buildRisks(options: MigrationOptions, dependencies: DependencyItem[]): RiskItem[] {
  const text = `${options.from} ${options.to} ${options.scope.join(" ")} ${options.constraints}`.toLowerCase();
  const risks: RiskItem[] = [
    {
      id: "risk-01",
      severity: includesAny(text, ["database", "drizzle", "postgres", "mysql", "schema", "migration"]) ? "high" : "medium",
      area: "Data Integrity",
      risk: "Schema or data-contract changes can silently corrupt generated state or historical records.",
      mitigation: "Run migrations against a production-like snapshot, verify checksums, and keep a tested rollback script.",
      owner: "backend",
    },
    {
      id: "risk-02",
      severity: includesAny(text, ["next", "react", "node", "bun", "framework"]) ? "medium" : "low",
      area: "Runtime Compatibility",
      risk: "Framework or runtime changes can break routing, build output, edge behavior, or package resolution.",
      mitigation: "Pin a compatibility matrix, build both old and new targets in CI, and smoke the highest-traffic flows.",
      owner: "application",
    },
    {
      id: "risk-03",
      severity: options.strategy === "big-bang" ? "high" : "medium",
      area: "Release Safety",
      risk: "A single release window can hide coupled failures until after traffic moves to the new path.",
      mitigation: "Use feature flags, progressive traffic shifting, release holds, and a documented rollback trigger.",
      owner: "release",
    },
  ];

  if (text.includes("no downtime") || text.includes("zero downtime")) {
    risks.push({
      id: "risk-04",
      severity: "high",
      area: "Availability",
      risk: "The migration cannot rely on maintenance windows or user-visible downtime.",
      mitigation: "Use expand-contract database changes, dual writes when needed, and traffic cutover with health gates.",
      owner: "platform",
    });
  }

  if (text.includes("rls") || text.includes("permission") || text.includes("tenant")) {
    risks.push({
      id: `risk-${String(risks.length + 1).padStart(2, "0")}`,
      severity: "high",
      area: "Access Control",
      risk: "Tenant isolation or permission checks can regress when schemas, services, or workers change.",
      mitigation: "Run RLS verification, cross-tenant negative tests, and audit logs before traffic cutover.",
      owner: "security",
    });
  }

  if (text.includes("stripe") || text.includes("billing") || text.includes("checkout")) {
    risks.push({
      id: `risk-${String(risks.length + 1).padStart(2, "0")}`,
      severity: "high",
      area: "Revenue Flow",
      risk: "Checkout, webhook, or ledger changes can stop paid runs or mis-credit user balances.",
      mitigation: "Replay signed webhook fixtures, run a live-mode smoke against configured custom domains, and verify ledger idempotency.",
      owner: "billing",
    });
  }

  if (dependencies.some((item) => item.blockers.length > 1)) {
    risks.push({
      id: `risk-${String(risks.length + 1).padStart(2, "0")}`,
      severity: "medium",
      area: "Dependency Ordering",
      risk: "Multiple workstreams depend on sequencing and can block each other late in the migration.",
      mitigation: "Publish dependency owners, freeze dates, and daily unblock criteria before implementation starts.",
      owner: "program",
    });
  }

  return risks;
}

function buildPhases(options: MigrationOptions, dependencies: DependencyItem[], risks: RiskItem[]): PlanPhase[] {
  const highRiskAreas = risks.filter((risk) => risk.severity === "high").map((risk) => risk.area);
  return [
    {
      id: "phase-01",
      title: "Inventory and Compatibility",
      goal: "Confirm the current and target states, owners, and breaking changes before implementation.",
      owner: "tech lead",
      tasks: [
        `Document current state: ${options.from}.`,
        `Document target state: ${options.to}.`,
        `Map affected workstreams: ${options.scope.join(", ")}.`,
        "Create a compatibility matrix for runtime, package, database, infrastructure, and deployment surfaces.",
      ],
      exitCriteria: ["All dependency owners assigned", "Breaking changes cataloged", "Rollback path drafted"],
    },
    {
      id: "phase-02",
      title: "Prepare Safe Migration Path",
      goal: `Shape a ${options.strategy} migration that can be tested before traffic moves.`,
      owner: "platform",
      tasks: [
        "Create feature flags or routing controls for old and new paths.",
        "Add observability for migration-specific success, latency, error, and billing signals.",
        "Prepare data backups, snapshots, and rollback scripts.",
        ...dependencies.slice(0, 4).map((item) => `Prepare ${item.name}: ${item.action}.`),
      ],
      exitCriteria: ["Flags or routing controls exist", "Rollback scripts tested", "Monitoring dashboard ready"],
    },
    {
      id: "phase-03",
      title: "Implement and Parallel Validate",
      goal: "Build the target path while keeping the existing path available for comparison.",
      owner: "engineering",
      tasks: [
        "Implement the target changes behind controls.",
        "Run old-vs-new output comparisons for critical workflows.",
        "Resolve high-risk areas before release candidate freeze.",
        ...highRiskAreas.map((area) => `Add explicit validation for ${area}.`),
      ],
      exitCriteria: ["Regression suite green", "No unresolved high risks", "Release candidate signed off"],
    },
    {
      id: "phase-04",
      title: "Cutover and Stabilize",
      goal: "Move traffic to the target state with measurable health gates and rollback triggers.",
      owner: "release",
      tasks: [
        "Run preflight checks immediately before cutover.",
        "Shift traffic according to the rollout plan.",
        "Monitor errors, latency, ledger consistency, and user-impact signals.",
        "Keep rollback owner available until the stabilization window closes.",
      ],
      exitCriteria: ["Health gates pass", "Rollback window closed", "Post-migration report published"],
    },
  ];
}

function buildPlan(
  options: MigrationOptions,
  dependencies: DependencyItem[],
  risks: RiskItem[],
  phases: PlanPhase[],
): string {
  return `# Migration Plan: ${options.system}

## Summary

- Current state: ${options.from}
- Target state: ${options.to}
- Strategy: ${options.strategy}
- Scope: ${options.scope.join(", ")}
- Deadline: ${options.deadline || "Not supplied"}
- Constraints: ${options.constraints || "None supplied"}

## Dependency Map

| ID | Area | Current | Target | Action |
| --- | --- | --- | --- | --- |
${dependencies.map((item) => `| ${item.id} | ${item.category} | ${item.current} | ${item.target} | ${item.action} |`).join("\n")}

## Plan Phases

${phases.map((phase) => `### ${phase.id}: ${phase.title}

Owner: ${phase.owner}

Goal: ${phase.goal}

Tasks:
${phase.tasks.map((task) => `- ${task}`).join("\n")}

Exit criteria:
${phase.exitCriteria.map((criterion) => `- ${criterion}`).join("\n")}`).join("\n\n")}

## Highest Risks

${risks.filter((risk) => risk.severity === "high").map((risk) => `- ${risk.area}: ${risk.mitigation}`).join("\n") || "- No high-severity risks detected from supplied inputs."}
`;
}

function buildChecklist(options: MigrationOptions, phases: PlanPhase[]): string {
  let counter = 1;
  const lines = [`# Ordered Migration Checklist: ${options.system}`, ""];
  for (const phase of phases) {
    lines.push(`## ${phase.title}`, "");
    for (const task of phase.tasks) {
      lines.push(`${counter}. [ ] ${task}`);
      counter += 1;
    }
    for (const criterion of phase.exitCriteria) {
      lines.push(`${counter}. [ ] Verify exit criterion: ${criterion}.`);
      counter += 1;
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildTestStrategy(options: MigrationOptions, dependencies: DependencyItem[], risks: RiskItem[]): string {
  const scopedTests = options.scope.map((scope) => `- ${sentenceCase(scope)} regression tests covering old and new behavior.`);
  const riskTests = risks.map((risk) => `- ${risk.area}: prove mitigation with an automated or scripted verification step.`);
  return `# Test Strategy: ${options.system}

## Required Test Layers

- Unit tests for changed adapters, parsers, migrations, and feature flags.
- Integration tests for every boundary touched by ${dependencies.map((item) => item.category).join(", ")}.
- End-to-end smoke tests for signup/login, billing, run submission, artifact download, and admin operations when present.
${scopedTests.join("\n")}

## Migration-Specific Assertions

${riskTests.join("\n")}

## Release Gates

- Old and new paths produce equivalent results for critical workflows.
- Database migrations apply and roll back on a production-like snapshot.
- Observability dashboards show baseline, canary, and post-cutover windows.
- Rollback command and owner are documented before the migration starts.
`;
}

function buildRolloutPlan(options: MigrationOptions, phases: PlanPhase[], risks: RiskItem[]): string {
  const canary = options.strategy === "big-bang" ? "internal users, then full cutover after preflight" : "1%, 10%, 50%, then 100% traffic";
  return `# Rollout Plan: ${options.system}

## Cutover Shape

- Strategy: ${options.strategy}
- Suggested traffic schedule: ${canary}
- Migration window: ${options.deadline || "coordinate with release calendar"}
- Freeze condition: unresolved high-severity risks or failing release gates

## Health Gates

- Error rate does not exceed baseline by more than 20%.
- p95 latency remains inside the agreed service budget.
- Data checksums and record counts match expected migration deltas.
- Billing, authentication, and artifact access flows remain healthy when in scope.

## Rollback Triggers

${risks.slice(0, 5).map((risk) => `- ${risk.area}: rollback or pause if mitigation verification fails.`).join("\n")}

## Communications

- Publish owner, status, and current phase before each cutover step.
- Keep a single incident channel open from ${phases[0]?.title || "preflight"} through stabilization.
- Send a post-migration summary with completed phases, remaining follow-ups, and evidence links.
`;
}

function writeArtifacts(
  options: MigrationOptions,
  dependencies: DependencyItem[],
  risks: RiskItem[],
  phases: PlanPhase[],
  content: { plan: string; checklist: string; testStrategy: string; rolloutPlan: string },
) {
  const planPath = join(options.outputDir, "migration-plan.md");
  const riskMatrixPath = join(options.outputDir, "risk-matrix.csv");
  const checklistPath = join(options.outputDir, "ordered-checklist.md");
  const testStrategyPath = join(options.outputDir, "test-strategy.md");
  const dependencyMapPath = join(options.outputDir, "dependency-map.json");
  const rolloutPlanPath = join(options.outputDir, "rollout-plan.md");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(planPath, content.plan);
  writeFileSync(riskMatrixPath, risksCsv(risks));
  writeFileSync(checklistPath, content.checklist);
  writeFileSync(testStrategyPath, content.testStrategy);
  writeJson(dependencyMapPath, { schemaVersion: 1, skill: SKILL_NAME, runId: RUN_ID, items: dependencies });
  writeFileSync(rolloutPlanPath, content.rolloutPlan);
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      system: options.system,
      from: options.from,
      to: options.to,
      scope: options.scope,
      strategy: options.strategy,
      deadline: options.deadline,
      constraintsSupplied: Boolean(options.constraints),
    },
    phaseCount: phases.length,
    riskCount: risks.length,
    files: {
      plan: toManifestPath(options.outputDir, planPath),
      riskMatrix: toManifestPath(options.outputDir, riskMatrixPath),
      checklist: toManifestPath(options.outputDir, checklistPath),
      testStrategy: toManifestPath(options.outputDir, testStrategyPath),
      dependencyMap: toManifestPath(options.outputDir, dependencyMapPath),
      rolloutPlan: toManifestPath(options.outputDir, rolloutPlanPath),
    },
  });

  return {
    plan: planPath,
    riskMatrix: riskMatrixPath,
    checklist: checklistPath,
    testStrategy: testStrategyPath,
    dependencyMap: dependencyMapPath,
    rolloutPlan: rolloutPlanPath,
    manifest: manifestPath,
  };
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const parsed = splitItems(String(value || ""));
  return parsed.length > 0 ? parsed : fallback;
}

function splitItems(value: string): string[] {
  return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function nameFor(current: string, target: string, scope: string): string {
  const targetName = target.replace(/\s+/g, " ").trim();
  if (targetName && targetName !== "target state") return targetName;
  return `${sentenceCase(scope)} migration from ${current}`;
}

function classifyDependency(text: string): string {
  const lower = text.toLowerCase();
  if (includesAny(lower, ["postgres", "mysql", "database", "drizzle", "schema", "sql"])) return "database";
  if (includesAny(lower, ["aws", "infra", "terraform", "region", "worker", "queue"])) return "infrastructure";
  if (includesAny(lower, ["next", "react", "vue", "svelte", "node", "bun"])) return "application";
  if (includesAny(lower, ["stripe", "billing", "checkout", "webhook"])) return "billing";
  if (includesAny(lower, ["test", "qa", "ci", "deploy"])) return "delivery";
  return "system";
}

function actionFor(current: string, target: string): string {
  if (current.toLowerCase() === target.toLowerCase()) return "verify compatibility and keep pinned";
  if (target === "target state") return "define target version and compatibility requirements";
  return `migrate from ${current} to ${target}`;
}

function blockersFor(options: MigrationOptions, current: string, target: string): string[] {
  const text = `${options.constraints} ${current} ${target}`.toLowerCase();
  const blockers = ["owner sign-off"];
  if (includesAny(text, ["database", "schema", "drizzle", "postgres"])) blockers.push("snapshot and rollback verification");
  if (includesAny(text, ["no downtime", "zero downtime", "multi-region"])) blockers.push("progressive cutover controls");
  if (includesAny(text, ["stripe", "billing", "checkout", "webhook"])) blockers.push("billing smoke and webhook replay");
  if (includesAny(text, ["rls", "tenant", "permission"])) blockers.push("tenant isolation verification");
  return blockers;
}

function risksCsv(risks: RiskItem[]): string {
  const headers = ["id", "severity", "area", "risk", "mitigation", "owner"] as const;
  return [headers.join(","), ...risks.map((risk) => headers.map((header) => csvCell(risk[header])).join(","))].join("\n") + "\n";
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : value;
}

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, value: unknown) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function toManifestPath(root: string, path: string): string {
  return relative(root, path) || basename(path);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
