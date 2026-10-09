import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCodexNativeSkillCatalog, isCodexNativeSkillDisabled, codexPluginSourceIsConfigControlled } from "./codex-native-skill-catalog.js";
import { admitCorpusFixture, wrapNativeInspectionFixture } from "./codex-corpus.fixture.js";
import { connectCodexHookRpc } from "./codex-hook-rpc.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
// Explicit opt-in requires a reviewed native executable. The runner provides a
// synthetic HOME, read-only station files and sandbox-only writable paths.
const binary = process.env.SKILLS_TEST_CODEX_COMMAND;
// The transport holds the shared corpus admission lease, which only native
// enrollment creates. This test measures catalog semantics, not admission: it
// admits its synthetic home through the protocol fixture and passes every other
// invocation, including --version and app-server, to the reviewed executable.
const admittedNativeCommand = (home: string): string => {
  const command = join(home, "native-codex");
  writeFileSync(command, wrapNativeInspectionFixture(`#!/bin/sh\nexec '${binary!.replaceAll("'", "'\\''")}' "$@"\n`), { mode: 0o700 });
  return command;
};
test.skipIf(!binary)("native catalog preserves exact ordered name controls across path changes", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-native-catalog-"));
  const codexHome = join(home, ".codex"), folder = join(home, ".agents/skills/vendor"), bridge = join(home, ".agents/skills/skills-cli");
  const document = join(folder, "SKILL.md"), config = join(codexHome, "config.toml");
  const base = 'model = "synthetic"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Synthetic unauthenticated provider"\nbase_url = "https://native-catalog.invalid/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n';
  try {
    for (const path of [codexHome, folder, bridge]) mkdirSync(path, { recursive: true, mode: 0o700 });
    admitCorpusFixture(codexHome);
    const command = admittedNativeCommand(home);
    writeFileSync(document, "---\nname: vendor:deploy\ndescription: Synthetic qualified-name fixture\n---\nSynthetic instruction.\n");
    writeFileSync(join(bridge, "SKILL.md"), "---\nname: skills-cli\ndescription: Synthetic bridge fixture\n---\nSynthetic instruction.\n");
    const capture = async (rules: Array<{ name?: string; path?: string; enabled: boolean }>) => {
      writeFileSync(config, base + rules.map(rule => `\n[[skills.config]]\n${rule.name === undefined ? `path = ${JSON.stringify(rule.path)}` : `name = ${JSON.stringify(rule.name)}`}\nenabled = ${rule.enabled}\n`).join(""), { mode: 0o600 });
      const original = readFileSync(config);
      const catalog = await captureCodexNativeSkillCatalog({ command, home, codexHome, cwd: home });
      expect(readFileSync(config)).toEqual(original);
      if (process.env.SKILLS_TEST_CODEX_VERSION) expect(catalog.version).toBe(process.env.SKILLS_TEST_CODEX_VERSION);
      expect(catalog.plugins).toEqual([]);
      expect(catalog.skills.find(skill => skill.name === "skills-cli")?.enabled).toBe(true);
      return catalog;
    };
    const cases = [
      { rules: [], disabled: false },
      { rules: [{ name: "deploy", enabled: false }], disabled: false },
      { rules: [{ name: "vendor:*", enabled: false }], disabled: false },
      { rules: [{ name: "vendor:deploy", enabled: false }], disabled: true },
      { rules: [{ name: "vendor:deploy", enabled: false }, { path: document, enabled: true }], disabled: false },
      { rules: [{ path: document, enabled: true }, { name: "vendor:deploy", enabled: false }], disabled: true },
    ];
    for (const { rules, disabled } of cases) {
      const catalog = await capture(rules), skill = catalog.skills.find(skill => skill.name === "vendor:deploy");
      expect(skill).toBeDefined();
      expect(skill!.enabled).toBe(!disabled);
      expect(isCodexNativeSkillDisabled(skill!, rules)).toBe(disabled);
    }
    const relocated = join(home, ".agents/skills/vendor-new");
    renameSync(folder, relocated);
    const catalog = await capture([{ name: "vendor:deploy", enabled: false }]);
    const skill = catalog.skills.find(skill => skill.name === "vendor:deploy")!;
    expect(skill.path).toBe(join(relocated, "SKILL.md"));
    expect(skill.enabled).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 60000);

// Exercise a genuine local installation as well as the empty plugin inventory.
// Every registration, cache and configuration here belongs to this test home.
test.skipIf(!binary)("native catalog binds local installation source and exact disabled plugin controls", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-native-local-plugin-"));
  const codexHome = join(home, ".codex"), marketplace = join(home, "marketplace"), source = join(marketplace, "input/vendor");
  try {
    for (const path of [codexHome, join(source, ".codex-plugin"), join(source, "skills/deploy"), join(marketplace, ".agents/plugins")])
      mkdirSync(path, { recursive: true, mode: 0o700 });
    admitCorpusFixture(codexHome);
    const command = admittedNativeCommand(home);
    writeFileSync(join(source, ".codex-plugin/plugin.json"), JSON.stringify({ name: "vendor", version: "1.0.0" }));
    writeFileSync(join(source, "skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: Synthetic local plugin fixture\n---\nSynthetic instruction.\n");
    const marketplacePath = join(marketplace, ".agents/plugins/marketplace.json");
    writeFileSync(marketplacePath, JSON.stringify({ name: "probe", plugins: [{ name: "vendor", source: { source: "local", path: "./input/vendor" } }] }));
    writeFileSync(join(codexHome, "config.toml"), 'model = "synthetic"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Synthetic unauthenticated provider"\nbase_url = "https://native-catalog.invalid/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n', { mode: 0o600 });
    const rpc = await connectCodexHookRpc({ command, home, codexHome });
    try { await rpc.request("plugin/install", { marketplacePath, pluginName: "vendor" }); }
    finally { await rpc.close(); }
    const capture = () => captureCodexNativeSkillCatalog({ command, home, codexHome, cwd: marketplace });
    const catalog = await capture();
    if (process.env.SKILLS_TEST_CODEX_VERSION) expect(catalog.version).toBe(process.env.SKILLS_TEST_CODEX_VERSION);
    const plugin = catalog.plugins?.find(plugin => plugin.id === "vendor@probe");
    expect(plugin).toBeDefined();
    expect(plugin).toMatchObject({ name: "vendor", installed: true, enabled: true, sourceType: "local", sourcePath: source });
    expect(codexPluginSourceIsConfigControlled(plugin!)).toBe(true);
    const skill = catalog.skills.find(skill => skill.pluginId === "vendor@probe");
    expect(skill).toMatchObject({ name: "vendor:deploy", enabled: true });
    const config = join(codexHome, "config.toml"), original = readFileSync(config, "utf8");
    writeFileSync(config, original + '\n[[skills.config]]\nname = "vendor:deploy"\nenabled = false\n');
    const disabled = await capture();
    expect(disabled.plugins?.find(plugin => plugin.id === "vendor@probe")).toEqual(plugin);
    expect(disabled.skills.find(skill => skill.pluginId === "vendor@probe")?.enabled).toBe(false);
    writeFileSync(config, original.replace('enabled = true', 'enabled = false'));
    const inactive = await capture();
    expect(inactive.plugins?.find(plugin => plugin.id === "vendor@probe")).toMatchObject({ installed: true, enabled: false, sourceType: "local", sourcePath: source });
    expect(inactive.skills.filter(skill => skill.pluginId === "vendor@probe")).toEqual([]);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 60000);

test.skipIf(!binary)("native hook transport reads hooks and paginated features and guards config writes by version", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-native-hooks-")), codexHome = join(home, ".codex");
  try {
    mkdirSync(codexHome, { mode: 0o700 }); admitCorpusFixture(codexHome);
    const command = admittedNativeCommand(home), configPath = join(codexHome, "config.toml");
    writeFileSync(configPath, 'model = "synthetic"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Synthetic unauthenticated provider"\nbase_url = "https://native-hooks.invalid/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n', { mode: 0o600 });
    const rpc = await connectCodexHookRpc({ command, home, codexHome });
    try {
      if (process.env.SKILLS_TEST_CODEX_VERSION) expect(rpc.version).toBe(process.env.SKILLS_TEST_CODEX_VERSION);
      const hooks = await rpc.request("hooks/list", { cwds: [home] });
      expect(hooks.data).toHaveLength(1); expect(hooks.data[0]).toMatchObject({ cwd: home, hooks: [], errors: [], warnings: [] });
      let cursor: string | null = null, pages = 0;
      const cursors = new Set<string>();
      do {
        const features = await rpc.request("experimentalFeature/list", { limit: 1, cursor });
        expect(Array.isArray(features.data)).toBe(true); expect(features.data.length).toBeLessThanOrEqual(1);
        cursor = features.nextCursor ?? null;
        if (cursor !== null) { expect(typeof cursor).toBe("string"); expect(cursors.has(cursor)).toBe(false); cursors.add(cursor); }
        expect(++pages).toBeLessThan(256);
      } while (cursor !== null);
      expect(pages).toBeGreaterThan(1);
      const configuration = await rpc.request("config/read", { includeLayers: true, cwd: home });
      const layers = configuration.layers.filter((layer: any) => layer.name.type === "user" && layer.name.file === configPath);
      expect(layers).toHaveLength(1); expect(layers[0].version).toMatch(/^sha256:[a-f0-9]{64}$/);
      const params = { edits: [{ keyPath: "skills.config", value: [{ name: "synthetic:deploy", enabled: false }], mergeStrategy: "replace" }],
        filePath: configPath, expectedVersion: layers[0].version, reloadUserConfig: true };
      const result = await rpc.request("config/batchWrite", params);
      expect(result).toMatchObject({ status: "ok", filePath: configPath }); expect(result.version).not.toBe(layers[0].version);
      const original = readFileSync(configPath);
      expect((Bun.TOML.parse(original.toString()) as any).skills.config).toEqual([{ name: "synthetic:deploy", enabled: false }]);
      await expect(rpc.request("config/batchWrite", params)).rejects.toThrow("CODEX_HOOK_TRUST_NATIVE_RPC_REFUSED");
      expect(readFileSync(configPath)).toEqual(original);
    } finally { await rpc.close(); }
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 30000);
