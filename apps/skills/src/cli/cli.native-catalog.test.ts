import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { admitCorpusFixture, wrapNativeInspectionFixture } from "../lib/codex-corpus.fixture.js";
import { KernelLock } from "@hasna/contracts/kernel-lock";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-native-catalog-cli-"));
const binary = join(scratch, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function run(root: string, args: string[]) {
  const home = join(root, "home"), temporary = join(root, "tmp");
  mkdirSync(home, { recursive: true });
  mkdirSync(temporary, { recursive: true });
  const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], {
    cwd: root,
    env: { PATH: `${process.env.PATH ?? ""}`, HOME: home, USERPROFILE: home, TMPDIR: temporary,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1", TERM: "dumb" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

function native(root: string, version = "0.159.2", options: { enrolled?: boolean; observeClose?: boolean } = {}) {
  if (options.enrolled !== false) admitCorpusFixture(join(root, "home", ".codex"));
  const command = join(root, "codex"), document = join(root, "plugin", "SKILL.md");
  writeFileSync(command, wrapNativeInspectionFixture(`#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") { console.log("codex-cli ${version}"); process.exit(0); }
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") console.log(JSON.stringify({ id: request.id, result: { userAgent: "skills-native-hook-enrollment/${version} synthetic" } }));
  if (request.method === "skills/list") console.log(JSON.stringify({ id: request.id, result: { data: [{ cwd: request.params.cwds[0], errors: [], skills: [{ name: "example:review", path: ${JSON.stringify(document)}, enabled: true, pluginId: "example@probe" }] }] } }));
  if (request.method === "plugin/installed") console.log(JSON.stringify({ id: request.id, result: { marketplaces: [{ name: "probe", plugins: [{ id: "example@probe", name: "example", installed: true, enabled: true, localVersion: "1.0.0" }] }], marketplaceLoadErrors: [] } }));
}
${options.observeClose ? `writeFileSync(${JSON.stringify(join(root, "closing"))}, "closing");
await new Promise(resolve => setTimeout(resolve, 750));
writeFileSync(${JSON.stringify(join(root, "closed"))}, "closed");` : ""}
`), { mode: 0o700 });
  chmodSync(command, 0o700);
  return { command, document };
}

for (const nativeVersion of ["0.159.2", "0.160.0", "0.160.1"]) test(`built CLI captures the ${nativeVersion} native catalog privately with exact readback`, async () => {
  const root = mkdtempSync(join(scratch, "case-")), { command, document } = native(root, nativeVersion);
  const output = join(root, "catalog.json");
  const result = await run(root, ["hook", "native-catalog", "--cwd", root, "--output", output, "--codex-command", command, "--json"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const receipt = JSON.parse(result.stdout), bytes = readFileSync(output);
  expect(receipt).toEqual({ version: `codex-cli ${nativeVersion}`, cwd: root, skillCount: 1, output,
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  expect(statSync(output).mode & 0o777).toBe(0o600);
  expect(JSON.parse(bytes.toString())).toEqual({ version: `codex-cli ${nativeVersion}`, cwd: root,
    skills: [{ name: "example:review", path: document, enabled: true, pluginId: "example@probe" }],
    plugins: [{ id: "example@probe", name: "example", installed: true, enabled: true, localVersion: "1.0.0" }] });
});

test("built CLI refuses an existing catalog without replacing its bytes", async () => {
  const root = mkdtempSync(join(scratch, "case-")), { command } = native(root);
  const output = join(root, "catalog.json"), original = "preserved original\n";
  writeFileSync(output, original, { mode: 0o600 });
  const result = await run(root, ["hook", "native-catalog", "--cwd", root, "--output", output, "--codex-command", command, "--json"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe("CODEX_NATIVE_SKILL_CATALOG_OUTPUT_EXISTS");
  expect(readFileSync(output, "utf8")).toBe(original);
});

test("built CLI refuses a native version without qualified-name control support", async () => {
  const root = mkdtempSync(join(scratch, "case-")), { command } = native(root, "0.158.0");
  const output = join(root, "catalog.json");
  const result = await run(root, ["hook", "native-catalog", "--cwd", root, "--output", output, "--codex-command", command, "--json"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe("CODEX_NATIVE_SKILL_CATALOG_UNSUPPORTED_VERSION");
  expect(existsSync(output)).toBe(false);
});

for (const nativeVersion of ["0.160.2", "0.161.0"]) test(`built CLI refuses the unmeasured ${nativeVersion} neighbour without publishing output`, async () => {
  const root = mkdtempSync(join(scratch, "case-")), { command } = native(root, nativeVersion);
  const output = join(root, "catalog.json");
  const result = await run(root, ["hook", "native-catalog", "--cwd", root, "--output", output, "--codex-command", command, "--json"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe("CODEX_HOOK_TRUST_NATIVE_UNSUPPORTED_VERSION");
  expect(existsSync(output)).toBe(false);
});

for (const nativeVersion of ["0.160.0", "0.160.1"]) for (const state of ["unenrolled", "pending", "exclusive"] as const) test(`built CLI ${nativeVersion} catalog refuses ${state} admission without publishing output`, async () => {
  const root = mkdtempSync(join(scratch, "case-"));
  const { command } = native(root, nativeVersion, { enrolled: state !== "unenrolled" });
  const corpus = join(root, "home", ".codex"), output = join(root, "catalog.json");
  const blocker = state === "exclusive" ? new KernelLock(corpus, ".native-corpus-admission", { existingOnly: true }) : undefined;
  if (state === "pending") writeFileSync(join(corpus, "fixture-mode"), "pending");
  try {
    if (blocker) expect(blocker.trySync(1000)).toBe(true);
    const result = await run(root, ["hook", "native-catalog", "--cwd", root, "--output", output, "--codex-command", command, "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("CODEX_NATIVE_SKILL_CATALOG_CAPTURE_FAILED");
    expect(existsSync(output)).toBe(false);
    if (state === "unenrolled") expect(existsSync(corpus)).toBe(false);
  } finally { blocker?.close(); }
});

test("built CLI retains shared admission until the native catalog child closes", async () => {
  const root = mkdtempSync(join(scratch, "case-"));
  const { command } = native(root, "0.160.0", { observeClose: true });
  const output = join(root, "catalog.json");
  const pending = run(root, ["hook", "native-catalog", "--cwd", root, "--output", output, "--codex-command", command, "--json"]);
  try {
    const deadline = performance.now() + 5000;
    while (!existsSync(join(root, "closing")) && performance.now() < deadline) await Bun.sleep(10);
    expect(existsSync(join(root, "closing"))).toBe(true);
    expect(existsSync(join(root, "closed"))).toBe(false);
    expect(existsSync(output)).toBe(false);
    const publisher = new KernelLock(join(root, "home", ".codex"), ".native-corpus-admission", { existingOnly: true });
    try {
      expect(publisher.trySync(100)).toBe(false);
      const result = await pending;
      expect(result.exitCode).toBe(0); expect(result.stderr).toBe("");
      expect(existsSync(join(root, "closed"))).toBe(true);
      expect(existsSync(output)).toBe(true);
      expect(publisher.trySync(1000)).toBe(true);
    } finally { publisher.close(); }
  } finally { await pending; }
});
