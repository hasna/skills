#!/usr/bin/env bun
/** CI-only native CLI integration; deliberately outside unit-test discovery. */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { userInfo } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { scanInputExposures, stagedScanExitCode } from "@hasna/secrets/scanner";

const VERSION = "2.1.302";
const PACKAGE = "@anthropic-ai/claude-code-linux-x64";
const ARCHIVE = `https://registry.npmjs.org/${PACKAGE}/-/claude-code-linux-x64-${VERSION}.tgz`;
const SHA1 = "2ddf60cd10f29b7d44e70fb6fa3cbcebcb569202";
const INTEGRITY = "sha512-+d4RUq3E3K+3/J4MysB3z4QXA4rkDNt70VYpTLE6kJCnUe/Z6SB8VJsVJG/NV4bECrvkxkLHjXk+vrgBstfZkw==";
const ORIGIN = "http://127.0.0.1:9";
const OUTPUT_LIMIT = 1024 * 1024;
// Publicly attested names only: this controls diagnostics, never admission.
// https://github.com/anthropics/claude-code/issues/62634
// https://github.com/anthropics/claude-code/issues/75419
// https://github.com/anthropics/claude-code/issues/87534
const SAFE_NATIVE_FIELDS = new Set(["numStartups", "installMethod", "autoUpdates", "userID", "firstStartTime",
  "hasCompletedOnboarding", "lastOnboardingVersion", "cachedStatsigGates", "cachedGrowthBookFeatures", "projects",
  "migrationVersion", "opusProMigrationComplete", "sonnet1m45MigrationComplete", "seenNotifications",
  "unpinOpus47LaunchEffort", "cachedExperimentFeatures", "cachedExtraUsageDisabledReason", "skillUsage",
  "machineID", "hasResetAutoModeOptInForDefaultOffer"]);
// A candidate is diagnostic vocabulary only when the exact verified artifact
// contains it and the independent synthetic config adds that same literal.
const STARTUP_VERSION_FIELDS = ["firstStartVersion", "firstStartClaudeVersion", "firstStartClaudeCodeVersion"] as const;
let stage = "admission";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const save = (file: string, bytes: string | Uint8Array) => {
  const data = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  writeFileSync(file, data, { flag: "wx", mode: 0o600 });
  assert.equal(sha256(readFileSync(file)), sha256(data));
};

function scanned(bytes: Uint8Array) {
  const result = scanInputExposures({ buffer: Buffer.from(bytes), maxBytes: OUTPUT_LIMIT });
  const status = stagedScanExitCode(result);
  const complete = result.stats.filesScanned === 1 && result.stats.filesSkipped === 0
    && result.stats.errors.length === 0 && !result.truncated && result.stats.bytesScanned === bytes.length;
  return { status, complete, bytes: result.stats.bytesScanned, findings: result.findingCount };
}

async function run(command: string[], cwd: string, env: Record<string, string>, limit = OUTPUT_LIMIT, timeoutMs = 30_000) {
  const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const stop = () => { if (child.exitCode === null) child.kill("SIGKILL"); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  async function collect(stream: ReadableStream<Uint8Array>) {
    const chunks: Uint8Array[] = []; let length = 0;
    for await (const chunk of stream) { length += chunk.byteLength; if (length > limit) { stop(); throw Error("OUTPUT_BOUND"); } chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  try {
    const [stdout, stderr, exit] = await Promise.all([collect(child.stdout), collect(child.stderr), child.exited]);
    return { stdout, stderr, exit, timedOut };
  } finally { clearTimeout(timer); stop(); }
}

function fixture(root: string, name: string, binary: string, seeded = true, disableNonessentialTraffic = true) {
  const directory = join(root, name);
  mkdirSync(directory, { mode: 0o700 });
  for (const part of ["home", "config", "cache", "state", "tmp", "cwd", "bin", "records"])
    mkdirSync(join(directory, part), { mode: 0o700 });
  const config = join(directory, seeded ? "config" : "home", ".claude.json");
  const original = seeded ? Buffer.from(JSON.stringify({ fixturePreserved: { value: "synthetic-only" },
    mcpServers: { other: { type: "stdio", command: "fixture-other", args: [] } } })) : null;
  if (original !== null) save(config, original);
  else assert(!existsSync(config));
  save(join(directory, "original.private.json"), original ?? "null");
  assert(original === null ? !existsSync(config) : readFileSync(config).equals(original));
  const env = { HOME: join(directory, "home"), USERPROFILE: join(directory, "home"),
    ...(seeded ? { CLAUDE_CONFIG_DIR: join(directory, "config") } : {}), XDG_CONFIG_HOME: join(directory, "config"),
    XDG_CACHE_HOME: join(directory, "cache"), XDG_STATE_HOME: join(directory, "state"),
    TMPDIR: join(directory, "tmp"), PATH: `${join(directory, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HASNA_HOME: join(directory, "home", ".hasna"), HASNA_CONFIG_HOME: join(directory, "home", "config"),
    HASNA_PROFILE: "claude-probe", HASNA_SKILLS_API_URL: ORIGIN, SKILLS_API_URL: ORIGIN,
    HASNA_STATION: "claude-mcp-probe-no-keychain", NO_COLOR: "1", TERM: "dumb",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", ...(disableNonessentialTraffic ? { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } : {}),
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", DISABLE_AUTOUPDATER: "1", DISABLE_UPDATES: "1" };
  // This wrapper can launch only this verified binary's version/add commands.
  // Native stdout/stderr stay private even when the Skills adapter refuses.
  const wrapper = `#!${process.execPath}\n` + `
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const version = args.length === 1 && args[0] === "--version";
if (!version) {
  assert.deepEqual(args.slice(0, 4), ["mcp", "add", "-s", "user"]);
  let i = 4; const selected = {};
  while (args[i] === "--env") { const item = args[i + 1]; const split = item.indexOf("="); assert(split > 0); selected[item.slice(0, split)] = item.slice(split + 1); i += 2; }
  assert.deepEqual(args.slice(i), ["--transport", "stdio", "skills", "--", "skills-mcp", "--stdio"]);
  assert.deepEqual(selected, { HASNA_PROFILE: "claude-probe", HASNA_HOME: process.env.HASNA_HOME,
    HASNA_CONFIG_HOME: process.env.HASNA_CONFIG_HOME, HASNA_SKILLS_API_URL: ${JSON.stringify(ORIGIN)}, SKILLS_API_URL: ${JSON.stringify(ORIGIN)} });
}
const kind = version ? "version" : "add";
const child = Bun.spawn([${JSON.stringify(binary)}, ...args], { cwd: process.cwd(), env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; if (child.exitCode === null) child.kill("SIGKILL"); }, 15000);
try {
  const collect = async (stream) => { const chunks = []; let length = 0;
    for await (const chunk of stream) { length += chunk.byteLength; if (length > ${OUTPUT_LIMIT}) { if (child.exitCode === null) child.kill("SIGKILL"); throw Error("NATIVE_OUTPUT_BOUND"); } chunks.push(chunk); }
    return Buffer.concat(chunks); };
  const [stdout, stderr, exit] = await Promise.all([collect(child.stdout), collect(child.stderr), child.exited]);
  const base = ${JSON.stringify(join(directory, "records"))} + "/" + kind;
  const save = (file, value) => { writeFileSync(file, value, { flag: "wx", mode: 0o600 }); assert(Buffer.from(readFileSync(file)).equals(Buffer.from(value))); };
  save(base + ".stdout", Buffer.from(stdout)); save(base + ".stderr", Buffer.from(stderr));
  save(base + ".json", JSON.stringify({ exit, timedOut }));
  process.stdout.write(Buffer.from(stdout)); process.stderr.write(Buffer.from(stderr)); process.exitCode = exit;
} finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); }
`;
  save(join(directory, "bin", "claude"), wrapper); chmodSync(join(directory, "bin", "claude"), 0o700);
  return { directory, config, original, env, wrapper: join(directory, "bin", "claude") };
}

function capture(file: string, bytes: Uint8Array) {
  save(file, bytes); const scan = scanned(readFileSync(file));
  assert(scan.status === 0 && scan.complete); return scan;
}

function configSummary(file: string, original: Buffer | null, nativeVocabulary: Set<string>) {
  const bytes = readFileSync(file); const scan = scanned(bytes); assert(scan.status === 0 && scan.complete);
  const before = original === null ? {} : JSON.parse(original.toString()), after = JSON.parse(bytes.toString());
  const selectors = after.mcpServers?.skills?.env ?? {};
  const outside = (data: Record<string, unknown>) => {
    const result = { ...data }, servers = { ...((data.mcpServers ?? {}) as object) } as Record<string, unknown>;
    delete servers.skills; result.mcpServers = servers; return result;
  };
  // Report only this fixed vocabulary of field names and primitive type labels.
  // Unknown native keys remain withheld even after a clean credential scan.
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => key !== "mcpServers" && !isDeepStrictEqual(before[key], after[key]));
  const type = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const safeChanges = changes.map(key => ({ field: SAFE_NATIVE_FIELDS.has(key) || (nativeVocabulary.has(key) && !Object.hasOwn(before, key)) ? key : "withheld",
    before: type(before[key]), after: type(after[key]) }));
  const plainObject = (value: unknown): value is Record<string, unknown> => value !== null
    && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const utcTimestamp = (value: unknown) => typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const bootstrapShape = {
    firstStartTimeUtcTimestamp: utcTimestamp(after.firstStartTime),
    startupVersionMatchesPinned: STARTUP_VERSION_FIELDS.some(key => nativeVocabulary.has(key) && after[key] === VERSION),
    userIdCanonicalUuidV4: typeof after.userID === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(after.userID),
    userIdHex64: typeof after.userID === "string" && /^[0-9a-f]{64}$/i.test(after.userID),
    machineIdHex64: typeof after.machineID === "string" && /^[0-9a-f]{64}$/i.test(after.machineID),
    opusProMigrationCompleteTrue: after.opusProMigrationComplete === true,
    sonnet1m45MigrationCompleteTrue: after.sonnet1m45MigrationComplete === true,
    seenNotificationsPlainObject: plainObject(after.seenNotifications),
    seenNotificationsEmpty: plainObject(after.seenNotifications) && Object.keys(after.seenNotifications).length === 0,
    hasResetAutoModeOptInForDefaultOfferTrue: after.hasResetAutoModeOptInForDefaultOffer === true,
    migrationVersionNonnegativeInteger: Number.isSafeInteger(after.migrationVersion) && after.migrationVersion >= 0,
  };
  return { scan, bootstrapShape, unrelatedConfigPreserved: isDeepStrictEqual(outside(before), outside(after)),
    preimageAbsent: original === null,
    seededConfigPreserved: isDeepStrictEqual(before.fixturePreserved, after.fixturePreserved)
      && isDeepStrictEqual(before.mcpServers?.other, after.mcpServers?.other),
    changedTopLevelFields: safeChanges,
    selectedProfilePreserved: selectors.HASNA_PROFILE === "claude-probe",
    selectedOriginPreserved: selectors.HASNA_SKILLS_API_URL === ORIGIN && selectors.SKILLS_API_URL === ORIGIN,
    stdioPreserved: after.mcpServers?.skills?.type === "stdio" && after.mcpServers.skills.command === "skills-mcp"
      && isDeepStrictEqual(after.mcpServers.skills.args, ["--stdio"]) };
}

async function exercise(root: string, binary: string, skills: string, outerNamespace: string, uid: number) {
  stage = "isolation-uid";
  assert(process.getuid?.() === uid && process.geteuid?.() === uid && uid !== 0);
  stage = "isolation-namespace-binding";
  assert.notEqual(readlinkSync("/proc/self/ns/net"), outerNamespace);
  stage = "isolation-interface-view";
  const interfaces = readFileSync("/proc/self/net/dev", "utf8").trim().split("\n").slice(2)
    .map(line => line.split(":")[0]!.trim());
  assert.deepEqual(interfaces, ["lo"]);
  stage = "isolation-routes";
  assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
  stage = "isolation-effective-capabilities";
  assert.equal(BigInt("0x" + /^CapEff:\s*([0-9a-f]+)$/im.exec(readFileSync("/proc/self/status", "utf8"))![1]), 0n);
  // The parent has verified the exact package archive before this child starts.
  // Literal membership emits no artifact bytes or dynamic property names.
  const nativeBytes = readFileSync(binary);
  const nativeVocabulary = new Set(STARTUP_VERSION_FIELDS.filter(name => nativeBytes.includes(Buffer.from(name))));
  const results = [];
  for (const kind of ["direct", "skills", "first-run-direct", "first-run-skills", "default-traffic-direct", "default-traffic-skills"] as const) {
    stage = `case-${kind}`;
    const f = fixture(root, kind, binary, kind === "direct" || kind === "skills", !kind.startsWith("default-traffic-"));
    const selected = ["HASNA_PROFILE", "HASNA_HOME", "HASNA_CONFIG_HOME", "HASNA_SKILLS_API_URL", "SKILLS_API_URL"] as const;
    const args = ["mcp", "add", "-s", "user", ...selected.flatMap(key => ["--env", `${key}=${f.env[key]}`]),
      "--transport", "stdio", "skills", "--", "skills-mcp", "--stdio"];
    const command = kind.endsWith("direct") ? [f.wrapper, ...args]
      : [process.execPath, "--no-env-file", "--no-install", skills, "--profile", "claude-probe", "setup", "agents", "--json"];
    const result = await run(command, join(f.directory, "cwd"), f.env);
    const stdoutScan = capture(join(f.directory, "command.stdout"), result.stdout);
    const stderrScan = capture(join(f.directory, "command.stderr"), result.stderr);
    stage = `scan-${kind}`;
    const nativeStdout = readFileSync(join(f.directory, "records", "add.stdout"));
    const nativeStderr = readFileSync(join(f.directory, "records", "add.stderr"));
    const nativeScans = [scanned(nativeStdout), scanned(nativeStderr)];
    assert(nativeScans.every(value => value.status === 0 && value.complete));
    const native = JSON.parse(readFileSync(join(f.directory, "records", "add.json"), "utf8"));
    const config = configSummary(f.config, f.original, nativeVocabulary);
    const diagnostic = nativeStderr.toString().replace(/\x1b\[[0-9;]*m/g, "").trim();
    results.push({ kind, nonessentialTrafficDisabled: Object.hasOwn(f.env, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"), commandExit: result.exit, commandTimedOut: result.timedOut,
      nativeExit: native.exit, nativeTimedOut: native.timedOut, stdoutScan, stderrScan, nativeScans, config,
      nativeDiagnostic: /^(?:Error: )?MCP server skills already exists in user config$/.test(diagnostic)
        ? "DUPLICATE_USER_SERVER" : native.exit === 0 ? "NATIVE_SUCCESS" : "OTHER_NATIVE_REFUSAL" });
  }
  stage = "version-binding";
  const f = fixture(root, "version", binary);
  const version = await run([f.wrapper, "--version"], join(f.directory, "cwd"), f.env);
  capture(join(f.directory, "version.stdout"), version.stdout); capture(join(f.directory, "version.stderr"), version.stderr);
  assert(version.exit === 0 && !version.timedOut && /^2\.1\.302(?: \(Claude Code\))?\s*$/.test(version.stdout.toString()));
  const accepted = results.every(item => item.commandExit === 0 && item.nativeExit === 0 && !item.commandTimedOut && !item.nativeTimedOut
    && item.config.seededConfigPreserved && item.config.selectedProfilePreserved && item.config.selectedOriginPreserved && item.config.stdioPreserved);
  console.log(JSON.stringify({ schema: "skills.claude-mcp-probe.v1", collection: "complete", accepted,
    package: PACKAGE, version: VERSION, isolatedNetwork: true, unprivileged: true, results }));
  process.exitCode = accepted ? 0 : 1;
}

async function main() {
  assert(process.platform === "linux" && process.arch === "x64");
  if (process.argv[2] === "--exercise") {
    assert(process.argv.length === 8);
    return exercise(process.argv[3]!, process.argv[4]!, process.argv[5]!, process.argv[6]!, Number(process.argv[7]));
  }
  assert(process.argv.length === 2 && process.env.GITHUB_ACTIONS === "true");
  const runnerTemp = process.env.RUNNER_TEMP!;
  assert(isAbsolute(runnerTemp) && existsSync(runnerTemp));
  const root = mkdtempSync(join(runnerTemp, "skills-claude-native-")); chmodSync(root, 0o700);
  stage = "registry-binding";
  const metadataResponse = await fetch(`https://registry.npmjs.org/${PACKAGE}/${VERSION}`, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  assert(metadataResponse.ok); const metadata = await metadataResponse.json() as any;
  assert(metadata.name === PACKAGE && metadata.version === VERSION && metadata.dist.integrity === INTEGRITY
    && metadata.dist.shasum === SHA1 && metadata.dist.tarball === ARCHIVE
    && isDeepStrictEqual(metadata.os, ["linux"]) && isDeepStrictEqual(metadata.cpu, ["x64"]) && isDeepStrictEqual(metadata.libc, ["glibc"]));
  stage = "archive-integrity";
  const response = await fetch(ARCHIVE, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  assert(response.ok && response.body);
  const chunks: Uint8Array[] = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.byteLength; assert(length <= 128 * 1024 * 1024); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  assert.equal(createHash("sha1").update(bytes).digest("hex"), SHA1);
  assert.equal("sha512-" + createHash("sha512").update(bytes).digest("base64"), INTEGRITY);
  const archive = join(root, "claude.tgz"); save(archive, bytes);
  stage = "archive-extraction";
  const cleanEnv = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
  const manifest = await run(["/usr/bin/tar", "-xzOf", archive, "package/package.json"], root, cleanEnv);
  assert(manifest.exit === 0 && !manifest.timedOut);
  const identity = JSON.parse(manifest.stdout.toString()); assert(identity.name === PACKAGE && identity.version === VERSION);
  const executable = await run(["/usr/bin/tar", "-xzOf", archive, "package/claude"], root, cleanEnv, 512 * 1024 * 1024);
  assert(executable.exit === 0 && !executable.timedOut && executable.stdout.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])));
  const binary = join(root, "claude-native"); save(binary, executable.stdout); chmodSync(binary, 0o700);
  stage = "isolation-launch";
  const uid = process.getuid!(), user = userInfo().username;
  assert(uid !== 0 && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(user));
  const skills = resolve(import.meta.dir, "../bin/index.js"); assert(existsSync(skills));
  // Network isolation is mandatory; failure never falls back to host execution.
  const child = await run(["/usr/bin/sudo", "-n", "/usr/bin/unshare", "--net", "--", "/usr/sbin/runuser", "-u", user, "--",
    "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "BUN_RUNTIME_TRANSPILER_CACHE_PATH=0",
    process.execPath, "--no-env-file", "--no-install", import.meta.path, "--exercise", root, binary, skills, readlinkSync("/proc/self/ns/net"), String(uid)],
    root, cleanEnv, OUTPUT_LIMIT, 90_000);
  const stdoutScan = capture(join(root, "collector.stdout"), child.stdout), stderrScan = capture(join(root, "collector.stderr"), child.stderr);
  assert(!child.timedOut && [0, 1, 2].includes(child.exit));
  const result = JSON.parse(child.stdout.toString()); assert(result.schema === "skills.claude-mcp-probe.v1"
    && ["complete", "failed"].includes(result.collection));
  console.log(JSON.stringify({ ...result, collectionExit: child.exit, collectorStdoutScan: stdoutScan, collectorStderrScan: stderrScan }));
  process.exitCode = child.exit;
}

main().catch(() => {
  console.log(JSON.stringify({ schema: "skills.claude-mcp-probe.v1", collection: "failed", stage, accepted: false }));
  process.exitCode = 2;
});
