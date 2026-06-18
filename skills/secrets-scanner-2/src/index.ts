#!/usr/bin/env bun
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { decodeBase64Payload, formatPayload } from "./decode.ts";

const SKILL = "secrets-scanner-2";
const BUNDLE = join(dirname(import.meta.path), "..", "data", "reference.json");

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a.startsWith("decode=")) out.decode = a.slice(7);
    else if (a.startsWith("file=")) out.file = a.slice(5);
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

function printHelp() {
  console.log(`${SKILL} — bundled reference helper

Usage:
  ${SKILL} --help
  ${SKILL} --json
  ${SKILL} decode=<base64> --json
  ${SKILL} file=./bundle.b64 --json
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const payload = loadPayload(args);
const out = formatPayload(payload, false);
if (args.json) console.log(JSON.stringify(out, null, 2));
else console.log(out.title ?? SKILL);
