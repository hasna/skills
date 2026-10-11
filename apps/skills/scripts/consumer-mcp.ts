#!/usr/bin/env bun
/**
 * Installed MCP consumer check: tool schemas must survive any installed zod.
 *
 * bin/mcp.js bundles everything except the MCP SDK, zod included, and the SDK
 * may resolve a different zod than the one that built the tool schemas.
 * 0.10.61-0.10.68 let the SDK convert those schemas for tools/list, which
 * failed (`ctx.deferred.push`) or advertised degraded schemas whenever the
 * SDK's zod was older. tools/list now converts with the bundled zod
 * (src/mcp/package-tool-list.ts); the SDK still validates tool arguments.
 *
 * Each case installs the selected archive into a private consumer and re-checks
 * that layout from its lock:
 * - bun, root zod pinned to the declared floor exactly;
 * - bun, root zod at the declared range (the newest version it admits);
 * - npm, root zod pinned below the floor (default 4.3.5), where npm hoists the
 *   SDK onto that zod and nests a newer one under the package.
 * Each case runs initialize, tools/list and a valid and an invalid tools/call
 * over stdio in local mode, and every case must list byte-identical tools. Only
 * the package install uses the network: the MCP child refuses and counts every
 * fetch. The tested zod range and version come from the archive itself.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { parseConsumerArguments, stageConsumerArchive } from "./consumer-archive.js";

export type McpZodCase = { label: string; installer: "bun" | "npm"; zodSpec: string };
export type McpZodResult = {
  case: string; installer: "bun" | "npm"; zodSpec: string; rootZod: string; sdkVersion: string; sdkZod: string;
  tools: number; toolsSha256: string; calls: number; fetchAttempts: 0;
};

const LIMIT_BYTES = 1_024_000;
const PUBLISHER_EXEMPT = ["@hasna/skills", "@hasna/contracts", "@hasna/events", "@hasna/secrets"];
const DEFAULT_NPM_SPLIT_ZOD = ["4.3.5"];
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), "bun", "bun:sqlite"]);
const isSdk = (path: string) => path === "@modelcontextprotocol/sdk" || path.startsWith("@modelcontextprotocol/sdk/");

/** bin/mcp.js bundles everything except the MCP SDK: it must import the SDK and nothing else. */
export function assertMcpBinarySurface(source: string): void {
  const imports = new Bun.Transpiler({ loader: "js" }).scanImports(source.replace(/^#!.*\n/, ""))
    .map(entry => entry.path).filter(path => !builtins.has(path));
  const foreign = [...new Set(imports.filter(path => !isSdk(path)))];
  if (foreign.length) throw new Error(`bin/mcp.js must bundle everything except the MCP SDK; it imports ${foreign.join(", ")}`);
  if (!imports.some(isSdk)) throw new Error("bin/mcp.js must load the MCP SDK from node_modules, not bundle it");
}

/** The declared floor of a caret range such as `^4.3.6`. */
export function declaredFloor(range: unknown): string {
  const match = typeof range === "string" ? /^\^(\d+\.\d+\.\d+)$/.exec(range) : null;
  if (!match) throw new Error(`Update the MCP consumer fixture for the declared zod range ${JSON.stringify(range)}`);
  return match[1]!;
}

/** The cases for a declared zod range: bun at the floor and at the range, npm split layouts below it. */
export function mcpZodCases(range: unknown, npmSplitZod: readonly string[] = DEFAULT_NPM_SPLIT_ZOD): McpZodCase[] {
  const floor = declaredFloor(range);
  for (const version of npmSplitZod) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || Bun.semver.satisfies(version, range as string)) {
      throw new Error(`An npm split case needs an exact zod outside the declared range ${range}: ${version}`);
    }
  }
  return [
    { label: "bun-floor", installer: "bun", zodSpec: floor },
    { label: "bun-latest", installer: "bun", zodSpec: range as string },
    ...npmSplitZod.map(version => ({ label: `npm-split-${version}`, installer: "npm" as const, zodSpec: version })),
  ];
}

/** Read package.json from inside a packed archive without extracting it. */
export function readArchiveMetadata(archive: string): { name: string; version: string; dependencies?: Record<string, string>; bin?: Record<string, string> } {
  const result = Bun.spawnSync(["tar", "-xzOf", archive, "package/package.json"],
    { env: { PATH: "/usr/bin:/bin" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`Cannot read package/package.json from the archive (tar exit ${result.exitCode})`);
  const metadata = JSON.parse(result.stdout.toString());
  assert.equal(metadata.name, "@hasna/skills", "The archive is not @hasna/skills");
  return metadata;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Walk up from a resolved module file to the package root that owns it. */
function packageRoot(file: string, name: string): string {
  for (let directory = dirname(realpathSync(file)); dirname(directory) !== directory; directory = dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name) return directory;
  }
  throw new Error(`No ${name} package owns ${file}`);
}

const versionOf = (directory: string) => JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version as string;

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
  const timer = setTimeout(stop, 300_000);
  try {
    const [stdout, stderr, status] = await Promise.all([bounded(child.stdout, stop), bounded(child.stderr, stop), child.exited]);
    if (status !== 0) throw new Error(`MCP consumer command failed (${command.slice(0, 3).join(" ")}, exit ${status}):\n${stdout.slice(-8_000)}${stderr.slice(-8_000)}`);
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
    // tools/list converts every registered tool schema to JSON Schema.
    const listed = await rpc(2, "tools/list", {});
    assert(Array.isArray(listed.tools) && listed.tools.length > 0, "The installed MCP must list its tools");
    for (const tool of listed.tools) assert.equal(tool.inputSchema?.type, "object", `Tool ${tool.name} lacks an object input schema`);
    const listSkills = listed.tools.find((tool: any) => tool.name === "list_skills");
    assert.equal(listSkills?.inputSchema.properties?.limit?.type, "number");
    // The SDK validates arguments against the package's schema objects.
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
    return { tools: listed.tools as unknown[], calls: 2 };
  } finally { clearTimeout(timer); child.stdin.end(); stop(); await child.exited; reader.releaseLock(); }
}

/** Install with bun, then prove the lock reproduces with --frozen-lockfile. */
async function installWithBun(consumer: string, root: string, home: string): Promise<void> {
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: consumer, NO_COLOR: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", BUN_INSTALL_CACHE_DIR: join(root, "bun-cache"),
    NPM_CONFIG_USERCONFIG: join(consumer, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(consumer, "global.npmrc") };
  const config = join(consumer, "install.bunfig.toml");
  // Exact Hasna package names are publisher-exempt; unrelated packages retain the seven-day gate.
  await writeFile(config, `[install]\nregistry = "https://registry.npmjs.org"\nminimumReleaseAge = 604800\nminimumReleaseAgeExcludes = ${JSON.stringify(PUBLISHER_EXEMPT)}\n`, { mode: 0o600 });
  await run([process.execPath, "--no-env-file", "install", "--ignore-scripts", `--config=${config}`], consumer, env);
  const lock = sha256(readFileSync(join(consumer, "bun.lock")));
  await run([process.execPath, "--no-env-file", "install", "--frozen-lockfile", "--ignore-scripts", `--config=${config}`], consumer, env);
  assert.equal(sha256(readFileSync(join(consumer, "bun.lock"))), lock, "The frozen MCP consumer lock changed");
}

/** Resolve a lock with npm (seven-day window, Hasna exempt), then install exactly that lock with `npm ci`. */
async function installWithNpm(consumer: string, root: string, home: string): Promise<void> {
  const npm = Bun.which("npm");
  assert(npm, "The npm split-layout case needs npm on PATH");
  const node = Bun.which("node");
  const env = { PATH: [...new Set([dirname(npm), ...(node ? [dirname(node)] : []), dirname(process.execPath), "/usr/bin", "/bin"])].join(":"),
    HOME: home, TMPDIR: consumer, NO_COLOR: "1", NPM_CONFIG_CACHE: join(root, "npm-cache"),
    NPM_CONFIG_USERCONFIG: join(consumer, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(consumer, "global.npmrc"),
    NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  await writeFile(env.NPM_CONFIG_USERCONFIG, "registry=https://registry.npmjs.org/\n", { mode: 0o600 });
  await writeFile(env.NPM_CONFIG_GLOBALCONFIG, "", { mode: 0o600 });
  const age = ["--min-release-age=7", ...PUBLISHER_EXEMPT.map(name => `--min-release-age-exclude=${name}`)];
  await run([npm, "install", "--package-lock-only", "--ignore-scripts", ...age], consumer, env);
  const lock = sha256(readFileSync(join(consumer, "package-lock.json")));
  await run([npm, "ci", "--ignore-scripts", ...age], consumer, env);
  assert.equal(sha256(readFileSync(join(consumer, "package-lock.json"))), lock, "npm ci changed the MCP consumer lock");
}

/**
 * Install `archive` into a fresh consumer below `root` and prove the stdio MCP
 * lists and validates its tools there. `root` must have no node_modules
 * ancestor that could supply zod or the SDK.
 */
export async function verifyInstalledMcpZod(options: {
  archive: string; root: string; testCase: McpZodCase; version: string; range: string;
}): Promise<McpZodResult & { toolList: unknown[] }> {
  const { testCase } = options;
  const consumer = join(options.root, `mcp-zod-${testCase.label}`);
  const home = join(consumer, "home");
  await mkdir(home, { recursive: true, mode: 0o700 });
  // The root owns zod, as an application with its own frozen lock does.
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module",
    dependencies: { "@hasna/skills": `file:${options.archive}`, zod: testCase.zodSpec } }));
  if (testCase.installer === "bun") await installWithBun(consumer, options.root, home);
  else await installWithNpm(consumer, options.root, home);

  const installed = realpathSync(join(consumer, "node_modules/@hasna/skills"));
  const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(pkg.name, "@hasna/skills"); assert.equal(pkg.version, options.version);
  const mcp = realpathSync(join(installed, pkg.bin["skills-mcp"]));
  assert(mcp.startsWith(installed + sep), "The MCP binary must resolve inside the installed package");
  assertMcpBinarySurface(readFileSync(mcp, "utf8"));
  const sdkEntry = Bun.resolveSync("@modelcontextprotocol/sdk/server/mcp.js", dirname(mcp));
  const sdkRoot = packageRoot(sdkEntry, "@modelcontextprotocol/sdk");
  const sdkZodRoot = packageRoot(Bun.resolveSync("zod/v4-mini", dirname(sdkEntry)), "zod");
  const rootZod = versionOf(join(consumer, "node_modules/zod"));
  const sdkZod = versionOf(sdkZodRoot);
  const sdkZodRange = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")).dependencies?.zod;
  assert(typeof sdkZodRange === "string" && Bun.semver.satisfies(sdkZod, sdkZodRange), "The SDK's zod is outside the SDK's own range");
  if (testCase.label === "bun-floor") assert.equal(rootZod, testCase.zodSpec, "The consumer did not resolve the declared zod floor");
  else if (testCase.installer === "bun") assert(Bun.semver.satisfies(rootZod, options.range), "The consumer resolved zod outside the declared range");
  else {
    // The case only means something if the SDK really runs on the older root zod.
    assert.equal(rootZod, testCase.zodSpec, "npm did not keep the pinned root zod");
    assert.equal(sdkZod, testCase.zodSpec, "npm did not hoist the SDK onto the pinned root zod; this case no longer tests a split layout");
  }

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
  return { case: testCase.label, installer: testCase.installer, zodSpec: testCase.zodSpec, rootZod, sdkVersion: versionOf(sdkRoot), sdkZod,
    tools: exercised.tools.length, toolsSha256: sha256(JSON.stringify(exercised.tools)), calls: exercised.calls, fetchAttempts: 0, toolList: exercised.tools };
}

/**
 * Run every case for the archive in a private temporary root, reading the
 * tested zod range and version from the archive. All cases must list the same
 * tools with the same schemas.
 */
export async function verifyInstalledMcpZodCases(archive: string, npmSplitZod: readonly string[] = DEFAULT_NPM_SPLIT_ZOD): Promise<McpZodResult[]> {
  const metadata = readArchiveMetadata(archive);
  const range = metadata.dependencies?.zod;
  const cases = mcpZodCases(range, npmSplitZod);
  const root = realpathSync(await mkdtemp(join(tmpdir(), "skills-consumer-mcp-")));
  try {
    for (let parent = dirname(root); ; parent = dirname(parent)) {
      for (const name of ["zod", "@modelcontextprotocol/sdk"]) {
        assert(!existsSync(join(parent, "node_modules", name)), `The MCP consumer fixture has an ambient ${name} ancestor`);
      }
      if (dirname(parent) === parent) break;
    }
    const results: Array<McpZodResult & { toolList: unknown[] }> = [];
    for (const testCase of cases) {
      results.push(await verifyInstalledMcpZod({ archive, root, testCase, version: metadata.version, range: range! }));
    }
    // A degraded schema in any layout shows up as a difference from the others.
    for (const result of results.slice(1)) {
      assert.deepEqual(result.toolList, results[0]!.toolList,
        `${result.case} (SDK ${result.sdkVersion}) lists different tools or schemas than ${results[0]!.case} (SDK ${results[0]!.sdkVersion})`);
    }
    return results.map(({ toolList: _toolList, ...result }) => result);
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  // --npm-split-zod <exact version> (repeatable) replaces the default npm split case.
  const argv = process.argv.slice(2), npmSplitZod: string[] = [];
  for (let index = argv.indexOf("--npm-split-zod"); index >= 0; index = argv.indexOf("--npm-split-zod")) {
    const value = argv[index + 1];
    assert(value && !value.startsWith("--"), "--npm-split-zod needs an exact zod version");
    npmSplitZod.push(value); argv.splice(index, 2);
  }
  const options = parseConsumerArguments(argv);
  assert.equal(options.receipt, undefined, "verify:consumer-mcp writes no receipt; use verify:consumer-types for release receipts");
  const workspace = realpathSync(await mkdtemp(join(tmpdir(), "skills-consumer-mcp-archive-")));
  try {
    let source = options.archive;
    if (!source) {
      const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      const packed = JSON.parse(await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", workspace], root,
        { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: workspace, TMPDIR: workspace,
          NPM_CONFIG_USERCONFIG: join(workspace, "user.npmrc"), NPM_CONFIG_GLOBALCONFIG: join(workspace, "global.npmrc") }));
      assert(Array.isArray(packed) && packed.length === 1 && packed[0]?.filename === `hasna-skills-${metadata.version}.tgz`, "Unexpected Skills package archive");
      source = join(workspace, packed[0].filename);
    }
    const archive = await stageConsumerArchive(source, workspace, options.sha256);
    const results = await verifyInstalledMcpZodCases(archive.installedFrom, npmSplitZod.length ? npmSplitZod : DEFAULT_NPM_SPLIT_ZOD);
    for (const result of results) console.log(JSON.stringify({ installedMcpZod: result, archiveSha256: archive.sha256 }));
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
