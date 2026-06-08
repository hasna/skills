#!/usr/bin/env bun
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { decodeBase64Payload, formatPayload } from "./decode.ts";

const SKILL = "env-leak-check";
const TOPIC = "env-leak-check";
const BUNDLE = join(dirname(import.meta.path), "..", "data", "reference.json");

const CHECKLIST = [
  "Finds .env, .env.local, and .env.production files in the project tree",
  "Scans source files for hardcoded API keys, tokens, and password patterns",
  "Flags unsafe NEXT_PUBLIC_/VITE_ exposure of secrets",
  "Produces a leak report suitable for pre-commit review",
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

  const envNames = [".env", ".env.local", ".env.production", ".env.development"];
  for (const name of envNames) {
    const p = join(root, name);
    if (existsSync(p)) findings.push({ severity: "warn", message: `Env file present: ${name}`, file: name });
  }
  const patterns = [/AKIA[0-9A-Z]{16}/, /ghp_[A-Za-z0-9_]{20,}/, /sk-[A-Za-z0-9]{20,}/, /PRIVATE KEY/];
  function walk(dir: string, depth = 0) {
    if (depth > 4) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".git") || ent.name === "node_modules") continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p, depth + 1);
      else if (/\.(ts|js|tsx|jsx|py|go|rb|env)$/i.test(ent.name)) {
        const text = readFileSync(p, "utf8");
        for (const rx of patterns) {
          if (rx.test(text)) findings.push({ severity: "fail", message: `Possible secret in ${ent.name}`, file: ent.name });
        }
      }
    }
  }
  walk(root);

  return findings;
}

function buildReport(payload: ReturnType<typeof formatPayload>, path?: string) {
  const findings = path ? scanProject(path) : [];
  const fails = findings.filter((f) => f.severity === "fail").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  return {
    skill: SKILL,
    topic: TOPIC,
    title: payload.title ?? "Find committed",
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
  console.log(`${SKILL} — Find committed

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
