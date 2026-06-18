#!/usr/bin/env bun
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { decodeBase64Payload, formatPayload } from "./decode.ts";

const SKILL = "onchain-skill-loader";
const BUNDLE = join(dirname(import.meta.path), "..", "data", "reference.json");

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--expand-files") out.expand = true;
    else if (a.startsWith("decode=")) out.decode = a.slice(7);
    else if (a.startsWith("file=")) out.file = a.slice(5);
  }
  return out;
}

function printHelp() {
  console.log(`${SKILL} — EVM reference bundle (offline)

Usage:
  ${SKILL} --json              bundled reference from data/reference.json
  ${SKILL} decode=<base64>     decode external base64 JSON
  ${SKILL} file=./x.b64 --json
`);
}

function loadPayload(args: ReturnType<typeof parseArgs>) {
  if (typeof args.decode === "string") {
    return decodeBase64Payload(args.decode);
  }
  if (typeof args.file === "string") {
    const text = readFileSync(args.file, "utf8").trim();
    return text.startsWith("{") ? JSON.parse(text) : decodeBase64Payload(text);
  }
  return JSON.parse(readFileSync(BUNDLE, "utf8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const payload = loadPayload(args);
  const out = formatPayload(payload, !!args.expand);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`title: ${out.title ?? "EVM reference"}`);
    if (out.version) console.log(`version: ${out.version}`);
    if (out.common_selectors) console.log(`selectors: ${Object.keys(out.common_selectors).length}`);
    if (out.chains) console.log(`chains: ${Object.keys(out.chains).join(", ")}`);
  }
}

main();
