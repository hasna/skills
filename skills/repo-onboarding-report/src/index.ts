#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, relative } from "path";
import { parseArgs } from "util";

type RiskSeverity = "high" | "medium" | "low";

interface RepoOptions {
  target: string;
  name: string;
  stack: string;
  focus: string[];
  outputDir: string;
}

interface RepoFile {
  path: string;
  size: number;
  extension: string;
  role: string;
}

interface PackageInfo {
  name: string;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
}

interface RepoInventory {
  files: RepoFile[];
  packageInfo: PackageInfo | null;
  languages: Record<string, number>;
  sourceDirs: string[];
  docs: string[];
  config: string[];
  tests: string[];
  entrypoints: string[];
  envExamples: string[];
}

interface RiskItem {
  id: string;
  severity: RiskSeverity;
  area: string;
  title: string;
  evidence: string;
  recommendation: string;
}

const SKILL_NAME = "repo-onboarding-report";
const RUN_ID = process.env.SKILLS_RUN_ID || `run_${Date.now().toString(36)}`;
const DEFAULT_OUTPUT_DIR =
  process.env.SKILLS_EXPORT_DIR ||
  join(process.env.SKILLS_OUTPUT_DIR || join(process.cwd(), ".skills"), "exports", SKILL_NAME, RUN_ID);
const DEFAULT_FOCUS = ["architecture", "setup", "testing", "risks", "first-week"];
const MAX_FILES = 700;
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const TEXT_NAMES = new Set([
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "Dockerfile",
  "GEMINI.md",
  "README.md",
  "bun.lock",
  "package.json",
]);
const IGNORED_DIRS = new Set([".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "out", "tmp"]);

const HELP = `Repo Onboarding Report

Usage:
  skills run repo-onboarding-report --target ./my-app --name "Acme Web App" --stack "Next.js SaaS"
  skills run repo-onboarding-report --target . --focus "architecture,setup,testing,risks"

Options:
  --target <path>  Repository directory to inspect. Default: current directory
  --name <text>    Project name. Default: package name or folder name
  --stack <text>   Stack or product context. Default: inferred from repository files
  --focus <list>   Comma-separated focus areas
  --output <dir>   Output directory. Default: current run export directory
  --help           Show this help

Outputs:
  repo-onboarding-report.md, architecture-map.md, setup-quickstart.md, first-week-plan.md, code-inventory.json, risk-register.json, and manifest.json
`;

async function main() {
  const options = parseCliOptions();
  ensureDir(options.outputDir);

  const inventory = inspectRepository(options.target);
  const risks = buildRisks(inventory);
  const report = buildReport(options, inventory, risks);
  const architectureMap = buildArchitectureMap(options, inventory);
  const quickstart = buildQuickstart(options, inventory, risks);
  const firstWeekPlan = buildFirstWeekPlan(options, inventory, risks);
  const files = writeArtifacts(options, inventory, risks, {
    report,
    architectureMap,
    quickstart,
    firstWeekPlan,
  });

  console.log(`Generated repo onboarding report for ${options.name}.`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`- ${files.report}`);
  console.log(`- ${files.architectureMap}`);
  console.log(`- ${files.quickstart}`);
  console.log(`- ${files.firstWeekPlan}`);
  console.log(`- ${files.inventory}`);
  console.log(`- ${files.risks}`);
  console.log(`- ${files.manifest}`);
}

function parseCliOptions(): RepoOptions {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      target: { type: "string", default: "." },
      name: { type: "string" },
      stack: { type: "string" },
      focus: { type: "string" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const target = String(values.target || ".").trim();
  if (!existsSync(target)) {
    console.error(`Target not found: ${target}`);
    process.exit(1);
  }
  if (!statSync(target).isDirectory()) {
    console.error(`Target must be a directory: ${target}`);
    process.exit(1);
  }

  const packageInfo = readPackageInfo(target);
  const explicitName = String(values.name || positionals.join(" ")).trim();
  const name = explicitName || packageInfo?.name || basename(target === "." ? process.cwd() : target);

  return {
    target,
    name,
    stack: String(values.stack || inferStack(target, packageInfo)).trim(),
    focus: parseFocus(values.focus),
    outputDir: String(values.output || DEFAULT_OUTPUT_DIR),
  };
}

function inspectRepository(target: string): RepoInventory {
  const files = collectFiles(target);
  const packageInfo = readPackageInfo(target);
  return {
    files,
    packageInfo,
    languages: countLanguages(files),
    sourceDirs: unique(files.map((file) => file.path.split("/")[0]).filter((dir) => ["app", "cmd", "lib", "packages", "scripts", "server", "src", "test", "tests"].includes(dir))),
    docs: files.filter((file) => file.role === "documentation").map((file) => file.path),
    config: files.filter((file) => file.role === "configuration").map((file) => file.path),
    tests: files.filter((file) => file.role === "test").map((file) => file.path),
    entrypoints: detectEntrypoints(files),
    envExamples: files.filter((file) => file.path === ".env.example" || file.path.endsWith("/.env.example")).map((file) => file.path),
  };
}

function collectFiles(target: string): RepoFile[] {
  const files: RepoFile[] = [];

  function walk(currentDir: string, relativeDir = "") {
    if (files.length >= MAX_FILES) return;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(join(currentDir, entry.name), relPath);
        continue;
      }
      if (!entry.isFile() || !isTextFile(entry.name)) continue;
      const path = join(currentDir, entry.name);
      const size = statSync(path).size;
      if (size > 1_000_000) continue;
      files.push({
        path: relPath,
        size,
        extension: extname(entry.name).toLowerCase() || entry.name,
        role: classifyFile(relPath),
      });
      if (files.length >= MAX_FILES) return;
    }
  }

  walk(target);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function readPackageInfo(target: string): PackageInfo | null {
  const path = join(target, "package.json");
  if (!existsSync(path)) return null;
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    return {
      name: String(pkg.name || basename(target)),
      scripts: objectOfStrings(pkg.scripts),
      dependencies: Object.keys(pkg.dependencies || {}).sort(),
      devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
    };
  } catch {
    return null;
  }
}

function buildRisks(inventory: RepoInventory): RiskItem[] {
  const risks: RiskItem[] = [];
  const scripts = inventory.packageInfo?.scripts || {};

  if (inventory.docs.length === 0) {
    risks.push(risk("medium", "documentation", "Missing README or docs", "No markdown documentation was detected.", "Add a README with setup, run, test, deploy, and ownership notes."));
  }
  if (inventory.tests.length === 0) {
    risks.push(risk("high", "testing", "No automated tests detected", "No test or spec files were found in the sampled repository.", "Add smoke tests for the main user flows before large changes."));
  }
  if (inventory.packageInfo && !scripts.test) {
    risks.push(risk("high", "testing", "Package has no test script", "package.json does not define scripts.test.", "Add a blocking test script and include it in release gates."));
  }
  if (inventory.packageInfo && !scripts.typecheck && !scripts.lint) {
    risks.push(risk("medium", "quality", "No typecheck or lint script", "package.json does not define scripts.typecheck or scripts.lint.", "Add at least one static quality gate for quick local verification."));
  }
  if (inventory.packageInfo && !inventory.files.some((file) => ["bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(file.path))) {
    risks.push(risk("medium", "dependencies", "Missing lockfile", "No package manager lockfile was found.", "Commit a lockfile and keep dependency updates reviewable."));
  }
  if (inventory.envExamples.length === 0) {
    risks.push(risk("low", "setup", "No environment example file", "No .env.example file was found.", "Document required environment variables without real secret values."));
  }
  if (inventory.entrypoints.length === 0) {
    risks.push(risk("low", "architecture", "Entrypoints are unclear", "No common application entrypoint was detected.", "Document the startup path and runtime process in the architecture map."));
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (/--force|--legacy-peer-deps|ignore-scripts|ignore-release-age/i.test(command)) {
      risks.push(risk("medium", "dependencies", `Script ${name} bypasses package safety`, command, "Remove package safety bypasses or document a time-boxed exception."));
    }
  }

  return risks.length > 0 ? risks : [
    risk("low", "onboarding", "Keep onboarding notes current", "No immediate structural gaps were detected in the sampled repository.", "Refresh this package after major architecture, deploy, or testing changes."),
  ];
}

function buildReport(options: RepoOptions, inventory: RepoInventory, risks: RiskItem[]): string {
  return `# Repo Onboarding Report

## Project Snapshot

- Project: ${options.name}
- Stack: ${options.stack}
- Files sampled: ${inventory.files.length}
- Focus: ${options.focus.join(", ")}
- Main directories: ${inventory.sourceDirs.length > 0 ? inventory.sourceDirs.join(", ") : "not detected"}
- Entrypoints: ${inventory.entrypoints.length > 0 ? inventory.entrypoints.join(", ") : "not detected"}

## What To Read First

${firstDocs(inventory).map((file, index) => `${index + 1}. \`${file}\``).join("\n") || "1. Add a README so the first-read path is explicit."}

## Local Setup Path

${setupSteps(inventory).map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Architecture Summary

${architectureNarrative(inventory)}

## Test And Release Signals

${testSignals(inventory).map((item) => `- ${item}`).join("\n")}

## Risk Summary

| Severity | Area | Issue | Recommendation |
| --- | --- | --- | --- |
${risks.map((item) => `| ${item.severity.toUpperCase()} | ${cell(item.area)} | ${cell(item.title)} | ${cell(item.recommendation)} |`).join("\n")}
`;
}

function buildArchitectureMap(options: RepoOptions, inventory: RepoInventory): string {
  return `# Architecture Map

## Repository Shape

${inventory.sourceDirs.map((dir) => `- \`${dir}/\`: ${describeDirectory(dir)}`).join("\n") || "- Source directories were not detected in the sampled files."}

## Language Mix

${Object.entries(inventory.languages).map(([language, count]) => `- ${language}: ${count} file${count === 1 ? "" : "s"}`).join("\n") || "- No text source files were detected."}

## Entrypoints

${inventory.entrypoints.map((file) => `- \`${file}\``).join("\n") || "- Entrypoints need to be documented."}

## Configuration

${inventory.config.slice(0, 18).map((file) => `- \`${file}\``).join("\n") || "- No configuration files were detected."}

## Ownership Questions

- Which runtime owns production deploys for ${options.name}?
- Which tests block a release?
- Which directories are safe for first contributions?
- Which data, billing, or auth boundaries need senior review?
`;
}

function buildQuickstart(options: RepoOptions, inventory: RepoInventory, risks: RiskItem[]): string {
  const scripts = inventory.packageInfo?.scripts || {};
  const commands = [
    scriptCommand("install", inventory),
    scripts.typecheck ? commandLine("typecheck", scripts.typecheck) : null,
    scripts.test ? commandLine("test", scripts.test) : null,
    scripts.dev ? commandLine("dev", scripts.dev) : scripts.start ? commandLine("start", scripts.start) : null,
  ].filter(Boolean);

  return `# Setup Quickstart

## Recommended Path

${setupSteps(inventory).map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Commands

${commands.map((command) => `\`\`\`bash\n${command}\n\`\`\``).join("\n\n") || "No package scripts were detected. Add setup and verification commands to the README."}

## Environment

${inventory.envExamples.length > 0 ? inventory.envExamples.map((file) => `- Copy \`${file}\` to a local env file and fill values from the secret manager.`).join("\n") : "- Add `.env.example` with placeholder values before onboarding new contributors."}

## Watchouts

${risks.slice(0, 5).map((item) => `- ${item.title}: ${item.recommendation}`).join("\n")}
`;
}

function buildFirstWeekPlan(options: RepoOptions, inventory: RepoInventory, risks: RiskItem[]): string {
  return `# First Week Plan

## Day 1

- Read ${firstDocs(inventory).map((file) => `\`${file}\``).join(", ") || "the repository overview once it exists"}.
- Run the local setup commands and record any missing prerequisites.
- Trace the entrypoints: ${inventory.entrypoints.length > 0 ? inventory.entrypoints.map((file) => `\`${file}\``).join(", ") : "document the startup path first"}.

## Days 2-3

- Map the main user flow through the directories: ${inventory.sourceDirs.length > 0 ? inventory.sourceDirs.map((dir) => `\`${dir}/\``).join(", ") : "source directories need identification"}.
- Run or add the smallest useful test around the first contribution area.
- Review the top risks in \`risk-register.json\`.

## Days 4-5

- Take a small issue that touches one bounded module.
- Add or update tests with the change.
- Update docs where the setup or architecture map was stale.

## Starter Tasks

${starterTasks(options, inventory, risks).map((task, index) => `${index + 1}. ${task}`).join("\n")}
`;
}

function writeArtifacts(
  options: RepoOptions,
  inventory: RepoInventory,
  risks: RiskItem[],
  docs: {
    report: string;
    architectureMap: string;
    quickstart: string;
    firstWeekPlan: string;
  },
) {
  const reportPath = join(options.outputDir, "repo-onboarding-report.md");
  const architectureMapPath = join(options.outputDir, "architecture-map.md");
  const quickstartPath = join(options.outputDir, "setup-quickstart.md");
  const firstWeekPlanPath = join(options.outputDir, "first-week-plan.md");
  const inventoryPath = join(options.outputDir, "code-inventory.json");
  const risksPath = join(options.outputDir, "risk-register.json");
  const manifestPath = join(options.outputDir, "manifest.json");

  writeFileSync(reportPath, docs.report);
  writeFileSync(architectureMapPath, docs.architectureMap);
  writeFileSync(quickstartPath, docs.quickstart);
  writeFileSync(firstWeekPlanPath, docs.firstWeekPlan);
  writeJson(inventoryPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    summary: {
      filesSampled: inventory.files.length,
      sourceDirs: inventory.sourceDirs,
      docs: inventory.docs,
      tests: inventory.tests,
      entrypoints: inventory.entrypoints,
      languages: inventory.languages,
    },
    package: inventory.packageInfo,
    files: inventory.files,
  });
  writeJson(risksPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    risks,
  });
  writeJson(manifestPath, {
    schemaVersion: 1,
    skill: SKILL_NAME,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    input: {
      target: options.target,
      name: options.name,
      stack: options.stack,
      focus: options.focus,
    },
    filesSampled: inventory.files.length,
    riskCount: risks.length,
    files: {
      report: toManifestPath(options.outputDir, reportPath),
      architectureMap: toManifestPath(options.outputDir, architectureMapPath),
      quickstart: toManifestPath(options.outputDir, quickstartPath),
      firstWeekPlan: toManifestPath(options.outputDir, firstWeekPlanPath),
      inventory: toManifestPath(options.outputDir, inventoryPath),
      risks: toManifestPath(options.outputDir, risksPath),
      manifest: toManifestPath(options.outputDir, manifestPath),
    },
  });

  return {
    report: reportPath,
    architectureMap: architectureMapPath,
    quickstart: quickstartPath,
    firstWeekPlan: firstWeekPlanPath,
    inventory: inventoryPath,
    risks: risksPath,
    manifest: manifestPath,
  };
}

function isTextFile(name: string): boolean {
  return TEXT_NAMES.has(name) || TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

function classifyFile(path: string): string {
  const name = basename(path);
  if (/(\.test\.|\.spec\.|\/tests?\/|\/__tests__\/)/i.test(path)) return "test";
  if (/README|AGENTS|CLAUDE|GEMINI|\.md$/i.test(name)) return "documentation";
  if (/package\.json|tsconfig|vite\.config|next\.config|drizzle|prisma|docker|\.ya?ml$|\.toml$|\.env\.example/i.test(path)) return "configuration";
  if (/src\/index|src\/main|app\/page|app\/layout|server|cmd\//i.test(path)) return "entrypoint";
  return "source";
}

function detectEntrypoints(files: RepoFile[]): string[] {
  return files
    .filter((file) => file.role === "entrypoint" || /^(src\/index|src\/main|server|cmd\/|app\/page|app\/layout)/.test(file.path))
    .map((file) => file.path)
    .slice(0, 12);
}

function countLanguages(files: RepoFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const language = languageFor(file.extension);
    counts[language] = (counts[language] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function languageFor(extension: string): string {
  const map: Record<string, string> = {
    ".css": "CSS",
    ".go": "Go",
    ".html": "HTML",
    ".java": "Java",
    ".js": "JavaScript",
    ".json": "JSON",
    ".jsx": "React",
    ".lock": "Lockfile",
    ".md": "Markdown",
    ".mjs": "JavaScript",
    ".py": "Python",
    ".rs": "Rust",
    ".scss": "SCSS",
    ".sh": "Shell",
    ".sql": "SQL",
    ".toml": "TOML",
    ".ts": "TypeScript",
    ".tsx": "React",
    ".txt": "Text",
    ".yaml": "YAML",
    ".yml": "YAML",
  };
  return map[extension] || "Text";
}

function inferStack(target: string, packageInfo: PackageInfo | null): string {
  const deps = new Set([...(packageInfo?.dependencies || []), ...(packageInfo?.devDependencies || [])]);
  if (existsSync(join(target, "next.config.ts")) || deps.has("next")) return "Next.js";
  if (deps.has("@remix-run/react")) return "Remix";
  if (deps.has("vite")) return "Vite";
  if (deps.has("react")) return "React";
  if (deps.has("express") || deps.has("hono") || deps.has("elysia")) return "TypeScript API";
  if (existsSync(join(target, "pyproject.toml"))) return "Python";
  if (existsSync(join(target, "go.mod"))) return "Go";
  return "software repository";
}

function parseFocus(value: unknown): string[] {
  if (!value) return DEFAULT_FOCUS;
  const focus = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return focus.length > 0 ? focus : DEFAULT_FOCUS;
}

function setupSteps(inventory: RepoInventory): string[] {
  if (!inventory.packageInfo) {
    return [
      "Install the runtime described by the repository README.",
      "Read configuration files to identify required services.",
      "Add package scripts if this repository is meant to be run locally.",
    ];
  }
  const scripts = inventory.packageInfo.scripts;
  return [
    "Install dependencies with the package manager used by the lockfile.",
    inventory.envExamples.length > 0 ? "Create a local env file from the example without committing real values." : "Create a documented env example before sharing setup steps.",
    scripts.typecheck ? "Run the typecheck script before making changes." : "Add a typecheck or lint script for quick local feedback.",
    scripts.test ? "Run the test script and inspect any required external services." : "Add a test script before broad onboarding.",
    scripts.dev ? "Start the dev server with the dev script." : scripts.start ? "Start the app with the start script." : "Document the local run command.",
  ];
}

function testSignals(inventory: RepoInventory): string[] {
  const scripts = inventory.packageInfo?.scripts || {};
  return [
    scripts.test ? `Test script: \`${scripts.test}\`` : "No package test script detected.",
    scripts.typecheck ? `Typecheck script: \`${scripts.typecheck}\`` : "No package typecheck script detected.",
    scripts.lint ? `Lint script: \`${scripts.lint}\`` : "No package lint script detected.",
    `${inventory.tests.length} test file${inventory.tests.length === 1 ? "" : "s"} sampled.`,
  ];
}

function architectureNarrative(inventory: RepoInventory): string {
  const parts = [];
  if (inventory.sourceDirs.length > 0) {
    parts.push(`Primary work appears to live in ${inventory.sourceDirs.map((dir) => `\`${dir}/\``).join(", ")}.`);
  }
  if (inventory.entrypoints.length > 0) {
    parts.push(`Startup and request boundaries likely begin around ${inventory.entrypoints.map((file) => `\`${file}\``).join(", ")}.`);
  }
  if (inventory.config.length > 0) {
    parts.push(`Configuration files worth reviewing first: ${inventory.config.slice(0, 8).map((file) => `\`${file}\``).join(", ")}.`);
  }
  return parts.join(" ") || "The sampled files did not reveal a clear architecture. Add a high-level architecture note before onboarding new contributors.";
}

function starterTasks(options: RepoOptions, inventory: RepoInventory, risks: RiskItem[]): string[] {
  const tasks = risks.slice(0, 4).map((item) => `Address ${item.area}: ${item.recommendation}`);
  if (inventory.tests.length > 0) tasks.push(`Make one low-risk change in ${options.name} and update a nearby test.`);
  tasks.push("Update the onboarding report after the first real contribution.");
  return tasks.slice(0, 6);
}

function firstDocs(inventory: RepoInventory): string[] {
  const priority = ["README.md", "AGENTS.md", "docs/"];
  return inventory.docs
    .sort((a, b) => scoreDoc(a, priority) - scoreDoc(b, priority))
    .slice(0, 6);
}

function scoreDoc(path: string, priority: string[]): number {
  const index = priority.findIndex((prefix) => path === prefix || path.startsWith(prefix));
  return index === -1 ? 100 : index;
}

function scriptCommand(name: string, inventory: RepoInventory): string {
  if (inventory.files.some((file) => file.path === "bun.lock")) return `bun install`;
  if (inventory.files.some((file) => file.path === "pnpm-lock.yaml")) return `pnpm install`;
  if (inventory.files.some((file) => file.path === "yarn.lock")) return `yarn install`;
  if (inventory.packageInfo) return `npm install`;
  return `# install project dependencies`;
}

function commandLine(name: string, script: string): string {
  return `bun run ${name} # ${script}`;
}

function objectOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function describeDirectory(dir: string): string {
  const descriptions: Record<string, string> = {
    app: "route, page, or application shell code",
    cmd: "command entrypoints",
    lib: "shared library code",
    packages: "workspace packages",
    scripts: "automation and maintenance scripts",
    server: "server runtime code",
    src: "primary source code",
    test: "test code",
    tests: "test code",
  };
  return descriptions[dir] || "project code";
}

function risk(
  severity: RiskSeverity,
  area: string,
  title: string,
  evidence: string,
  recommendation: string,
): RiskItem {
  return {
    id: `${area}-${Math.abs(hash(`${area}:${title}:${evidence}`)).toString(36)}`,
    severity,
    area,
    title,
    evidence: evidence.slice(0, 180),
    recommendation,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|");
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

function hash(value: string): number {
  let hashValue = 0;
  for (let index = 0; index < value.length; index++) {
    hashValue = (hashValue << 5) - hashValue + value.charCodeAt(index);
    hashValue |= 0;
  }
  return hashValue;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
