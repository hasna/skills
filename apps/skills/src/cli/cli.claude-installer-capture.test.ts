import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { renderPinnedLauncher } from "./commands/runtime-launcher.js";
import { captureClaudeSettings, captureClaudeSettingsV2, captureClaudeSettingsV3, captureClaudeSettingsV4 } from "../lib/claude-settings-witness.js";
import { captureClaudeProspectiveCandidateClosure, hashClaudeDiscoveryBinding } from "../lib/claude-prospective-review.js";
import { captureClaudePluginManifestFile } from "../lib/claude-plugin-manifest-witness.js";
import { captureClaudeMarketplaceRegistry, captureClaudeMarketplaceRegistryV2 } from "../lib/claude-marketplace-registry.js";
import { captureDiscoveryDirectories, captureDiscoveryPathSources } from "../lib/agent-discovery.js";
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
async function run(shape: "symlink" | "pinned", request: unknown) {
  setupCommand(shape);
  const requestPath = join(scratch, `request-${shape}.json`);
  writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
  const args = ["hook", "capture-claude-installer", "--request", requestPath, "--json"];
  const child = Bun.spawn(shape === "pinned" ? [command, ...args] : [process.execPath, "--no-env-file", entry, ...args], {
    cwd: scratch,
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(scratch, "home"), USERPROFILE: join(scratch, "home"), TMPDIR: temp, HASNA_SKILLS_DIR: dataDir, NO_COLOR: "1" },
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
