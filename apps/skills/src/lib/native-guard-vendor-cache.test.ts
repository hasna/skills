import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (p: string, s: string) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s); };
const payload = (name: string) => `---\nname: ${name}\ndescription: Synthetic vendor cache fixture\n---\nSynthetic native instructions\n`;

// Skill payloads reach agents only through the Skills CLI, with no native
// fallback. Skills that the Codex app materializes in its own plugin cache are
// native copies like any other, so the guard must stop the session and must not
// record an acceptance. The 0.10.40 allowance for this tree was withdrawn before
// publication; this test keeps it from coming back unnoticed.
test("skills in Codex's openai-curated-remote plugin cache stop the guard and are never accepted", () => {
  const home = mkdtempSync(join(tmpdir(), "skills-vendor-cache-refused-")); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  const f = { home, dataDir: join(home, "data"), projectDir: home };
  applyAgentIntegration(planAgentIntegration({ ...f, agents: ["codex"] }));
  expect(() => assertManagedAgentBridge("codex", f)).not.toThrow();
  // Materialize the plugin the way the Codex app does on station04 (sites 0.1.75).
  const plugin = join(home, ".codex", "plugins", "cache", "openai-curated-remote", "sites");
  put(join(plugin, "0.1.75", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "0.1.75", description: "Synthetic plugin" }));
  put(join(plugin, ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: `plugins~Plugin_${"sites".padEnd(32, "0")}` }));
  for (const name of ["sites-building", "sites-hosting", "sites-mcp", "sites-preview-troubleshooting"]) put(join(plugin, "0.1.75", "skills", name, "SKILL.md"), payload(name));
  expect(() => assertManagedAgentBridge("codex", f)).toThrow(/NATIVE_SKILL_DRIFT: 4 unexpected native skill copies/);
  expect(existsSync(join(f.dataDir, "agent-hooks", "codex-vendor-cache-acceptance.json"))).toBe(false);
});
