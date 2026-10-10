import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import * as internal from "../lib/skillinfo.js";
import { getPortableSkillsRoot } from "../lib/portable-skills.js";
import type { SkillMeta } from "../lib/registry-types.js";
import type { SkillRequirements } from "./index.js";

useDefaultTestTimeout();

// The public SDK entry, never the internal module. The installed consumer
// fixture (scripts/consumer-types.ts) names an installed package so this file
// checks the built `dist/sdk/index.js`; otherwise it checks the source entry.
const installed = process.env.SKILLS_REQUIREMENTS_TEST_PACKAGE;
const entry = installed ? join(resolve(installed), "dist/sdk/index.js") : resolve(import.meta.dir, "index.ts");
const sdk: typeof import("./index.js") = await import(entry);

type Case = { name: string; texts: string[]; dependencies?: Record<string, string>; meta?: SkillMeta };
const meta = (name: string, tags: string[]): SkillMeta =>
  ({ name, displayName: name, description: "Synthetic fixture", category: "Development Tools", tags });

const CORPUS: Case[] = [
  { name: "doc-tool", texts: ["# Doc tool\nSet OPENAI_API_KEY and STRIPE_SECRET_KEY before running.\nNeeds ffmpeg, python3 and git.",
    "Export MY_SERVICE_TOKEN, GITHUB_TOKEN and REPORT_BUCKET first."], dependencies: { xlsx: "^0.18.5", zod: "4.0.0" } },
  { name: "hosted-alias", texts: ["Authenticate with SKILLS_API_KEY or SKILL_API_KEY.\nProvider keys OPENAI_API_KEY, ANTHROPIC_API_KEY and AWS_REGION are managed by the host.",
    "Converts with docker and pandoc; use ImageMagick to convert the image.\nCUSTOM_ENDPOINT and TWILIO_AUTH_TOKEN"], dependencies: {},
    meta: meta("hosted-canonical", ["premium"]) },
  { name: "remote-tag", texts: ["HASNA_SKILLS_API_KEY only; GEMINI_API_KEY ignored.", "chromium playwright puppeteer wkhtmltopdf"],
    meta: meta("remote-tag", ["remote", "Writing"]) },
  { name: "local-tagged", texts: ["SKILLS_API_KEY stays as written for local skills. OPENAI_API_KEY too.", "github gitlab gitignore only"],
    dependencies: { "@scope/pkg": "1.2.3" }, meta: meta("local-tagged", ["Premium-ish", "writing"]) },
  { name: "empty", texts: [] },
];

// Captured from the internal helper at 00b630d (0.10.66), before it was public.
const GOLDEN: SkillRequirements[] = [
  { envVars: ["GITHUB_TOKEN", "MY_SERVICE_TOKEN", "OPENAI_API_KEY", "REPORT_BUCKET", "STRIPE_SECRET_KEY"],
    systemDeps: ["ffmpeg", "git", "python"], cliCommand: "skills run doc-tool", dependencies: { xlsx: "^0.18.5", zod: "4.0.0" } },
  { envVars: ["CUSTOM_ENDPOINT", "HASNA_SKILLS_API_KEY", "TWILIO_AUTH_TOKEN"],
    systemDeps: ["docker", "imagemagick", "pandoc"], cliCommand: "skills run hosted-alias", dependencies: {} },
  { envVars: ["HASNA_SKILLS_API_KEY"], systemDeps: ["chromium", "playwright", "puppeteer", "wkhtmltopdf"],
    cliCommand: "skills run remote-tag", dependencies: {} },
  { envVars: ["OPENAI_API_KEY", "SKILLS_API_KEY"], systemDeps: [], cliCommand: "skills run local-tagged",
    dependencies: { "@scope/pkg": "1.2.3" } },
  { envVars: [], systemDeps: [], cliCommand: "skills run empty", dependencies: {} },
];

function evaluate(fn: typeof internal.getSkillRequirementsFromContent, cases: readonly Case[]) {
  return cases.map(item => item.dependencies === undefined && item.meta === undefined
    ? fn(item.name, item.texts)
    : fn(item.name, item.texts, item.dependencies, item.meta));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test("the public SDK entry exports the explicit-content requirements helper", () => {
  expect(typeof sdk.getSkillRequirementsFromContent).toBe("function");
  // From source, the export is the very function skillinfo.ts and
  // selection-resolver.ts already call, so internal callers are unchanged.
  if (!installed) expect(sdk.getSkillRequirementsFromContent).toBe(internal.getSkillRequirementsFromContent);
});

test("output is determined only by the explicit arguments", () => {
  const first = evaluate(sdk.getSkillRequirementsFromContent, CORPUS);
  const second = evaluate(sdk.getSkillRequirementsFromContent, structuredClone(CORPUS));
  expect(first).toEqual(GOLDEN);
  expect(second).toEqual(GOLDEN);
  // The hosted alias normalization is unchanged: hosted skills document the
  // canonical HASNA_SKILLS_API_KEY, local skills keep what they wrote.
  expect(first[1]!.envVars).not.toContain("SKILLS_API_KEY");
  expect(first[3]!.envVars).toContain("SKILLS_API_KEY");
});

test("frozen inputs are read without being mutated", () => {
  const frozen = deepFreeze(structuredClone(CORPUS));
  const before = structuredClone(frozen);
  expect(evaluate(sdk.getSkillRequirementsFromContent, frozen)).toEqual(GOLDEN);
  expect(frozen).toEqual(before);
  for (const item of frozen) {
    expect(Object.isFrozen(item.texts)).toBe(true);
    if (item.dependencies) expect(Object.isFrozen(item.dependencies)).toBe(true);
    if (item.meta) expect(Object.isFrozen(item.meta.tags)).toBe(true);
  }
});

// Runs before the entry loads: wraps filesystem, account, environment, network
// and process access so that, once armed, any such read throws instead.
const AMBIENT_TRAP = `
const fs = require("node:fs"), os = require("node:os"), attempts = [];
let armed = false;
globalThis.__ambientTrap = { arm(value) { armed = value; }, attempts };
const refuse = (label) => { attempts.push(label); throw new Error("AMBIENT_READ_REFUSED: " + label); };
const wrap = (owner, prefix) => {
  for (const key of Object.keys(owner)) {
    const original = owner[key];
    if (typeof original !== "function" || /^[A-Z]/.test(key)) continue;
    owner[key] = function (...args) { if (armed) refuse(prefix + key); return original.apply(this, args); };
  }
};
wrap(fs, "fs."); wrap(fs.promises, "fs.promises."); wrap(os, "os.");
for (const key of ["file", "spawn", "spawnSync", "connect", "listen", "serve", "write"]) {
  const original = Bun[key];
  if (typeof original === "function") Bun[key] = function (...args) { if (armed) refuse("Bun." + key); return original.apply(this, args); };
}
const fetchOriginal = globalThis.fetch;
globalThis.fetch = function (...args) { if (armed) refuse("fetch"); return fetchOriginal.apply(this, args); };
process.env = new Proxy(process.env, {
  get(target, key, receiver) { if (armed && typeof key === "string") refuse("env." + key); return Reflect.get(target, key, receiver); },
  has(target, key) { if (armed && typeof key === "string") refuse("env." + key); return Reflect.has(target, key); },
  ownKeys(target) { if (armed) refuse("env.keys"); return Reflect.ownKeys(target); },
});
`;

const AMBIENT_CHILD = `
const [entry, corpusPath] = process.argv.slice(2);
const corpus = JSON.parse(await Bun.file(corpusPath).text());
const { getSkillRequirementsFromContent } = await import(entry);
const trap = globalThis.__ambientTrap;
let results, failure = null;
trap.arm(true);
try {
  results = corpus.map(item => item.dependencies === undefined && item.meta === undefined
    ? getSkillRequirementsFromContent(item.name, item.texts)
    : getSkillRequirementsFromContent(item.name, item.texts, item.dependencies, item.meta));
} catch (error) { failure = String(error); }
trap.arm(false);
console.log(JSON.stringify({ results, failure, attempts: trap.attempts }));
`;

test("poisoned ambient configuration and trapped ambient reads leave the result unchanged", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skills-requirements-ambient-"));
  const locked = join(scratch, "locked");
  try {
    mkdirSync(join(locked, "data"), { recursive: true });
    writeFileSync(join(locked, "data", "registry.json"), "{ not json");
    // Every configured location sits below a directory nobody may read, so a
    // registry, install or credential lookup would fail rather than succeed.
    chmodSync(locked, 0o000);
    const trap = join(scratch, "trap.js"), child = join(scratch, "child.js"), corpus = join(scratch, "corpus.json");
    writeFileSync(trap, AMBIENT_TRAP); writeFileSync(child, AMBIENT_CHILD); writeFileSync(corpus, JSON.stringify(CORPUS));
    const unreadable = (name: string) => join(locked, name);
    const poisoned = "poisoned-not-a-credential";
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "--preload", trap, child, entry, corpus], {
      cwd: scratch, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: scratch, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        HOME: unreadable("home"), XDG_CONFIG_HOME: unreadable("config"), XDG_DATA_HOME: unreadable("data"),
        HASNA_DATA_HOME: unreadable("data"), HASNA_SKILLS_DIR: unreadable("data"), HASNA_SKILLS_HOME: unreadable("home"),
        SKILLS_HOME: unreadable("home"), SKILLS_API_KEY: poisoned, HASNA_SKILLS_API_KEY: poisoned,
        HASNA_SKILLS_API_KEY_REF: "poisoned/ref", SKILLS_API_URL: "http://127.0.0.1:9/poisoned",
        HASNA_SKILLS_API_URL: "http://127.0.0.1:9/poisoned", SKILLS_LOCAL: "1", HASNA_SKILLS_LOCAL: "1",
        SKILLS_SOURCE: "poisoned", HASNA_SKILLS_DATABASE_URL: "postgres://poisoned.invalid/skills",
      },
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report.failure).toBeNull();
    expect(report.attempts).toEqual([]);
    expect(report.results).toEqual(GOLDEN);
  } finally {
    chmodSync(locked, 0o700);
    rmSync(scratch, { recursive: true, force: true });
  }
});

test.skipIf(Boolean(installed))("the internal getSkillRequirements caller keeps its output for the same files", () => {
  const name = "requirements-fixture";
  const dir = join(getPortableSkillsRoot(), name);
  mkdirSync(dir, { recursive: true });
  const files: Array<[string, string]> = [
    ["SKILL.md", CORPUS[0]!.texts[0]!], ["README.md", CORPUS[0]!.texts[1]!], ["CLAUDE.md", "Uses docker."],
    [".env.example", "LOCAL_SERVICE_URL=\n"],
  ];
  for (const [file, body] of files) writeFileSync(join(dir, file), body);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, dependencies: { xlsx: "^0.18.5" } }));
  const expected = { envVars: ["GITHUB_TOKEN", "LOCAL_SERVICE_URL", "MY_SERVICE_TOKEN", "OPENAI_API_KEY", "REPORT_BUCKET", "STRIPE_SECRET_KEY"],
    systemDeps: ["docker", "ffmpeg", "git", "python"], cliCommand: `skills run ${name}`, dependencies: { xlsx: "^0.18.5" } };
  expect(internal.getSkillRequirements(name)).toEqual(expected);
  expect(sdk.getSkillRequirementsFromContent(name, files.map(([, body]) => body), { xlsx: "^0.18.5" })).toEqual(expected);
});
