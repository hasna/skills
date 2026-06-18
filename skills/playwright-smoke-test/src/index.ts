#!/usr/bin/env bun
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { decodeBase64Payload, formatPayload } from "./decode.ts";

const SKILL = "playwright-smoke-test";
const TOPIC = "playwright-smoke-test";
const BUNDLE = join(dirname(import.meta.path), "..", "data", "reference.json");

const CHECKLIST = [
  "Detects Playwright config and existing e2e test layout",
  "Suggests critical-path smoke scenarios from routes and package scripts",
  "Outputs starter spec outline for CI smoke suite",
  "No browser launch — planning scaffold only (offline)",
];

type Finding = { severity: "info" | "warn" | "fail"; message: string; file?: string };

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--checklist") out.checklist = true;
    else if (a.startsWith("decode=")) out.decode = a.slice(7);
    else if (a.startsWith("file=")) out.file = a.slice(5);
    else if (a.startsWith("path=")) out.path = a.slice(5);
  }
  return out;
}

function loadPayload(args: ReturnType<typeof parseArgs>) {
  if (typeof args.decode === "string") return decodeBase64Payload(args.decode);
  if (typeof args.file === "string") {
    const text = readFileSync(args.file, "utf8").trim();
    return text.startsWith("{") ? JSON.parse(text) : decodeBase64Payload(text);
  }
  return JSON.parse(readFileSync(BUNDLE, "utf8"));
}

function scanProject(root: string): Finding[] {
  const findings: Finding[] = [];
  if (!existsSync(root)) {
    findings.push({ severity: "fail", message: `Path not found: ${root}` });
    return findings;
  }

  const pw = ["playwright.config.ts", "playwright.config.js"];
  if (!pw.some((f) => existsSync(join(root, f)))) {
    findings.push({ severity: "info", message: "No playwright.config — smoke suite scaffold needed" });
  }
  const e2e = join(root, "e2e");
  if (!existsSync(e2e)) findings.push({ severity: "info", message: "Suggest e2e/ folder with smoke.spec.ts" });

  return findings;
}

function buildReport(payload: ReturnType<typeof formatPayload>, path?: string) {
  const findings = path ? scanProject(path) : [];
  const fails = findings.filter((f) => f.severity === "fail").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  return {
    skill: SKILL,
    topic: TOPIC,
    title: payload.title ?? "Generate Playwright smoke tests for critical user flows and CI pipelines",
    checklist: CHECKLIST,
    hints: payload.hints ?? [],
    findings,
    summary: {
      scanned: Boolean(path),
      path: path ?? null,
      fail: fails,
      warn: warns,
      info: findings.length - fails - warns,
      status: fails ? "fail" : warns ? "warn" : "ok",
    },
  };
}

function printHelp() {
  console.log(`${SKILL} — Generate Playwright smoke tests for critical user flows and CI pipelines

Usage:
  ${SKILL} --help
  ${SKILL} --checklist
  ${SKILL} --json
  ${SKILL} path=./my-project --json
  ${SKILL} decode=<base64> --json
  ${SKILL} file=./bundle.b64 --json
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.checklist) {
  const lines = CHECKLIST.map((c, i) => `${i + 1}. ${c}`).join("\n");
  console.log(lines);
  process.exit(0);
}

const payload = formatPayload(loadPayload(args), false);
const report = buildReport(payload, typeof args.path === "string" ? args.path : undefined);
if (args.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(report.title);
  if (report.findings.length) {
    for (const f of report.findings) console.log(`[${f.severity}] ${f.message}${f.file ? ` (${f.file})` : ""}`);
  } else if (typeof args.path === "string") {
    console.log("No issues found (basic scan).");
  } else {
    console.log("Run with path=./project --json for offline scan.");
  }
}
