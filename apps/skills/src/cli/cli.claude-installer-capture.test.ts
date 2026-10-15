import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, copyFileSync, lstatSync, readdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { renderPinnedLauncher } from "./commands/runtime-launcher.js";
import { captureClaudeSettings, captureClaudeSettingsV2, captureClaudeSettingsV3, captureClaudeSettingsV4 } from "../lib/claude-settings-witness.js";
import { captureClaudeProspectiveCandidateClosure, hashClaudeDiscoveryBinding } from "../lib/claude-prospective-review.js";
import { captureClaudePluginManifestFile } from "../lib/claude-plugin-manifest-witness.js";
import { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "../lib/claude-marketplace-registry.js";
import { captureDiscoveryByteSources, captureDiscoveryDirectories, captureDiscoveryPathSources } from "../lib/agent-discovery.js";
import { applyAgentIntegration, assertManagedAgentBridge, planAgentIntegration } from "../lib/agent-integration.js";
import { planPluginAdmission, admitPlugin } from "../lib/plugin-admission.js";
import { pluginFixture } from "../lib/plugin-admission.test-fixtures.js";
import { captureManagedPluginRegistry } from "../lib/plugin-discovery.js";
import { materializePluginTree, snapshotPluginTree } from "../lib/plugin-projection-store.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "skills-claude-installer-capture-")));
const packageRoot = join(scratch, "runtime/node_modules/@hasna/skills");
const entry = join(packageRoot, "bin/index.js");
const bin = join(scratch, "bin");
const command = join(bin, "skills");
const temp = join(scratch, "tmp");
const dataDir = join(scratch, "skills-data");
beforeAll(async () => {
  mkdirSync(dirname(entry), { recursive: true, mode: 0o700 });
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  mkdirSync(temp, { recursive: true, mode: 0o700 });
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@hasna/skills", version: "1.2.3", bin: { skills: "bin/index.js" } }), { mode: 0o644 });
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), entry);
  chmodSync(entry, 0o755);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function setupCommand(shape: "symlink" | "pinned") {
  rmSync(command, { force: true });
  if (shape === "symlink") symlinkSync(entry, command);
  else writeFileSync(command, renderPinnedLauncher({ runtime: realpathSync(process.execPath), cwd: packageRoot, entry }), { mode: 0o755 });
}
async function run(shape: "symlink" | "pinned", request: unknown, skillsDir = dataDir) {
  setupCommand(shape);
  const requestPath = join(scratch, `request-${shape}.json`);
  writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
  const args = ["hook", "capture-claude-installer", "--request", requestPath, "--json"];
  const child = Bun.spawn(shape === "pinned" ? [command, ...args] : [process.execPath, "--no-env-file", entry, ...args], {
    cwd: scratch,
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(scratch, "home"), USERPROFILE: join(scratch, "home"), TMPDIR: temp, HASNA_SKILLS_DIR: skillsDir, NO_COLOR: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}
async function runRawRequest(bytes: Uint8Array, symlink = false) {
  setupCommand("pinned");
  const requestPath = join(scratch, "raw-request.json"), targetPath = join(scratch, "raw-request-target.json");
  rmSync(requestPath, { force: true }); rmSync(targetPath, { force: true });
  writeFileSync(targetPath, bytes, { mode: 0o600 });
  if (symlink) symlinkSync(targetPath, requestPath); else copyFileSync(targetPath, requestPath);
  const child = Bun.spawn([command, "hook", "capture-claude-installer", "--request", requestPath, "--json"], {
    cwd: scratch, env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(scratch, "home"), TMPDIR: temp, HASNA_SKILLS_DIR: dataDir, NO_COLOR: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}
function base(operation: string, extra: Record<string, unknown> = {}) {
  return { schema: "skills.claude-installer-capture/v1", commandPath: command, operation, ...extra };
}

for (const shape of ["symlink", "pinned"] as const) {
  test(`captures exact Skills-owned witnesses through ${shape} command`, async () => {
    const home = join(scratch, `home-${shape}`), settings = join(home, ".claude/settings.json");
    mkdirSync(dirname(settings), { recursive: true });
    writeFileSync(settings, JSON.stringify({ model: "sonnet", permissions: { allow: ["Read"] } }));
    const expected = [
      ["claude-settings-v1", captureClaudeSettings], ["claude-settings-v2", captureClaudeSettingsV2],
      ["claude-settings-v3", captureClaudeSettingsV3], ["claude-settings-v4", captureClaudeSettingsV4],
    ] as const;
    for (const [kind, capture] of expected) {
      const result = await run(shape, base("settings", { kind, path: settings }));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const receipt = JSON.parse(result.stdout);
      expect(receipt.schema).toBe("skills.claude-installer-capture-result/v1");
      expect(receipt.producer).toMatchObject({
        schema: "skills.cli-producer-identity/v1", configuredCommandPath: command,
        runtimeEntry: { path: entry }, package: { name: "@hasna/skills", version: "1.2.3" },
      });
      expect(receipt.producer.physicalLauncher.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.producer.runtimeEntry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.producer.package.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.producer.runtime).toEqual({ path: realpathSync(process.execPath), sha256: createHash("sha256").update(readFileSync(realpathSync(process.execPath))).digest("hex") });
      expect(receipt.operation).toBe("settings");
      expect(receipt.result).toEqual(capture(settings));
    }
  });
}

test("candidate capture returns the existing closure, policy binding digest and generic plugin manifest witnesses", async () => {
  const candidate = join(scratch, "candidate"), catalogPath = join(candidate, ".claude-plugin/marketplace.json");
  const pluginRoot = join(candidate, "plugins/swift-lsp"), manifestPath = join(pluginRoot, ".claude-plugin/plugin.json");
  mkdirSync(dirname(catalogPath), { recursive: true }); mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(catalogPath, JSON.stringify({ name: "fixture-marketplace", plugins: [{ name: "swift-lsp", source: "./plugins/swift-lsp" }] }));
  writeFileSync(manifestPath, JSON.stringify({ name: "swift-lsp", version: "1.2.3", commands: ["run"] }));
  const binding = { agent: "claude", method: "reviewed", roots: [], sources: [], pluginHooks: "reviewed-no-skill-injection" };
  writeFileSync(join(dataDir, "agent-policy.json"), JSON.stringify({ loading: "cli", bridge: { discovery: { claude: binding } } }));
  const output = await run("pinned", base("candidate", { root: candidate, policyPath: join(dataDir, "agent-policy.json") }));
  expect(output.exitCode).toBe(0);
  const result = JSON.parse(output.stdout).result;
  expect(result.closureSha256).toBe(captureClaudeProspectiveCandidateClosure(candidate));
  expect(result.discoverySha256).toBe(hashClaudeDiscoveryBinding(binding));
  expect(result.manifests).toEqual([{ plugin: "swift-lsp", ...captureClaudePluginManifestFile(manifestPath) }]);
});

test("standalone plugin-manifest operation returns the existing normalized manifest witness", async () => {
  const manifestPath = join(scratch, "standalone-plugin/.claude-plugin/plugin.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ name: "fixture-plugin", version: "1.0.0", description: "Fixture" }));
  const output = await run("pinned", base("plugin-manifest", { path: manifestPath }));
  expect(output.exitCode).toBe(0);
  expect(JSON.parse(output.stdout).result).toEqual(captureClaudePluginManifestFile(manifestPath));
});

test("managed-plugin-registry CLI capture matches an admitted synthetic binding and native cache", async () => {
  const fixtureRoot = join(scratch, "managed-registry-positive"), fixture = pluginFixture(fixtureRoot);
  const plan = await planPluginAdmission("synthetic-integration", "synthetic-profile", fixture.target, fixture.options);
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", fixture.target, plan.planDigest, plan.evidenceDigest, fixture.options);
  const registry = join(fixtureRoot, "native/plugins/known_plugins.json");
  const cacheRoot = join(dirname(registry), "cache", "synthetic", "fixture");
  const version = `1.0.0-${receipt.plan.planDigest.slice(7, 19)}`;
  const installPath = join(cacheRoot, version);
  const nativeEntries = snapshotPluginTree(receipt.materializedPath);
  materializePluginTree(installPath, nativeEntries);
  mkdirSync(dirname(registry), { recursive: true });
  const row = {
    scope: "user", version, installPath, sourceProducerPath: receipt.materializedPath,
    sourceCommand: receipt.plan.sourceCommand, lastUpdated: "2026-10-09T00:00:00.000Z",
  };
  writeFileSync(registry, JSON.stringify({ version: 2, plugins: { [fixture.target.pluginId]: [row] } }), { mode: 0o600 });
  const managedPlugins = [{ bindingId: receipt.plan.bindingId, storeRoot: fixture.options.storeRoot! }];
  const expected = captureManagedPluginRegistry(registry, managedPlugins);
  const beforeRegistry = readFileSync(registry), beforeProducer = snapshotPluginTree(receipt.materializedPath), beforeNative = snapshotPluginTree(installPath);
  const output = await run("pinned", base("managed-plugin-registry", { path: registry, managedPlugins }));
  expect(output.exitCode).toBe(0); expect(output.stderr).toBe("");
  expect(JSON.parse(output.stdout).result).toEqual(expected);
  expect(readFileSync(registry)).toEqual(beforeRegistry);
  expect(snapshotPluginTree(receipt.materializedPath)).toEqual(beforeProducer);
  expect(snapshotPluginTree(installPath)).toEqual(beforeNative);
});

test("registry, path-source and directory operations preserve the owning witness results and input order", async () => {
  const home = join(scratch, "capture-operations"), registry = join(home, "plugins/known_marketplaces.json");
  const file = join(home, "source.txt"), secondFile = join(home, "second-source.txt"), directory = join(home, "discovery"), secondDirectory = join(home, "second-discovery");
  mkdirSync(dirname(registry), { recursive: true }); mkdirSync(directory, { recursive: true }); mkdirSync(secondDirectory, { recursive: true });
  writeFileSync(registry, "{}"); writeFileSync(file, "source bytes"); writeFileSync(secondFile, "other source"); writeFileSync(join(directory, "entry"), "discovery entry"); writeFileSync(join(secondDirectory, "entry"), "other discovery entry");
  for (const [kind, expected] of [["claude-marketplace-registry-v1", captureClaudeMarketplaceRegistry(registry)], ["claude-marketplace-registry-v2", captureClaudeMarketplaceRegistryV2(registry)]] as const) {
    const output = await run("pinned", base("marketplace-registry", { kind, path: registry }));
    expect(output.exitCode).toBe(0); expect(JSON.parse(output.stdout).result).toEqual(expected);
  }
  const pathBytes = await run("pinned", base("path-bytes", { paths: [secondFile, file] }));
  expect(pathBytes.exitCode).toBe(0); expect(JSON.parse(pathBytes.stdout).result).toEqual(captureDiscoveryPathSources([secondFile, file]));
  const directories = await run("pinned", base("discovery-directories", { paths: [secondDirectory, directory] }));
  expect(directories.exitCode).toBe(0); expect(JSON.parse(directories.stdout).result).toEqual(captureDiscoveryDirectories([secondDirectory, directory]));
  const rejectedRegistry = await run("pinned", base("managed-plugin-registry", { path: registry, managedPlugins: [] }));
  expect(rejectedRegistry.exitCode).not.toBe(0); expect(rejectedRegistry.stderr).toContain("MANAGED_PLUGIN_REGISTRY_REJECTED:");
});

test("request file rejects malformed, oversized, non-UTF-8 and symlink inputs with safe diagnostics", async () => {
  const cases: Array<[Uint8Array, boolean, string]> = [
    [new TextEncoder().encode("{"), false, "INVALID_REQUEST_JSON:"],
    [new Uint8Array(64 * 1024 + 1), false, "INVALID_REQUEST_FILE:"],
    [new Uint8Array([0xff, 0xfe, 0xfd]), false, "INVALID_REQUEST_JSON:"],
    [new TextEncoder().encode("{}"), true, "INVALID_REQUEST_FILE:"],
  ];
  for (const [bytes, symlink, reason] of cases) {
    const result = await runRawRequest(bytes, symlink);
    expect(result.exitCode).not.toBe(0); expect(result.stdout).toBe(""); expect(result.stderr).toContain(reason);
  }
});

test("rejects a valid but different @hasna/skills producer", async () => {
  const otherPackage = join(scratch, "other-runtime/node_modules/@hasna/skills"), otherEntry = join(otherPackage, "bin/index.js");
  mkdirSync(dirname(otherEntry), { recursive: true, mode: 0o700 });
  const contractPackage = realpathSync(join(dirname(entry), "node_modules/@hasna/contracts"));
  mkdirSync(join(otherPackage, "node_modules/@hasna"), { recursive: true, mode: 0o700 });
  for (const directory of [join(scratch, "other-runtime"), join(scratch, "other-runtime/node_modules"), join(scratch, "other-runtime/node_modules/@hasna"), otherPackage, dirname(otherEntry)]) chmodSync(directory, 0o700);
  symlinkSync(contractPackage, join(otherPackage, "node_modules/@hasna/contracts"), "dir");
  const otherManifest = join(otherPackage, "package.json");
  writeFileSync(otherManifest, JSON.stringify({ name: "@hasna/skills", version: "1.2.3", bin: { skills: "bin/index.js" } }), { mode: 0o644 });
  chmodSync(otherManifest, 0o644);
  copyFileSync(entry, otherEntry); chmodSync(otherEntry, 0o755);
  rmSync(command, { force: true }); symlinkSync(otherEntry, command);
  const requestPath = join(scratch, "different-producer.json");
  writeFileSync(requestPath, JSON.stringify(base("path-bytes", { paths: [] })), { mode: 0o600 });
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(scratch, "home"), TMPDIR: temp, HASNA_SKILLS_DIR: dataDir, NO_COLOR: "1" };
  const invoke = async (argv: string[]) => {
    const child = Bun.spawn(argv, { cwd: scratch, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  };
  // Positive control: the alternative package is valid when both the running
  // entry and the configured command resolve to it.
  const matching = await invoke([process.execPath, "--no-env-file", otherEntry, "hook", "capture-claude-installer", "--request", requestPath, "--json"]);
  if (matching.exitCode !== 0) {
    const code = matching.stderr.match(/CODEX_HOOK_TRUST_[A-Z0-9_]+/)?.[0] ?? matching.stderr.match(/^[A-Z][A-Z0-9_]+/)?.[0] ?? "UNCLASSIFIED";
    throw new Error(`alternative producer positive control refused: ${code}`);
  }
  expect(JSON.parse(matching.stdout).producer.runtimeEntry.path).toBe(otherEntry);
  // Mismatch control: keep the declared command bound to that alternative, but
  // run the original package entry. The producer guard must refuse the split.
  const mismatched = await invoke([process.execPath, "--no-env-file", entry, "hook", "capture-claude-installer", "--request", requestPath, "--json"]);
  expect(mismatched.exitCode).not.toBe(0); expect(mismatched.stdout).toBe(""); expect(mismatched.stderr).toContain("PRODUCER_UNVERIFIED:");
});

test("unknown operations, keys and producer paths refuse without echoing private request data", async () => {
  const marker = "private-candidate-content-must-not-render";
  const invalid = await run("pinned", { ...base("run-arbitrary-export", { payload: marker }) });
  expect(invalid.exitCode).not.toBe(0); expect(invalid.stdout).toBe("");
  expect(invalid.stderr).toContain("INVALID_OPERATION: operation must be settings, marketplace-registry"); expect(invalid.stderr).not.toContain(marker);
  const extraKey = await run("pinned", { ...base("path-bytes", { paths: [] }), unexpected: marker });
  expect(extraKey.exitCode).not.toBe(0); expect(extraKey.stdout).toBe(""); expect(extraKey.stderr).toContain("INVALID_REQUEST_FIELDS: path-bytes"); expect(extraKey.stderr).not.toContain(marker);
  const changedProducer = await run("pinned", base("path-bytes", { paths: [] , commandPath: join(scratch, "foreign-command") }));
  expect(changedProducer.exitCode).not.toBe(0); expect(changedProducer.stdout).toBe(""); expect(changedProducer.stderr).toContain("PRODUCER_UNVERIFIED:"); expect(changedProducer.stderr).not.toContain("foreign-command");
});

const ORPHAN_MODE = "claude-plugin-orphaned-at-v1";
const put = (path: string, body: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body, { mode: 0o644 }); };
const fileSha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** A reviewed Claude binding written by the ordinary hook install: one enabled
 * cache plugin with a retired 1.0.0 and the registered 2.0.0, each with the
 * Claude-written version-root .orphaned_at marker, and a typed (default) or
 * byte settings witness. Each fixture has its own Skills data directory, so
 * the stored policy is exactly what Skills wrote. */
function reviewedClaudeBinding(name: string, settingsWitness: "claude-settings-v4" | "bytes" = "claude-settings-v4") {
  const home = join(scratch, name), claude = join(home, ".claude"), skillsDir = join(home, "skills-data");
  const parent = join(claude, "plugins/cache/market/plugin"), retired = join(parent, "1.0.0"), active = join(parent, "2.0.0");
  const settings = join(claude, "settings.json"), registry = join(claude, "plugins/installed_plugins.json");
  put(settings, JSON.stringify({ enabledPlugins: { "plugin@market": true } }));
  put(registry, JSON.stringify({ version: 2, plugins: { "plugin@market": [{ scope: "user", installPath: active, version: "2.0.0" }] } }));
  for (const root of [retired, active]) {
    put(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "plugin", version: basename(root) }));
    mkdirSync(join(root, "skills"), { recursive: true });
    put(join(root, ".orphaned_at"), "1791981120000");
  }
  const manifests = [retired, active].map(root => join(root, ".claude-plugin/plugin.json"));
  const markers = [retired, active].map(root => join(root, ".orphaned_at"));
  const options = { home, dataDir: skillsDir, projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs: { version: 1, agents: [{
    agent: "claude", roots: [join(retired, "skills"), join(active, "skills")], pluginHooks: "reviewed-no-skill-injection",
    sources: [settingsWitness === "bytes" ? captureDiscoveryByteSources([settings])[0]! : captureClaudeSettingsV4(settings), ...captureDiscoveryByteSources([registry, ...manifests]), ...captureDiscoveryPathSources(markers)],
    directories: captureDiscoveryDirectories([active]),
  }] } }));
  const policyPath = join(skillsDir, "agent-policy.json");
  const stored = () => JSON.parse(readFileSync(policyPath, "utf8")).bridge.discovery.claude;
  const prune = () => renameSync(retired, join(home, "pruned-1.0.0"));
  const verify = async (request: Record<string, unknown> = {}) => {
    const output = await run("pinned", base("discovery-binding", { policyPath, ...request }), skillsDir);
    return { ...output, receipt: output.exitCode === 0 ? JSON.parse(output.stdout) : undefined };
  };
  const hook = () => assertManagedAgentBridge("claude", options);
  return { home, claude, skillsDir, retired, active, settings, registry, manifests, markers, policyPath, stored, prune, verify, hook };
}
const statusOf = (result: any, path: string, hashMode?: string) => result.sources.filter((row: any) => row.path === path && (hashMode === undefined || row.hashMode === hashMode)).map((row: any) => row.status);

test("discovery-binding retains a pruned retired version while the registered sibling stays bound and current", async () => {
  const f = reviewedClaudeBinding("binding-retained");
  f.prune();
  // The installer's former per-file re-capture of the same stored witness refuses.
  const perFile = await run("pinned", base("plugin-manifest", { path: f.manifests[0] }), f.skillsDir);
  expect(perFile.exitCode).not.toBe(0); expect(perFile.stderr).toContain("PLUGIN_MANIFEST_REJECTED:");
  // Skills' own prompt hook accepts the binding, and so does the new operation.
  expect(() => f.hook()).not.toThrow();
  const output = await f.verify();
  expect(output.exitCode).toBe(0); expect(output.stderr).toBe("");
  expect(output.receipt.schema).toBe("skills.claude-installer-capture-result/v1");
  expect(output.receipt.operation).toBe("discovery-binding");
  expect(output.receipt.producer.configuredCommandPath).toBe(command);
  const result = output.receipt.result, binding = f.stored();
  expect(result).toMatchObject({
    schema: "skills.claude-discovery-binding-verification/v1", ok: true, agent: "claude", method: "reviewed",
    policySha256: fileSha(f.policyPath), discoverySha256: hashClaudeDiscoveryBinding(binding), rootCount: binding.roots.length, failures: [],
  });
  expect(result.rootCount).toBeGreaterThan(0);
  expect(result.sources.map((row: any) => [row.index, row.path, row.hashMode, row.format, row.sha256]))
    .toEqual(binding.sources.map((source: any, index: number) => [index, source.path, source.hashMode ?? null, source.format ?? null, source.sha256]));
  expect(result.sources.find((row: any) => row.path === f.manifests[0])).toEqual({
    index: expect.any(Number), path: f.manifests[0], hashMode: "claude-plugin-manifest-v1", format: null, sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    status: "retained-absent", retention: { rule: "absent-retired-claude-version", root: f.retired, witness: "claude-plugin-manifest-v1" },
  });
  expect(statusOf(result, f.manifests[1]!)).toEqual(["current"]);
  for (const path of [f.settings, f.registry]) {
    expect(statusOf(result, path).length).toBeGreaterThan(0);
    expect(new Set(statusOf(result, path))).toEqual(new Set(["current"]));
  }
  // Every other source is current; only the pruned version's witnesses are retained.
  for (const row of result.sources) expect(row.status).toBe(row.path.startsWith(f.retired + "/") ? "retained-absent" : "current");
  expect(result.directories).toEqual(binding.directories.map((directory: any, index: number) => ({ index, path: directory.path, status: "current" })));
});

test("discovery-binding follows Claude's orphan marker lifecycle with the marker predicate and agrees with the hook at every step", async () => {
  const f = reviewedClaudeBinding("binding-orphan-markers");
  const [retiredMarker, activeMarker] = f.markers as [string, string];
  expect(f.markers.map(path => f.stored().sources.find((source: any) => source.path === path)?.hashMode)).toEqual([ORPHAN_MODE, ORPHAN_MODE]);
  const hookAccepts = () => { try { f.hook(); return true; } catch (error) { expect(String(error)).toContain("NATIVE_SKILL_DRIFT"); return false; } };
  /** One step: the hook and the operation give the same verdict, and every
   * marker row has the expected status (and reason, for drift). */
  const step = async (accepted: boolean, markers: Array<[string, string, string?]>) => {
    expect(hookAccepts()).toBe(accepted);
    const result = (await f.verify()).receipt.result;
    expect(result.ok).toBe(accepted);
    for (const [path, status, reason] of markers) {
      const row = result.sources.find((item: any) => item.path === path);
      expect(row).toMatchObject({ hashMode: ORPHAN_MODE, status, ...(reason ? { reason } : {}) });
      if (status === "drift") expect(result.failures).toContainEqual({ kind: "source", index: row.index, path, reason });
      if (status === "retained-absent") expect(row.retention).toEqual({ rule: "absent-retired-claude-version", root: f.retired, witness: ORPHAN_MODE });
    }
    if (!accepted) expect(result.failures).toContainEqual({ kind: "binding", reason: "DISCOVERY_REFUSED" });
    return result;
  };
  // Claude rewrites the timestamp at each start and may replace the file's inode.
  for (const marker of f.markers) put(marker, "1791981121000");
  put(join(f.home, "next-marker"), "1791981122000"); renameSync(join(f.home, "next-marker"), activeMarker);
  await step(true, [[retiredMarker, "current"], [activeMarker, "current"]]);
  // A byte-order mark before the timestamp is not a Claude marker.
  writeFileSync(activeMarker, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("1791981120000")]));
  await step(false, [[activeMarker, "drift", "MARKER_INVALID"]]);
  put(activeMarker, "1791981123000");
  await step(true, [[activeMarker, "current"]]);
  // Claude deletes the marker while its version directory stays: drift.
  rmSync(retiredMarker);
  await step(false, [[retiredMarker, "drift", "MISSING"]]);
  // Claude then deletes the whole orphaned version: retained beside the installed sibling.
  f.prune();
  await step(true, [[retiredMarker, "retained-absent"], [activeMarker, "current"]]);
  // A recreated version directory is checked again, file by file.
  put(f.manifests[0]!, JSON.stringify({ name: "plugin", version: "1.0.0" })); mkdirSync(join(f.retired, "skills"));
  await step(false, [[retiredMarker, "drift", "MISSING"]]);
  put(retiredMarker, "1791981124000");
  await step(true, [[retiredMarker, "current"], [activeMarker, "current"]]);
});

test("discovery-binding fails closed when a file outside the retained-version rule is missing", async () => {
  const f = reviewedClaudeBinding("binding-missing");
  f.prune();
  const activeManifest = f.manifests[1]!, manifestText = readFileSync(activeManifest, "utf8");
  rmSync(activeManifest);
  expect(() => f.hook()).toThrow("NATIVE_SKILL_DRIFT");
  let result = (await f.verify()).receipt.result;
  expect(result.ok).toBe(false);
  expect(result.failures).toContainEqual({ kind: "source", index: expect.any(Number), path: activeManifest, reason: "MISSING" });
  // Without a current registered sibling, the pruned version is not retained either.
  expect(result.sources.some((row: any) => row.status === "retained-absent")).toBe(false);
  expect(statusOf(result, f.manifests[0]!)).toEqual(["drift"]);
  expect(result.failures).toContainEqual({ kind: "binding", reason: "DISCOVERY_REFUSED" });
  put(activeManifest, manifestText);
  expect((await f.verify()).receipt.result.ok).toBe(true);
});

test.each(["claude-settings-v4", "bytes"] as const)("discovery-binding never retains an absent settings file bound by a %s witness", async settingsWitness => {
  const f = reviewedClaudeBinding(`binding-missing-settings-${settingsWitness}`, settingsWitness);
  f.prune();
  expect(f.stored().sources.some((source: any) => source.path === f.settings && (source.hashMode ?? null) === settingsWitness)).toBe(true);
  const settingsText = readFileSync(f.settings, "utf8");
  rmSync(f.settings);
  expect(() => f.hook()).toThrow("NATIVE_SKILL_DRIFT");
  const result = (await f.verify()).receipt.result;
  expect(result.ok).toBe(false);
  const settingsRows = result.sources.filter((row: any) => row.path === f.settings);
  expect(settingsRows.length).toBeGreaterThan(1);
  for (const row of settingsRows) {
    expect(row).toMatchObject({ status: "drift", reason: "MISSING" });
    expect(result.failures).toContainEqual({ kind: "source", index: row.index, path: f.settings, reason: "MISSING" });
  }
  // Without unchanged settings the retired version is not retained either.
  expect(result.sources.some((row: any) => row.status === "retained-absent")).toBe(false);
  put(f.settings, settingsText);
  expect((await f.verify()).receipt.result.ok).toBe(true);
});

test.each(["claude-settings-v4", "bytes"] as const)("discovery-binding reports changed settings and registry bytes as failures, never as retained (%s settings witness)", async settingsWitness => {
  const f = reviewedClaudeBinding(`binding-changed-${settingsWitness}`, settingsWitness);
  f.prune();
  for (const [path, change] of [
    [f.settings, (value: any) => ({ ...value, enabledPlugins: { ...value.enabledPlugins, "other@market": true } })],
    [f.registry, (value: any) => ({ ...value, plugins: { ...value.plugins, "other@market": [{ scope: "user", installPath: join(f.claude, "plugins/cache/market/other/1.0.0"), version: "1.0.0" }] } })],
  ] as const) {
    const original = readFileSync(path, "utf8");
    writeFileSync(path, JSON.stringify(change(JSON.parse(original))));
    expect(() => f.hook()).toThrow("NATIVE_SKILL_DRIFT");
    const result = (await f.verify()).receipt.result;
    expect(result.ok).toBe(false);
    const rows = result.sources.filter((row: any) => row.path === path);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatchObject({ status: "drift", reason: "CHANGED" });
      expect(result.failures).toContainEqual({ kind: "source", index: row.index, path, reason: "CHANGED" });
    }
    expect(rows.every((row: any) => row.status !== "retained-absent")).toBe(true);
    expect(result.failures).toContainEqual({ kind: "binding", reason: "DISCOVERY_REFUSED" });
    writeFileSync(path, original);
    expect((await f.verify()).receipt.result.ok).toBe(true);
  }
});

test("discovery-binding refuses request, policy path, policy and binding errors with stable codes", async () => {
  const f = reviewedClaudeBinding("binding-refusals");
  const refused = async (request: Record<string, unknown>, code: string, skillsDir = f.skillsDir) => {
    const output = await run("pinned", base("discovery-binding", request), skillsDir);
    expect(output.exitCode).not.toBe(0); expect(output.stdout).toBe(""); expect(output.stderr).toStartWith(`${code}:`);
  };
  await refused({ policyPath: join(f.home, "agent-policy.json") }, "POLICY_PATH_MISMATCH");
  await refused({ policyPath: join(dataDir, "agent-policy.json") }, "POLICY_PATH_MISMATCH");
  await refused({ policyPath: f.policyPath, unexpected: true }, "INVALID_REQUEST_FIELDS");
  await refused({}, "INVALID_REQUEST_FIELDS");
  await refused({ policyPath: "relative/agent-policy.json" }, "INVALID_PATH");
  await refused({ policyPath: f.policyPath, commandPath: join(scratch, "foreign-command") }, "PRODUCER_UNVERIFIED");
  const emptyDir = join(f.home, "empty-skills-data"); mkdirSync(emptyDir);
  await refused({ policyPath: join(emptyDir, "agent-policy.json") }, "POLICY_UNAVAILABLE", emptyDir);
  const original = readFileSync(f.policyPath, "utf8"), policy = JSON.parse(original);
  for (const [text, code] of [
    ["{", "POLICY_UNREADABLE"],
    [JSON.stringify({ ...policy, loading: "legacy" }), "POLICY_UNREADABLE"],
    [JSON.stringify({ ...policy, bridge: { ...policy.bridge, discovery: {} } }), "BINDING_UNAVAILABLE"],
    // The shared policy parser already refuses malformed discovery collections.
    [JSON.stringify({ ...policy, bridge: { ...policy.bridge, discovery: { claude: { ...policy.bridge.discovery.claude, sources: "not-an-array" } } } }), "POLICY_UNREADABLE"],
    [JSON.stringify({ ...policy, bridge: { ...policy.bridge, discovery: { claude: { ...policy.bridge.discovery.claude, agent: "codex" } } } }), "POLICY_UNREADABLE"],
    // A parseable policy whose Claude slot is not a Claude binding.
    [JSON.stringify({ ...policy, bridge: { ...policy.bridge, discovery: { claude: { agent: "codex", method: "reviewed", roots: [], sources: [] } } } }), "BINDING_INVALID"],
    [JSON.stringify({ ...policy, bridge: { ...policy.bridge, discovery: { claude: { agent: "claude", method: "unreviewed", roots: [], sources: [] } } } }), "BINDING_INVALID"],
  ] as const) {
    writeFileSync(f.policyPath, text);
    await refused({ policyPath: f.policyPath }, code);
  }
  writeFileSync(f.policyPath, original);
  expect((await f.verify()).receipt.result.ok).toBe(true);
});

/** Every entry under `root` with its type, mode, size, mtime, ctime and file
 * digest. Directory mtimes also expose a file created and removed again. */
function treeSnapshot(root: string): Array<[string, string, number, string, string, string, string | null]> {
  const rows: Array<[string, string, number, string, string, string, string | null]> = [];
  const walk = (path: string) => {
    const stat = lstatSync(path, { bigint: true });
    const type = stat.isDirectory() ? "dir" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "link" : "other";
    rows.push([path, type, Number(stat.mode), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs), type === "file" ? fileSha(path) : null]);
    if (type === "dir") for (const name of readdirSync(path).sort()) walk(join(path, name));
  };
  walk(root);
  return rows;
}

test("discovery-binding writes nothing: no file, cache or selection pin in the data directory or native home", async () => {
  const f = reviewedClaudeBinding("binding-no-writes");
  f.prune();
  for (const expected of [true, false]) {
    if (!expected) writeFileSync(f.registry, readFileSync(f.registry, "utf8") + "\n");
    const beforeData = treeSnapshot(f.skillsDir), beforeNative = treeSnapshot(f.claude);
    const output = await f.verify();
    expect(output.exitCode).toBe(0);
    expect(output.receipt.result.ok).toBe(expected);
    expect(treeSnapshot(f.skillsDir)).toEqual(beforeData);
    expect(treeSnapshot(f.claude)).toEqual(beforeNative);
  }
});
