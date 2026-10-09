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

function fixture(scope: "user" | "project" = "user", existingMarketplace = false, pluginNames = ["demo"], extraMarketplaces?: (home: string) => unknown, mutateKnown?: (rows: Record<string, any>) => void) {
  const home = mkdtempSync(join(tmpdir(), "skills-claude-prospective-")); roots.push(home);
  const settings = join(home, ".claude/settings.json"), known = join(home, ".claude/plugins/known_marketplaces.json"), installed = join(home, ".claude/plugins/installed_plugins.json");
  const candidateRoot = join(home, "frozen-candidate");
  const projectPath = join(home, "project"), projectSettings = join(projectPath, ".claude/settings.json"), projectSettingsLocal = join(projectPath, ".claude/settings.local.json");
  const anotherProject = join(home, "another-project"); mkdirSync(projectPath); mkdirSync(anotherProject);
  const pluginIds = pluginNames.map(plugin => `${plugin}@fixture-market`);
  const initialSettings = {
    theme: "dark",
    enabledPlugins: { ...Object.fromEntries(pluginIds.map(id => [id, false])), "other@market": false },
    pluginConfigs: {
      ...Object.fromEntries(pluginIds.map(id => [id, { options: { enabled: false, pollSeconds: 5, retainedOption: `keep-${id}` }, retainedConfig: `keep-${id}` }])),
      "other@market": { options: { enabled: true, retain: "other" } },
    },
    env: { OTHER_ENV: "retained", CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "0" },
    ...(extraMarketplaces ? { extraKnownMarketplaces: extraMarketplaces(home) } : {}),
  };
  put(settings, JSON.stringify(initialSettings));
  put(projectSettings, JSON.stringify({ permissions: { allow: ["Read"] } }));
  const initialKnown: Record<string, any> = {
    "unrelated-market": { source: { source: "directory", path: join(home, "unrelated-market") }, installLocation: join(home, ".claude/plugins/marketplaces/unrelated-market"), lastUpdated: "2026-10-01T00:00:00.000Z" },
    ...(existingMarketplace ? { "fixture-market": { source: { source: "directory", path: candidateRoot }, installLocation: candidateRoot, autoUpdate: true, lastUpdated: "2026-10-02T00:00:00.000Z" } } : {}),
  };
  mutateKnown?.(initialKnown);
  put(known, JSON.stringify(initialKnown));
  const initialRegistrations: Record<string, unknown> = {};
  for (const plugin of pluginNames) {
    const id = `${plugin}@fixture-market`, path = join(home, `.claude/plugins/cache/fixture-market/${plugin}/0.9.0`);
    initialRegistrations[id] = scope === "user"
      ? [{ scope: "local", projectPath, installPath: path, version: "0.8.0" }, { scope: "user", installPath: path, version: "0.9.0", installedAt: "2026-10-01T00:00:00.000Z", lastUpdated: "2026-10-03T00:00:00.000Z" }, { scope: "project", projectPath: anotherProject, installPath: path, version: "0.9.0", installedAt: "2026-10-01T00:00:00.000Z" }]
      : [{ scope: "project", projectPath: anotherProject, installPath: path, version: "0.8.0" }, { scope: "user", installPath: path, version: "0.9.0", installedAt: "2026-10-01T00:00:00.000Z", lastUpdated: "2026-10-03T00:00:00.000Z" }];
  }
  initialRegistrations["other@market"] = [{ scope: "local", projectPath, installPath: join(home, ".claude/local/other"), version: "4.0.0" }];
  for (const rows of Object.values(initialRegistrations) as Array<Array<Record<string, unknown>>>) {
    for (const row of rows) {
      row.installedAt ??= "2026-10-01T00:00:00.000Z";
      row.lastUpdated ??= "2026-10-03T00:00:00.000Z";
    }
  }
  put(installed, JSON.stringify({ version: 2, plugins: initialRegistrations }));
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
  const candidatePlugins = pluginNames.map(plugin => {
    const manifestPath = join(candidateRoot, `plugins/${plugin}/.claude-plugin/plugin.json`);
    put(manifestPath, JSON.stringify({ name: plugin, version: "1.0.0" }));
    return { plugin, manifestPath, manifestSha256: awaitManifestHash(manifestPath), optionsPatch: { enabled: true, pollSeconds: 10 } };
  });
  put(catalogPath, JSON.stringify({ name: "fixture-market", plugins: pluginNames.map(plugin => ({ name: plugin, version: "1.0.0", source: `./plugins/${plugin}` })) }));
  const targetSettings = scope === "project" ? projectSettings : settings;
  const targetSettingsAfter = JSON.parse(readFileSync(targetSettings, "utf8")); targetSettingsAfter.enabledPlugins ??= {}; targetSettingsAfter.pluginConfigs ??= {};
  for (const { plugin } of candidatePlugins) {
    const pluginId = `${plugin}@fixture-market`; targetSettingsAfter.enabledPlugins[pluginId] = true;
    const current = targetSettingsAfter.pluginConfigs[pluginId] ?? {};
    current.options = { ...(current.options ?? {}), pollSeconds: 10, enabled: true };
    targetSettingsAfter.pluginConfigs[pluginId] = current;
  }
  targetSettingsAfter.env ??= {};
  targetSettingsAfter.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1";
  const knownAfter = { ...structuredClone(initialKnown), "fixture-market": { source: { source: "directory", path: candidateRoot }, installLocation: candidateRoot, autoUpdate: false, lastUpdated: existingMarketplace ? { $allowed: ["2026-10-02T00:00:00.000Z", { $generated: "claude-utc-timestamp", field: "known-marketplaces.lastUpdated" }] } : { $generated: "claude-utc-timestamp", field: "known-marketplaces.lastUpdated" } } };
  const installedAfterPlugins: Record<string, any> = { ...initialRegistrations };
  for (const { plugin } of candidatePlugins) {
    const pluginId = `${plugin}@fixture-market`, rows = [...installedAfterPlugins[pluginId]];
    const index = rows.findIndex(row => row.scope === scope && (scope === "user" ? row.projectPath === undefined : row.projectPath === projectPath));
    const prior = index < 0 ? undefined : rows[index];
    const targetRow = { scope, ...(scope === "project" ? { projectPath } : {}), installPath: join(home, `.claude/plugins/cache/fixture-market/${plugin}/1.0.0`), version: "1.0.0",
      ...(prior?.installedAt === undefined ? { installedAt: { $generated: "claude-utc-timestamp", field: "installed_plugins.fresh-row.installedAt" } } : { installedAt: prior.installedAt }),
      lastUpdated: prior?.lastUpdated === undefined ? { $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" } : { $allowed: [prior.lastUpdated, { $generated: "claude-utc-timestamp", field: "installed_plugins.selected-row.lastUpdated" }] } };
    if (index < 0) rows.push(targetRow); else rows[index] = targetRow;
    installedAfterPlugins[pluginId] = rows;
  }
  const installedAfter = { version: 2, plugins: installedAfterPlugins };
  const request: ClaudeProspectiveReviewRequest = {
    schema: CLAUDE_PROSPECTIVE_REVIEW_SCHEMA,
    scope: { kind: scope, projectPath },
    native: { home, configRoot: join(home, ".claude"), pluginRoot: join(home, ".claude/plugins"), executable: { path: nativePath, target: nativePath, version: "2.1.295", sha256: sha(readFileSync(nativePath)) } },
    skills: { dataDir, policySha256: sha(readFileSync(join(dataDir, "agent-policy.json"))), discoverySha256: sha(JSON.stringify(binding)), discoveryInputs },
    candidate: { marketplace: "fixture-market", root: candidateRoot, catalogPath, catalogSha256: sha(readFileSync(catalogPath)), closureSha256: captureClaudeProspectiveCandidateClosure(candidateRoot), plugins: candidatePlugins, functionHooksEnv: "1" },
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

function refreshSettingsBinding(f: ReturnType<typeof fixture>): void {
  f.request.preimages.settings.sha256 = sha(readFileSync(f.request.preimages.settings.path));
  f.request.preimages.userSettings.sha256 = sha(readFileSync(f.request.preimages.userSettings.path));
  f.request.preimages.projectSettings.sha256 = sha(readFileSync(f.request.preimages.projectSettings.path));
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

test("Claude 2.1.293 user install models its exact selected marketplace source setting", () => {
  const f = fixture();
  f.request.native.executable.version = "2.1.293 (Claude Code)";
  f.request.candidate.settingsMarketplaceSource = "directory";
  f.request.delta.settingsAfter.extraKnownMarketplaces = {
    "fixture-market": { source: { source: "directory", path: f.candidateRoot } },
  };
  const before = [f.settings, f.known, f.installed, join(f.dataDir, "agent-policy.json")].map(path => readFileSync(path, "utf8"));
  expect(review(f.request).accepted).toBe(true);
  expect([f.settings, f.known, f.installed, join(f.dataDir, "agent-policy.json")].map(path => readFileSync(path, "utf8"))).toEqual(before);
});

test("the declared settings marketplace operation preserves supported foreign rows", () => {
  const f = fixture("user", false, ["demo"], home => ({
    "other-market": { source: { source: "directory", path: join(home, "other") }, autoUpdate: false },
    "fixture-market": { source: { source: "directory", path: join(home, "prior") } },
  }));
  f.request.native.executable.version = "2.1.293";
  f.request.candidate.settingsMarketplaceSource = "directory";
  const extra = JSON.parse(readFileSync(f.settings, "utf8")).extraKnownMarketplaces;
  const expected = { ...extra, "fixture-market": { ...extra["fixture-market"], source: { source: "directory", path: f.candidateRoot } } };
  f.request.delta.settingsAfter.extraKnownMarketplaces = structuredClone(expected);
  expect(review(f.request).accepted).toBe(true);
  for (const mutate of [
    (value: any) => { delete value["other-market"]; },
    (value: any) => { value["other-market"].autoUpdate = true; },
    (value: any) => { value["fixture-market"].autoUpdate = false; },
    (value: any) => { value["fixture-market"].source.path = join(f.home, "unreviewed"); },
    (value: any) => { value["fixture-market"].source.source = "github"; },
    (value: any) => { value.injected = { source: { source: "directory", path: f.candidateRoot } }; },
  ]) {
    const altered = structuredClone(expected); mutate(altered);
    f.request.delta.settingsAfter.extraKnownMarketplaces = altered;
    expect(() => review(f.request)).toThrow("complete settings document differs");
  }
});

test("native metadata loss refuses before installation even when the caller predicts preservation", () => {
  for (const [name, metadata] of [
    ["fixture-market", { autoUpdate: false }],
    ["fixture-market", { fixtureMetadata: { preserve: true } }],
    ["other-market", { fixtureMetadata: { preserve: true } }],
  ] as const) {
    const f = fixture("user", false, ["demo"], home => ({ [name]: { source: { source: "directory", path: join(home, "prior") }, ...metadata } }));
    f.request.native.executable.version = "2.1.293";
    f.request.candidate.settingsMarketplaceSource = "directory";
    const before = readFileSync(f.settings, "utf8");
    const extra = JSON.parse(before).extraKnownMarketplaces;
    f.request.delta.settingsAfter.extraKnownMarketplaces = { ...extra, "fixture-market": { ...extra["fixture-market"], source: { source: "directory", path: f.candidateRoot } } };
    expect(() => review(f.request)).toThrow("metadata cannot be preserved");
    expect(readFileSync(f.settings, "utf8")).toBe(before);
  }
});

test("native known-marketplace metadata loss refuses before writes even when the caller predicts preservation", () => {
  for (const mutate of [
    (rows: Record<string, any>) => { rows["unrelated-market"].fixtureMetadata = { preserve: true }; },
    (rows: Record<string, any>) => { rows["unrelated-market"].source.fixtureMetadata = "preserve"; },
    (rows: Record<string, any>) => { rows["fixture-market"].source.fixtureMetadata = "preserve"; },
  ]) {
    const f = fixture("user", true, ["demo"], undefined, mutate);
    f.request.native.executable.version = "2.1.293";
    f.request.candidate.settingsMarketplaceSource = "directory";
    f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
    const paths = [f.settings, f.known, f.installed, join(f.dataDir, "agent-policy.json")];
    const before = paths.map(path => readFileSync(path, "utf8"));
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED");
    expect(paths.map(path => readFileSync(path, "utf8"))).toEqual(before);
  }
});

test("the measured known-marketplace directory row retains foreign auto-update metadata", () => {
  const f = fixture("user", true, ["demo"], undefined, rows => { rows["unrelated-market"].autoUpdate = true; });
  f.request.native.executable.version = "2.1.293";
  f.request.candidate.settingsMarketplaceSource = "directory";
  f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
  const before = readFileSync(f.known, "utf8");
  expect(review(f.request).accepted).toBe(true);
  expect(readFileSync(f.known, "utf8")).toBe(before);
});

test("the foreign GitHub index projection preserves the row without widening the install source", () => {
  const f = fixture("user", true, ["demo"], undefined, rows => {
    rows["unrelated-market"].source = { source: "github", repo: "example/official-plugins" };
    rows["unrelated-market"].autoUpdate = true;
  });
  f.request.native.executable.version = "2.1.293";
  f.request.candidate.settingsMarketplaceSource = "directory";
  f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
  const before = readFileSync(f.known, "utf8");
  expect(review(f.request).accepted).toBe(true);
  expect(readFileSync(f.known, "utf8")).toBe(before);
  (f.request.delta.knownMarketplacesAfter["unrelated-market"] as Record<string, any>).source.repo = "example/replaced";
  expect(() => review(f.request)).toThrow("complete marketplace document differs");
});

test("the known-marketplace preflight refuses unknown GitHub metadata and malformed foreign fields", () => {
  for (const mutate of [
    (row: any) => { row.source = { source: "github", repo: "example/other", ref: "main" }; },
    (row: any) => { row.source = { source: "github", repo: "https://example.invalid/other" }; },
    (row: any) => { row.source = { source: "github", repo: "example/other\n" }; },
    (row: any) => { row.source = { source: "git", url: "https://example.invalid/other" }; },
    (row: any) => { row.autoUpdate = "true"; },
    (row: any) => { row.installLocation = "relative"; },
    (row: any) => { row.lastUpdated = "invalid"; },
  ]) {
    const f = fixture("user", true, ["demo"], undefined, rows => mutate(rows["unrelated-market"]));
    f.request.native.executable.version = "2.1.293";
    f.request.candidate.settingsMarketplaceSource = "directory";
    f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
    const before = readFileSync(f.known, "utf8");
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED");
    expect(readFileSync(f.known, "utf8")).toBe(before);
  }
});

test("the declared native operation refuses installed-registry metadata loss before any writer", () => {
  for (const mutate of [
    (registry: any) => { registry.fixtureMetadata = { preserve: true }; },
    (registry: any) => { registry.plugins["other@market"][0].fixtureMetadata = "preserve"; },
    (registry: any) => { registry.plugins["demo@fixture-market"][0].fixtureMetadata = "preserve"; },
  ]) {
    const f = fixture();
    f.request.native.executable.version = "2.1.293";
    f.request.candidate.settingsMarketplaceSource = "directory";
    f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
    expect(review(f.request).accepted).toBe(true);
    const registry = JSON.parse(readFileSync(f.installed, "utf8"));
    mutate(registry);
    mutate(f.request.delta.installedPluginsAfter);
    refreshRegistryBinding(f, registry);
    const paths = [f.settings, f.known, f.installed, join(f.dataDir, "agent-policy.json")];
    const before = paths.map(path => readFileSync(path, "utf8"));
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED");
    expect(paths.map(path => readFileSync(path, "utf8"))).toEqual(before);
  }
});

test("the installed-registry projection preserves supported foreign Git metadata", () => {
  const f = fixture();
  f.request.native.executable.version = "2.1.293";
  f.request.candidate.settingsMarketplaceSource = "directory";
  f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
  const registry = JSON.parse(readFileSync(f.installed, "utf8"));
  registry.plugins["other@market"][0].gitCommitSha = "a".repeat(40);
  (f.request.delta.installedPluginsAfter.plugins as Record<string, any>)["other@market"][0].gitCommitSha = "a".repeat(40);
  refreshRegistryBinding(f, registry);
  const before = readFileSync(f.installed, "utf8");
  expect(review(f.request).accepted).toBe(true);
  expect(readFileSync(f.installed, "utf8")).toBe(before);
  (f.request.delta.installedPluginsAfter.plugins as Record<string, any>)["other@market"][0].gitCommitSha = "b".repeat(40);
  expect(() => review(f.request)).toThrow("complete installed plugin document changes an unrelated registration");
});

test("unmeasured or malformed foreign source declarations refuse the directory operation", () => {
  for (const source of [
    { source: "github", repo: "example/other" },
    { source: "directory", path: "/fixture/other", extra: "unknown" },
    { source: "directory", path: "relative" },
  ]) {
    const f = fixture("user", false, ["demo"], () => ({ "other-market": { source } }));
    f.request.native.executable.version = "2.1.293";
    f.request.candidate.settingsMarketplaceSource = "directory";
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED");
  }
});

test("a malformed current settings marketplace map or selected row cannot be normalized", () => {
  for (const malformed of [null, [], true, "invalid", { "fixture-market": null }, { "fixture-market": [] }]) {
    const f = fixture("user", false, ["demo"], () => malformed);
    f.request.native.executable.version = "2.1.293";
    f.request.candidate.settingsMarketplaceSource = "directory";
    f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
    expect(() => review(f.request)).toThrow("is not an object");
  }
});

test("settings marketplace mutation is explicit and restricted to the measured native operation", () => {
  for (const version of ["2.1.292", "2.1.294", "2.1.295", "2.1.293-beta", "2.1.293+local"]) {
    const f = fixture(); f.request.native.executable.version = version;
    f.request.candidate.settingsMarketplaceSource = "directory";
    expect(() => review(f.request)).toThrow("measured Claude 2.1.293 user scope");
  }
  const project = fixture("project"); project.request.native.executable.version = "2.1.293";
  project.request.candidate.settingsMarketplaceSource = "directory";
  expect(() => review(project.request)).toThrow("measured Claude 2.1.293 user scope");
  const f = fixture(); f.request.native.executable.version = "2.1.293";
  f.request.delta.settingsAfter.extraKnownMarketplaces = { "fixture-market": { source: { source: "directory", path: f.candidateRoot } } };
  expect(() => review(f.request)).toThrow("complete settings document differs");
  (f.request.candidate as any).settingsMarketplaceSource = "github";
  expect(() => review(f.request)).toThrow("measured Claude 2.1.293 user scope");
});

test("prospective review accepts an exact user-scoped frozen candidate without writing native state", () => {
  const f = fixture();
  const before = readFileSync(f.settings, "utf8");
  const receipt = review(f.request);
  expect(receipt.accepted).toBe(true);
  expect(receipt.applied).toBe(false);
  expect(receipt.ownedDelta.settingsEnabledPlugins).toEqual(["demo@fixture-market"]);
  expect(receipt.ownedDelta.functionHooksEnv).toBe("1");
  expect(readFileSync(f.settings, "utf8")).toBe(before);
});

test("CLI receipt binds one complete two-plugin request and semantic post-state for an external adapter", async () => {
  const f = fixture("project", false, ["messages", "conversations"]), requestBytes = Buffer.from(JSON.stringify(f.request));
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
  expect(receipt.pluginIds).toEqual(["messages@fixture-market", "conversations@fixture-market"]);
  expect(receipt.targetSettingsPath).toBe(f.projectSettings);
  expect(receipt.semanticDocumentsSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.operationSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.expectedPostStateSha256).toMatch(/^[a-f0-9]{64}$/);
  expect([f.settings, f.projectSettings].map(path => readFileSync(path, "utf8"))).toEqual(before);
});

test("one prospective batch preserves unrelated plugin options and existing registration positions", () => {
  const f = fixture("user", false, ["messages", "conversations"]);
  const before = JSON.parse(readFileSync(f.settings, "utf8"));
  const receipt = review(f.request);
  const after = f.request.delta.settingsAfter as Record<string, any>;
  expect(receipt.pluginIds).toEqual(["messages@fixture-market", "conversations@fixture-market"]);
  expect(after.pluginConfigs["messages@fixture-market"].retainedConfig).toBe("keep-messages@fixture-market");
  expect(after.pluginConfigs["messages@fixture-market"].options).toEqual({ enabled: true, pollSeconds: 10, retainedOption: "keep-messages@fixture-market" });
  expect(after.pluginConfigs["conversations@fixture-market"].options).toEqual({ enabled: true, pollSeconds: 10, retainedOption: "keep-conversations@fixture-market" });
  expect(after.pluginConfigs["other@market"]).toEqual(before.pluginConfigs["other@market"]);
  expect(after.enabledPlugins["other@market"]).toBe(false);
  expect(after.env).toEqual({ OTHER_ENV: "retained", CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" });
  const beforeRows = JSON.parse(readFileSync(f.installed, "utf8")).plugins;
  const afterRows = (f.request.delta.installedPluginsAfter as Record<string, any>).plugins;
  for (const id of receipt.pluginIds) {
    expect(afterRows[id][0]).toEqual(beforeRows[id][0]);
    expect(afterRows[id][1].scope).toBe("user");
    expect(afterRows[id][1].version).toBe("1.0.0");
    expect(afterRows[id][2]).toEqual(beforeRows[id][2]);
  }
});

test("function-hook environment is preserved exactly when the request declares no mutation", () => {
  const f = fixture();
  delete f.request.candidate.functionHooksEnv;
  const expected = f.request.delta.settingsAfter as Record<string, any>;
  expected.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "0";
  expect(() => review(f.request)).not.toThrow();
});

test("optional separate release manifest witness binds its complete bytes and path", () => {
  const f = fixture();
  const releaseManifest = join(f.home, "release.json");
  put(releaseManifest, JSON.stringify({ version: 1, options: { pollSeconds: 10 }, retained: ["whole-file-binding"] }));
  const bytes = readFileSync(releaseManifest);
  f.request.candidate.releaseManifest = { path: releaseManifest, sha256: sha(bytes) };
  const receipt = review(f.request);
  expect(receipt.candidate.releaseManifest).toEqual(f.request.candidate.releaseManifest);
  put(releaseManifest, JSON.stringify({ version: 1, options: { pollSeconds: 10 }, retained: ["changed"] }));
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});

test("a selected enabledPlugins array mutation refuses instead of being normalized to true", () => {
  const f = fixture();
  (f.request.delta.settingsAfter as Record<string, any>).enabledPlugins["demo@fixture-market"] = ["native-array-shape"];
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});

test("a current selected enabledPlugins array cannot be rebound by the supported discovery resolver", () => {
  const f = fixture();
  const current = JSON.parse(readFileSync(f.settings, "utf8"));
  current.enabledPlugins["demo@fixture-market"] = ["native-array-shape"];
  put(f.settings, JSON.stringify(current));
  refreshSettingsBinding(f);
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});

test("second batch member source escape refuses before any settings mutation is possible", () => {
  const f = fixture("user", false, ["messages", "conversations"]);
  const shallowManifest = join(f.candidateRoot, "plugin.json");
  put(shallowManifest, JSON.stringify({ name: "conversations", version: "1.0.0" }));
  const catalog = JSON.parse(readFileSync(f.request.candidate.catalogPath, "utf8"));
  catalog.plugins[1].source = "./..";
  put(f.request.candidate.catalogPath, JSON.stringify(catalog));
  f.request.candidate.plugins[1]!.manifestPath = shallowManifest;
  f.request.candidate.plugins[1]!.manifestSha256 = awaitManifestHash(shallowManifest);
  f.request.candidate.catalogSha256 = sha(readFileSync(f.request.candidate.catalogPath));
  f.request.candidate.closureSha256 = captureClaudeProspectiveCandidateClosure(f.candidateRoot);
  const before = readFileSync(f.settings, "utf8");
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  expect(readFileSync(f.settings, "utf8")).toBe(before);
});

test("native dependency on the second batch member refuses before the batch can proceed", () => {
  const f = fixture("user", false, ["messages", "conversations"]);
  const catalog = JSON.parse(readFileSync(f.request.candidate.catalogPath, "utf8"));
  catalog.plugins[1].dependencies = ["unselected-external-plugin"];
  put(f.request.candidate.catalogPath, JSON.stringify(catalog));
  f.request.candidate.catalogSha256 = sha(readFileSync(f.request.candidate.catalogPath));
  f.request.candidate.closureSha256 = captureClaudeProspectiveCandidateClosure(f.candidateRoot);
  const before = readFileSync(f.settings, "utf8");
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  expect(readFileSync(f.settings, "utf8")).toBe(before);
});

test("nontrivial marketplace metadata pluginRoot refuses external source rebasing", () => {
  const f = fixture();
  const catalog = JSON.parse(readFileSync(f.request.candidate.catalogPath, "utf8"));
  catalog.metadata = { pluginRoot: "../external" };
  put(f.request.candidate.catalogPath, JSON.stringify(catalog));
  f.request.candidate.catalogSha256 = sha(readFileSync(f.request.candidate.catalogPath));
  f.request.candidate.closureSha256 = captureClaudeProspectiveCandidateClosure(f.candidateRoot);
  const before = readFileSync(f.settings, "utf8");
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  expect(readFileSync(f.settings, "utf8")).toBe(before);
});

test("cache path collisions after native sanitization refuse a multi-plugin batch", () => {
  const f = fixture("user", false, ["messages.v1", "messages-v1"]);
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});

test("malformed and duplicate selected plugin batch members refuse", () => {
  const malformedRows: unknown[] = [null, "demo", { plugin: "demo", manifestPath: "/x", manifestSha256: "a".repeat(64), optionsPatch: [] }];
  for (const row of malformedRows) {
    const f = fixture();
    (f.request.candidate as any).plugins = [row];
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  }
  const duplicate = fixture();
  const selected = duplicate.request.candidate.plugins[0]!;
  duplicate.request.candidate.plugins.push(structuredClone(selected));
  expect(() => review(duplicate.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});

test("the options patch must explicitly bind enabled true", () => {
  for (const optionsPatch of [{ pollSeconds: 10 }, { enabled: false, pollSeconds: 10 }]) {
    const f = fixture();
    f.request.candidate.plugins[0]!.optionsPatch = optionsPatch;
    expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
  }
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

test("user and project updates preserve a same-plugin local registration with its projectPath", () => {
  for (const scope of ["user", "project"] as const) {
    const f = fixture(scope);
    const localRow = {
      scope: "local",
      projectPath: f.request.scope.projectPath,
      installPath: join(f.home, ".claude/local/demo"),
      version: "0.8.0",
      retainedNativeField: "preserve-local-row",
    };
    const before = JSON.parse(readFileSync(f.installed, "utf8"));
    const id = "demo@fixture-market";
    before.plugins[id].splice(0, 1, localRow);
    const after = structuredClone(f.request.delta.installedPluginsAfter as Record<string, any>);
    after.plugins[id].splice(0, 1, localRow);
    (f.request.delta as Record<string, unknown>).installedPluginsAfter = after;
    refreshRegistryBinding(f, before);

    expect(() => review(f.request)).not.toThrow();
    const reviewedRows = (f.request.delta.installedPluginsAfter as Record<string, any>).plugins[id];
    expect(reviewedRows[0]).toEqual(localRow);
    expect(reviewedRows[0].scope).toBe("local");
    expect(reviewedRows[0].projectPath).toBe(f.request.scope.projectPath);
  }
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
  const localRow = { scope: "local", projectPath: local.request.scope.projectPath, installPath: join(local.home, ".claude/local/demo"), version: "1.0.0", retainedNativeField: true };
  localRegistry.plugins["demo@fixture-market"].push(localRow);
  refreshRegistryBinding(local, localRegistry);
  const localRows = (local.request.delta.installedPluginsAfter as Record<string, any>).plugins["demo@fixture-market"] as Array<Record<string, unknown>>;
  localRows.push(localRow);
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
      const manifestPath = f.request.candidate.plugins[0]!.manifestPath;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.skills = "./skills";
      put(manifestPath, JSON.stringify(manifest));
      f.request.candidate.plugins[0]!.manifestSha256 = awaitManifestHash(manifestPath);
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

test("a shallow plugin.json cannot derive a source root outside the frozen closure", () => {
  const f = fixture();
  const shallowManifest = join(f.candidateRoot, "plugin.json");
  put(shallowManifest, JSON.stringify({ name: "demo", version: "1.0.0" }));
  const catalog = JSON.parse(readFileSync(f.request.candidate.catalogPath, "utf8"));
  catalog.plugins[0].source = "./..";
  put(f.request.candidate.catalogPath, JSON.stringify(catalog));
  f.request.candidate.plugins[0]!.manifestPath = shallowManifest;
  f.request.candidate.plugins[0]!.manifestSha256 = awaitManifestHash(shallowManifest);
  f.request.candidate.catalogSha256 = sha(readFileSync(f.request.candidate.catalogPath));
  f.request.candidate.closureSha256 = captureClaudeProspectiveCandidateClosure(f.candidateRoot);
  expect(() => review(f.request)).toThrow("CLAUDE_CANDIDATE_REVIEW_REFUSED:");
});
