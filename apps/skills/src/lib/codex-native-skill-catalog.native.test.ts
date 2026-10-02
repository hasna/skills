import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCodexNativeSkillCatalog, isCodexNativeSkillDisabled } from "./codex-native-skill-catalog.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
// Explicit opt-in requires a reviewed native executable. The runner provides a
// synthetic HOME, read-only station files and sandbox-only writable paths.
const binary = process.env.SKILLS_TEST_CODEX_COMMAND;
test.skipIf(!binary)("native catalog preserves exact ordered name controls across path changes", async () => {
  const home = mkdtempSync(join(tmpdir(), "skills-native-catalog-"));
  const codexHome = join(home, ".codex"), folder = join(home, ".agents/skills/vendor"), bridge = join(home, ".agents/skills/skills-cli");
  const document = join(folder, "SKILL.md"), config = join(codexHome, "config.toml");
  const base = 'model = "synthetic"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Synthetic unauthenticated provider"\nbase_url = "https://native-catalog.invalid/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n';
  try {
    for (const path of [codexHome, folder, bridge]) mkdirSync(path, { recursive: true, mode: 0o700 });
    writeFileSync(document, "---\nname: vendor:deploy\ndescription: Synthetic qualified-name fixture\n---\nSynthetic instruction.\n");
    writeFileSync(join(bridge, "SKILL.md"), "---\nname: skills-cli\ndescription: Synthetic bridge fixture\n---\nSynthetic instruction.\n");
    const capture = async (rules: Array<{ name?: string; path?: string; enabled: boolean }>) => {
      writeFileSync(config, base + rules.map(rule => `\n[[skills.config]]\n${rule.name === undefined ? `path = ${JSON.stringify(rule.path)}` : `name = ${JSON.stringify(rule.name)}`}\nenabled = ${rule.enabled}\n`).join(""), { mode: 0o600 });
      const original = readFileSync(config);
      const catalog = await captureCodexNativeSkillCatalog({ command: binary!, home, codexHome, cwd: home });
      expect(readFileSync(config)).toEqual(original);
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
}, 30000);
