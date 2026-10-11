#!/usr/bin/env bun
/**
 * Installed MCP consumer check: one zod for the tool schemas and the MCP SDK.
 *
 * The tool schemas bin/mcp.js builds and the MCP SDK that converts them to JSON
 * Schema and validates arguments must use one zod. 0.10.61-0.10.68 bundled zod
 * but left the SDK external, so tools/list failed (`ctx.deferred.push`) whenever
 * the consumer's SDK resolved an older zod than the producer's lock. The binary
 * must bundle both, or resolve both from the same installed zod package.
 *
 * Each case installs the selected archive into a private consumer whose root
 * pins zod (the declared floor exactly, or the declared range for the newest
 * version it admits), re-checks that layout with --frozen-lockfile, checks how
 * the binary obtains zod and the SDK, and runs initialize, tools/list and
 * tools/call over stdio in local mode. Only the package install uses the
 * network: the MCP child refuses and counts every fetch.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { parseConsumerArguments, stageConsumerArchive } from "./consumer-archive.js";

export type McpZodCase = "floor" | "latest";
export type McpZodResult = {
  case: McpZodCase; zodSpec: string; zodVersion: string; sdkVersion: string;
  binaryZodAndSdk: "bundled" | "installed"; tools: number; calls: number; fetchAttempts: 0;
};

const isZod = (path: string) => path === "zod" || path.startsWith("zod/");
const isSdk = (path: string) => path === "@modelcontextprotocol/sdk" || path.startsWith("@modelcontextprotocol/sdk/");

/** Whether the built binary imports zod and the MCP SDK from node_modules; both or neither. */
export function mcpBinaryDisposition(source: string): "bundled" | "installed" {
  const imports = new Bun.Transpiler({ loader: "js" }).scanImports(source.replace(/^#!.*\n/, "")).map(entry => entry.path);
  const zod = imports.some(isZod), sdk = imports.some(isSdk);
  if (zod !== sdk) throw new Error(`bin/mcp.js ${zod ? "imports zod but bundles" : "bundles zod but imports"} the MCP SDK; bundle both or resolve both from node_modules`);
  return zod ? "installed" : "bundled";
}

const LIMIT_BYTES = 512_000;
const PUBLISHER_EXEMPT = ["@hasna/skills", "@hasna/contracts", "@hasna/events", "@hasna/secrets"];

/** The declared floor of a caret range such as `^4.3.6`. */
export function declaredFloor(range: unknown): string {
  const match = typeof range === "string" ? /^\^(\d+\.\d+\.\d+)$/.exec(range) : null;
  if (!match) throw new Error(`Update the MCP consumer fixture for the declared zod range ${JSON.stringify(range)}`);
  return match[1]!;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Walk up from a resolved module file to the package root that owns it. */
function packageRoot(file: string, name: string): string {
  for (let directory = dirname(realpathSync(file)); dirname(directory) !== directory; directory = dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name) return directory;
  }
  throw new Error(`No ${name} package owns ${file}`);
}

async function bounded(stream: ReadableStream<Uint8Array>, onOverflow: () => void): Promise<string> {
  const decoder = new TextDecoder(); let bytes = 0, value = "";
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > LIMIT_BYTES) { onOverflow(); throw new Error("Installed MCP consumer output limit"); }
    value += decoder.decode(chunk, { stream: true });
  }
  return value + decoder.decode();
}

async function run(command: string[], cwd: string, env: Record<string, string>): Promise<string> {
  const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const stop = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  const timer = setTimeout(stop, 180_000);
  try {
    const [stdout, stderr, status] = await Promise.all([bounded(child.stdout, stop), bounded(child.stderr, stop), child.exited]);
    if (status !== 0) throw new Error(`MCP consumer command failed (${command[1] ?? command[0]}, exit ${status}):\n${stdout.slice(-8_000)}${stderr.slice(-8_000)}`);
    return stdout;
  } finally { clearTimeout(timer); stop(); }
}

/** Speak newline-delimited JSON-RPC to the installed stdio MCP. */
async function exerciseMcp(mcp: string, cwd: string, env: Record<string, string>, preload: string) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", preload, mcp, "--stdio"],
    { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const stop = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  const timer = setTimeout(stop, 60_000);
  const stderr = bounded(child.stderr, stop);
  void stderr.catch(stop);
  const reader = child.stdout.getReader(), decoder = new TextDecoder();
  let pending = "", outputBytes = 0;
  async function response(id: number, method: string, params: unknown): Promise<{ result?: any; error?: { code: number; message: string } }> {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    child.stdin.flush();
    while (true) {
      const newline = pending.indexOf("\n");
      if (newline >= 0) {
        const message = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (message.id === undefined) continue;
        assert.equal(message.id, id);
        return message;
      }
      const part = await reader.read();
      if (part.done) throw new Error(`MCP ended before its ${method} response: ${(await stderr.catch(() => "")).slice(-2_000)}`);
      outputBytes += part.value.byteLength;
      assert(outputBytes <= LIMIT_BYTES, "Installed MCP output limit");
      pending += decoder.decode(part.value, { stream: true });
    }
  }
  async function rpc(id: number, method: string, params: unknown): Promise<any> {
    const message = await response(id, method, params);
    if (message.error) throw new Error(`MCP ${method} failed (${message.error.code}): ${String(message.error.message).slice(0, 500)}`);
    return message.result;
  }
  try {
    const initialized = await rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "skills-mcp-zod-consumer", version: "1" } });
    assert.equal(initialized.serverInfo?.name, "skills");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    // tools/list converts every registered zod schema through the SDK.
    const listed = await rpc(2, "tools/list", {});
    assert(Array.isArray(listed.tools) && listed.tools.length > 0, "The installed MCP must list its tools");
    for (const tool of listed.tools) assert.equal(tool.inputSchema?.type, "object", `Tool ${tool.name} lacks an object input schema`);
    const listSkills = listed.tools.find((tool: any) => tool.name === "list_skills");
    assert.equal(listSkills?.inputSchema.properties?.limit?.type, "number");
    // The SDK validates arguments with the package's own schema objects.
    const accepted = await rpc(3, "tools/call", { name: "list_skills", arguments: { profile: "basic", limit: 1 } });
    assert.notEqual(accepted.isError, true, `list_skills refused valid arguments: ${JSON.stringify(accepted).slice(0, 500)}`);
    const page = JSON.parse(accepted.content[0].text);
    assert(Array.isArray(page.skills) && page.limit === 1, "list_skills returned an unexpected page");
    // A JSON-RPC error or an isError result both count as a refusal naming the field.
    const invalid = await response(4, "tools/call", { name: "list_skills", arguments: { limit: "one" } });
    const refusal = JSON.stringify(invalid.error ?? (invalid.result?.isError === true ? invalid.result : null));
    assert(refusal !== "null" && refusal.includes("limit"), `Invalid list_skills arguments were not refused by schema validation: ${JSON.stringify(invalid).slice(0, 500)}`);
    child.stdin.end();
    assert.equal(await child.exited, 0, "The installed MCP did not exit cleanly");
    await stderr;
    return { tools: listed.tools.length as number, calls: 2 };
  } finally { clearTimeout(timer); child.stdin.end(); stop(); await child.exited; reader.releaseLock(); }
}

/**
 * Install `archive` into a fresh consumer below `root` and prove the stdio MCP
 * works with the selected zod. `zodSpec` is an exact version or the package's
 * declared range. `root` must have no node_modules ancestor that could supply
 * zod or the SDK.
 */
export async function verifyInstalledMcpZod(options: {
  archive: string; root: string; testCase: McpZodCase; zodSpec: string; version: string;
}): Promise<McpZodResult> {
  const consumer = join(options.root, `mcp-zod-${options.testCase}`);
  // Both cases share one private install cache below the temporary root.
  const home = join(consumer, "home"), cache = join(options.root, "install-cache");
  await mkdir(home, { recursive: true, mode: 0o700 });
  const installEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: consumer, NO_COLOR: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", BUN_INSTALL_CACHE_DIR: cache,
    NPM_CONFIG_USERCONFIG: join(consumer, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(consumer, "global.npmrc") };
  const installConfig = join(consumer, "install.bunfig.toml");
  // Exact Hasna package names are publisher-exempt; unrelated packages retain the seven-day gate.
  await writeFile(installConfig, `[install]\nregistry = "https://registry.npmjs.org"\nminimumReleaseAge = 604800\nminimumReleaseAgeExcludes = ${JSON.stringify(PUBLISHER_EXEMPT)}\n`, { mode: 0o600 });
  // The root owns zod, as an application with its own frozen lock does; the
  // package and the SDK then share it whenever it satisfies both ranges.
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module",
    dependencies: { "@hasna/skills": `file:${options.archive}`, zod: options.zodSpec } }));
  await run([process.execPath, "--no-env-file", "install", "--ignore-scripts", `--config=${installConfig}`], consumer, installEnv);
  const lock = sha256(join(consumer, "bun.lock"));
  await run([process.execPath, "--no-env-file", "install", "--frozen-lockfile", "--ignore-scripts", `--config=${installConfig}`], consumer, installEnv);
  assert.equal(sha256(join(consumer, "bun.lock")), lock, "The frozen MCP consumer lock changed");

  const root = realpathSync(join(consumer, "node_modules/@hasna/skills"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@hasna/skills"); assert.equal(pkg.version, options.version);
  const mcp = realpathSync(join(root, pkg.bin["skills-mcp"]));
  assert(mcp.startsWith(root + sep), "The MCP binary must resolve inside the installed package");
  const sdkEntry = Bun.resolveSync("@modelcontextprotocol/sdk/server/mcp.js", dirname(mcp));
  const sdkRoot = packageRoot(sdkEntry, "@modelcontextprotocol/sdk");
  const packageZod = packageRoot(Bun.resolveSync("zod", dirname(mcp)), "zod");
  const zodVersion = JSON.parse(readFileSync(join(packageZod, "package.json"), "utf8")).version as string;
  const sdkVersion = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")).version as string;
  if (options.testCase === "floor") assert.equal(zodVersion, options.zodSpec, "The consumer did not resolve the declared zod floor");
  else assert(Bun.semver.satisfies(zodVersion, options.zodSpec), "The consumer resolved zod outside the declared range");
  const sdkZodRange = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")).dependencies?.zod;
  assert(typeof sdkZodRange === "string" && Bun.semver.satisfies(zodVersion, sdkZodRange), "The resolved zod is outside the MCP SDK's own range");

  const scratch = await mkdtemp(join(consumer, "run-"));
  const preload = join(scratch, "refuse-fetch.ts"), ledger = join(scratch, "fetch.jsonl");
  await writeFile(ledger, "", { mode: 0o600 });
  await writeFile(preload, `import {appendFileSync} from "node:fs";
globalThis.fetch=async(input)=>{appendFileSync(process.env.QA_FETCH_LEDGER,JSON.stringify({url:String(input).slice(0,200)})+"\\n");throw new Error("network refused by the MCP consumer fixture");};
`, { mode: 0o600 });
  const runHome = join(scratch, "home"); await mkdir(runHome, { mode: 0o700 });
  const env = { PATH: "/usr/bin:/bin", HOME: runHome, TMPDIR: scratch, NO_COLOR: "1", TERM: "dumb",
    HASNA_HOME: join(runHome, "hasna"), HASNA_CONFIG_HOME: join(runHome, "config"), HASNA_SKILLS_DIR: join(runHome, "data"),
    HASNA_STATION: "mcp-zod-consumer-no-owner", HASNA_SKILLS_LOCAL: "1", QA_FETCH_LEDGER: ledger };
  const exercised = await exerciseMcp(mcp, scratch, env, preload);
  assert.equal(readFileSync(ledger, "utf8"), "", "The installed MCP attempted a network request");
  // A working run can still depend on a lucky layout: check how the binary gets both.
  const disposition = mcpBinaryDisposition(readFileSync(mcp, "utf8"));
  if (disposition === "installed") {
    // The schemas come from the package's zod, conversion and validation from the SDK's.
    for (const subpath of ["zod/v4", "zod/v4-mini"]) {
      assert.equal(packageRoot(Bun.resolveSync(subpath, dirname(sdkEntry)), "zod"), packageZod,
        `The MCP SDK resolves ${subpath} from a different zod package than the package's tool schemas`);
    }
  }
  return { case: options.testCase, zodSpec: options.zodSpec, zodVersion, sdkVersion, binaryZodAndSdk: disposition,
    tools: exercised.tools, calls: exercised.calls, fetchAttempts: 0 };
}

/**
 * Run both zod cases in a private temporary root: the declared floor exactly
 * and the newest version the declared range admits.
 */
export async function verifyInstalledMcpZodCases(archive: string, metadata: {
  version: string; dependencies?: Record<string, string>;
}): Promise<McpZodResult[]> {
  const range = metadata.dependencies?.zod;
  const floor = declaredFloor(range);
  const root = realpathSync(await mkdtemp(join(tmpdir(), "skills-consumer-mcp-")));
  try {
    for (let parent = dirname(root); ; parent = dirname(parent)) {
      for (const name of ["zod", "@modelcontextprotocol/sdk"]) {
        assert(!existsSync(join(parent, "node_modules", name)), `The MCP consumer fixture has an ambient ${name} ancestor`);
      }
      if (dirname(parent) === parent) break;
    }
    const results: McpZodResult[] = [];
    for (const [testCase, zodSpec] of [["floor", floor], ["latest", range!]] as const) {
      results.push(await verifyInstalledMcpZod({ archive, root, testCase, zodSpec, version: metadata.version }));
    }
    return results;
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const options = parseConsumerArguments(process.argv.slice(2));
  assert.equal(options.receipt, undefined, "verify:consumer-mcp writes no receipt; use verify:consumer-types for release receipts");
  const workspace = realpathSync(await mkdtemp(join(tmpdir(), "skills-consumer-mcp-")));
  try {
    const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    let source = options.archive;
    if (!source) {
      const packed = JSON.parse(await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", workspace], root,
        { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: workspace, TMPDIR: workspace,
          NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc") }));
      assert(Array.isArray(packed) && packed.length === 1 && packed[0]?.filename === `hasna-skills-${metadata.version}.tgz`, "Unexpected Skills package archive");
      source = join(workspace, packed[0].filename);
    }
    const archive = await stageConsumerArchive(source, workspace, options.sha256);
    for (const result of await verifyInstalledMcpZodCases(archive.installedFrom, metadata)) {
      console.log(JSON.stringify({ installedMcpZod: result, archiveSha256: archive.sha256 }));
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
