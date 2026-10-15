import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
import { planAgentIntegration, applyAgentIntegration, assertManagedAgentBridge } from "./agent-integration.js";
import { captureDiscoveryDirectories } from "./agent-discovery.js";
import { captureCodexSettings, captureCodexSettingsV2, captureCodexSettingsV3, captureCodexSettingsV4, captureCodexSettingsV5, hashCodexSettingsReplacementV4 } from "./codex-settings-witness.js";
import { readManagedSkillPolicySnapshot } from "./managed-policy.js";
import { admitCorpusFixture, installCorpusInspectorFixture } from "./codex-corpus.fixture.js";
useDefaultTestTimeout();
let restoreInspector: () => void;
beforeEach(() => { restoreInspector = installCorpusInspectorFixture(); });
afterEach(() => { restoreInspector(); });
const roots: string[] = []; afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const read = (path: string) => readFileSync(path, "utf8");
function refusal(run: () => unknown): string { try { run(); return "ACCEPTED"; } catch (error) { return (error as Error).message; } }

interface Station { home: string; dataDir: string; projectDir: string; config: string; vendor: string }
const CAPTURES = { "codex-settings-v1": captureCodexSettings, "codex-settings-v2": captureCodexSettingsV2, "codex-settings-v3": captureCodexSettingsV3, "codex-settings-v4": captureCodexSettingsV4, "codex-settings-v5": captureCodexSettingsV5 } as const;
/** A reviewed binding with one typed settings witness, as fleet stations hold (V4 on 02, 10 and 15). */
const REMOTE_ID = "plugins_synthetic_00_0000000000000000000";
function reviewed(mode: keyof typeof CAPTURES = "codex-settings-v4", initial = "[tui]\nalternate_screen = \"never\"\n", vendorCopy = false): Station {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-receipt-bridge-"))); roots.push(home); admitCorpusFixture(join(home, ".codex"));
  const s = { home, dataDir: join(home, "data"), projectDir: home, config: join(home, ".codex", "config.toml"), vendor: join(home, ".codex", "plugins", "cache", "openai-curated-remote") };
  put(join(s.vendor, "sites", ".codex-remote-plugin-install.json"), JSON.stringify({ schema_version: 1, remote_plugin_id: REMOTE_ID }));
  if (vendorCopy) {
    // A remote vendor copy already disabled by exact path at review time.
    const document = join(s.vendor, "sites", "1.0.1", "skills", "sites", "SKILL.md");
    put(join(s.vendor, "sites", "1.0.1", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "sites", version: "1.0.1", description: "Synthetic plugin" }));
    put(document, "---\nname: sites\ndescription: Synthetic\n---\nSynthetic native instructions\n");
    initial += `\n[[skills.config]]\npath = ${JSON.stringify(document)}\nenabled = false\n`;
  }
  mkdirSync(join(home, ".codex", "plugins", "cache", "hasna-internal-bridge", "hasna-codex"), { recursive: true });
  put(s.config, initial);
  const review = { version: 1 as const, agents: [{ agent: "codex" as const, roots: [], sources: [CAPTURES[mode](s.config)], directories: captureDiscoveryDirectories([s.vendor]), pluginHooks: "reviewed-no-skill-injection" as const }] };
  applyAgentIntegration(planAgentIntegration({ home, dataDir: s.dataDir, projectDir: home, agents: ["codex"], discoveryInputs: review }));
  expect(readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.discovery.codex.sources.some((source: any) => source.path === s.config && source.hashMode === mode)).toBe(true);
  expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
  return s;
}
const opts = (s: Station, projectDir = s.projectDir) => ({ home: s.home, dataDir: s.dataDir, projectDir });
const live = (s: Station, projectDir = s.projectDir) => ({ ...opts(s, projectDir), codexPromptHook: true });
const INPUT = (s: Station) => `NATIVE_SKILL_DRIFT: Native discovery input changed; run skills hook install with a fresh discovery review: ${s.config}`;
/** Exactly what Codex 0.162.1 writes: toml_edit inserts into the existing `[tui]` table. */
const receipt = (s: Station) => writeFileSync(s.config, read(s.config).replace("[tui]\n", "[tui]\nscreen_reader_detection_done = true\n"));
const trust = (s: Station, dir: string, level = "trusted") => writeFileSync(s.config, `${read(s.config).trimEnd()}\n\n[projects.${JSON.stringify(dir)}]\ntrust_level = ${JSON.stringify(level)}\n`);
const project = (s: Station, name = "work") => { const dir = join(s.home, "repos", name); mkdirSync(dir, { recursive: true }); return dir; };

const stored = (s: Station) => readManagedSkillPolicySnapshot(s.dataDir)!.value.bridge.discovery.codex.sources.find((source: any) => source.path === s.config && source.hashMode === "codex-settings-v4").sha256 as string;
/** A planned Skills write to config.toml without a fresh discovery review:
 * enrolling the vendor plugin from a native catalog adds a qualified-name disable row. */
const plannedWrite = (s: Station) => refusal(() => applyAgentIntegration(planAgentIntegration({ home: s.home, dataDir: s.dataDir, projectDir: s.home, agents: ["codex"], codexNativeCatalog: { version: "codex-cli 0.160.0", cwd: s.home, skills: [], plugins: [{ id: "sites@openai-curated-remote", name: "sites", installed: true, enabled: true, localVersion: null, remotePluginId: REMOTE_ID, sourceType: "remote" as const }] } })));

describe("the Codex screen-reader receipt keeps existing typed bindings current without a rebind", () => {
  for (const mode of Object.keys(CAPTURES) as Array<keyof typeof CAPTURES>) test(`${mode}: the receipt alone is accepted by the strict guard and the live hook`, () => {
    const s = reviewed(mode), policy = readFileSync(join(s.dataDir, "agent-policy.json"));
    receipt(s);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
    expect(assertManagedAgentBridge("codex", live(s))).toEqual({ codexInertVendorCopies: [], codexDiscoveryChanges: [] });
    // Nothing is recorded or rebound.
    expect(readFileSync(join(s.dataDir, "agent-policy.json")).equals(policy)).toBe(true);
  });

  test("project trust entries, other TUI keys and non-boolean receipts still drift", () => {
    const changes: Array<(s: Station) => void> = [
      s => trust(s, project(s)),
      s => { receipt(s); trust(s, project(s)); },
      s => trust(s, project(s), "untrusted"),
      s => writeFileSync(s.config, read(s.config).replace("[tui]\n", "[tui]\nscreen_reader_detection_done = \"true\"\n")),
      s => writeFileSync(s.config, read(s.config).replace("[tui]\n", "[tui]\nscreen_reader_detection_done = true\nanimations = false\n")),
      s => { receipt(s); writeFileSync(s.config, `approval_policy = "never"\n${read(s.config)}`); },
    ];
    for (const change of changes) {
      const s = reviewed();
      change(s);
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(INPUT(s));
      expect(refusal(() => assertManagedAgentBridge("codex", live(s)))).toBe(INPUT(s));
    }
  });

  test("a planned config.toml write adopts at most the boolean receipt into the reviewed baseline", () => {
    // Control: without the receipt the planned write rebinds to the written document.
    const control = reviewed("codex-settings-v4", undefined, true);
    expect(plannedWrite(control)).toBe("ACCEPTED");
    expect(read(control.config)).toContain('name = "sites:sites"');
    // Receipt only: the write proceeds and the written document becomes the baseline.
    // Only the benign boolean receipt was adopted with it.
    const s = reviewed("codex-settings-v4", undefined, true);
    receipt(s);
    const before = stored(s);
    expect(plannedWrite(s)).toBe("ACCEPTED");
    const written = read(s.config);
    expect(written).toContain("screen_reader_detection_done = true");
    expect(written).toContain('name = "sites:sites"');
    expect(written.replace("screen_reader_detection_done = true\n", "")).toBe(read(control.config).replaceAll(control.home, s.home));
    expect(stored(s)).not.toBe(before);
    expect(stored(s)).toBe(hashCodexSettingsReplacementV4(written));
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe("ACCEPTED");
    // After adoption, anything else still drifts, including a trusted folder.
    for (const change of [(t: Station) => trust(t, project(t)), (t: Station) => writeFileSync(t.config, read(t.config).replace("[tui]\n", "[tui]\nanimations = false\n"))]) {
      change(s);
      expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(INPUT(s));
      writeFileSync(s.config, written);
    }
    // Any other unreviewed difference, alone or beside the receipt: the planned
    // write refuses and adopts nothing.
    const others: Array<(t: Station) => void> = [
      t => trust(t, project(t)),
      t => writeFileSync(t.config, read(t.config).replace("[tui]\n", "[tui]\nanimations = false\n")),
      t => writeFileSync(t.config, read(t.config).replace("[tui]\n", "[tui]\nscreen_reader_detection_done = \"true\"\n")),
      t => writeFileSync(t.config, `approval_policy = "never"\n${read(t.config)}`),
    ];
    // A non-boolean receipt cannot sit beside the boolean one (duplicate TOML key).
    for (const [change, withReceipt] of others.flatMap((change, index) => index === 2 ? [[change, false] as const] : [[change, false], [change, true]] as const)) {
      const t = reviewed("codex-settings-v4", undefined, true);
      if (withReceipt) receipt(t);
      change(t);
      const config = read(t.config), policy = readFileSync(join(t.dataDir, "agent-policy.json"));
      // Retained-review installation names the explicit review form; the live
      // guard above retains its shorter refusal. Both leave original bytes intact.
      expect(plannedWrite(t)).toBe(`${INPUT(t)}. This agent reuses a saved discovery review and that review no longer verifies, so a fresh explicit review is required: skills hook install --agent codex --discovery-inputs <review> --apply.`);
      expect(read(t.config)).toBe(config);
      expect(readFileSync(join(t.dataDir, "agent-policy.json")).equals(policy)).toBe(true);
    }
  });

  test("on the live hook, a vendor plugin refresh beside the receipt keeps its visible warning", () => {
    const s = reviewed();
    receipt(s);
    writeFileSync(s.config, `${read(s.config).trimEnd()}\n\n[plugins."sites@openai-curated-remote"]\nenabled = false\n`);
    expect(refusal(() => assertManagedAgentBridge("codex", opts(s)))).toBe(INPUT(s));
    expect(assertManagedAgentBridge("codex", live(s)).codexDiscoveryChanges).toEqual([{ kind: "input", path: s.config }]);
  });
});
