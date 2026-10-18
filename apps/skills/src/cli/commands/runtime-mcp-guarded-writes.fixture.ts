import { strict as assert } from "node:assert";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { assertTestStartupIsolation } from "../../test-isolation.fixture.js";

const requestedRoot = resolve(process.env.GUARDED_CONFIG_FIXTURE_ROOT!);
assert(basename(requestedRoot).startsWith("skills-mcp-guarded-"));
const requestedMode = process.argv[3]!;
const expectedHome = requestedMode === "home-ancestor-symlink" ? join(requestedRoot, "home-alias", "nested") : join(requestedRoot, "home");
assert.equal(homedir(), expectedHome);
assert.equal(process.env.HASNA_PROFILE, "guarded-fixture");
assert.equal(process.env.HASNA_SKILLS_API_URL, "http://127.0.0.1:9");
assert.equal(process.env.SKILLS_API_URL, "http://127.0.0.1:9");
assertTestStartupIsolation();
const agent = process.argv[2]!;
const paths: Record<string, string[]> = {
  codex: [".codex", "config.toml"], gemini: [".gemini", "settings.json"],
  pi: [".pi", "agent", "mcp.json"], opencode: [".config", "opencode", "opencode.json"],
  cursor: [".cursor", "mcp.json"], windsurf: [".windsurf", "mcp.json"],
};
assert(Object.hasOwn(paths, agent));
let networkCalls = 0;
globalThis.fetch = (async () => { networkCalls++; throw Error("FIXTURE_NETWORK_REFUSED"); }) as unknown as typeof fetch;
Bun.spawn = (() => { throw Error("FIXTURE_PROCESS_REFUSED"); }) as typeof Bun.spawn;
Bun.spawnSync = (() => { throw Error("FIXTURE_PROCESS_REFUSED"); }) as typeof Bun.spawnSync;
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const)
  (childProcess as unknown as Record<string, unknown>)[method] = () => { throw Error("FIXTURE_PROCESS_REFUSED"); };
syncBuiltinESMExports();
const { canonicalSystemPath } = await import("../../lib/agent-integration.js");
const root = canonicalSystemPath(requestedRoot);
const { handleMcp } = await import("./runtime-mcp.js");
const native = {
  openSync: fs.openSync, closeSync: fs.closeSync, readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync, fstatSync: fs.fstatSync, fsyncSync: fs.fsyncSync, renameSync: fs.renameSync,
};
const modes = ["atomic", "new", "race", "new-race", "cas-stat-race", "locked", "symlink", "parent-symlink", "home-ancestor-symlink", "hardlink",
  "invalid", "invalid-container", "backup-readback", "temp-write", "final-readback"] as const;
const receipts = [];
assert(modes.some(mode => mode === requestedMode));
// Native home resolution is established before module initialization. Each case
// runs in its own fresh child; changing HOME inside an initialized process is not isolation.
for (const mode of modes.filter(mode => mode === requestedMode)) {
  const initiallyMissing = mode === "new" || mode === "new-race";
  const home = canonicalSystemPath(homedir());
  assert.equal(home, canonicalSystemPath(expectedHome));
  const path = join(home, ...paths[agent]!);
  const other = { command: "fixture-other", args: ["keep"], env: { KEEP: "synthetic" } };
  const container = agent === "opencode" ? "mcp" : "mcpServers";
  const valid = agent === "codex"
    ? 'model = "fixture-model"\n[mcp_servers.other]\ncommand = "fixture-other"\nargs = ["keep"]\n[mcp_servers.other.env]\nKEEP = "synthetic"\n'
    : JSON.stringify({ retained: { synthetic: true }, ...(agent === "opencode" ? { $schema: "" } : {}), [container]: { other } }, null, 2) + "\n";
  const original = Buffer.from(mode === "invalid" ? "[invalid"
    : mode === "invalid-container" ? agent === "codex" ? "mcp_servers = 0\n" : JSON.stringify({ retained: true, [container]: [] })
    : valid);
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const foreign = join(home, "foreign-original");
  if (mode === "parent-symlink") {
    // The real directory was created by this isolated fixture and is empty.
    fs.rmdirSync(dirname(path));
    const directory = join(home, "foreign-directory");
    fs.mkdirSync(directory, { mode: 0o700 }); fs.symlinkSync(directory, dirname(path));
  }
  if (!initiallyMissing) { native.writeFileSync(path, original); fs.chmodSync(path, 0o640); }
  if (mode === "symlink") { fs.renameSync(path, foreign); fs.symlinkSync(foreign, path); }
  if (mode === "hardlink") fs.linkSync(path, foreign);
  const lock = path + ".skills-mcp.lock";
  if (mode === "locked") {
    fs.mkdirSync(lock, { mode: 0o700 }); native.writeFileSync(join(lock, "foreign-owner"), "synthetic owner");
  }
  const descriptors = new Map<number, string>(), synced = new Set<string>();
  let backupRead = false, replacements = 0, renameAttempts = 0, finalRead = false, raced = false, casRead = false;
  const concurrent = Buffer.from(valid + (agent === "codex" ? "\n# concurrent writer\n" : " "));
  fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
    const [file] = args;
    assert.equal(typeof file, "string");
    if (file === path || !resolve(file as string).startsWith(root + "/")) {
      // The existing macOS verifier may open OS-owned alias parents read-only.
      assert.equal(typeof args[1], "number");
      assert.equal(Number(args[1]) & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_TRUNC | fs.constants.O_CREAT), 0);
    }
    const descriptor = native.openSync(...args);
    descriptors.set(descriptor, String(file)); return descriptor;
  }) as typeof fs.openSync;
  fs.closeSync = ((fd: number) => { native.closeSync(fd); descriptors.delete(fd); }) as typeof fs.closeSync;
  fs.writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
    const [file] = args;
    const target = typeof file === "number" ? descriptors.get(file)! : String(file);
    assert(target && resolve(target).startsWith(root + "/"));
    assert.notEqual(target, path); // The original is never opened for an in-place write.
    if (target.endsWith(".tmp")) { assert(backupRead || initiallyMissing); if (mode === "temp-write") throw Error("FIXTURE_WRITE_FAILURE"); }
    return native.writeFileSync(...args);
  }) as typeof fs.writeFileSync;
  fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    const [file] = args;
    const target = typeof file === "number" ? descriptors.get(file) : String(file);
    const result = native.readFileSync(...args);
    if (target === path && replacements === 0 && [...synced].some(file => file.endsWith(".tmp"))) casRead = true;
    if (target?.endsWith(".backup")) {
      if (mode === "backup-readback") return Buffer.from("fixture-corrupt-readback");
      const bytes = typeof result === "string" ? Buffer.from(result) : result;
      assert(bytes.equals(original)); backupRead = true;
    }
    if (target === path && replacements) {
      finalRead = true;
      if (mode === "final-readback") return Buffer.from("fixture-corrupt-readback");
    }
    return result;
  }) as typeof fs.readFileSync;
  fs.fstatSync = ((...args: Parameters<typeof fs.fstatSync>) => {
    const result = native.fstatSync(...args);
    if (mode === "cas-stat-race" && descriptors.get(args[0]) === path && casRead && !raced) {
      // Modify the same inode after the final CAS descriptor stat, immediately
      // before readSnapshot observes the final pathname stat. Its old bytes must
      // not be accepted just because dev/ino/uid/mode/nlink remain unchanged.
      assert(backupRead); assert.equal(replacements, 0);
      native.writeFileSync(path, concurrent); raced = true;
    }
    return result;
  }) as typeof fs.fstatSync;
  fs.fsyncSync = ((fd: number) => {
    native.fsyncSync(fd);
    const target = descriptors.get(fd)!; synced.add(target);
    if ((mode === "race" || mode === "new-race") && target.endsWith(".tmp") && !raced) {
      assert(backupRead || initiallyMissing); native.writeFileSync(path, concurrent); raced = true;
    }
  }) as typeof fs.fsyncSync;
  fs.renameSync = ((...args: Parameters<typeof fs.renameSync>) => {
    renameAttempts++; // Count entry before any fixture assertion can throw into the writer.
    const [source, destination] = args;
    assert.equal(destination, path); assert.equal(dirname(String(source)), dirname(path));
    assert(String(source).endsWith(".tmp")); assert(synced.has(String(source)));
    assert(backupRead || initiallyMissing); assert(fs.lstatSync(lock).isDirectory());
    if (mode === "new") assert(!fs.existsSync(path));
    else assert(native.readFileSync(path).equals(original));
    const prepared = native.readFileSync(source);
    assert(prepared.length > 0); assert.equal(Number(fs.statSync(source).mode & 0o777), mode === "new" ? 0o600 : 0o640);
    native.renameSync(source, destination); replacements++;
    assert(native.readFileSync(path).equals(prepared));
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  const output = console.log, logs: string[] = [];
  console.log = (...values) => { logs.push(values.map(String).join(" ")); };
  try { await handleMcp({ register: agent, json: true, apiUrl: "http://127.0.0.1:9" }); }
  finally { console.log = output; Object.assign(fs, native); syncBuiltinESMExports(); }
  const success = mode === "atomic" || mode === "new";
  const result = JSON.parse(logs.join("\n"));
  assert.equal(result.registered, success ? 1 : 0); assert.equal(result.results[0].success, success);
  assert.equal(process.exitCode ?? 0, success ? 0 : 1); process.exitCode = 0;
  if (success) {
    assert.equal(replacements, 1); assert(finalRead); assert(synced.has(dirname(path)));
    assert.equal(fs.statSync(path).mode & 0o777, mode === "new" ? 0o600 : 0o640);
    const data = agent === "codex" ? Bun.TOML.parse(native.readFileSync(path, "utf8")) : JSON.parse(native.readFileSync(path, "utf8"));
    const servers = data[agent === "codex" ? "mcp_servers" : container];
    if (mode !== "new") {
      assert.deepEqual(servers.other, other);
      if (agent === "codex") assert.equal(data.model, "fixture-model");
      else assert.deepEqual(data.retained, { synthetic: true });
      if (agent === "opencode") assert.equal(data.$schema, "");
    }
    const server = servers.skills, environment = agent === "opencode" ? server.environment : server.env;
    assert.equal(environment.HASNA_PROFILE, "guarded-fixture");
    assert.equal(environment.HASNA_SKILLS_API_URL, "http://127.0.0.1:9");
    assert.equal(environment.SKILLS_API_URL, "http://127.0.0.1:9");
    assert.deepEqual(agent === "opencode" ? server.command : server.args, agent === "opencode" ? ["skills-mcp", "--stdio"] : ["--stdio"]);
  } else {
    assert.equal(typeof result.results[0].error, "string"); assert(result.results[0].error.includes("safely update"));
    const reason = mode === "locked" ? "locked" : ["symlink", "parent-symlink", "home-ancestor-symlink", "hardlink"].includes(mode) ? "unsafe"
      : ["invalid", "invalid-container"].includes(mode) ? "invalid" : mode === "backup-readback" ? "preserve and verify"
      : mode === "temp-write" ? "prepare" : mode === "final-readback" ? "verify the committed" : "changed";
    assert(result.results[0].error.includes(reason));
    if (mode === "final-readback") { assert.equal(replacements, 1); assert(finalRead); }
    else { assert.equal(replacements, 0); assert(native.readFileSync(path).equals(raced ? concurrent : original)); }
  }
  if (mode === "cas-stat-race") { assert(casRead); assert(raced); assert.equal(renameAttempts, 0); assert.equal(replacements, 0); assert(native.readFileSync(path).equals(concurrent)); }
  if (mode === "locked") assert.equal(native.readFileSync(join(lock, "foreign-owner"), "utf8"), "synthetic owner");
  else assert(!fs.existsSync(lock));
  if (mode === "symlink") { assert(fs.lstatSync(path).isSymbolicLink()); assert(native.readFileSync(foreign).equals(original)); }
  if (mode === "parent-symlink") assert(fs.lstatSync(dirname(path)).isSymbolicLink());
  if (backupRead) {
    const backups = fs.readdirSync(dirname(path)).filter(name => name.startsWith(basename(path) + ".skills-mcp-") && name.endsWith(".backup"));
    assert.equal(backups.length, 1);
    const backup = join(dirname(path), backups[0]!);
    assert(native.readFileSync(backup).equals(original)); assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
    assert(synced.has(backup));
  }
  receipts.push({ mode, success, originalPreserved: mode === "new" || mode === "final-readback" ? backupRead || mode === "new" : true });
}
assert.equal(networkCalls, 0);
assert.equal(receipts.length, 1);
console.log(JSON.stringify({ agent, mode: requestedMode, cases: receipts.length, networkCalls, syntheticOnly: true }));
