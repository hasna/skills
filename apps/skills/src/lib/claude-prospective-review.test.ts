import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, join as pathJoin } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCliFixture } from "../cli/cli-build.fixture.js";
import { applyAgentIntegration, planAgentIntegration } from "./agent-integration.js";
import { captureDiscoveryPathSources, resolveAgentDiscovery, type ReviewedDiscoveryInputs } from "./agent-discovery.js";
import { captureClaudeSettingsV4 } from "./claude-settings-witness.js";
import { captureClaudeProspectiveCandidateClosure, reviewClaudeProspectiveCandidate, CLAUDE_PROSPECTIVE_REVIEW_SCHEMA, type ClaudeProspectiveReviewRequest } from "./claude-prospective-review.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const put = (path: string, value: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, value); };
const review = (request: ClaudeProspectiveReviewRequest) => reviewClaudeProspectiveCandidate(request, sha(JSON.stringify(request)));
const cliScratch = mkdtempSync(join(tmpdir(), "skills-claude-review-cli-"));
const cliEntry = pathJoin(cliScratch, "entry.ts"), cliBin = pathJoin(cliScratch, "skills.js");
beforeAll(async () => {
  put(cliEntry, `import { Command } from ${JSON.stringify(require.resolve("commander"))};\nimport { registerAgentIntegration } from ${JSON.stringify(resolve(import.meta.dir, "../cli/commands/agent-integration.ts"))};\nconst program = new Command(); registerAgentIntegration(program); await program.parseAsync(process.argv);\n`);
  await buildCliFixture(cliEntry, cliBin);
});
afterAll(() => rmSync(cliScratch, { recursive: true, force: true }));

function fixture(scope: "user" | "project" = "user", existingMarketplace = false) {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-prospective-")); roots.push(home);
  const settings = join(home, ".claude/settings.json"), known = join(home, ".claude/plugins/known_marketplaces.json"), installed = join(home, ".claude/plugins/installed_plugins.json");
  const candidateRoot = join(home, "frozen-candidate");
  const projectPath = join(home, "project"), projectSettings = join(projectPath, ".claude/settings.json"), projectSettingsLocal = join(projectPath, ".claude/settings.local.json");
  const anotherProject = join(home, "another-project"); mkdirSync(projectPath); mkdirSync(anotherProject);
  put(settings, JSON.stringify({ theme: "dark" }));
  put(projectSettings, JSON.stringify({ permissions: { allow: ["Read"] } }));
  put(known, JSON.stringify({
    "unrelated-market": { source: { source: "directory", path: join(home, "unrelated-market") }, installLocation: join(home, ".claude/plugins/marketplaces/unrelated-market"), lastUpdated: "2026-10-01T00:00:00.000Z" },
    ...(existingMarketplace ? { "fixture-market": { source: { source: "directory", path: candidateRoot }, installLocation: candidateRoot, autoUpdate: true, lastUpdated: "2026-10-02T00:00:00.000Z" } } : {}),
  }));
  put(installed, JSON.stringify({ version: 2, plugins: {
    "demo@fixture-market": [
      { scope: "user", installPath: join(home, ".claude/plugins/cache/fixture-market/demo/0.9.0"), version: "0.9.0", installedAt: "2026-10-01T00:00:00.000Z", lastUpdated: "2026-10-03T00:00:00.000Z" },
      { scope: "project", projectPath: anotherProject, installPath: join(home, ".claude/plugins/cache/fixture-market/demo/0.9.0"), version: "0.9.0", installedAt: "2026-10-01T00:00:00.000Z" },
    ],
    "other@market": [{ scope: "local", installPath: join(home, ".claude/local/other"), version: "4.0.0" }],
  } }));
  const dataDir = join(home, "skills-data");
  const options = { home, dataDir, projectDir: home, agents: ["claude" as const], command: "/fixture/skills" };
  applyAgentIntegration(planAgentIntegration(options));
  const baselineBinding = JSON.parse(readFileSync(join(dataDir, "agent-policy.json"), "utf8")).bridge.discovery.claude;
  const discoveryInputs: ReviewedDiscoveryInputs = { version: 1, agents: [{
    agent: "claude", roots: baselineBinding.roots, sources: [
      captureClaudeSettingsV4(settings),
      ...captureDiscoveryPathSources([projectSettings, projectSettingsLocal, known, installed]),
    ], pluginHooks: "reviewed-no-skill-injection",
  }] };
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs }));
  const binding = resolveAgentDiscovery({ home, agent: "claude", reviewed: discoveryInputs });
  const nativePath = join(home, "bin/claude"); put(nativePath, "#!/bin/sh\nexit 0\n"); chmodSync(nativePath, 0o700);
  const catalogPath = join(candidateRoot, ".claude-plugin/marketplace.json");
  const manifestPath = join(candidateRoot, "plugins/demo/.claude-plugin/plugin.json");
  put(catalogPath, JSON.stringify({ name: "fixture-market", plugins: [{ name: "demo", version: "1.0.0", source: "./plugins/demo" }] }));
  put(manifestPath, JSON.stringify({ name: "demo", version: "1.0.0" }));
  const pluginId = "demo@fixture-market", targetInstall = join(home, ".claude/plugins/cache/fixture-market/demo/1.0.0");
  const targetSettings = scope === "project" ? projectSettings : settings;
  const targetSettingsAfter = JSON.parse(readFileSync(targetSettings, "utf8")); targetSettingsAfter.enabledPlugins ??= {}; targetSettingsAfter.enabledPlugins[pluginId] = true;
  const knownAfter = { "unrelated-market": { source: { source: "directory", path: join(home, "unrelated-market") }, installLocation: join(home, ".claude/plugins/marketplaces/unrelated-market"), lastUpdated: "2026-10-01T00:00:00.000Z" }, "fixture-market": { source: { source: "directory", path: candidateRoot }, installLocation: candidateRoot, autoUpdate: false, lastUpdated: existingMarketplace ? { $allowed: ["2026-10-02T00:00:00.000Z", { $generated: "claude-utc-timestamp", field: "known-marketplaces.lastUpdated" }] } : { $generated: "claude-utc-timestamp", field: "known-marketplaces.lastUpdated" } } };
  const installedAfter = { version: 2, plugins: {
    "demo@fixture-market": [
      ...(scope === "user" ? [] : [{ scope: "user", installPath: join(home, ".claude/plugins/cache/fixture-market/demo/0.9.0"), version: "0.9.0", installedAt: "2026-10-01T00:00:00.000Z", lastUpdated: "2026-10-03T00:00:00.000Z" }]),
      { scope: "project", projectPath: anotherProject, installPath: join(home, ".claude/plugins/cache/fixture-market/demo/0.9.0"), version: "0.9.0", installedAt: "2026-10-01T00:00:00.000Z" },
      { scope, ...(scope === "project" ? { projectPath } : {}), installPath: targetInstall, version: "1.0.0", ...(scope === "user" ? { installedAt: "2026-10-01T00:00:00.000Z", lastUpdated: { $allowed: ["2026-10-03T00:00:00.000Z", { $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" }] } } : { installedAt: { $generated: "claude-utc-timestamp", field: "installed_plugins.fresh-row.installedAt" }, lastUpdated: { $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" } }) },
    ],
    "other@market": [{ scope: "local", installPath: join(home, ".claude/local/other"), version: "4.0.0" }],
  } };
  const request: ClaudeProspectiveReviewRequest = {
    schema: CLAUDE_PROSPECTIVE_REVIEW_SCHEMA,
    scope: { kind: scope, projectPath },
    native: { home, configRoot: join(home, ".claude"), pluginRoot: join(home, ".claude/plugins"), executable: { path: nativePath, target: nativePath, version: "2.1.295", sha256: sha(readFileSync(nativePath)) } },
    skills: { dataDir, policySha256: sha(readFileSync(join(dataDir, "agent-policy.json"))), discoverySha256: sha(JSON.stringify(binding)), discoveryInputs },
    candidate: { marketplace: "fixture-market", plugin: "demo", root: candidateRoot, catalogPath, catalogSha256: sha(readFileSync(catalogPath)), closureSha256: captureClaudeProspectiveCandidateClosure(candidateRoot), manifestPath, manifestSha256: (awaitManifestHash(manifestPath)) },
    preimages: { settings: { path: targetSettings, sha256: sha(readFileSync(targetSettings)) }, userSettings: { path: settings, sha256: sha(readFileSync(settings)) }, projectSettings: { path: projectSettings, sha256: sha(readFileSync(projectSettings)) }, projectSettingsLocal: { path: projectSettingsLocal, sha256: null }, marketplaces: { path: known, sha256: sha(readFileSync(known)) }, installedPlugins: { path: installed, sha256: sha(readFileSync(installed)) } },
    delta: { settingsAfter: targetSettingsAfter, knownMarketplacesAfter: knownAfter, installedPluginsAfter: installedAfter },
    review: { pluginHooks: "reviewed-no-skill-injection" },
  };
  return { request, settings, projectSettings, candidateRoot, dataDir, known, installed, projectSettingsLocal, home };
}

function refreshRegistryBinding(f: ReturnType<typeof fixture>, registry: Record<string, any>): void {
  put(f.installed, JSON.stringify(registry));
  f.request.preimages.installedPlugins.sha256 = sha(readFileSync(f.installed));
  const options = { home: f.home, dataDir: f.dataDir, projectDir: f.home, agents: ["claude" as const], command: "/fixture/skills" };
  const prior = JSON.parse(readFileSync(join(f.dataDir, "agent-policy.json"), "utf8")).bridge.discovery.claude;
  const discoveryInputs: ReviewedDiscoveryInputs = { version: 1, agents: [{
    agent: "claude", roots: prior.roots, sources: [
      captureClaudeSettingsV4(f.settings),
      ...captureDiscoveryPathSources([f.projectSettings, f.projectSettingsLocal, f.known, f.installed]),
    ], pluginHooks: "reviewed-no-skill-injection",
  }] };
  applyAgentIntegration(planAgentIntegration({ ...options, discoveryInputs }));
  const binding = resolveAgentDiscovery({ home: f.home, agent: "claude", reviewed: discoveryInputs });
  f.request.skills.discoveryInputs = discoveryInputs;
  f.request.skills.discoverySha256 = sha(JSON.stringify(binding));
  f.request.skills.policySha256 = sha(readFileSync(join(f.dataDir, "agent-policy.json")));
}

function awaitManifestHash(path: string): string {
  // Manifest witness digest is semantic; importing it directly keeps the
  // positive fixture aligned with the same validator used at admission.
  return hashClaudePlugin(readFileSync(path, "utf8"));
}
import { hashClaudePluginManifest as hashClaudePlugin } from "./claude-plugin-manifest-witness.js";

test("prospective review accepts an exact user-scoped frozen candidate without writing native state", () => {
  const f = fixture();
  const before = readFileSync(f.settings, "utf8");
  const receipt = review(f.request);
  expect(receipt.accepted).toBe(true);
  expect(receipt.applied).toBe(false);
  expect(receipt.ownedDelta.settingsEnabledPlugin).toBe("demo@fixture-market");
  expect(readFileSync(f.settings, "utf8")).toBe(before);
});

test("CLI receipt binds the raw request file and complete semantic post-state for an external adapter", async () => {
  const f = fixture("project"), requestBytes = Buffer.from(JSON.stringify(f.request));
  const requestPath = join(cliScratch, `request-${randomUUID()}.json`); writeFileSync(requestPath, requestBytes);
  const before = [f.settings, f.projectSettings].map(path => readFileSync(path, "utf8"));
  const child = Bun.spawn([process.execPath, "--no-env-file", cliBin, "hook", "review-claude-candidate", "--request", requestPath, "--json"], {
    cwd: f.request.native.home,
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: f.request.native.home, USERPROFILE: f.request.native.home, HASNA_HOME: join(f.request.native.home, ".hasna"), HASNA_SKILLS_DIR: f.dataDir, TMPDIR: cliScratch, NO_COLOR: "1" },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(status).toBe(0); expect(stderr).toBe("");
  const receipt = JSON.parse(stdout);
  expect(receipt.requestFileSha256).toBe(sha(requestBytes));
  expect(receipt.targetSettingsPath).toBe(f.projectSettings);
  expect(receipt.semanticDocumentsSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.operationSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.expectedPostStateSha256).toMatch(/^[a-f0-9]{64}$/);
  expect([f.settings, f.projectSettings].map(path => readFileSync(path, "utf8"))).toEqual(before);
});

test("project scope binds its exact project path while preserving the same candidate closure", () => {
  const f = fixture("project");
  const receipt = review(f.request);
  expect(receipt.scope).toEqual(f.request.scope);
  const rows = (f.request.delta.installedPluginsAfter as Record<string, any>).plugins["demo@fixture-market"] as Array<Record<string, unknown>>;
  const fresh = rows.find(row => row.scope === "project" && row.projectPath === f.request.scope.projectPath)!;
  expect(fresh.installedAt).toEqual({ $generated: "claude-utc-timestamp", field: "installed_plugins.fresh-row.installedAt" });
  expect(fresh.lastUpdated).toEqual({ $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" });
  expect(rows.find(row => row.scope === "user")?.installedAt).toBe("2026-10-01T00:00:00.000Z");
});

test("an update preserves installedAt and allows only the prior or generated lastUpdated value", () => {
  const f = fixture("user");
  const rows = (f.request.delta.installedPluginsAfter as Record<string, any>).plugins["demo@fixture-market"] as Array<Record<string, unknown>>;
  const target = rows.find(row => row.scope === "user")!;
  expect(target.installedAt).toBe("2026-10-01T00:00:00.000Z");
  expect(target.lastUpdated).toEqual({ $allowed: ["2026-10-03T00:00:00.000Z", { $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" }] });
  expect(() => review(f.request)).not.toThrow();
  target.lastUpdated = "2026-10-04T00:00:00.000Z";
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  target.lastUpdated = { $allowed: ["2026-10-03T00:00:00.000Z", { $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" }] };
  target.installedAt = { $generated: "claude-utc-timestamp", equalityGroup: "wrong" };
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});

test("an existing local-directory marketplace keeps its source path, pins autoUpdate off, and allows only its prior or generated timestamp", () => {
  const f = fixture("user", true);
  const receipt = review(f.request);
  const row = (f.request.delta.knownMarketplacesAfter as Record<string, any>)["fixture-market"];
  expect(row.installLocation).toBe(f.candidateRoot);
  expect(row.autoUpdate).toBe(false);
  expect(row.lastUpdated).toEqual({ $allowed: ["2026-10-02T00:00:00.000Z", { $generated: "claude-utc-timestamp", field: "known-marketplaces.lastUpdated" }] });
  expect(receipt.accepted).toBe(true);
  row.installLocation = join(f.request.native.configRoot, "plugins/marketplaces/fixture-market");
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});

test("present malformed v2 registration entries refuse while absent entries and valid non-cache rows remain admissible", () => {
  for (const malformed of [{ installPath: "/synthetic/local" }, null, [null], ["invalid"], [{}], [{ installPath: 42 }]]) {
    const f = fixture();
    const registry = JSON.parse(readFileSync(f.installed, "utf8"));
    registry.plugins["demo@fixture-market"] = malformed;
    refreshRegistryBinding(f, registry);
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  }

  const absent = fixture();
  const absentRegistry = JSON.parse(readFileSync(absent.installed, "utf8"));
  delete absentRegistry.plugins["demo@fixture-market"];
  refreshRegistryBinding(absent, absentRegistry);
  (absent.request.delta.installedPluginsAfter as Record<string, any>).plugins["demo@fixture-market"] = [{
    scope: "user", installPath: join(absent.home, ".claude/plugins/cache/fixture-market/demo/1.0.0"), version: "1.0.0",
    installedAt: { $generated: "claude-utc-timestamp", field: "installed_plugins.fresh-row.installedAt" },
    lastUpdated: { $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" },
  }];
  expect(() => review(absent.request)).not.toThrow();

  const local = fixture();
  const localRegistry = JSON.parse(readFileSync(local.installed, "utf8"));
  const localRow = { scope: "local", installPath: join(local.home, ".claude/local/demo"), version: "1.0.0", retainedNativeField: true };
  localRegistry.plugins["demo@fixture-market"].push(localRow);
  refreshRegistryBinding(local, localRegistry);
  const localRows = (local.request.delta.installedPluginsAfter as Record<string, any>).plugins["demo@fixture-market"] as Array<Record<string, unknown>>;
  localRows.splice(localRows.length - 1, 0, localRow);
  expect(() => review(local.request)).not.toThrow();
});

test("prospective review refuses candidate, native, Skills, review, and owned-delta drift", () => {
  const mutations: Array<[string, (request: ClaudeProspectiveReviewRequest, f: ReturnType<typeof fixture>) => void]> = [
    ["candidate bytes", (request, f) => { put(join(f.candidateRoot, "plugins/demo/payload.txt"), "changed"); }],
    ["settings preimage", (_request, f) => { put(f.settings, JSON.stringify({ enabledPlugins: { "unrelated@market": true } })); }],
    ["unrelated settings mutation", request => { request.delta.settingsAfter.unrelated = "changed"; }],
    ["unrelated marketplace mutation", request => { request.delta.knownMarketplacesAfter.unrelated = { source: "bad" }; }],
    ["wrong registration scope", request => { (request.delta.installedPluginsAfter as Record<string, any>).plugins["demo@fixture-market"][0].scope = "user"; }],
    ["missing explicit assessment", request => { request.review.pluginHooks = "" as "reviewed-no-skill-injection"; }],
  ];
  for (const [label, mutate] of mutations) {
    const f = fixture(); mutate(f.request, f);
    expect(() => review(f.request), label).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  }
});

test("an explicit no-injection declaration cannot admit declared skill or command payloads", () => {
  for (const target of ["manifest", "marketplace-entry"] as const) {
    const f = fixture();
    if (target === "manifest") {
      const manifest = JSON.parse(readFileSync(f.request.candidate.manifestPath, "utf8"));
      manifest.skills = "./skills";
      put(f.request.candidate.manifestPath, JSON.stringify(manifest));
      f.request.candidate.manifestSha256 = awaitManifestHash(f.request.candidate.manifestPath);
    } else {
      const catalog = JSON.parse(readFileSync(f.request.candidate.catalogPath, "utf8"));
      catalog.plugins[0].commands = ["./commands" ];
      put(f.request.candidate.catalogPath, JSON.stringify(catalog));
      f.request.candidate.catalogSha256 = sha(readFileSync(f.request.candidate.catalogPath));
    }
    f.request.candidate.closureSha256 = captureClaudeProspectiveCandidateClosure(f.candidateRoot);
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  }
});

test("candidate source must resolve from the frozen marketplace root to the selected plugin closure", () => {
  const f = fixture();
  const catalog = JSON.parse(readFileSync(f.request.candidate.catalogPath, "utf8"));
  catalog.plugins[0].source = "../../elsewhere";
  put(f.request.candidate.catalogPath, JSON.stringify(catalog));
  f.request.candidate.catalogSha256 = sha(readFileSync(f.request.candidate.catalogPath));
  f.request.candidate.closureSha256 = captureClaudeProspectiveCandidateClosure(f.candidateRoot);
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});
