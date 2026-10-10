import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { hashNativeJsonControls } from "./claude-settings-witness.js";
import { captureCodexSemanticCacheWitness, assertCodexSemanticCacheWitnessUnchanged, type CodexSemanticCacheAppOnlyParent } from "./codex-semantic-cache-witness.js";
import type { CodexPluginSkillControl } from "./codex-plugin-skill-controls.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (path: string, value: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, value); };

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "skills-codex-semantic-cache-")); roots.push(home);
  const cacheRoot = join(home, ".codex/plugins/cache"), pluginParent = join(cacheRoot, "probe/vendor");
  const receipt = JSON.stringify({ schema_version: 1, remote_plugin_id: "remote-vendor-1" });
  put(join(pluginParent, ".codex-remote-plugin-install.json"), receipt);
  const addVersion = (version: string, skillPath = "skills/deploy/SKILL.md") => {
    const root = join(pluginParent, version), manifest = JSON.stringify({ name: "vendor", version });
    const document = join(root, skillPath);
    put(join(root, ".codex-plugin/plugin.json"), manifest);
    put(document, "---\nname: deploy\ndescription: Synthetic cache fixture\n---\nDisabled content");
    return { root, document, manifest };
  };
  const old = addVersion("1.0.0");
  const controls: CodexPluginSkillControl[] = [{
    name: "vendor:deploy", pluginId: "vendor@probe", namespace: "vendor", pluginParent,
    manifestSha256: hashNativeJsonControls(old.manifest, "version"), remotePluginId: "remote-vendor-1",
  }];
  const rules: Array<{ name?: string; path?: string; enabled: boolean }> = [{ name: "vendor:deploy", enabled: false }];
  const read = (path: string) => readFileSync(path, "utf8");
  const capture = (nextControls = controls, nextRules: unknown = rules, appOnlyParents: CodexSemanticCacheAppOnlyParent[] = [], nextRead = read) =>
    captureCodexSemanticCacheWitness({ cacheRoot, controls: nextControls, appOnlyParents, rules: nextRules, read: nextRead });
  return { home, cacheRoot, pluginParent, old, addVersion, controls, rules, capture, read };
}

function witnessHash(projection: unknown): string {
  const encode = (value: any): string => value === null || typeof value !== "object" ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(encode).join(",")}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode(value[key])}`).join(",")}}`;
  return createHash("sha256").update(encode(projection)).digest("hex");
}

test("inert assets and equivalent plugin-version materializations preserve the semantic witness", () => {
  const f = fixture();
  f.rules.push({ path: f.old.document, enabled: false });
  const before = f.capture();
  put(join(f.old.root, "assets/readme.txt"), "First inert asset");
  put(join(f.old.root, "assets/readme.txt"), "Changed inert asset");
  const next = f.addVersion("3.0.0", "nested/skills/deploy/SKILL.md");
  put(join(next.root, "assets/readme.txt"), "Version-specific inert asset");
  const after = f.capture();
  expect(after.skills).toEqual(before.skills);
  expect(after.sha256).toBe(before.sha256);
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, after)).not.toThrow();
});

test("duplicate qualified identities inside one version root refuse, while matching names across roots are valid", () => {
  const f = fixture();
  f.addVersion("3.0.0");
  expect(() => f.capture()).not.toThrow();
  put(join(f.old.root, "alternate/deploy/SKILL.md"), "---\nname: deploy\ndescription: Duplicate identity\n---\nDisabled");
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("every skill-bearing version root must contain the complete reviewed skill set", () => {
  const f = fixture();
  const emptyVersion = f.addVersion("2.0.0");
  rmSync(emptyVersion.document);
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("a capability manifest changed during its read cannot produce a mixed witness", () => {
  const f = fixture(), manifestPath = join(f.old.root, ".codex-plugin/plugin.json");
  let changed = false;
  const racingRead = (path: string) => {
    const value = f.read(path);
    if (path === manifestPath && !changed) {
      changed = true;
      writeFileSync(path, JSON.stringify({ name: "vendor", version: "1.0.0", description: "Changed during capture" }));
    }
    return value;
  };
  expect(() => f.capture(f.controls, f.rules, [], racingRead)).toThrow();
});

test("a skill added during capture changes the final census and refuses", () => {
  const f = fixture();
  let added = false;
  const racingRead = (path: string) => {
    const value = f.read(path);
    if (path === f.old.document && !added) {
      added = true;
      put(join(f.old.root, "skills/added/SKILL.md"), "---\nname: added\ndescription: Concurrent addition\n---\nDisabled");
    }
    return value;
  };
  expect(() => f.capture(f.controls, f.rules, [], racingRead)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("same-sized document rename during the final verification read refuses", () => {
  const f = fixture();
  let reads = 0;
  const racingRead = (path: string) => {
    const value = f.read(path);
    if (path === f.old.document && ++reads === 3) put(path, value.replace("name: deploy", "name: shipxx"));
    return value;
  };
  expect(() => f.capture(f.controls, f.rules, [], racingRead)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("ambiguous qualified names across plugin parents refuse", () => {
  const f = fixture(), parent = join(f.cacheRoot, "other/vendor"), root = join(parent, "1.0.0");
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "remote-vendor-2" }));
  const manifest = JSON.stringify({ name: "vendor", version: "1.0.0" });
  put(join(root, ".codex-plugin/plugin.json"), manifest);
  put(join(root, "skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: Duplicate qualified identity\n---\nDisabled");
  const ambiguous = [...f.controls, { ...f.controls[0]!, pluginId: "vendor@other", pluginParent: parent, remotePluginId: "remote-vendor-2" }];
  expect(() => f.capture(ambiguous)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("same-count qualified skill replacement is refused even when its new rule is disabled", () => {
  const f = fixture(), before = f.capture();
  put(f.old.document, "---\nname: ship\ndescription: Synthetic cache fixture\n---\nDisabled content");
  const replacedControls: CodexPluginSkillControl[] = [{ ...f.controls[0]!, name: "vendor:ship" }];
  const after = f.capture(replacedControls, [{ name: "vendor:ship", enabled: false }]);
  expect(after.skills).toHaveLength(before.skills.length);
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, after)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("new plugin parents and unreviewed skill names refuse instead of refreshing the baseline", () => {
  const f = fixture(), before = f.capture();
  const extra = join(f.cacheRoot, "probe/other/1.0.0");
  put(join(extra, ".codex-plugin/plugin.json"), '{"name":"other","version":"1.0.0"}');
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  rmSync(join(f.cacheRoot, "probe/other"), { recursive: true });
  put(join(f.old.root, "skills/new-skill/SKILL.md"), "---\nname: new-skill\ndescription: New\n---\nDisabled");
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(before.sha256).toMatch(/^[a-f0-9]{64}$/);
});

test("missing and renamed plugin parents refuse against the original parent identity", () => {
  const f = fixture();
  const renamed = join(f.cacheRoot, "probe/renamed-vendor");
  rmSync(f.pluginParent, { recursive: true });
  put(join(renamed, "1.0.0/.codex-plugin/plugin.json"), '{"name":"vendor","version":"1.0.0"}');
  put(join(renamed, "1.0.0/skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: Synthetic cache fixture\n---\nDisabled content");
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("conflicting enabled rules, changed capability controls, and aliases fail closed", () => {
  const f = fixture(), before = f.capture();
  expect(() => f.capture(f.controls, [{ name: "vendor:deploy", enabled: false }, { name: "vendor:deploy", enabled: true }]))
    .toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");

  const appPath = join(f.old.root, ".app.json");
  put(join(f.old.root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "vendor", version: "1.0.0", apps: "./.app.json" }));
  put(appPath, '{"apps":{"connector":{"id":"synthetic_connector","required":true}}}');
  const appControls = [{ ...f.controls[0]!, manifestSha256: hashNativeJsonControls(JSON.stringify({ name: "vendor", version: "1.0.0", apps: "./.app.json" }), "version"), appSha256: hashNativeJsonControls(readFileSync(appPath, "utf8")) }];
  const appWitness = f.capture(appControls);
  put(appPath, '{"apps":{"connector":{"id":"changed_connector","required":true}}}');
  expect(() => f.capture(appControls)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, appWitness)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");

});

test("valid baseline refuses symlinks, special files, and enabled alias-path conflicts", () => {
  const f = fixture(), alias = join(f.home, "alias.md");
  const before = f.capture();
  symlinkSync(f.old.document, alias);
  expect(() => f.capture(f.controls, [{ path: alias, enabled: true }, { name: "vendor:deploy", enabled: false }]))
    .toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, f.capture())).not.toThrow();
  rmSync(alias);

  const fifo = join(f.old.root, "assets/special-pipe");
  mkdirSync(join(f.old.root, "assets"), { recursive: true });
  const created = Bun.spawnSync(["/usr/bin/mkfifo", fifo]);
  if (created.exitCode !== 0) throw new Error(`synthetic FIFO fixture creation failed: ${created.stderr.toString("utf8")}`);
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("MCP controls, hook capability paths, and remote receipts stay bound", () => {
  const f = fixture(), mcpText = JSON.stringify({ mcpServers: { probe: {
    command: "synthetic-never-executed", args: ["--fixture"], cwd: "${CODEX_PLUGIN_ROOT}", env_vars: ["SKILLS_SYNTHETIC_NAME"],
  } } });
  const manifestText = JSON.stringify({ name: "vendor", version: "1.0.0", mcpServers: "./.mcp.json" });
  put(join(f.old.root, ".codex-plugin/plugin.json"), manifestText);
  put(join(f.old.root, ".mcp.json"), mcpText);
  const mcpControls = [{ ...f.controls[0]!, manifestSha256: hashNativeJsonControls(manifestText, "version"), mcpSha256: hashNativeJsonControls(mcpText) }];
  const mcpWitness = f.capture(mcpControls);
  put(join(f.old.root, ".mcp.json"), mcpText.replace("--fixture", "--changed"));
  expect(() => f.capture(mcpControls)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");

  put(join(f.old.root, ".mcp.json"), mcpText);
  put(join(f.old.root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "vendor", version: "1.0.0", hooks: {} }));
  expect(() => f.capture(mcpControls)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(mcpWitness.sha256).toMatch(/^[a-f0-9]{64}$/);

  put(join(f.old.root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "vendor", version: "1.0.0" }));
  rmSync(join(f.old.root, ".mcp.json"));
  put(join(f.pluginParent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: "different-remote" }));
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("explicit app-only parents bind receipts and every materialization while requiring zero Skills", () => {
  const f = fixture(), parent = join(f.cacheRoot, "openai-curated-remote/pages"), remotePluginId = "remote-pages-1";
  const app = '{"apps":{"pages":{"id":"synthetic_pages_connector","required":true}}}';
  put(join(parent, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: remotePluginId }));
  const addVersion = (version: string, appText = app) => {
    const root = join(parent, version), manifest = JSON.stringify({ name: "pages", version, apps: "./.app.json" });
    put(join(root, ".codex-plugin/plugin.json"), manifest); put(join(root, ".app.json"), appText);
  };
  addVersion("1.0.0");
  const role = [{ role: "app-only" as const, pluginId: "pages@openai-curated-remote", namespace: "pages", pluginParent: parent, remotePluginId }];
  const before = f.capture(f.controls, f.rules, role);
  addVersion("3.0.0");
  const after = f.capture(f.controls, f.rules, role);
  expect(after.appOnlyParents).toEqual(before.appOnlyParents);
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, after)).not.toThrow();

  addVersion("4.0.0", app.replace("synthetic_pages_connector", "changed_connector"));
  expect(() => f.capture(f.controls, f.rules, role)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  addVersion("4.0.0", app);
  put(join(parent, "4.0.0/skills/hidden/SKILL.md"), "---\nname: hidden\ndescription: Not app-only\n---\nDisabled");
  expect(() => f.capture(f.controls, f.rules, role)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(() => f.capture()).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("app-only remote receipts reject duplicate decoded JSON keys like the owning parser", () => {
  const f = fixture(), parent = join(f.cacheRoot, "openai-curated-remote/pages"), remotePluginId = "remote-pages";
  put(join(parent, ".codex-remote-plugin-install.json"),
    '{"schema_version":1,"schema_version":1,"remote_plugin_id":"remote-pages"}');
  const root = join(parent, "1.0.0");
  put(join(root, ".codex-plugin/plugin.json"), JSON.stringify({ name: "pages", version: "1.0.0", apps: "./.app.json" }));
  put(join(root, ".app.json"), '{"apps":{"connector":{"id":"synthetic_connector"}}}');
  const role = [{ role: "app-only" as const, pluginId: "pages@openai-curated-remote", namespace: "pages", pluginParent: parent, remotePluginId }];
  expect(() => f.capture(f.controls, f.rules, role)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});

test("witness digest is recomputed and cannot be used to silently bless changed content", () => {
  const f = fixture(), before = f.capture();
  const forged = { ...before, skills: [{ ...before.skills[0]!, name: "vendor:replacement" }] };
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, forged)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
  expect(createHash("sha256").update(before.sha256).digest("hex")).not.toBe(before.sha256);

  const projection = { schema: before.schema, cacheRoot: "relative/cache", controls: before.controls,
    appOnlyParents: before.appOnlyParents, skills: before.skills };
  const relativeRoot = { ...projection, sha256: witnessHash(projection) } as unknown as typeof before;
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, relativeRoot)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");

  const extraProjection = { schema: before.schema, cacheRoot: before.cacheRoot, controls: before.controls,
    appOnlyParents: before.appOnlyParents, skills: before.skills };
  const unknownField = { ...extraProjection, extra: true, sha256: witnessHash(extraProjection) } as unknown as typeof before;
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, unknownField)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");

  const emptyProjection = { schema: before.schema, cacheRoot: before.cacheRoot, controls: [], appOnlyParents: [], skills: [] };
  const emptyWitness = { ...emptyProjection, sha256: witnessHash(emptyProjection) } as unknown as typeof before;
  expect(() => assertCodexSemanticCacheWitnessUnchanged(before, emptyWitness)).toThrow("CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED");
});
