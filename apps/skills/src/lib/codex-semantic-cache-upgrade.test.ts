import { afterEach, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { captureDiscoveryDirectories, verifyAgentDiscovery, resolveAgentDiscovery, rebindAgentDiscovery, codexSemanticCacheSourceRole, codexSemanticCacheDirectoryRole, type AgentDiscoveryBinding } from "./agent-discovery.js";
import { planCodexSemanticCacheWitnessUpgrade, applyAgentIntegration } from "./agent-integration.js";
import { hashCodexSettingsReplacementV5 } from "./codex-settings-witness.js";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { serializeManagedSkillPolicy, parseManagedSkillPolicy } from "./managed-policy.js";
import type { CodexPluginSkillControl } from "./codex-plugin-skill-controls.js";
import { buildCliFixture } from "../cli/cli-build.fixture.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const put = (path: string, text: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };

function fixture(reviewedVersion = "codex-cli 0.162.0") {
  const home = mkdtempSync(join(tmpdir(), "skills-semantic-cache-upgrade-")); roots.push(home);
  const dataDir = join(home, "data"), cache = join(home, ".codex/plugins/cache"), parent = join(cache, "market/vendor"), appParent = join(cache, "market/connector");
  const receipt = (remote: string) => JSON.stringify({ schema_version: 1, remote_plugin_id: remote });
  put(join(parent, ".codex-remote-plugin-install.json"), receipt("remote-vendor"));
  put(join(appParent, ".codex-remote-plugin-install.json"), receipt("remote-connector"));
  const addSkill = (version: string) => {
    const root = join(parent, version), manifest = JSON.stringify({ name: "vendor", version });
    put(join(root, ".codex-plugin/plugin.json"), manifest);
    put(join(root, "skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: Synthetic disabled skill\n---\nContent");
    return { root, manifest };
  };
  const addApp = (version: string) => {
    const root = join(appParent, version), manifest = JSON.stringify({ name: "connector", version, apps: "./.app.json" });
    put(join(root, ".codex-plugin/plugin.json"), manifest);
    put(join(root, ".app.json"), '{"apps":{"connector":{"id":"synthetic_connector"}}}');
    return root;
  };
  const skill = addSkill("1.0.0"), appRoot = addApp("1.0.0");
  const config = join(home, ".codex/config.toml"), settings = '[[skills.config]]\nname="vendor:deploy"\nenabled=false\n'; put(config, settings);
  const external = join(home, "unrelated/manifest.json"); put(external, "{}");
  const controls: CodexPluginSkillControl[] = [{ name: "vendor:deploy", pluginId: "vendor@market", namespace: "vendor", pluginParent: parent, manifestSha256: hashNativeJsonControls(skill.manifest, "version"), remotePluginId: "remote-vendor" }];
  const source = (path: string) => ({ path, sha256: sha(readFileSync(path, "utf8")) });
  const binding: AgentDiscoveryBinding = { agent: "codex", method: "reviewed", roots: [cache], codexDisabledPluginSkills: controls, directories: captureDiscoveryDirectories([cache, join(home, "unrelated")]), sources: [
    { path: config, hashMode: "codex-settings-v5", sha256: hashCodexSettingsReplacementV5(settings) }, source(external), source(join(parent, ".codex-remote-plugin-install.json")), source(join(appParent, ".codex-remote-plugin-install.json")),
    source(join(skill.root, ".codex-plugin/plugin.json")), source(join(appRoot, ".codex-plugin/plugin.json")),
    { path: join(skill.root, "SKILL.md"), sha256: null }, { path: join(skill.root, "hooks/hooks.json"), sha256: null },
  ] };
  const policyPath = join(dataDir, "agent-policy.json");
  const policy = serializeManagedSkillPolicy({ version: 1, loading: "cli", profileId: "fleet", bridge: { discovery: { codex: binding }, codexPluginSkills: controls, codexPluginSkillReview: { version: reviewedVersion, catalogSha256: "a".repeat(64) } } });
  put(policyPath, policy);
  const options = { agent: "codex" as const, home, dataDir, appOnlyParents: [appParent], expectedPolicySha256: sha(policy), expectedSettingsSha256: sha(settings) };
  return { home, dataDir, cache, parent, appParent, appRoot, skill, binding, policy, policyPath, config, settings, external, controls, addSkill, addApp, options };
}

test("explicit semantic migration retains legacy proof and accepts inert cache changes with equivalent versions", () => {
  const f = fixture();
  expect(() => verifyAgentDiscovery(f.binding)).not.toThrow();
  put(join(f.skill.root, "assets/example.txt"), "Benign new asset"); f.addSkill("2.0.0"); f.addApp("2.0.0");
  expect(() => verifyAgentDiscovery(f.binding)).toThrow("directory membership changed");
  const plan = planCodexSemanticCacheWitnessUpgrade(f.options), next = plan.discoveryAfter![0]!;
  expect(plan.changes.map(change => change.path)).toEqual([f.policyPath]);
  expect(next.sources).toEqual(f.binding.sources);
  expect(next.directories).toEqual(f.binding.directories);
  expect(next.codexSemanticCache!.previousPolicySha256).toBe(sha(f.policy));
  expect(next.codexSemanticCache!.witness.appOnlyParents).toHaveLength(1);
  expect(next.codexSemanticCache!.witness.skills.map(skill => skill.name)).toEqual(["vendor:deploy"]);
  expect(() => verifyAgentDiscovery(next)).not.toThrow();
  expect(resolveAgentDiscovery({ home: f.home, agent: "codex", retainedReview: next })).toEqual(next);
  expect(rebindAgentDiscovery(next, new Map())).toEqual(next);
  put(join(f.skill.root, "assets/second.txt"), "Another asset"); f.addSkill("3.0.0"); f.addApp("3.0.0");
  expect(() => verifyAgentDiscovery(next)).not.toThrow();
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy);
  expect(readFileSync(f.config, "utf8")).toBe(f.settings);
  const parsed = parseManagedSkillPolicy(plan.changes[0]!.after);
  expect(parsed.bridge.codexPluginSkills).toEqual(f.controls);
});

test("retained installed-plugin review versions 0.160.0 and 0.162.0 support the same guarded cache contract", () => {
  for (const version of ["codex-cli 0.160.0", "codex-cli 0.162.0"]) {
    const f = fixture(version);
    put(join(f.skill.root, "assets/new.txt"), "Benign cache refresh");
    const plan = planCodexSemanticCacheWitnessUpgrade(f.options);
    expect(() => verifyAgentDiscovery(plan.discoveryAfter![0]!)).not.toThrow();
    expect(parseManagedSkillPolicy(plan.changes[0]!.after).bridge.codexPluginSkillReview!.version).toBe(version);
    expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy);
  }
});

test("explicit roles refuse omitted, foreign, aliased, skill-bearing, and changed app-only provenance", () => {
  const f = fixture();
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, appOnlyParents: [] })).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, appOnlyParents: [f.parent] })).toThrow("Unsupported app-only parent");
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, appOnlyParents: [f.home] })).toThrow("Unsupported app-only parent");
  const alias = join(f.cache, "market/alias"); symlinkSync(f.appParent, alias);
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, appOnlyParents: [alias] })).toThrow();
  rmSync(alias);
  put(join(f.appRoot, ".codex-plugin/plugin.json"), JSON.stringify({ name: "connector", version: "1.0.0", apps: "./.app.json", description: "changed" }));
  expect(() => planCodexSemanticCacheWitnessUpgrade(f.options)).toThrow("Reviewed cache identity source changed");
});

test("unknown sources and directories remain strict before and after migration", () => {
  const f = fixture(), plan = planCodexSemanticCacheWitnessUpgrade(f.options), next = plan.discoveryAfter![0]!;
  put(f.external, '{"changed":true}');
  expect(() => planCodexSemanticCacheWitnessUpgrade(f.options)).toThrow("Native discovery input changed");
  expect(() => verifyAgentDiscovery(next)).toThrow("Native discovery input changed");
  put(f.external, "{}"); put(join(f.home, "unrelated/new.txt"), "new member");
  expect(() => verifyAgentDiscovery(next)).toThrow("directory membership changed");
});

test("guarded cache digest, policy/config CAS, tampered plans and raced capabilities refuse without policy writes", () => {
  const f = fixture(), preview = planCodexSemanticCacheWitnessUpgrade(f.options), digest = preview.discoveryAfter![0]!.codexSemanticCache!.witness.sha256;
  const plan = planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedCacheWitnessSha256: digest });
  expect(() => applyAgentIntegration(preview)).toThrow("Invalid cache witness upgrade plan");
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedCacheWitnessSha256: "0".repeat(64) })).toThrow("semantic cache preimage changed");
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedPolicySha256: "0".repeat(64) })).toThrow("policy preimage changed");
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedSettingsSha256: "0".repeat(64) })).toThrow("settings preimage changed");
  const tampered = structuredClone(plan); tampered.changes[0]!.after += " ";
  expect(() => applyAgentIntegration(tampered)).toThrow("Cache witness upgrade plan changed");
  put(join(f.appRoot, ".app.json"), '{"apps":{"connector":{"id":"different_connector"}}}');
  expect(() => applyAgentIntegration(plan)).toThrow("semantic cache preimage changed");
  expect(() => verifyAgentDiscovery(plan.discoveryAfter![0]!)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy);
});

test("new control paths, disabled skill-name replacement, and role-proof tampering remain blocking", () => {
  const f = fixture(), plan = planCodexSemanticCacheWitnessUpgrade(f.options), next = plan.discoveryAfter![0]!;
  const forged = structuredClone(next); forged.codexSemanticCache!.supersededSources.push({ path: f.external, sha256: sha("{}") });
  expect(() => verifyAgentDiscovery(forged)).toThrow("provenance changed");
  put(join(f.skill.root, "nested/.mcp.json"), "{}");
  expect(() => verifyAgentDiscovery(next)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  rmSync(join(f.skill.root, "nested"), { recursive: true });
  put(join(f.skill.root, "skills/deploy/SKILL.md"), "---\nname: ship\ndescription: Synthetic replacement\n---\nContent");
  expect(() => verifyAgentDiscovery(next)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("direct hooks cannot select projected cache assets; managed hooks outside the cache remain valid", () => {
  const f = fixture();
  const setHooks = (command: string) => {
    const settings = f.settings + `\n[hooks]\ncommand=${JSON.stringify(command)}\n`;
    put(f.config, settings);
    const policy = JSON.parse(f.policy);
    policy.bridge.discovery.codex.sources.find((source: any) => source.path === f.config).sha256 = hashCodexSettingsReplacementV5(settings);
    const text = serializeManagedSkillPolicy(policy); put(f.policyPath, text);
    return { ...f.options, expectedSettingsSha256: sha(settings), expectedPolicySha256: sha(text) };
  };
  const managed = setHooks(join(f.home, "retained-runtime/bin/skills"));
  const plan = planCodexSemanticCacheWitnessUpgrade(managed);
  expect(() => verifyAgentDiscovery(plan.discoveryAfter![0]!)).not.toThrow();
  expect(() => planCodexSemanticCacheWitnessUpgrade(setHooks(join(f.skill.root, "assets/hook.sh")))).toThrow("Direct native hooks select");
  const restored = setHooks(join(f.home, "retained-runtime/bin/skills"));
  put(join(f.home, ".codex/hooks.json"), JSON.stringify({ hooks: { Stop: [{ command: join(f.appRoot, "asset.sh") }] } }));
  expect(() => planCodexSemanticCacheWitnessUpgrade(restored)).toThrow("Direct native hooks select");
});

test("HOME, tilde and relative direct cache hook selectors refuse; external managed hooks remain valid", () => {
  const f = fixture(), next = planCodexSemanticCacheWitnessUpgrade(f.options).discoveryAfter![0]!;
  const hooks = join(f.home, ".codex/hooks.json");
  for (const command of [
    'sh "$HOME/.codex/plugins/cache/market/vendor/1.0.0/assets/hook.sh"',
    'sh "${HOME}/.codex/plugins/cache/market/vendor/1.0.0/assets/hook.sh"',
    'sh ~/.codex/plugins/cache/market/vendor/1.0.0/assets/hook.sh',
    'sh .codex/plugins/cache/market/vendor/1.0.0/assets/hook.sh',
    'sh plugins/cache/market/vendor/1.0.0/assets/hook.sh',
  ]) {
    put(hooks, JSON.stringify({ hooks: { Stop: [{ command }] } }));
    expect(() => planCodexSemanticCacheWitnessUpgrade(f.options)).toThrow("Direct native hooks select");
    expect(() => verifyAgentDiscovery(next)).toThrow("Direct native hooks select");
  }
  put(hooks, JSON.stringify({ hooks: { Stop: [{ command: join(f.home, "retained-runtime/bin/skills") + " hook" }] } }));
  expect(() => planCodexSemanticCacheWitnessUpgrade(f.options)).not.toThrow();
  expect(() => verifyAgentDiscovery(next)).not.toThrow();
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy);
});

test("ancestor aggregate coverage cannot be waived and source roles reject null manifests or normalized escapes", () => {
  const f = fixture();
  const manifest = join(f.skill.root, ".codex-plugin/plugin.json");
  expect(codexSemanticCacheDirectoryRole(f.cache + "/../outside", f.cache)).toBe(false);
  expect(codexSemanticCacheDirectoryRole(f.cache, f.cache)).toBe(true);
  expect(codexSemanticCacheSourceRole({ path: manifest, sha256: null }, f.cache, [f.parent])).toBe(false);
  expect(codexSemanticCacheSourceRole({ path: f.skill.root + "/../1.0.0/.codex-plugin/plugin.json", sha256: sha(f.skill.manifest) }, f.cache, [f.parent])).toBe(false);
  const policy = JSON.parse(f.policy);
  policy.bridge.discovery.codex.directories.push(...captureDiscoveryDirectories([join(f.home, ".codex/plugins")]));
  const text = serializeManagedSkillPolicy(policy); put(f.policyPath, text);
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedPolicySha256: sha(text) })).toThrow("unproved ancestor projection");
});

test("reviewed whole Codex root aliases preserve the exact canonical config source and cache roles", () => {
  const f = fixture(), alias = join(f.home, ".codex"), target = join(f.home, "owned-codex");
  renameSync(alias, target); symlinkSync(target, alias);
  const policy = JSON.parse(f.policy.split(alias).join(target));
  const linkStat = lstatSync(alias, { bigint: true }), targetStat = lstatSync(target);
  policy.bridge.rootAliases = [{ agent: "codex", home: f.home, alias, target, link: target, aliasIdentity: `${linkStat.dev}:${linkStat.ino}:${linkStat.ctimeNs}`, targetIdentity: `${targetStat.dev}:${targetStat.ino}` }];
  const text = serializeManagedSkillPolicy(policy); put(f.policyPath, text);
  const plan = planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedPolicySha256: sha(text), appOnlyParents: [f.appParent.replace(alias, target)] });
  const next = plan.discoveryAfter![0]!;
  expect(next.codexSemanticCache!.configPath).toBe(join(target, "config.toml"));
  expect(() => verifyAgentDiscovery(next)).not.toThrow();
  expect(plan.rootAliases).toEqual(policy.bridge.rootAliases);
  expect(next.codexSemanticCache!.hookRootAlias).toEqual({ alias, target });
  const forged = structuredClone(next); forged.codexSemanticCache!.hookRootAlias!.target = f.home;
  expect(() => verifyAgentDiscovery(forged)).toThrow("hook alias changed");
  const removed = structuredClone(next); removed.codexSemanticCache!.hookRootAlias = null;
  expect(() => verifyAgentDiscovery(removed, undefined, policy.bridge.rootAliases)).toThrow("differs from reviewed root binding");
  const aliasCommand = join(alias, "plugins/cache/market/vendor/1.0.0/assets/hook.sh");
  const hooked = f.settings + `\n[hooks]\ncommand=${JSON.stringify(aliasCommand)}\n`;
  put(join(target, "config.toml"), hooked);
  const hookedPolicy = structuredClone(policy);
  hookedPolicy.bridge.discovery.codex.sources.find((source: any) => source.path === join(target, "config.toml")).sha256 = hashCodexSettingsReplacementV5(hooked);
  const hookedText = serializeManagedSkillPolicy(hookedPolicy); put(f.policyPath, hookedText);
  const hookedNext = structuredClone(next);
  hookedNext.sources.find(source => source.path === join(target, "config.toml"))!.sha256 = hashCodexSettingsReplacementV5(hooked);
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedPolicySha256: sha(hookedText), expectedSettingsSha256: sha(hooked), appOnlyParents: [f.appParent.replace(alias, target)] })).toThrow("Direct native hooks select");
  expect(() => verifyAgentDiscovery(hookedNext)).toThrow("Direct native hooks select");
  put(join(target, "config.toml"), f.settings); put(f.policyPath, text);
  put(join(target, "hooks.json"), JSON.stringify({ hooks: { Stop: [{ command: aliasCommand }] } }));
  expect(() => verifyAgentDiscovery(next)).toThrow("Direct native hooks select");
  expect(() => planCodexSemanticCacheWitnessUpgrade({ ...f.options, expectedPolicySha256: sha(text), appOnlyParents: [f.appParent.replace(alias, target)] })).toThrow("Direct native hooks select");
  rmSync(join(target, "hooks.json"));
  const other = join(f.home, "different-codex"); mkdirSync(other);
  rmSync(alias); symlinkSync(other, alias);
  expect(() => verifyAgentDiscovery(next)).toThrow("hook alias changed");
  rmSync(alias);
  expect(() => verifyAgentDiscovery(next)).toThrow("hook alias changed");
});

test("the built cache CLI previews the exact roles and refuses unguarded apply or foreign agents", async () => {
  const f = fixture(), binary = join(f.home, "built/skills.js"); mkdirSync(join(f.home, "built"));
  await buildCliFixture(join(import.meta.dir, "../cli/index.tsx"), binary);
  const run = async (extra: string[], agent = "codex") => {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, "hook", "rebind-cache", "--agent", agent,
      "--app-only-parent", f.appParent, "--expected-policy-sha256", sha(f.policy), "--expected-settings-sha256", sha(f.settings), "--json", ...extra], {
      cwd: f.home, env: { HOME: f.home, USERPROFILE: f.home, HASNA_HOME: join(f.home, ".hasna"), HASNA_SKILLS_DIR: f.dataDir, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: tmpdir(), NO_COLOR: "1" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  };
  const preview = await run([]);
  expect(preview.exitCode).toBe(0); expect(preview.stderr).toBe("");
  expect(JSON.parse(preview.stdout).witness.sha256).toBe(planCodexSemanticCacheWitnessUpgrade(f.options).discoveryAfter![0]!.codexSemanticCache!.witness.sha256);
  const unguarded = await run(["--apply"]);
  expect(unguarded.exitCode).toBe(1); expect(unguarded.stderr).toContain("requires --expected-cache-witness-sha256");
  const foreign = await run([], "claude");
  expect(foreign.exitCode).toBe(1); expect(foreign.stderr).toContain("accepts codex only");
  expect(readFileSync(f.policyPath, "utf8")).toBe(f.policy);
  expect(readFileSync(f.config, "utf8")).toBe(f.settings);
}, 30000);
